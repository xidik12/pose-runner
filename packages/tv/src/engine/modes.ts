// Mode rule strategies. Each implements MatchMode. The Match orchestrator
// asks the mode whether the match is over and how to build the result.
import type { GameMode, MatchResult, PlayerSlot } from '@pose-runner/shared';
import type { PlayerWorld } from './PlayerWorld';
import { SCORE_BATTLE_DURATION_MS } from './constants';

export interface MatchMode {
  timerMs(): number | null;
  isOver(now: number, startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>): boolean;
  endsOnAnyDeath(): boolean;
  buildResult(now: number, startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>, mapId: string): MatchResult;
}

export class SoloMode implements MatchMode {
  timerMs() { return null; }
  endsOnAnyDeath() { return true; }
  isOver(_now: number, _startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>) {
    return [...worlds.values()].every((w) => !w.alive);
  }
  buildResult(now: number, startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>, mapId: string): MatchResult {
    return {
      mode: 'solo', mapId, durationMs: now - startedAt,
      perPlayer: [...worlds.values()].map((w) => ({
        slot: w.slot, score: w.score, ...statsExcl(w, now - startedAt),
      })),
      winnerSlot: null,
    };
  }
}

export class ScoreBattleMode implements MatchMode {
  constructor(public durationMs = SCORE_BATTLE_DURATION_MS) {}
  timerMs() { return this.durationMs; }
  endsOnAnyDeath() { return false; }
  isOver(now: number, startedAt: number) {
    return now - startedAt >= this.durationMs;
  }
  buildResult(now: number, startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>, mapId: string): MatchResult {
    const ws = [...worlds.values()];
    const winner = ws.reduce((best, w) => (w.score > best.score ? w : best), ws[0]);
    return {
      mode: 'score-battle', mapId, durationMs: now - startedAt,
      perPlayer: ws.map((w) => ({ slot: w.slot, score: w.score, ...statsExcl(w, now - startedAt) })),
      winnerSlot: ws.length > 1 ? winner.slot : null,
    };
  }
}

export class CoopSurvivalMode implements MatchMode {
  timerMs() { return null; }
  endsOnAnyDeath() { return true; }
  isOver(_now: number, _startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>) {
    return [...worlds.values()].some((w) => !w.alive);
  }
  buildResult(now: number, startedAt: number, worlds: Map<PlayerSlot, PlayerWorld>, mapId: string): MatchResult {
    const ws = [...worlds.values()];
    const combined = ws.reduce((s, w) => s + w.score, 0);
    return {
      mode: 'co-op-survival', mapId, durationMs: now - startedAt,
      perPlayer: ws.map((w) => ({ slot: w.slot, score: w.score, ...statsExcl(w, now - startedAt) })),
      winnerSlot: null,
      combinedScore: combined,
    };
  }
}

export function modeFor(gm: GameMode): MatchMode {
  switch (gm) {
    case 'solo':           return new SoloMode();
    case 'score-battle':   return new ScoreBattleMode();
    case 'co-op-survival': return new CoopSurvivalMode();
    case 'race':           return new ScoreBattleMode(); // race deferred → fall back
    case 'tournament':     return new ScoreBattleMode();
  }
}

function statsExcl(w: PlayerWorld, durationMs: number) {
  const s = w.player.stats;
  return {
    coinsCollected: s.coin,
    obstaclesAvoided: s.avoided,
    obstaclesBroken: s.broken,
    perfectStanceMatches: s.perfectStance,
    jumps: s.jump, ducks: s.duck, punches: s.punch, laneChanges: s.lane,
    diedAt: w.alive ? null : durationMs,
  };
}
