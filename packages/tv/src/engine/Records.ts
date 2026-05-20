// localStorage-backed personal best tracking. Per-map records.

const STORAGE_KEY = 'pose-runner:records:v1';

export interface MapRecord {
  bestScore: number;
  bestDistance: number;
  bestRunMs: number;     // longest survival duration
  totalRuns: number;
  lastPlayedMs: number;
}

interface RecordsBlob {
  byMap: Record<string, MapRecord>;
  totalLifetimeScore: number;
}

function blank(): RecordsBlob {
  return { byMap: {}, totalLifetimeScore: 0 };
}

export class Records {
  private blob: RecordsBlob;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.blob = raw ? (JSON.parse(raw) as RecordsBlob) : blank();
    } catch {
      this.blob = blank();
    }
  }

  get(mapId: string): MapRecord {
    return this.blob.byMap[mapId] ?? {
      bestScore: 0, bestDistance: 0, bestRunMs: 0, totalRuns: 0, lastPlayedMs: 0,
    };
  }

  /** Update records with a fresh run; returns flags for newly-beaten records. */
  update(mapId: string, run: { score: number; distance: number; durationMs: number }): {
    isNewBestScore: boolean;
    isNewBestDistance: boolean;
    isNewLongestRun: boolean;
    record: MapRecord;
  } {
    const prev = this.get(mapId);
    const isNewBestScore = run.score > prev.bestScore;
    const isNewBestDistance = run.distance > prev.bestDistance;
    const isNewLongestRun = run.durationMs > prev.bestRunMs;
    const updated: MapRecord = {
      bestScore: Math.max(prev.bestScore, run.score),
      bestDistance: Math.max(prev.bestDistance, run.distance),
      bestRunMs: Math.max(prev.bestRunMs, run.durationMs),
      totalRuns: prev.totalRuns + 1,
      lastPlayedMs: Date.now(),
    };
    this.blob.byMap[mapId] = updated;
    this.blob.totalLifetimeScore += run.score;
    this.persist();
    return { isNewBestScore, isNewBestDistance, isNewLongestRun, record: updated };
  }

  private persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.blob)); } catch { /* ignore quota */ }
  }
}

export const records = new Records();
