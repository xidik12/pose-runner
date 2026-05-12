-- packages/backend/migrations/20260101_001_initial.sql
-- =============================================================================
-- Pose-Runner backend schema for Supabase (Postgres 15+).
-- Apply via: supabase db push   OR psql -f this file
-- =============================================================================

-- All tables use Supabase auth's `auth.users` as the user identity source.

-- =============================================================================
-- 1. PROFILES (1:1 with auth.users)
-- =============================================================================

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name  text not null,
  avatar_url    text,
  country_code  text check (length(country_code) = 2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- aggregates (denormalized for cheap leaderboard reads)
  total_score   bigint not null default 0,
  total_runs    integer not null default 0,
  total_coins   bigint not null default 0,
  best_streak_days integer not null default 0,
  current_streak_days integer not null default 0,
  last_played_at timestamptz
);

create index profiles_total_score_idx on public.profiles (total_score desc);
create index profiles_username_idx on public.profiles (lower(username));

-- =============================================================================
-- 2. MAPS (content registry; admin-managed)
-- =============================================================================

create type map_tier as enum ('free', 'premium', 'earnable');

create table public.maps (
  id              text primary key,
  name            text not null,
  tagline         text,
  tier            map_tier not null,
  price_usd_cents integer,                -- null for free/earnable
  apple_product_id text,
  google_product_id text,
  difficulty      smallint not null check (difficulty between 1 and 5),
  length_seconds  integer not null,
  manifest        jsonb not null,         -- full MapManifest payload
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index maps_active_tier_idx on public.maps (active, tier);

-- =============================================================================
-- 3. MAP OWNERSHIP
-- =============================================================================

create type ownership_source as enum ('free', 'purchase', 'earned', 'gift', 'tournament', 'gifted-by-friend');

create table public.map_ownership (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  map_id       text not null references public.maps(id),
  source       ownership_source not null,
  acquired_at  timestamptz not null default now(),
  -- For 'gifted-by-friend' / tournament wins, who/what triggered it
  source_ref   text,
  primary key (user_id, map_id)
);

create index map_ownership_user_idx on public.map_ownership (user_id);

-- =============================================================================
-- 4. PURCHASES (raw receipts for audit / refund handling)
-- =============================================================================

create type purchase_platform as enum ('apple', 'google', 'stripe-web');
create type purchase_status as enum ('pending', 'verified', 'failed', 'refunded');

create table public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  platform            purchase_platform not null,
  product_id          text not null,         -- apple/google/stripe SKU
  map_id              text references public.maps(id),
  receipt_blob        text not null,         -- raw verification payload
  transaction_id      text not null,
  original_transaction_id text,
  amount_usd_cents    integer,
  currency            text,
  status              purchase_status not null default 'pending',
  status_detail       text,
  verified_at         timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (platform, transaction_id)
);

create index purchases_user_idx on public.purchases (user_id, created_at desc);
create index purchases_status_idx on public.purchases (status);

-- =============================================================================
-- 5. SCORES + RUNS
-- =============================================================================

create type game_mode as enum ('solo', 'co-op-survival', 'score-battle', 'race', 'tournament');

create table public.runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  map_id          text not null references public.maps(id),
  mode            game_mode not null,
  -- match-level grouping (multiple runs share a match_id for co-op/battle)
  match_id        uuid,
  score           integer not null,
  duration_ms     integer not null,
  coins_collected integer not null default 0,
  obstacles_avoided integer not null default 0,
  obstacles_broken integer not null default 0,
  perfect_stances integer not null default 0,
  jumps           integer not null default 0,
  ducks           integer not null default 0,
  punches         integer not null default 0,
  lane_changes    integer not null default 0,
  died_at_ms      integer,
  client_meta     jsonb,           -- app version, device model, OS version
  -- compressed action event stream (for replays / async ghost runs)
  replay_blob_url text,             -- pointer to Supabase Storage object
  -- anti-cheat heuristics (computed server-side at insertion)
  plausibility    real,             -- 0..1; <0.3 = suspect
  flagged         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index runs_user_map_score_idx on public.runs (user_id, map_id, score desc);
create index runs_map_score_idx on public.runs (map_id, score desc) where flagged = false;
create index runs_match_idx on public.runs (match_id);
create index runs_created_idx on public.runs (created_at desc);

-- =============================================================================
-- 6. UNLOCK PROGRESS (per-user per-rule)
-- =============================================================================

create table public.unlock_progress (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  -- composite "rule key" identifies which rule we're tracking
  -- e.g. 'totalScore:50000', 'mapCompleted:phnom-penh-streets:10'
  rule_key       text not null,
  current_value  bigint not null default 0,
  target_value   bigint not null,
  -- which map this rule unlocks (for fast joins)
  unlocks_map_id text references public.maps(id),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, rule_key)
);

create index unlock_progress_completion_idx on public.unlock_progress (user_id) where completed_at is null;

-- =============================================================================
-- 7. TOURNAMENTS
-- =============================================================================

create type tournament_status as enum ('upcoming', 'active', 'ended', 'cancelled');

create table public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  description     text,
  map_id          text not null references public.maps(id),
  prize_map_id    text references public.maps(id),
  prize_coins     integer not null default 0,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          tournament_status not null default 'upcoming',
  -- top-N positions also win lesser prizes
  prize_table     jsonb,        -- e.g. [{rank: 1, mapId: '...'}, {rank: 2-10, coins: 500}]
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index tournaments_status_starts_idx on public.tournaments (status, starts_at);

create table public.tournament_entries (
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  best_score      integer not null default 0,
  best_run_id     uuid references public.runs(id),
  rank            integer,
  prize_granted   boolean not null default false,
  entered_at      timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create index tournament_entries_score_idx on public.tournament_entries (tournament_id, best_score desc);

-- =============================================================================
-- 8. FRIENDS + ASYNC CHALLENGES (ghost runs)
-- =============================================================================

create type friend_status as enum ('pending', 'accepted', 'blocked');

create table public.friendships (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  friend_id    uuid not null references public.profiles(id) on delete cascade,
  status       friend_status not null default 'pending',
  created_at   timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create index friendships_friend_idx on public.friendships (friend_id, status);

create table public.challenges (
  id            uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  challenged_id uuid not null references public.profiles(id) on delete cascade,
  map_id        text not null references public.maps(id),
  challenger_run_id uuid not null references public.runs(id),
  challenged_run_id uuid references public.runs(id),
  expires_at    timestamptz not null,
  resolved_at   timestamptz,
  winner_id     uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index challenges_challenged_open_idx on public.challenges (challenged_id) where resolved_at is null;

-- =============================================================================
-- 9. ROOMS (for analytics, NOT runtime — broker holds runtime state in memory)
-- =============================================================================

create table public.room_sessions (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  mode          game_mode not null,
  map_id        text not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_ms   integer,
  player_count  smallint not null,
  match_id      uuid,
  meta          jsonb
);

create index room_sessions_started_idx on public.room_sessions (started_at desc);

-- =============================================================================
-- 10. ROW-LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.map_ownership enable row level security;
alter table public.purchases enable row level security;
alter table public.runs enable row level security;
alter table public.unlock_progress enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.friendships enable row level security;
alter table public.challenges enable row level security;

-- Profiles: anyone can read public fields, only owner writes
create policy profiles_read on public.profiles for select using (true);
create policy profiles_write_self on public.profiles for update using (auth.uid() = id);
create policy profiles_insert_self on public.profiles for insert with check (auth.uid() = id);

-- Map ownership: only the owner can see their own
create policy ownership_read_own on public.map_ownership for select using (auth.uid() = user_id);
-- Inserts done by service role only (via Edge Function on receipt verify)

-- Purchases: only owner reads; only service role writes
create policy purchases_read_own on public.purchases for select using (auth.uid() = user_id);

-- Runs: anyone reads (leaderboards), only owner inserts via authed RPC
create policy runs_read_all on public.runs for select using (true);
create policy runs_insert_self on public.runs for insert with check (auth.uid() = user_id);

-- Tournaments are public; entries readable, insertable by owner
create policy tour_entries_read on public.tournament_entries for select using (true);
create policy tour_entries_insert on public.tournament_entries for insert with check (auth.uid() = user_id);
create policy tour_entries_update_self on public.tournament_entries for update using (auth.uid() = user_id);

-- Friendships: read your own
create policy friendships_read_own on public.friendships for select using (auth.uid() = user_id or auth.uid() = friend_id);
create policy friendships_insert_self on public.friendships for insert with check (auth.uid() = user_id);
create policy friendships_update_self on public.friendships for update using (auth.uid() = friend_id);

-- Challenges
create policy challenges_read_involved on public.challenges for select using (auth.uid() = challenger_id or auth.uid() = challenged_id);
create policy challenges_insert_self on public.challenges for insert with check (auth.uid() = challenger_id);

-- =============================================================================
-- 11. RPC FUNCTIONS
-- =============================================================================

-- Bootstrap a profile when a user first signs in
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'player_' || substr(new.id::text, 1, 8),
    coalesce(new.raw_user_meta_data->>'name', 'Runner')
  );
  -- everyone starts owning the free map
  insert into public.map_ownership (user_id, map_id, source)
  values (new.id, 'phnom-penh-streets', 'free');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Submit a run (replaces direct insert; updates aggregates + unlock progress in one txn)
create or replace function public.submit_run(
  p_map_id        text,
  p_mode          game_mode,
  p_match_id      uuid,
  p_score         integer,
  p_duration_ms   integer,
  p_coins         integer,
  p_avoided       integer,
  p_broken        integer,
  p_perfect_stances integer,
  p_jumps         integer,
  p_ducks         integer,
  p_punches       integer,
  p_lanes         integer,
  p_died_at_ms    integer,
  p_client_meta   jsonb,
  p_replay_url    text
) returns uuid language plpgsql security definer as $$
declare
  v_user uuid := auth.uid();
  v_run uuid;
  v_plausibility real;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;

  -- Cheap server-side plausibility: max 25 actions/sec, max 50 pts/sec
  v_plausibility := least(1.0,
    case when p_duration_ms = 0 then 0
         else (p_score::real / (p_duration_ms / 1000.0)) / 50.0
    end
  );

  insert into public.runs (
    user_id, map_id, mode, match_id, score, duration_ms,
    coins_collected, obstacles_avoided, obstacles_broken, perfect_stances,
    jumps, ducks, punches, lane_changes, died_at_ms,
    client_meta, replay_blob_url, plausibility,
    flagged
  ) values (
    v_user, p_map_id, p_mode, p_match_id, p_score, p_duration_ms,
    p_coins, p_avoided, p_broken, p_perfect_stances,
    p_jumps, p_ducks, p_punches, p_lanes, p_died_at_ms,
    p_client_meta, p_replay_url, v_plausibility,
    v_plausibility < 0.3
  ) returning id into v_run;

  -- aggregates
  update public.profiles
  set
    total_score = total_score + p_score,
    total_runs = total_runs + 1,
    total_coins = total_coins + p_coins,
    last_played_at = now()
  where id = v_user;

  -- evaluate unlock rules touched by this run
  perform public.evaluate_unlocks(v_user, p_map_id, p_score);

  return v_run;
end $$;

-- Update progress on relevant unlock rules; grant ownership when complete
create or replace function public.evaluate_unlocks(
  p_user uuid, p_map_id text, p_score integer
) returns void language plpgsql security definer as $$
declare
  r record;
begin
  -- totalScore rule(s)
  for r in
    select up.rule_key, up.target_value, up.unlocks_map_id
    from public.unlock_progress up
    where up.user_id = p_user and up.completed_at is null
      and up.rule_key like 'totalScore:%'
  loop
    update public.unlock_progress
    set current_value = (select total_score from public.profiles where id = p_user),
        updated_at = now()
    where user_id = p_user and rule_key = r.rule_key;

    update public.unlock_progress
    set completed_at = now()
    where user_id = p_user and rule_key = r.rule_key
      and current_value >= target_value and completed_at is null;
  end loop;

  -- mapCompleted rule(s) for the played map
  update public.unlock_progress
  set current_value = current_value + 1, updated_at = now()
  where user_id = p_user and completed_at is null
    and rule_key = 'mapCompleted:' || p_map_id;

  update public.unlock_progress
  set completed_at = now()
  where user_id = p_user and rule_key like 'mapCompleted:' || p_map_id || ':%'
    and current_value >= target_value and completed_at is null;

  -- grant ownership for newly-completed rules
  insert into public.map_ownership (user_id, map_id, source, source_ref)
  select up.user_id, up.unlocks_map_id, 'earned', up.rule_key
    from public.unlock_progress up
   where up.user_id = p_user
     and up.completed_at is not null
     and up.unlocks_map_id is not null
  on conflict do nothing;
end $$;

-- =============================================================================
-- 12. SEED DATA — call once after migrations
-- =============================================================================

insert into public.maps (id, name, tagline, tier, price_usd_cents, apple_product_id, google_product_id, difficulty, length_seconds, manifest)
values
  ('phnom-penh-streets', 'Phnom Penh Streets', 'Where it all began', 'free', null, null, null, 1, 180, '{}'::jsonb),
  ('jungle-ruins',       'Jungle Ruins',       'Stance gates among ancient temples', 'premium', 199, 'com.poserunner.map.jungle', 'map_jungle_ruins', 3, 300, '{}'::jsonb),
  ('neon-tokyo',         'Neon Tokyo',         'Lane-changes at the speed of light', 'premium', 199, 'com.poserunner.map.tokyo', 'map_neon_tokyo', 4, 240, '{}'::jsonb),
  ('arctic-sprint',      'Arctic Sprint',      'Slippery slopes, big jumps', 'premium', 199, 'com.poserunner.map.arctic', 'map_arctic_sprint', 3, 240, '{}'::jsonb),
  ('boxing-gym',         'Boxing Gym',         'Punch the bag, dodge the opponent', 'premium', 199, 'com.poserunner.map.boxing', 'map_boxing_gym', 4, 200, '{}'::jsonb),
  ('yoga-mountain',      'Yoga Mountain',      'Stance-heavy meditative run', 'premium', 199, 'com.poserunner.map.yoga', 'map_yoga_mountain', 2, 360, '{}'::jsonb),
  ('marathon',           'Marathon',           'Earned by playing 7 days in a row', 'earnable', null, null, null, 5, 600, '{}'::jsonb),
  ('champions-run',      'Champion''s Run',    'Won at weekly tournaments', 'earnable', null, null, null, 5, 240, '{}'::jsonb)
on conflict (id) do nothing;
