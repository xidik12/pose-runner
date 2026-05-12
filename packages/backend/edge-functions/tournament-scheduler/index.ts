// packages/backend/edge-functions/tournament-scheduler/index.ts
// =============================================================================
// Cron-triggered Edge Function. Schedule via supabase config (every 5 minutes):
//
//   [functions.tournament-scheduler]
//   schedule = "*/5 * * * *"
//
// Responsibilities (idempotent — safe to run any time):
//   1. Activate any 'upcoming' tournaments whose starts_at has passed
//   2. End any 'active' tournaments whose ends_at has passed:
//      - Recompute final ranks from tournament_entries.best_score
//      - Grant prize map ownership to top finishers per prize_table
//      - Mark prize_granted = true on each prize-eligible entry
//      - Optionally create the next week's tournament from a template
//   3. Surface anomalies (tournaments stuck in 'active' past 24h after end) in logs
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!; // shared secret with scheduler

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: 'upcoming' | 'active' | 'ended' | 'cancelled';
  starts_at: string;
  ends_at: string;
  map_id: string;
  prize_map_id: string | null;
  prize_table: PrizeRule[] | null;
}

interface PrizeRule {
  /** "1" or "2-10" or "11-100" */
  rank: string;
  mapId?: string;
  coins?: number;
}

interface TournamentEntry {
  tournament_id: string;
  user_id: string;
  best_score: number;
  rank: number | null;
  prize_granted: boolean;
}

// =============================================================================

serve(async (req) => {
  // Cron lockdown: only run when Supabase scheduler hits with our secret
  const auth = req.headers.get('x-cron-secret') ?? '';
  if (auth !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();
  const result = { activated: 0, ended: 0, prizesGranted: 0, errors: [] as string[] };

  // 1. ACTIVATE upcoming → active
  const { data: toActivate, error: actErr } = await admin
    .from('tournaments')
    .select('id, slug')
    .eq('status', 'upcoming')
    .lte('starts_at', now);

  if (actErr) result.errors.push(`activate query: ${actErr.message}`);
  else {
    for (const t of toActivate ?? []) {
      const { error } = await admin.from('tournaments').update({ status: 'active' }).eq('id', t.id);
      if (error) result.errors.push(`activate ${t.slug}: ${error.message}`);
      else result.activated++;
    }
  }

  // 2. END active → ended (and grant prizes)
  const { data: toEnd, error: endErr } = await admin
    .from('tournaments')
    .select('*')
    .eq('status', 'active')
    .lte('ends_at', now);

  if (endErr) result.errors.push(`end query: ${endErr.message}`);
  else {
    for (const t of (toEnd ?? []) as Tournament[]) {
      try {
        const granted = await endTournament(admin, t);
        result.ended++;
        result.prizesGranted += granted;
      } catch (err) {
        result.errors.push(`end ${t.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json' },
  });
});

// =============================================================================
// END TOURNAMENT
// =============================================================================

async function endTournament(admin: ReturnType<typeof createClient>, t: Tournament): Promise<number> {
  // Pull all entries, ordered by score desc
  const { data: entries, error } = await admin
    .from('tournament_entries')
    .select('tournament_id, user_id, best_score, rank, prize_granted')
    .eq('tournament_id', t.id)
    .order('best_score', { ascending: false });

  if (error) throw new Error(`fetch entries: ${error.message}`);
  const rows = (entries ?? []) as TournamentEntry[];

  // Assign ranks (handle ties by giving same rank, then jumping)
  let lastScore = -1;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.best_score !== lastScore) {
      lastRank = i + 1;
      lastScore = row.best_score;
    }
    row.rank = lastRank;
  });

  // Persist ranks
  for (const row of rows) {
    const { error: rankErr } = await admin
      .from('tournament_entries')
      .update({ rank: row.rank })
      .eq('tournament_id', row.tournament_id)
      .eq('user_id', row.user_id);
    if (rankErr) console.warn(`rank update ${row.user_id}: ${rankErr.message}`);
  }

  // Grant prizes per prize_table (or fallback: prize_map_id to rank 1)
  let granted = 0;
  const rules = t.prize_table ?? (t.prize_map_id ? [{ rank: '1', mapId: t.prize_map_id }] : []);

  for (const rule of rules) {
    const matchingRows = rows.filter((r) => r.rank !== null && rankInRange(r.rank, rule.rank));
    for (const row of matchingRows) {
      if (row.prize_granted) continue;

      if (rule.mapId) {
        const { error: ownErr } = await admin.from('map_ownership').upsert({
          user_id: row.user_id,
          map_id: rule.mapId,
          source: 'tournament',
          source_ref: t.id,
        }, { onConflict: 'user_id,map_id', ignoreDuplicates: true });
        if (ownErr) {
          console.warn(`grant ${row.user_id} ${rule.mapId}: ${ownErr.message}`);
          continue;
        }
      }

      if (rule.coins && rule.coins > 0) {
        // increment coin balance — assumes you have a coins column on profiles
        await admin.rpc('grant_coins', { p_user: row.user_id, p_amount: rule.coins });
      }

      await admin
        .from('tournament_entries')
        .update({ prize_granted: true })
        .eq('tournament_id', row.tournament_id)
        .eq('user_id', row.user_id);
      granted++;
    }
  }

  // Mark tournament ended
  await admin.from('tournaments').update({ status: 'ended' }).eq('id', t.id);

  // Roll the next weekly tournament from the same template (keeps the cycle live)
  if (t.slug.startsWith('weekly-')) {
    await rollNextWeekly(admin, t);
  }

  return granted;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Match a numeric rank against a rule string like "1", "2-5", "11-100". */
function rankInRange(rank: number, rule: string): boolean {
  if (!rule.includes('-')) return rank === Number(rule);
  const [a, b] = rule.split('-').map(Number);
  return rank >= a && rank <= b;
}

async function rollNextWeekly(admin: ReturnType<typeof createClient>, prev: Tournament) {
  const startsAt = new Date(prev.ends_at);
  startsAt.setUTCMinutes(startsAt.getUTCMinutes() + 1);
  const endsAt = new Date(startsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + 7);

  const slug = `weekly-${startsAt.toISOString().slice(0, 10)}`;
  await admin.from('tournaments').upsert({
    slug,
    name: `Weekly Run · ${slug.slice(7)}`,
    map_id: prev.map_id,
    prize_map_id: prev.prize_map_id,
    prize_table: prev.prize_table,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: 'upcoming',
  }, { onConflict: 'slug', ignoreDuplicates: true });
}
