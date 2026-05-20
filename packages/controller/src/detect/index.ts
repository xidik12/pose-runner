// packages/controller/src/detect/index.ts
// =============================================================================
// Detector pipeline: smooth → buffer → calibrate → detect → emit ActionEvents
// All thresholds live in `defaultConfig`. Tune in playtests, never in code.
// =============================================================================

import type {
  ActionEvent, ActionType, Baseline, Landmark, PoseSnapshot,
  StanceDefinition, JointAngle,
} from '@pose-runner/shared';
import { PoseIdx } from '@pose-runner/shared';

// =============================================================================
// SECTION 1 — One-Euro Filter (Casiez et al. 2012)
// Adaptive low-pass: smoother when still, more responsive when moving.
// =============================================================================

class LowPassFilter {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  reset() { this.y = null; }
  hasValue() { return this.y !== null; }
  lastValue() { return this.y!; }
}

export class OneEuroFilter {
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTimeMs: number | null = null;

  constructor(
    public mincutoff = 1.0,
    public beta = 0.007,
    public dcutoff = 1.0,
  ) {}

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimeMs = null;
  }

  filter(x: number, timeMs: number): number {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = timeMs;
      return this.xFilter.filter(x, 1.0);
    }
    const dt = Math.max((timeMs - this.lastTimeMs) / 1000, 1e-6);
    this.lastTimeMs = timeMs;

    const dx = this.xFilter.hasValue()
      ? (x - this.xFilter.lastValue()) / dt
      : 0;
    const edx = this.dxFilter.filter(dx, alpha(dt, this.dcutoff));
    const cutoff = this.mincutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(x, alpha(dt, cutoff));
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Per-landmark, per-axis filter bank. 33 landmarks × 3 axes = 99 filters. */
export class PoseSmoother {
  private filters: OneEuroFilter[][];

  constructor(mincutoff = 1.0, beta = 0.007) {
    this.filters = Array.from({ length: 33 }, () =>
      [0, 1, 2].map(() => new OneEuroFilter(mincutoff, beta)),
    );
  }

  reset() { this.filters.flat().forEach((f) => f.reset()); }

  smooth(landmarks: Landmark[], timeMs: number): Landmark[] {
    return landmarks.map((lm, i) => ({
      x: this.filters[i][0].filter(lm.x, timeMs),
      y: this.filters[i][1].filter(lm.y, timeMs),
      z: this.filters[i][2].filter(lm.z, timeMs),
      visibility: lm.visibility,
    }));
  }
}

// =============================================================================
// SECTION 2 — Ring buffer (no-allocation after warm-up)
// =============================================================================

export class RingBuffer<T> {
  private buf: (T | null)[];
  private head = 0;
  private size = 0;
  constructor(public readonly capacity: number) {
    this.buf = new Array(capacity).fill(null);
  }
  push(item: T) {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  /** newest-first; at(0) = most recent */
  at(i: number): T | null {
    if (i >= this.size) return null;
    const idx = (this.head - 1 - i + this.capacity) % this.capacity;
    return this.buf[idx];
  }
  /** newest n samples, oldest first */
  range(n: number): T[] {
    const k = Math.min(n, this.size);
    const out: T[] = new Array(k);
    for (let i = 0; i < k; i++) out[i] = this.at(k - 1 - i)!;
    return out;
  }
  get length() { return this.size; }
  clear() { this.head = 0; this.size = 0; }
}

// =============================================================================
// SECTION 3 — Calibration (capture neutral baseline)
// =============================================================================

const CALIB_FRAMES = 30;

export class CalibrationCapture {
  private samples: PoseSnapshot[] = [];

  push(snap: PoseSnapshot): boolean {
    if (snap.avgVisibility < 0.4) return false; // ignore bad frames
    this.samples.push(snap);
    return this.samples.length >= CALIB_FRAMES;
  }

  reset() { this.samples = []; }

  /** Returns null if not enough good samples. */
  finalize(): Baseline | null {
    if (this.samples.length < CALIB_FRAMES) return null;

    const hipY: number[] = [];
    const headY: number[] = [];
    const shoulderMidX: number[] = [];
    const armLen: number[] = [];
    const shoulderW: number[] = [];
    // Image-space (where vertical body motion actually shows up)
    const iHipY: number[] = [];
    const iHeadY: number[] = [];
    const iShoulderMidX: number[] = [];
    const iShoulderW: number[] = [];

    for (const s of this.samples) {
      const lh = s.landmarks[PoseIdx.LEFT_HIP];
      const rh = s.landmarks[PoseIdx.RIGHT_HIP];
      const ls = s.landmarks[PoseIdx.LEFT_SHOULDER];
      const rs = s.landmarks[PoseIdx.RIGHT_SHOULDER];
      const lw = s.landmarks[PoseIdx.LEFT_WRIST];
      const rw = s.landmarks[PoseIdx.RIGHT_WRIST];
      const nose = s.landmarks[PoseIdx.NOSE];

      hipY.push((lh.y + rh.y) / 2);
      headY.push(nose.y);
      shoulderMidX.push((ls.x + rs.x) / 2);
      armLen.push((dist(ls, lw) + dist(rs, rw)) / 2);
      shoulderW.push(Math.abs(ls.x - rs.x));

      const ilh = s.imageLandmarks[PoseIdx.LEFT_HIP];
      const irh = s.imageLandmarks[PoseIdx.RIGHT_HIP];
      const ils = s.imageLandmarks[PoseIdx.LEFT_SHOULDER];
      const irs = s.imageLandmarks[PoseIdx.RIGHT_SHOULDER];
      const inose = s.imageLandmarks[PoseIdx.NOSE];
      iHipY.push((ilh.y + irh.y) / 2);
      iHeadY.push(inose.y);
      iShoulderMidX.push((ils.x + irs.x) / 2);
      iShoulderW.push(Math.abs(ils.x - irs.x));
    }

    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const hipY0 = median(hipY);
    const armLength0 = median(armLen);
    const shoulderWidth0 = median(shoulderW);

    return {
      hipY0,
      headY0: median(headY),
      shoulderMidX0: median(shoulderMidX),
      armLength0,
      shoulderWidth0,
      bodyScale: armLength0,
      capturedAt: Date.now(),
      imageHipY0: median(iHipY),
      imageHeadY0: median(iHeadY),
      imageShoulderMidX0: median(iShoulderMidX),
      imageShoulderWidth0: median(iShoulderW),
    };
  }
}

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// =============================================================================
// SECTION 4 — Detector configuration (the only place to tune)
// =============================================================================

export interface DetectorConfig {
  jump: { riseM: number; windowMs: number; cooldownMs: number; minAnkleVis: number };
  duck: { dropM: number; cooldownMs: number; requireHeadDrop: boolean };
  lean: { enterM: number; exitM: number };
  punch: { peakVelMs: number; reachRatio: number; cooldownMs: number; maxTorsoFwdM: number };
  stance: { defaultThreshold: number; defaultHoldMs: number };
  /** scale all distance thresholds by (baseline.bodyScale / referenceArmLengthM)
      so a 1.5m kid and a 1.9m adult both trigger the same way */
  referenceArmLengthM: number;
}

export const defaultConfig: DetectorConfig = {
  // Image-space thresholds. The detectors multiply these by
  // baseline.imageShoulderWidth0 * 1.5 so values are RELATIVE to body span.
  // Example: at imageShoulderWidth0 = 0.15 (typical), threshold for jump becomes 0.15 * 1.5 * 0.4 = 0.09 image-y units.
  jump:   { riseM: 0.40, windowMs: 250, cooldownMs: 500, minAnkleVis: 0.2 },
  duck:   { dropM: 0.40, cooldownMs: 500, requireHeadDrop: false },
  lean:   { enterM: 0.40, exitM: 0.20 },
  punch:  { peakVelMs: -1.5, reachRatio: 0.70, cooldownMs: 350, maxTorsoFwdM: 0.08 },
  stance: { defaultThreshold: 0.90, defaultHoldMs: 400 },
  referenceArmLengthM: 0.55,
};

function scale(cfg: DetectorConfig, baseline: Baseline, m: number): number {
  return m * (baseline.bodyScale / cfg.referenceArmLengthM);
}

// =============================================================================
// SECTION 5 — Helper geometry
// =============================================================================

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (v: V3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

function angleAt(a: V3, b: V3, c: V3): number {
  const v1 = sub(a, b), v2 = sub(c, b);
  const denom = norm(v1) * norm(v2);
  if (denom < 1e-6) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(v1, v2) / denom)));
}

function hipMid(s: PoseSnapshot): V3 {
  const lh = s.landmarks[PoseIdx.LEFT_HIP];
  const rh = s.landmarks[PoseIdx.RIGHT_HIP];
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
}

function shoulderMid(s: PoseSnapshot): V3 {
  const ls = s.landmarks[PoseIdx.LEFT_SHOULDER];
  const rs = s.landmarks[PoseIdx.RIGHT_SHOULDER];
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
}

// =============================================================================
// SECTION 6 — Detector state (cooldowns, lean side, etc.)
// =============================================================================

export interface DetectorState {
  lastFireMs: Partial<Record<ActionType, number>>;
  leanSide: 'left' | 'right' | 'center';
  punchSide: { left: number; right: number };
  stanceHoldStart: Map<string, number>;
  duckSinceMs: number;
  /** Smoothed run confidence 0..1; updated every frame, sent at 5 Hz. */
  runConfidence: number;
  /** ms timestamps of recent knee-lift detections (for cadence calc). */
  recentLeftLifts: number[];
  recentRightLifts: number[];
}

export function newDetectorState(): DetectorState {
  return {
    lastFireMs: {},
    leanSide: 'center',
    punchSide: { left: 0, right: 0 },
    stanceHoldStart: new Map(),
    duckSinceMs: 0,
    runConfidence: 0,
    recentLeftLifts: [],
    recentRightLifts: [],
  };
}

// =============================================================================
// SECTION 7 — Individual detectors
// All return ActionEvent | null. Pure-ish: read-only baseline/cfg, mutate state.
// =============================================================================

/**
 * JUMP — image-space. Hip moves UP in frame (image y decreases) when the
 * player jumps. Either: (a) absolute rise crosses threshold, or
 * (b) rapid upward velocity over 2 frames (catches the launch even before
 * the peak crosses the rise threshold).
 */
export function detectJump(
  buf: RingBuffer<PoseSnapshot>,
  baseline: Baseline,
  state: DetectorState,
  cfg: DetectorConfig,
  now: number,
): ActionEvent | null {
  const last = state.lastFireMs.JUMP ?? 0;
  if (now - last < cfg.jump.cooldownMs) return null;

  const window = buf.range(8);
  if (window.length < 3) return null;

  const minImgHipY = Math.min(...window.map((s) => imgHipMidY(s)));
  // Loose threshold: ~5% of frame height for a typical body (shoulderW ≈ 0.15)
  const threshold = Math.max(0.04, cfg.jump.riseM * baseline.imageShoulderWidth0 * 1.5);
  const rise = baseline.imageHipY0 - minImgHipY;  // positive = jumped up

  // Velocity check: did hip rise rapidly between the oldest and newest frames?
  // Firing on launch velocity beats waiting for the peak — kills the perceived lag.
  const oldest = window[0];
  const newest = window[window.length - 1];
  const dy = imgHipMidY(oldest) - imgHipMidY(newest);  // positive = went UP
  const dt = (newest.timestamp - oldest.timestamp) / 1000;
  const velUp = dt > 0 ? dy / dt : 0;  // image-y / sec
  const fastUp = velUp > 0.20;          // ~6cm rise over 8 frames at 30fps

  if (rise > threshold || (fastUp && rise > threshold * 0.3)) {
    state.lastFireMs.JUMP = now;
    return {
      type: 'JUMP',
      timestamp: now,
      confidence: Math.min(1, rise / (threshold * 2)),
      meta: { rise: round(rise, 3), thr: round(threshold, 3), velUp: round(velUp, 2) },
    };
  }
  return null;
}

/**
 * DUCK — image-space. Requires the player to *currently* be below baseline
 * (not just dipped briefly during a jump-prep). This kills the false-DUCK
 * that fires during the load-spring phase of a jump.
 */
export function detectDuck(
  buf: RingBuffer<PoseSnapshot>,
  baseline: Baseline,
  state: DetectorState,
  cfg: DetectorConfig,
  now: number,
): ActionEvent | null {
  const last = state.lastFireMs.DUCK ?? 0;
  if (now - last < cfg.duck.cooldownMs) return null;

  const window = buf.range(6);
  if (window.length < 3) return null;

  const newest = window[window.length - 1];
  const threshold = cfg.duck.dropM * baseline.imageShoulderWidth0 * 1.5;

  const currentDrop = imgHipMidY(newest) - baseline.imageHipY0;

  // Not crouched right now → reset the hold timer.
  if (currentDrop <= threshold) {
    state.duckSinceMs = 0;
    return null;
  }
  // Currently below threshold; start (or continue) tracking how long.
  if (state.duckSinceMs === 0) state.duckSinceMs = now;
  const heldMs = now - state.duckSinceMs;
  // Real duck = sustained crouch. Jump-prep crouches are ~150ms; require 220ms.
  if (heldMs < 220) return null;

  // Suppress if we're rapidly rising (jump in progress, just measuring late)
  const oldest = window[0];
  const trend = imgHipMidY(newest) - imgHipMidY(oldest);
  if (trend < -0.01) return null;

  if (cfg.duck.requireHeadDrop) {
    const headDrop = newest.imageLandmarks[PoseIdx.NOSE].y - baseline.imageHeadY0;
    if (headDrop < threshold * 0.5) return null;
  }
  state.lastFireMs.DUCK = now;
  state.duckSinceMs = 0; // reset so we don't fire continuously
  return {
    type: 'DUCK',
    timestamp: now,
    confidence: Math.min(1, currentDrop / (threshold * 2)),
    meta: { drop: round(currentDrop, 3), thr: round(threshold, 3), heldMs: heldMs },
  };
}

function imgHipMidY(s: PoseSnapshot): number {
  const lh = s.imageLandmarks[PoseIdx.LEFT_HIP];
  const rh = s.imageLandmarks[PoseIdx.RIGHT_HIP];
  return (lh.y + rh.y) / 2;
}

function imgShoulderMidX(s: PoseSnapshot): number {
  const ls = s.imageLandmarks[PoseIdx.LEFT_SHOULDER];
  const rs = s.imageLandmarks[PoseIdx.RIGHT_SHOULDER];
  return (ls.x + rs.x) / 2;
}

/** Lane changes use hysteresis: emit on edge transitions only.
 *  Image-space, INVERTED for back-camera (camera faces player so left/right
 *  are mirrored relative to the player's perspective). */
export function detectLean(
  buf: RingBuffer<PoseSnapshot>,
  baseline: Baseline,
  state: DetectorState,
  cfg: DetectorConfig,
  now: number,
): ActionEvent | null {
  const newest = buf.at(0);
  if (!newest) return null;

  // Negate so player-perspective LEFT lean (camera-perspective right shift) → LEAN_LEFT.
  const offset = -(imgShoulderMidX(newest) - baseline.imageShoulderMidX0);
  const enter = cfg.lean.enterM * baseline.imageShoulderWidth0 * 1.5;
  const exit = cfg.lean.exitM * baseline.imageShoulderWidth0 * 1.5;

  let next: 'left' | 'right' | 'center' = state.leanSide;
  if (state.leanSide === 'center') {
    if (offset > enter) next = 'right';
    else if (offset < -enter) next = 'left';
  } else if (state.leanSide === 'left') {
    if (offset > -exit) next = 'center';
  } else if (state.leanSide === 'right') {
    if (offset < exit) next = 'center';
  }

  if (next === state.leanSide) return null;
  state.leanSide = next;

  if (next === 'left') return { type: 'LEAN_LEFT', timestamp: now, confidence: 1 };
  if (next === 'right') return { type: 'LEAN_RIGHT', timestamp: now, confidence: 1 };
  return { type: 'IDLE', timestamp: now, confidence: 1 };
}

export function detectPunch(
  buf: RingBuffer<PoseSnapshot>,
  baseline: Baseline,
  state: DetectorState,
  cfg: DetectorConfig,
  now: number,
  side: 'left' | 'right',
): ActionEvent | null {
  const lastFire = side === 'left' ? state.punchSide.left : state.punchSide.right;
  if (now - lastFire < cfg.punch.cooldownMs) return null;

  const window = buf.range(4); // ~130 ms at 30fps
  if (window.length < 2) return null;

  const wristIdx = side === 'left' ? PoseIdx.LEFT_WRIST : PoseIdx.RIGHT_WRIST;
  const shoulderIdx = side === 'left' ? PoseIdx.LEFT_SHOULDER : PoseIdx.RIGHT_SHOULDER;

  // Peak forward velocity in z (more negative = punching toward camera)
  let peakVel = 0;
  for (let i = 1; i < window.length; i++) {
    const dz = window[i].landmarks[wristIdx].z - window[i - 1].landmarks[wristIdx].z;
    const dt = (window[i].timestamp - window[i - 1].timestamp) / 1000;
    if (dt < 1e-3) continue;
    const v = dz / dt;
    if (v < peakVel) peakVel = v;
  }
  if (peakVel >= cfg.punch.peakVelMs) return null;

  // Wrist must be extended out from shoulder
  const newest = window[window.length - 1];
  const wrist = newest.landmarks[wristIdx];
  const shoulder = newest.landmarks[shoulderIdx];
  const reach = Math.abs(wrist.x - shoulder.x);
  if (reach < baseline.armLength0 * cfg.punch.reachRatio) return null;

  // Reject if torso itself is moving forward (means it's a lunge, not a punch)
  const oldestSh = shoulderMid(window[0]);
  const newestSh = shoulderMid(newest);
  if (oldestSh.z - newestSh.z > scale(cfg, baseline, cfg.punch.maxTorsoFwdM)) return null;

  if (side === 'left') state.punchSide.left = now;
  else state.punchSide.right = now;

  return {
    type: side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT',
    timestamp: now,
    confidence: Math.min(1, -peakVel / 4),
    meta: { peakVel: round(peakVel, 2), reach: round(reach, 3) },
  };
}

/**
 * Stance match: compute current joint-angle vector, compare against each
 * registered stance via cosine similarity. Fires when a stance is held above
 * threshold for `holdMs`. Only fires on transition (not every frame).
 */
export function detectStance(
  snap: PoseSnapshot,
  state: DetectorState,
  stances: StanceDefinition[],
  now: number,
): ActionEvent | null {
  const current = computeAngleVector(snap);

  for (const stance of stances) {
    const target = stance.angles;
    const joints = Object.keys(target) as JointAngle[];
    if (joints.length === 0) continue;

    let dotSum = 0, na = 0, nb = 0;
    for (const j of joints) {
      const a = current[j];
      const b = target[j]!;
      dotSum += a * b;
      na += a * a;
      nb += b * b;
    }
    const denom = Math.sqrt(na * nb);
    if (denom < 1e-6) continue;
    const sim = dotSum / denom;

    if (sim >= stance.threshold) {
      const start = state.stanceHoldStart.get(stance.id);
      if (start === undefined) {
        state.stanceHoldStart.set(stance.id, now);
      } else if (now - start >= stance.holdMs) {
        // already fired? swallow until exit
        if (state.lastFireMs.STANCE_MATCH !== start) {
          state.lastFireMs.STANCE_MATCH = start;
          return {
            type: 'STANCE_MATCH',
            timestamp: now,
            confidence: sim,
            meta: { stanceId: stance.id, similarity: round(sim, 3) },
          };
        }
      }
    } else {
      // exited — clear hold for this stance
      state.stanceHoldStart.delete(stance.id);
    }
  }
  return null;
}

function computeAngleVector(s: PoseSnapshot): Record<JointAngle, number> {
  const L = s.landmarks;
  const I = PoseIdx;
  return {
    leftElbow: angleAt(L[I.LEFT_SHOULDER], L[I.LEFT_ELBOW], L[I.LEFT_WRIST]),
    rightElbow: angleAt(L[I.RIGHT_SHOULDER], L[I.RIGHT_ELBOW], L[I.RIGHT_WRIST]),
    leftShoulder: angleAt(L[I.LEFT_HIP], L[I.LEFT_SHOULDER], L[I.LEFT_ELBOW]),
    rightShoulder: angleAt(L[I.RIGHT_HIP], L[I.RIGHT_SHOULDER], L[I.RIGHT_ELBOW]),
    leftKnee: angleAt(L[I.LEFT_HIP], L[I.LEFT_KNEE], L[I.LEFT_ANKLE]),
    rightKnee: angleAt(L[I.RIGHT_HIP], L[I.RIGHT_KNEE], L[I.RIGHT_ANKLE]),
    leftHip: angleAt(L[I.LEFT_SHOULDER], L[I.LEFT_HIP], L[I.LEFT_KNEE]),
    rightHip: angleAt(L[I.RIGHT_SHOULDER], L[I.RIGHT_HIP], L[I.RIGHT_KNEE]),
    torsoLean: torsoLeanAngle(s),
  };
}

function torsoLeanAngle(s: PoseSnapshot): number {
  const sm = shoulderMid(s), hm = hipMid(s);
  // angle of torso vector from vertical (y axis); positive = leaning to player's right
  const dx = sm.x - hm.x;
  const dy = sm.y - hm.y;
  return Math.atan2(dx, Math.max(dy, 1e-6));
}

// =============================================================================
// SECTION 8 — Top-level tick(): runs every frame
// =============================================================================

export interface DetectorPipeline {
  buffer: RingBuffer<PoseSnapshot>;
  state: DetectorState;
  baseline: Baseline | null;
  config: DetectorConfig;
}

export function newPipeline(): DetectorPipeline {
  return {
    buffer: new RingBuffer<PoseSnapshot>(30),
    state: newDetectorState(),
    baseline: null,
    config: defaultConfig,
  };
}

/** Returns all events fired this frame. Empty array is normal. */
export function tick(pipe: DetectorPipeline, raw: PoseSnapshot): ActionEvent[] {
  // Image landmarks are used for all current detectors (jump/duck/lean use
  // image space; punch uses world wrist Z which is fine). Smoother removed as
  // dead code — it was running on world landmarks that are no longer read.
  pipe.buffer.push(raw);

  if (!pipe.baseline) return [];

  const events: ActionEvent[] = [];
  const now = raw.timestamp;
  const push = (e: ActionEvent | null) => { if (e) events.push(e); };

  // Run-in-place — updates state.runConfidence every frame; emit at 5 Hz.
  updateRunConfidence(pipe.buffer, pipe.baseline, pipe.state, now);
  const runEv = maybeEmitRun(pipe.state, now);
  push(runEv);

  // While running, jump/duck thresholds tighten so the natural running bob
  // doesn't false-trigger.
  const isRunning = pipe.state.runConfidence > 0.4;
  const cfgEffective: DetectorConfig = isRunning
    ? {
        ...pipe.config,
        jump: { ...pipe.config.jump, riseM: pipe.config.jump.riseM * 1.6 },
        duck: { ...pipe.config.duck, dropM: pipe.config.duck.dropM * 1.4 },
      }
    : pipe.config;

  // Jump first; if it fires, suppress DUCK this frame (prep-crouch ambiguity).
  const jump = detectJump(pipe.buffer, pipe.baseline, pipe.state, cfgEffective, now);
  push(jump);
  if (!jump) push(detectDuck(pipe.buffer, pipe.baseline, pipe.state, cfgEffective, now));
  push(detectLean(pipe.buffer, pipe.baseline, pipe.state, cfgEffective, now));
  push(detectPunch(pipe.buffer, pipe.baseline, pipe.state, cfgEffective, now, 'left'));
  push(detectPunch(pipe.buffer, pipe.baseline, pipe.state, cfgEffective, now, 'right'));
  return events;
}

// =============================================================================
// SECTION 7b — RUN-in-place detection
// =============================================================================
//
// Method: track the y-position of left + right knees in image space. When a
// knee is "lifted" (image y noticeably below its rolling baseline), record a
// timestamp. A walking/running cadence is alternating left/right lifts within
// a window. Confidence = clamp(lifts_per_sec / 3.0, 0, 1).

const RUN_LIFT_THRESHOLD_FACTOR = 0.04; // image-y units of knee-lift to count
const RUN_WINDOW_MS = 1500;             // observation window
const RUN_CONFIDENCE_DECAY = 0.85;      // exponential decay per frame when not running
const RUN_EMIT_INTERVAL_MS = 200;       // 5 Hz max emit rate

function updateRunConfidence(
  buf: RingBuffer<PoseSnapshot>,
  baseline: Baseline,
  state: DetectorState,
  now: number,
) {
  const newest = buf.at(0);
  if (!newest) return;
  // Need a few frames of history
  const prev = buf.at(3);
  if (!prev) return;

  const lknee = newest.imageLandmarks[PoseIdx.LEFT_KNEE];
  const rknee = newest.imageLandmarks[PoseIdx.RIGHT_KNEE];
  // Use average hip→knee distance from calibration to set a relative threshold;
  // approximated via shoulder width (no hip-knee baseline captured)
  const liftThreshold = baseline.imageShoulderWidth0 * RUN_LIFT_THRESHOLD_FACTOR * 25;
  // Naive baseline: use the OLDEST knee y in the buffer as resting position
  // (a knee at rest holds a near-constant y; lifted knees drop the y value).
  const lkneePrev = prev.imageLandmarks[PoseIdx.LEFT_KNEE];
  const rkneePrev = prev.imageLandmarks[PoseIdx.RIGHT_KNEE];
  // Knee LIFTS if image y *decreases* (knee moves up in frame) by > threshold
  if (lkneePrev.y - lknee.y > liftThreshold) {
    pushLift(state.recentLeftLifts, now);
  }
  if (rkneePrev.y - rknee.y > liftThreshold) {
    pushLift(state.recentRightLifts, now);
  }
  // Prune old lifts
  pruneLifts(state.recentLeftLifts, now);
  pruneLifts(state.recentRightLifts, now);

  // Cadence: count lifts in the last RUN_WINDOW_MS
  const totalLifts = state.recentLeftLifts.length + state.recentRightLifts.length;
  const liftsPerSec = totalLifts / (RUN_WINDOW_MS / 1000);
  // Need ALTERNATING left/right (not just one leg twitching). Alternation score
  // is high when both legs have ~equal lift counts.
  const minSide = Math.min(state.recentLeftLifts.length, state.recentRightLifts.length);
  const maxSide = Math.max(state.recentLeftLifts.length, state.recentRightLifts.length);
  const alternation = maxSide > 0 ? minSide / maxSide : 0;
  const rawConf = Math.min(1, liftsPerSec / 3.0) * alternation;

  // Smooth
  if (rawConf > state.runConfidence) {
    state.runConfidence = rawConf; // rise fast
  } else {
    state.runConfidence = state.runConfidence * RUN_CONFIDENCE_DECAY;
  }
}

function pushLift(arr: number[], now: number) {
  // Debounce: don't double-count lifts within 150ms
  if (arr.length && now - arr[arr.length - 1] < 150) return;
  arr.push(now);
}
function pruneLifts(arr: number[], now: number) {
  while (arr.length && arr[0] < now - RUN_WINDOW_MS) arr.shift();
}

function maybeEmitRun(state: DetectorState, now: number): ActionEvent | null {
  const last = state.lastFireMs.RUN ?? 0;
  if (now - last < RUN_EMIT_INTERVAL_MS) return null;
  state.lastFireMs.RUN = now;
  return {
    type: 'RUN',
    timestamp: now,
    confidence: state.runConfidence,
    meta: { conf: round(state.runConfidence, 2) },
  };
}

// =============================================================================
// utils
// =============================================================================
function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
