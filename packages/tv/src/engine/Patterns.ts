// Spawn patterns: sequences of obstacles placed at specific lane + z offsets.
// Picked deterministically per slot via seeded RNG; weighted by t/length.
import type { Obstacles, ObstacleKind } from './Obstacles';

interface Pattern {
  id: string;
  weightAtStart: number;
  weightAtEnd: number;
  /** spawn instructions; zOffset measured forward (positive = further away) */
  spawns: Array<{ kind: ObstacleKind; lane: 0 | 1 | 2 | 'all'; z: number }>;
}

// Curated pattern library for the 3D obstacle types. zOffset 0 → spawn at SPAWN_AHEAD;
// positive z → spawned further behind (i.e. arrives later).
const LIBRARY: Pattern[] = [
  // Single primitives
  { id: 'log-l', weightAtStart: 1, weightAtEnd: 0.5, spawns: [{ kind: 'log', lane: 0, z: 0 }] },
  { id: 'log-c', weightAtStart: 1, weightAtEnd: 0.5, spawns: [{ kind: 'log', lane: 1, z: 0 }] },
  { id: 'log-r', weightAtStart: 1, weightAtEnd: 0.5, spawns: [{ kind: 'log', lane: 2, z: 0 }] },
  { id: 'beam', weightAtStart: 0.8, weightAtEnd: 0.7, spawns: [{ kind: 'beam', lane: 'all', z: 0 }] },
  { id: 'wall-l', weightAtStart: 0.6, weightAtEnd: 0.7, spawns: [{ kind: 'wall', lane: 0, z: 0 }] },
  { id: 'wall-c', weightAtStart: 0.6, weightAtEnd: 0.7, spawns: [{ kind: 'wall', lane: 1, z: 0 }] },
  { id: 'wall-r', weightAtStart: 0.6, weightAtEnd: 0.7, spawns: [{ kind: 'wall', lane: 2, z: 0 }] },
  { id: 'crate-l', weightAtStart: 0.4, weightAtEnd: 0.7, spawns: [{ kind: 'crate', lane: 0, z: 0 }] },
  { id: 'crate-c', weightAtStart: 0.4, weightAtEnd: 0.7, spawns: [{ kind: 'crate', lane: 1, z: 0 }] },
  { id: 'crate-r', weightAtStart: 0.4, weightAtEnd: 0.7, spawns: [{ kind: 'crate', lane: 2, z: 0 }] },
  { id: 'float-c', weightAtStart: 0.0, weightAtEnd: 0.5, spawns: [{ kind: 'floatCrate', lane: 1, z: 0 }] },
  { id: 'coin-l', weightAtStart: 0.6, weightAtEnd: 0.6, spawns: [{ kind: 'coin', lane: 0, z: 0 }] },
  { id: 'coin-c', weightAtStart: 0.6, weightAtEnd: 0.6, spawns: [{ kind: 'coin', lane: 1, z: 0 }] },
  { id: 'coin-r', weightAtStart: 0.6, weightAtEnd: 0.6, spawns: [{ kind: 'coin', lane: 2, z: 0 }] },

  // Combos (z is forward distance; smaller z = arrives sooner)
  { id: 'log-then-coin',
    weightAtStart: 0.4, weightAtEnd: 0.6,
    spawns: [{ kind: 'log', lane: 1, z: 0 }, { kind: 'coin', lane: 1, z: -8 }] },
  { id: 'beam-then-log',
    weightAtStart: 0.0, weightAtEnd: 0.5,
    spawns: [{ kind: 'beam', lane: 'all', z: 0 }, { kind: 'log', lane: 1, z: -10 }] },
  { id: 'wall-shift',
    weightAtStart: 0.3, weightAtEnd: 0.6,
    spawns: [{ kind: 'wall', lane: 0, z: 0 }, { kind: 'wall', lane: 2, z: -10 }] },
  { id: 'coin-trio-c',
    weightAtStart: 0.5, weightAtEnd: 0.5,
    spawns: [{ kind: 'coin', lane: 1, z: 0 }, { kind: 'coin', lane: 1, z: -3 }, { kind: 'coin', lane: 1, z: -6 }] },
];

export class Patterns {
  private rng: () => number;
  private obstacles: Obstacles;
  private accumMs = 0;
  private spawnIntervalMs = 1800;
  private startedAt: number;
  private mapLengthSec = 180;

  constructor(rng: () => number, obstacles: Obstacles, startedAt: number) {
    this.rng = rng;
    this.obstacles = obstacles;
    this.startedAt = startedAt;
  }

  setSpawnInterval(ms: number) {
    this.spawnIntervalMs = ms;
  }

  tick(dt: number, nowMs: number) {
    this.accumMs += dt * 1000;
    if (this.accumMs < this.spawnIntervalMs) return;
    this.accumMs = 0;

    const tNorm = Math.min(1, ((nowMs - this.startedAt) / 1000) / this.mapLengthSec);
    const weighted: Array<{ p: Pattern; w: number }> = [];
    let total = 0;
    for (const p of LIBRARY) {
      const w = p.weightAtStart + (p.weightAtEnd - p.weightAtStart) * tNorm;
      if (w <= 0) continue;
      weighted.push({ p, w });
      total += w;
    }
    if (total === 0) return;
    let pick = this.rng() * total;
    let chosen = weighted[0].p;
    for (const { p, w } of weighted) {
      pick -= w;
      if (pick <= 0) { chosen = p; break; }
    }
    for (const sp of chosen.spawns) {
      this.obstacles.spawn(sp.kind, sp.lane, sp.z);
    }
  }
}
