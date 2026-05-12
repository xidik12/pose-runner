// packages/shared/src/index.ts
// Foundation types shared between controller (phone), tv (Phaser/Unity), and broker.
// Both the web MVP and the Unity port should treat this as the source of truth.
// In Unity, mirror this file as C# DTOs in Assets/Scripts/Shared/Protocol/*.cs

// =============================================================================
// 1. ACTION EVENTS (phone → broker → TV)
// =============================================================================

export type ActionType =
  | 'JUMP'
  | 'DUCK'
  | 'LEAN_LEFT'
  | 'LEAN_RIGHT'
  | 'PUNCH_LEFT'
  | 'PUNCH_RIGHT'
  | 'STANCE_MATCH'
  | 'IDLE';

export interface ActionEvent {
  type: ActionType;
  /** ms since epoch, captured on phone before send */
  timestamp: number;
  /** 0..1 — gameplay can use this for visual emphasis but not gating */
  confidence: number;
  /** detector-specific extras — e.g. { rise: 0.18, peakVel: -2.4, stanceId: 'warrior2' } */
  meta?: Record<string, number | string>;
}

// =============================================================================
// 2. ROOMS, SLOTS, MODES (broker state)
// =============================================================================

export type ClientRole = 'controller' | 'tv' | 'spectator';
export type PlayerSlot = 1 | 2 | 3 | 4;

export type GameMode =
  | 'solo'
  | 'co-op-survival'
  | 'score-battle'
  | 'race'
  | 'tournament';

export interface ControllerSlot {
  slot: PlayerSlot;
  ready: boolean;
  calibrated: boolean;
  pingMs: number;
  /** populated only when authenticated (Phase 10+) */
  userId?: string;
  displayName?: string;
}

export interface RoomState {
  roomId: string;
  controllers: ControllerSlot[];
  tvCount: number;
  spectatorCount: number;
  mode: GameMode;
  mapId: string;
  /** monotonic seed used to derive deterministic obstacle patterns
      across all TVs when the mode requires shared world (race mode) */
  worldSeed: number;
  hostSlot: PlayerSlot;
  /** ms since epoch when current match started; null when not in a match */
  matchStartedAt: number | null;
}

// =============================================================================
// 3. WIRE PROTOCOL
// =============================================================================

export type RoomMessage =
  | { kind: 'join'; room: string; role: ClientRole; preferredSlot?: PlayerSlot; auth?: { jwt: string } }
  | { kind: 'joined'; room: string; role: ClientRole; assignedSlot?: PlayerSlot; state: RoomState }
  | { kind: 'rejected'; reason: 'room-full' | 'auth-failed' | 'invalid-slot' | 'banned' }
  | { kind: 'room-state'; state: RoomState }
  | { kind: 'peer-up'; role: ClientRole; slot?: PlayerSlot }
  | { kind: 'peer-down'; role: ClientRole; slot?: PlayerSlot; reconnectGraceMs: number }
  | { kind: 'set-mode'; mode: GameMode }
  | { kind: 'set-map'; mapId: string }
  | { kind: 'set-ready'; slot: PlayerSlot; ready: boolean }
  | { kind: 'set-calibrated'; slot: PlayerSlot; calibrated: boolean }
  | { kind: 'action'; slot: PlayerSlot; event: ActionEvent }
  | { kind: 'game-event'; event: GameEvent }
  | { kind: 'ping'; ts: number }
  | { kind: 'pong'; ts: number; serverTs: number }
  | { kind: 'error'; code: string; message: string };

export type GameEvent =
  | { type: 'match-start'; mapId: string; mode: GameMode; seed: number; durationMs?: number }
  | { type: 'match-end'; results: MatchResult }
  | { type: 'player-died'; slot: PlayerSlot; atScore: number }
  | { type: 'pause'; bySlot: PlayerSlot }
  | { type: 'resume'; bySlot: PlayerSlot };

export interface MatchResult {
  mode: GameMode;
  mapId: string;
  durationMs: number;
  /** indexed by slot */
  perPlayer: PlayerResult[];
  /** in competitive modes; null for cooperative */
  winnerSlot: PlayerSlot | null;
  /** in cooperative modes */
  combinedScore?: number;
}

export interface PlayerResult {
  slot: PlayerSlot;
  userId?: string;
  score: number;
  coinsCollected: number;
  obstaclesAvoided: number;
  obstaclesBroken: number;
  perfectStanceMatches: number;
  jumps: number;
  ducks: number;
  punches: number;
  laneChanges: number;
  diedAt: number | null; // ms into match, null if survived
}

// =============================================================================
// 4. MAP MANIFEST (content layer)
// =============================================================================

export type MapTier = 'free' | 'premium' | 'earnable';

export interface MapManifest {
  id: string;
  name: string;
  /** short hook for store listings */
  tagline: string;
  tier: MapTier;
  price?: { usd: number; productIds: { apple: string; google: string } };
  unlockRules?: UnlockRule[];
  /** seconds */
  length: number;
  theme: MapTheme;
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** which mechanics this map emphasizes */
  emphasis: MapEmphasis;
  obstaclePatterns: PatternRef[];
  stanceSet: string[]; // stance IDs from stances.json used in this map
  difficultyCurve: DifficultyPoint[];
  music: { trackId: string; bpm: number };
}

export interface MapTheme {
  palette: string;        // 'phnom-penh-streets', 'jungle-ruins', etc.
  parallaxLayers: { assetId: string; speed: number }[];
  postProcess?: 'none' | 'bloom' | 'sepia' | 'cold' | 'arcade';
  weather?: 'none' | 'rain' | 'snow' | 'sandstorm';
}

export interface MapEmphasis {
  jump: number;   // 0..1 normalized weight, sum need not equal 1
  duck: number;
  lean: number;
  punch: number;
  stance: number;
}

export type UnlockRule =
  | { kind: 'totalScore'; threshold: number }
  | { kind: 'streakDays'; days: number }
  | { kind: 'mapCompleted'; mapId: string; times: number }
  | { kind: 'tournamentWin'; tournamentId: string }
  | { kind: 'stanceMastery'; stanceId: string; perfectMatches: number }
  | { kind: 'coopWins'; threshold: number };

export interface PatternRef {
  id: string;             // 'easy-jump-jump-duck'
  weightAtStart: number;  // probability weight at t=0
  weightAtEnd: number;    // probability weight at t=length (lerp linearly)
  minDifficulty: 1 | 2 | 3 | 4 | 5;
}

export interface DifficultyPoint {
  /** seconds into the run */
  t: number;
  /** units per second */
  scrollSpeed: number;
  /** seconds between obstacle batches */
  spawnInterval: number;
}

// =============================================================================
// 5. STANCES (used by stance detector + stance gates)
// =============================================================================

export interface StanceDefinition {
  id: string;
  name: string;
  /** target joint angles in radians; missing entries = don't care */
  angles: Partial<Record<JointAngle, number>>;
  /** how strict the cosine similarity gate is; 0.92 default, 0.95 for "perfect" */
  threshold: number;
  /** ms the player must hold the pose */
  holdMs: number;
  /** silhouette image for the stance gate */
  silhouetteAsset: string;
}

export type JointAngle =
  | 'leftElbow'    // shoulder-elbow-wrist
  | 'rightElbow'
  | 'leftShoulder' // hip-shoulder-elbow
  | 'rightShoulder'
  | 'leftKnee'     // hip-knee-ankle
  | 'rightKnee'
  | 'leftHip'      // shoulder-hip-knee
  | 'rightHip'
  | 'torsoLean';   // signed angle of shoulder-midpoint to hip-midpoint vs vertical

// =============================================================================
// 6. POSE DATA (internal — not over the wire, but shared between worker + main)
// =============================================================================

export interface PoseSnapshot {
  /** ms since epoch */
  timestamp: number;
  /** world coordinates in meters, hip-midpoint origin, y-UP (flipped from MediaPipe) */
  landmarks: Landmark[];
  /** image-space coordinates 0..1, used only for overlay rendering */
  imageLandmarks: Landmark[];
  /** average landmark visibility this frame, for quality gating */
  avgVisibility: number;
}

export interface Landmark {
  x: number; y: number; z: number;
  visibility: number;
}

// =============================================================================
// 7. MEDIAPIPE LANDMARK INDICES (BlazePose 33-point model)
// =============================================================================

export const PoseIdx = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
} as const;

// =============================================================================
// 8. CALIBRATION BASELINE (per-player, per-session)
// =============================================================================

export interface Baseline {
  /** y of hip midpoint when standing neutral, in world meters (y-up) */
  hipY0: number;
  headY0: number;
  shoulderMidX0: number;
  /** shoulder-to-wrist distance with arms relaxed at sides */
  armLength0: number;
  /** shoulder-to-shoulder horizontal width */
  shoulderWidth0: number;
  /** computed at end of calibration, used to normalize thresholds for body height */
  bodyScale: number;
  /** ms since epoch, for staleness check */
  capturedAt: number;
}

// =============================================================================
// 9. UTILITIES
// =============================================================================

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function randomRoomCode(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** Deterministic 32-bit LCG for shared-world modes. */
export function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
