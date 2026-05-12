# Pose-Controlled TV Runner — Build Plan

A real-life infinite runner where the **TV** displays the game and the **phone camera** (aimed at the player) detects jumps, ducks, punches, lane changes, and stance poses. Designed for execution via Claude Code, phase-by-phase.

> **Reference kit**: this plan ships with 14 reference-implementation files (`01_*` through `14_*`) plus an index README (`15_README.md`). Each file maps to one or more phases below. Use them as concrete starting points — every threshold and tuning constant is in a config object so you tune in playtests, not in code. The cross-references between files are mapped in `15_README.md`.

---

## 1. What we're building (one paragraph)

Two web apps and one tiny server. The **phone PWA** opens the camera, runs MediaPipe Pose Landmarker locally to get 33 body landmarks per frame, converts those landmarks into discrete action events (jump / duck / punch / lean / stance), and sends those events over WebSocket. The **TV web app** is a Phaser 3 endless runner that subscribes to the same room and applies events to the player character. A **Node WebSocket broker** sits in the middle, pairing rooms via QR code and fanning events from phone → TV. Everything runs over LAN for sub-100 ms latency. No native apps, no app store, no Kinect.

---

## 2. System architecture

```
┌─────────────────────────────┐
│   Phone (player-facing)     │
│  ┌───────────────────────┐  │
│  │ getUserMedia (camera) │  │
│  └──────────┬────────────┘  │
│             ▼               │
│  ┌───────────────────────┐  │
│  │ MediaPipe Pose Worker │  │   ~30 fps, 33 landmarks
│  │ (WASM + GPU)          │  │   world coords in meters
│  └──────────┬────────────┘  │
│             ▼               │
│  ┌───────────────────────┐  │
│  │ One-Euro smoothing    │  │
│  └──────────┬────────────┘  │
│             ▼               │
│  ┌───────────────────────┐  │
│  │ Action detector       │  │   jump/duck/punch/lean/stance
│  │ (ring buffer, 20 fr)  │  │
│  └──────────┬────────────┘  │
│             ▼               │
│         WebSocket           │
└─────────────┼───────────────┘
              ▼
┌─────────────────────────────┐
│  Broker (Node.js + ws)      │
│  - Rooms by 6-char code     │
│  - Forwards phone → TV      │
│  - <5 ms overhead           │
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│   TV / Laptop browser       │
│  ┌───────────────────────┐  │
│  │ QR code (room ID)     │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ Phaser 3 runner       │  │
│  │ - 3 lanes             │  │
│  │ - Object-pooled spawn │  │
│  │ - Player state machine│  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Latency budget (target < 120 ms total)**:
- Camera capture → frame ready: ~16 ms (60 fps capture)
- MediaPipe inference (lite model, mobile GPU): 25–40 ms
- Smoothing + detection: < 2 ms
- WebSocket hop on LAN: 5–15 ms
- Phaser render frame: 16 ms

---

## 3. Tech stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Pose model | **MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`) | 33 landmarks (vs MoveNet's 17), gives world coordinates in meters with hip-midpoint origin — critical for jump/duck thresholds in physical units. Lite variant runs at 30+ fps on mid-range phones. Rigorously validated against gold-standard motion capture (Pearson r ≈ 0.91 for upper limbs). |
| Inference runtime | WASM + WebGL delegate, in **Web Worker** | Keeps the main thread free for UI/canvas. MediaPipe blocks the main thread during init otherwise. |
| Smoothing | **One-Euro filter** | Standard for noisy pose data. Adaptive cutoff: smooth when still, responsive when moving. |
| Phone framework | Vite + TypeScript, vanilla web (PWA-installable) | Zero install friction. Phone PWA serves over HTTPS (required for camera). |
| TV game engine | **Phaser 3** + TypeScript | Mature 2D engine, excellent Arcade physics, well-documented infinite runner pattern with object pooling. Free Ourcade book covers exactly this template. |
| Networking | **WebSocket** via Node + `ws` | LAN latency is already < 15 ms; WebRTC DataChannel adds STUN/ICE/signaling complexity for marginal gain. WebSocket is plenty for small JSON event payloads. Switch to WebRTC DataChannel later only if you go off-LAN and need sub-50 ms over the internet. |
| Broker runtime | Node 20+ | Same language as the rest of the stack. |
| Pairing | QR code on TV encoding `https://controller.app/?room=ABC123` | Mobile-native flow, no typing IPs. |
| Dev HTTPS | `mkcert` + Vite plugin | Camera API requires HTTPS even on LAN. Self-signed cert installed once. |

---

## 4. Repo structure

```
pose-runner/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── README.md
├── .env.example
├── packages/
│   ├── shared/                   # shared types: events, room messages
│   │   ├── src/
│   │   │   ├── events.ts         # ActionEvent, RoomMessage types
│   │   │   └── index.ts
│   │   └── package.json
│   ├── controller/               # phone PWA
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── pose/
│   │   │   │   ├── poseWorker.ts        # web worker, MediaPipe runs here
│   │   │   │   ├── poseClient.ts        # main-thread client of the worker
│   │   │   │   └── oneEuroFilter.ts
│   │   │   ├── detect/
│   │   │   │   ├── ringBuffer.ts
│   │   │   │   ├── calibration.ts
│   │   │   │   ├── jump.ts
│   │   │   │   ├── duck.ts
│   │   │   │   ├── punch.ts
│   │   │   │   ├── lean.ts
│   │   │   │   ├── stance.ts
│   │   │   │   └── index.ts             # combines into a single tick()
│   │   │   ├── net/
│   │   │   │   └── ws.ts
│   │   │   ├── ui/
│   │   │   │   ├── overlay.ts           # debug skeleton render
│   │   │   │   └── status.ts
│   │   │   └── config.ts                # all thresholds in one place
│   │   ├── index.html
│   │   ├── manifest.webmanifest
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── tv/                       # Phaser game
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── scenes/
│   │   │   │   ├── BootScene.ts
│   │   │   │   ├── PairingScene.ts      # QR code, "Waiting for player…"
│   │   │   │   ├── GameScene.ts
│   │   │   │   └── GameOverScene.ts
│   │   │   ├── entities/
│   │   │   │   ├── Player.ts
│   │   │   │   ├── Obstacle.ts
│   │   │   │   ├── Coin.ts
│   │   │   │   └── StanceGate.ts
│   │   │   ├── systems/
│   │   │   │   ├── SpawnSystem.ts       # object pool
│   │   │   │   ├── ParallaxSystem.ts
│   │   │   │   └── InputSystem.ts       # consumes ActionEvents
│   │   │   ├── net/
│   │   │   │   └── ws.ts
│   │   │   └── config.ts
│   │   ├── public/assets/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── broker/                   # WebSocket server
│       ├── src/
│       │   ├── server.ts
│       │   ├── rooms.ts
│       │   └── types.ts
│       └── package.json
└── tools/
    └── dev.sh                    # spawn all 3 with concurrently
```

---

## 5. Shared event protocol (build first — both apps depend on it)

**File: `packages/shared/src/events.ts`**

```ts
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
  timestamp: number;          // ms since epoch on phone
  confidence: number;         // 0..1
  meta?: Record<string, number>; // e.g. { magnitude: 0.18 }
}

export type ClientRole = 'controller' | 'tv';
export type PlayerSlot = 1 | 2 | 3 | 4;   // up to 4-player support
export type GameMode =
  | 'solo'
  | 'co-op-survival'   // both must survive, combined score
  | 'score-battle'     // independent worlds, fixed timer, highest wins
  | 'race';            // shared obstacle pattern, first behind by N loses

export interface RoomState {
  controllers: { slot: PlayerSlot; ready: boolean; userId?: string }[];
  tvs: number;                  // count of attached TVs
  mode: GameMode;
  mapId: string;
}

export type RoomMessage =
  | { kind: 'join';        room: string; role: ClientRole; preferredSlot?: PlayerSlot }
  | { kind: 'joined';      room: string; role: ClientRole; assignedSlot?: PlayerSlot; state: RoomState }
  | { kind: 'room-state';  state: RoomState }   // broadcast on every change
  | { kind: 'peer-up';     role: ClientRole; slot?: PlayerSlot }
  | { kind: 'peer-down';   role: ClientRole; slot?: PlayerSlot }
  | { kind: 'set-mode';    mode: GameMode }     // TV pushes when host changes mode
  | { kind: 'set-ready';   slot: PlayerSlot; ready: boolean }
  | { kind: 'set-map';     mapId: string }
  | { kind: 'action';      slot: PlayerSlot; event: ActionEvent }
  | { kind: 'game-event';  event: 'start' | 'end' | 'pause' | 'resume'; payload?: unknown }
  | { kind: 'ping';        ts: number }
  | { kind: 'pong';        ts: number };
```

**Slot assignment rules** (broker-side):
- First controller to join → slot 1
- Second controller → slot 2 (etc., up to 4)
- A controller can request a `preferredSlot`; broker grants if free, else assigns lowest available
- TV doesn't take a slot — there can be multiple TVs in a room (used for remote multiplayer)
- If a controller drops, their slot stays reserved for 30 sec to allow reconnect, then frees

Both `controller` and `tv` import from `@pose-runner/shared`.

---

## 6. Phase plan

Each phase is sized for one Claude Code session. Hand the whole markdown to Claude Code, then execute phases one at a time with `Run phase N`.

---

### **Phase 0 — Foundation**

**Goal**: monorepo + dev infrastructure runs locally.

**Deliverables**:
- pnpm workspace with the four packages above
- `pnpm dev` starts broker (port 8787), controller (https://localhost:5173), tv (https://localhost:5174) concurrently
- mkcert installed; certs in `.certs/` and gitignored
- Shared types compile and import cleanly into both apps

**Tasks for Claude Code**:
1. `pnpm init` at root, create `pnpm-workspace.yaml` listing `packages/*`
2. Create stub `package.json` in each subpackage
3. Wire Vite in controller and tv with `@vitejs/plugin-basic-ssl` (or mkcert) so dev runs over HTTPS
4. Create `tools/dev.sh` using `concurrently` to launch all three
5. Wire TypeScript project references so `shared` builds before others
6. Add `tsconfig.base.json` with strict mode

**Acceptance**:
- `pnpm dev` starts everything, no errors
- Visiting https://localhost:5173 on phone (same Wi-Fi, host = laptop's LAN IP, accept self-signed cert) shows "controller online"

**Pitfall**: iOS Safari is strict about self-signed certs. You'll need to install the mkcert root CA on the phone, or use a tunnel like `ngrok` / `tailscale` for the dev URL.

---

### **Phase 1 — Pose pipeline on the phone**

**Goal**: phone shows live camera feed with skeleton overlay at 25+ fps. Pose data is ready for downstream consumption.

**Deliverables**:
- `controller/src/pose/poseWorker.ts` — initializes MediaPipe Pose Landmarker (lite variant, GPU delegate) inside a Web Worker
- `controller/src/pose/poseClient.ts` — main-thread API: `start(videoEl)`, `onFrame(cb)`, `stop()`
- Debug overlay canvas drawing the 33 landmarks + connections
- FPS counter HUD

**Key implementation notes**:

```ts
// poseWorker.ts (sketch)
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker: PoseLandmarker | null = null;

self.onmessage = async (e) => {
  if (e.data.type === 'init') {
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    self.postMessage({ type: 'ready' });
  }
  if (e.data.type === 'frame') {
    if (!landmarker) return;
    const result = landmarker.detectForVideo(e.data.bitmap, e.data.timestamp);
    self.postMessage({ type: 'result', result, timestamp: e.data.timestamp });
    e.data.bitmap.close();
  }
};
```

In `poseClient.ts`, capture frames via `requestVideoFrameCallback` on the `<video>` element, transfer to worker via `ImageBitmap` + `Transferable` (zero-copy).

**Tasks for Claude Code**:
1. Install `@mediapipe/tasks-vision`
2. Build worker as ES module worker (Vite handles via `?worker` import)
3. Set up `<video autoplay playsinline muted>` + `getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } })`
4. Use `requestVideoFrameCallback` (not rAF) to drive the pipeline at native frame rate
5. Draw landmarks on overlay canvas using `DrawingUtils`
6. Display fps + inference time

**Acceptance**:
- Skeleton draws on top of live camera feed
- Sustained ≥ 25 fps on a mid-2020s Android or iPhone
- No main-thread jank when scrolling debug UI

---

### **Phase 2 — Smoothing + ring buffer + calibration**

**Goal**: smooth, baseline-corrected landmark stream ready for action detection.

**Deliverables**:
- `oneEuroFilter.ts` — implements the One-Euro filter per landmark axis. Default params: `mincutoff = 1.0`, `beta = 0.007`, `dcutoff = 1.0`.
- `ringBuffer.ts` — fixed-size circular buffer of pose snapshots (capacity 30 ≈ 1 sec at 30fps)
- `calibration.ts` — captures 30 frames of "neutral standing", stores mean baseline values: `hipY0`, `headY0`, `shoulderMidX0`, `armLength0` (= shoulder-to-wrist distance with arm at side).

**Calibration UX**:
- "Stand straight, arms at your sides, full body in frame"
- Countdown 3-2-1
- Captures 30 frames, computes baseline
- Re-callibrate button always available

**Tasks for Claude Code**:
1. Implement One-Euro per the canonical paper (Casiez et al.). Apply to **world** landmarks only; image-space only used for overlay.
2. Implement ring buffer with `push(snapshot)`, `at(i)` (negative indices = newest), `range(n)`.
3. Calibration screen with countdown and confirmation
4. Persist baseline to `localStorage` keyed by user height bucket (optional)

**Acceptance**:
- Filtered landmark trace is visibly smoother than raw (toggle to compare)
- Ring buffer never allocates after warm-up (object reuse)
- Baseline values reproducible within ±2 cm across runs

---

### **Phase 3 — Action detectors**

**Goal**: clean events fire reliably for each move with minimal false positives.

Each detector is a pure function: `(buffer, baseline, config) => ActionEvent | null`. They run every frame; cooldowns prevent re-fire.

**Coordinate convention**: MediaPipe world coordinates are meters, with hip midpoint at origin. **Y increases downward** in the original output — flip sign so up = positive in your detectors. Z is depth (smaller = closer to camera).

#### 3.1 Jump

```ts
// detect/jump.ts
const JUMP_RISE_M = 0.15;        // hip rises 15 cm above baseline
const JUMP_WINDOW_MS = 250;       // within 250 ms
const JUMP_COOLDOWN_MS = 600;
const ANKLE_VIS_MIN = 0.5;

export function detectJump(buf, baseline, now, lastFireMs) {
  if (now - lastFireMs < JUMP_COOLDOWN_MS) return null;
  const window = buf.range(8); // ~250 ms at 30fps
  const ankleVis = window[window.length-1].leftAnkle.visibility;
  if (ankleVis < ANKLE_VIS_MIN) return null;
  const minHipY = Math.min(...window.map(s => s.hip.y));
  const rise = baseline.hipY0 - minHipY; // y is up
  if (rise > JUMP_RISE_M) {
    return { type: 'JUMP', timestamp: now, confidence: Math.min(1, rise / 0.30), meta: { rise } };
  }
  return null;
}
```

#### 3.2 Duck

Hip drops > 15 cm AND head also drops (rules out sitting). Cooldown 600 ms.

#### 3.3 Lean (lane change)

Shoulder-midpoint X relative to baseline. Hysteresis: enter at ±0.10 m, exit at ±0.05 m. Emits `LEAN_LEFT` / `LEAN_RIGHT` once on entry per side, `IDLE` (centered) on exit.

#### 3.4 Punch

Wrist forward velocity along Z. Per side:
- `wrist.z` derivative over 100 ms window (peak velocity)
- Trigger when peak velocity < -2.0 m/s (negative = toward camera) **and** wrist x-distance from shoulder > 0.85 × `armLength0`
- Cooldown 400 ms per side

```ts
const PUNCH_VEL_THRESHOLD = -2.0;     // m/s along z
const PUNCH_REACH_RATIO = 0.85;
const PUNCH_COOLDOWN_MS = 400;
```

**Why velocity not just position**: a held arm extension shouldn't fire repeatedly. Punch is a *motion*, not a *position*.

#### 3.5 Stance match

Defined as a target vector of joint angles `[θ_leftElbow, θ_rightElbow, θ_leftKnee, θ_rightKnee, θ_torsoLean]`. Compute the same vector from the current frame; cosine similarity > 0.92 sustained for 500 ms = match. Used for "stance gates" in the runner (copy the pose to pass).

```ts
function angleAt(a, b, c) {
  // angle at joint b formed by a-b-c, in radians
  const v1 = sub(a, b), v2 = sub(c, b);
  return Math.acos(dot(v1,v2) / (norm(v1)*norm(v2)));
}
```

**Tasks for Claude Code**:
1. Implement each detector as its own file with unit tests in vitest using fixture pose buffers (record real sessions with a "save buffer" debug button)
2. Combine into `detect/index.ts` exposing a single `tick(snapshot, now): ActionEvent[]`
3. Tunable config in `controller/src/config.ts`; expose a debug HUD (collapsible) for live threshold tuning during testing
4. Include cooldown + per-action `lastFireMs` tracking

**Acceptance**:
- Recorded session of 10 deliberate moves per type fires the right event ≥ 9/10 times
- False-positive rate during 30 sec of "standing still + small fidgeting": < 1/min total across all detectors

---

### **Phase 4 — Broker + room pairing**

**Goal**: phone and TV connect to a room and exchange events.

**Deliverables**:
- `broker/src/server.ts` — Node 20, `ws` library, port 8787
- Rooms keyed by 6-char alphanumeric code (no `0/O/1/I` to avoid OCR confusion)
- Each room holds `{ tv?: WebSocket, controller?: WebSocket }`
- Forwards `action` messages from controller → tv only (and vice versa for ack/HUD)
- Heartbeat ping every 10 sec, drop dead sockets

**Tasks for Claude Code**:
1. Scaffold with `npm create vite@latest broker -- --template vanilla-ts` then strip the frontend bits, OR just a plain Node TS project with `tsx` for dev
2. Implement the room map as `Map<string, Room>`
3. On `join`, attach socket to room by role; emit `peer-up` to the existing peer
4. On disconnect, emit `peer-down` to the peer; delete room when empty
5. Validate messages against `RoomMessage` schema with Zod (lightweight)
6. Log: `[room ABC123] controller joined; peer ready`

**Acceptance**:
- Two browser tabs (one as TV, one as controller, same room code) both see "peer connected"
- Sending an `action` message from controller appears in TV tab within 20 ms (LAN)
- Killing a tab triggers `peer-down` on the other within 12 sec

---

### **Phase 5 — TV game shell + pairing scene**

**Goal**: TV shows a QR code; phone scan opens the controller; once both connect, game scene loads.

**Deliverables**:
- Phaser 3 boot scene loading minimal assets
- `PairingScene`: generates 6-char room code, displays it in giant text + QR code (`qrcode` library) encoding the controller URL with `?room=...`
- Phaser scene transitions to `GameScene` when broker reports `peer-up`
- `controller` reads `?room=...` from URL, auto-joins on load (after camera permission granted)

**Tasks for Claude Code**:
1. `npm i phaser qrcode`
2. Use the Ourcade infinite-runner-template-phaser3 as a starting point (clone, copy the scene structure, strip Jetpack-Joyride specifics)
3. Implement TV-side WebSocket client; on `peer-up`, transition scene
4. Display "Player connected ✓" briefly before game starts

**Acceptance**:
- Open TV URL → QR appears
- Scan with phone camera → controller PWA loads → camera permission → "connected"
- TV scene auto-transitions to GameScene

---

### **Phase 6 — Runner gameplay**

**Goal**: 3-lane runner with jump, duck, lean, and obstacle collision.

**Deliverables**:
- `Player.ts` — state machine: `RUNNING | JUMPING | DUCKING | LANE_LEFT | LANE_RIGHT`
- Three lanes at fixed X positions
- `SpawnSystem` — object pool of obstacles spawning ahead of player at increasing rate
- Parallax background (3 layers, speeds × 0.2, × 0.5, × 1.0)
- Collision = game over → `GameOverScene` shows score + "Stand still 3 sec to restart" (gesture-based UI)
- `InputSystem` consumes `ActionEvent`s from WS:
  - `JUMP` → vy = -jumpVel, gravity returns to ground
  - `DUCK` → shrink hitbox + duck sprite for 600 ms
  - `LEAN_LEFT/RIGHT` → tween to lane in 150 ms; ignore if already moving
- Speed ramps up by 5% every 10 sec

**Tasks for Claude Code**:
1. Object pool pattern from the Phaser endless runner tutorial
2. Tile sprite for parallax (`Phaser.GameObjects.TileSprite`)
3. Use Arcade Physics with `setAllowGravity(true)`; jump = `setVelocityY(-450)`
4. Connect the WebSocket subscription to `InputSystem.handleEvent(ev)` which routes to player methods
5. Score = elapsed seconds × multiplier + coins

**Acceptance**:
- 60 fps stable on a laptop running Chrome at 1080p
- Jump/duck/lane-change visibly respond to phone gestures with < 150 ms perceived latency
- Score persists in `localStorage`

---

### **Phase 7 — Punch + stance mechanics**

**Goal**: punch destroys breakable obstacles; stance gates require copying a pose.

**Deliverables**:
- New obstacle type: `breakable` (renders with cracks). On `PUNCH_LEFT/RIGHT` while within ±100 px of player, particle effect + score bonus, no game over
- `StanceGate` entity: a tall arch with a silhouette inside (yoga pose, T-pose, sumo squat, warrior 2). Player must hold the pose for 500 ms while passing under or score penalty
- Stance reference set: 5 hand-recorded target angle vectors stored in JSON; load via fetch
- HUD displays a small live skeleton from the phone (downsampled landmark stream sent every 100 ms)

**Tasks for Claude Code**:
1. Add a 6th detector path: continuous `STANCE_MATCH` events with `meta: { stanceId }`
2. Define stance gate spawn rule: every Nth obstacle batch, spawn a gate matching one of the 5 stances
3. Render the gate's silhouette using the same skeleton rig
4. Bonus particles + camera shake on successful match

**Acceptance**:
- Recorded session: punch breaks 9/10 breakable obstacles (no false-trigger destruction of solid ones)
- Stance gate matches when player holds the pose; misses when they don't

---

### **Phase 7b — Local split-screen co-op + remote multiplayer (web MVP)**

**Goal**: two players, two phones, one TV (local) — *and* the same protocol works for two players in two different houses (remote). This is the killer feature; it must be in the validation build.

**Modes shipping in this phase**:

1. **Score Battle** (default, easiest to make fun):
   - Independent worlds — each player runs their own obstacle stream
   - Fixed 90-second timer
   - Highest score wins
   - No collision sync needed; pure parallel runs
2. **Co-op Survival**:
   - Independent worlds, but if either player dies the run ends
   - Combined score advances shared unlock progress
   - Designed for friends who want to *help* each other, not compete
3. **Race** (Phase 12b in Unity port — skip for the web MVP if time is tight):
   - Shared obstacle pattern (same seed sent to both TV viewports)
   - First player to fall behind by 5 obstacles loses

**Camera setup (local co-op)**: two phones on two tripods, ~2 m apart, each player has their own. Each phone runs its own pose detection on its own player. This sidesteps the multi-person pose problem entirely — every phone only sees one body.

**Camera setup (remote)**: same as solo — each player has their phone-on-tripod setup at home; they each have their own TV.

**Pairing UX**:
- TV shows ONE QR code + 6-char code
- First phone scans → assigned slot 1, sees "✓ Player 1 — waiting for Player 2 (or tap Solo)"
- TV shows pairing screen with two slots; slot 1 fills in green, slot 2 still shows the same QR code
- Second phone scans → assigned slot 2, sees "✓ Player 2 — ready"
- Either player can tap "Ready" on phone; when both ready → game starts
- Mode selection on Player 1's phone (host)

**Split-screen rendering (Phaser)**:
- TV scene runs **two independent sub-scenes** added with `scene.add(...)`, each rendered into a Phaser camera covering half the screen (left/right viewports for landscape, top/bottom for portrait)
- Each sub-scene has its own `InputSystem`, player, obstacle pool, parallax
- Top-level `MatchScene` owns the timer, mode rules, win condition, score HUD
- Audio: spatial 2D pan (player 1 sounds slightly left, player 2 slightly right) — small touch but really sells the local-couch feel

**Remote multiplayer**:
- Each player connects to the same broker room from their own home
- Each TV is its own `tv` client in the room
- Each TV renders **its local player full-screen + small HUD showing remote player's progress** (score, lane, alive/dead). Splitting the screen for a remote player you can't actually see together is uncanny.
- Broker propagates `action` events to all TVs in the room
- Each TV deterministically simulates *its own* world from the same seed (Score Battle) or both worlds (so HUD can render the remote player's lane position)
- Latency tolerance: 50–150 ms WAN is acceptable for parallel-world modes; Race mode is borderline and may need a 200ms input buffer

**Deliverables**:
- Broker: support N controllers + N TVs per room (currently 1+1); slot assignment; reconnect grace window
- TV game: `MatchScene` orchestrator, two `RunScene` instances side-by-side, mode rules, end-of-match scoreboard
- Controller: slot indicator UI, ready toggle, mode picker (host only), reconnect handling
- Synchronization: shared map seed sent on `game-event: start`; both TVs derive identical obstacle patterns
- Latency HUD per slot ("P1 ping: 14 ms · P2 ping: 87 ms")
- Spectator support (optional): a third client joining as `tv` only sees both players, no controller — useful for streaming

**Tasks for Claude Code**:
1. Update broker rooms data structure: `Map<string, { controllers: Map<PlayerSlot, WS>, tvs: Set<WS>, state: RoomState }>`
2. Implement slot assignment + reconnect-grace timer
3. Refactor TV `GameScene` → `MatchScene` containing 1–2 `RunScene` instances at viewport rects `(0,0,W/2,H)` and `(W/2,0,W/2,H)`
4. `InputSystem` becomes per-slot; route incoming `action` messages by slot
5. Mode rules engine: pluggable strategies (`ScoreBattleMode`, `CoopSurvivalMode`) implementing `onTick`, `onPlayerDeath`, `isMatchOver`, `computeWinner`
6. Seedable random in `SpawnSystem` so both TVs spawn identical obstacle patterns when the mode requires it
7. Controller UI updates: slot badge, ready button, mode picker behind a host-only flag

**Acceptance**:
- Two phones + one TV: both players play simultaneously, scores tracked separately, winner shown
- Two laptops + two phones in different rooms (simulating remote): both can play, ping HUD < 100 ms on the same Wi-Fi, < 200 ms over public internet
- Co-op Survival: when either player dies, both runs end; combined score banked
- One player can drop their connection and rejoin within 30 sec without losing their slot
- Solo mode still works (single controller in room)

**Pitfalls specific to multiplayer**:
- **Two phones on same Wi-Fi, narrow channel** — bandwidth is not the issue (action events are tiny), but Wi-Fi airtime contention can spike latency. If you see > 50 ms LAN ping, switch one phone to 5 GHz or test with both wired (not realistic) to isolate.
- **One player calibrates, other doesn't** — calibration is per-phone, must be done by both before match starts. Block "Ready" until calibrated.
- **Camera cross-talk in close quarters** — if the two tripods are too close, each phone may pick up the *other* player's body in frame. MediaPipe Pose Landmarker with `numPoses: 1` defaults to the largest body in frame, which is usually the closer player; document the 2 m separation requirement and visualize a "you in frame ✓" check on each phone.
- **Audio sync is harder than visual sync**: when two players are in the same room, your code's "scored a coin" SFX fires twice almost simultaneously and creates flam. Suppress one side's SFX when the same event fires within 50 ms on both — pick whichever player's view dominates the screen.

---

### **Phase 8 — Polish & deploy**

**Deliverables**:
- Latency HUD (toggleable): round-trip ping every second, displayed as "ping: 18 ms"
- Sound: jump SFX, coin SFX, punch SFX, music
- "Calibration mode" accessible via a 3-second T-pose hold
- Deploy:
  - Broker → Fly.io or Railway, public WSS endpoint
  - Controller PWA + TV game → Vercel (separate projects). Both read `VITE_BROKER_URL` env var
- Add a `manifest.webmanifest` so the controller installs as a PWA
- README with a 30-second-to-play setup

**Tasks for Claude Code**:
1. Containerize broker (multi-stage Node Dockerfile)
2. Add CI: lint, typecheck, build per package
3. End-to-end smoke test using Playwright: TV opens, mock controller sends synthetic events, asserts in-game effects

**Acceptance**:
- Anyone with the TV URL on their laptop+monitor + a phone can play in < 60 seconds from cold

---

### **Phase 9 — Validation gate (decision point, not a build phase)**

This is the fork in the road. Phases 0–8 produce a **fully playable web MVP**. Before pouring effort into the Unity port + store releases (Phases 10–13), validate that the gameplay is actually fun and the tech is reliable enough to charge for.

**Hard validation criteria (all must be true to proceed)**:

1. **Engagement**: median session length ≥ 4 minutes across ≥ 30 unique testers
2. **Retention proxy**: ≥ 40% of testers ask "can I play again?" or come back within 24 h
3. **Reliability**: < 1 false-positive action per minute on average across testers; < 5% of sessions abandoned due to detection problems
4. **Setup friction**: ≥ 80% of testers can go from URL → playing in < 90 seconds without help
5. **Hardware coverage**: tested on iOS 17+ Safari, Android Chrome 120+, on at least 3 phone models per OS
6. **Willingness to pay signal**: at the end of the session, ask "would you pay $2 to unlock 5 more maps?" — target ≥ 30% yes
7. **Co-op proves the killer-feature thesis**: among testers who played at least one local Score Battle round, ≥ 60% rate it more fun than solo (single Likert question post-session)
8. **Co-op setup friction**: ≥ 70% of pairs go from "let's play together" → first match in < 3 minutes
9. **Remote multiplayer reliability**: tested across 5 home pairs on different ISPs, ≥ 80% of matches complete without a desync, dropped connection, or rage-quit-blamed-on-network

**Soft signals worth watching**:
- Which actions players love vs find frustrating (informs which moves the Unity version emphasizes)
- Whether they prefer the "tripod facing me" or "TV-side camera" setup (affects where you put the camera in Unity)
- Whether stance gates are a hit or a chore (informs how heavily to lean on them in premium maps)
- Whether co-op groups skew toward Score Battle (competitive) or Co-op Survival (cooperative) — informs mode mix in premium maps
- Whether people stream / record co-op sessions for social media — replay/share is the viral hook

**If validation fails**: iterate on the web version — it's far cheaper to fix gameplay there than after a Unity port. Tune thresholds, add/remove move types, redesign obstacle patterns. Don't proceed until criteria are met.

**If validation passes**: proceed to Phase 10. The web version stays live as the free demo / browser play option.

---

## 6b. Monetization architecture (read before Phase 10)

**Business model**: free-to-play with one always-free map; additional maps purchasable individually or earnable through gameplay.

**Map model**:

A **Map** is a JSON manifest + asset bundle. Designed so adding a map is a content drop, not a code release.

```ts
// shared/src/map.ts
export interface MapManifest {
  id: string;                    // 'cambodia-streets'
  name: string;
  tier: 'free' | 'premium' | 'earnable';
  price?: { usd: number };       // for premium
  unlockRules?: UnlockRule[];    // for earnable
  theme: { palette: string; music: string; parallaxAssets: string[] };
  length: number;                // seconds
  obstaclePatterns: PatternRef[];
  stanceSet: string[];           // stance IDs used in this map
  difficultyCurve: DifficultyPoint[];
}

export type UnlockRule =
  | { kind: 'totalScore'; threshold: number }       // earn 50,000 lifetime points
  | { kind: 'streakDays'; days: number }            // play 7 days in a row
  | { kind: 'mapCompleted'; mapId: string; times: number }  // beat free map 10x
  | { kind: 'tournamentWin'; tournamentId: string }
  | { kind: 'stanceMastery'; stanceId: string; perfectMatches: number };
```

**Launch content plan**:
- 1 free map: "**Phnom Penh Streets**" — tutorial + base gameplay loop (~3 min)
- 5 premium maps at $1.99 each, or $7.99 for the bundle:
  - Tomb Raider (jungle ruins, heavy stance gates)
  - Neon Tokyo (fast lane-changes, breakable obstacles)
  - Arctic Sprint (slippery physics modifier)
  - Boxing Gym (punch-heavy)
  - Yoga Mountain (stance-heavy, slower pace)
- 2 earnable maps:
  - "Marathon" (unlock by playing 7 days in a row)
  - "Champion's Run" (unlock by winning a weekly tournament)

**Why this mix works**: premium gives a clear money path; earnable gives F2P players a reason to keep coming back; the free map alone is satisfying so players don't bounce in 30 seconds.

**Backend additions needed for Phase 10**:
- User accounts (email/Apple/Google sign-in)
- Map ownership table
- Purchase receipt validation (Apple App Store + Google Play Billing)
- Score history + leaderboards
- Achievement / unlock-rule evaluation
- Optional: tournaments table

**Recommended backend stack**: **Supabase** (Postgres + Auth + Realtime + Edge Functions). Faster than rolling your own; generous free tier; real SQL when you outgrow Firebase-style. Alternative: Node + Postgres on Railway/Fly.io if you want full control.

**Anti-cheat reality check**: pose detection runs on the player's phone — it's spoofable (record a video, replay it). For a casual game, this is fine. For paid tournaments, validate score plausibility server-side (max points/sec, reasonable action distributions) and accept that determined cheaters will get through. Don't over-engineer.

---

## 7. Unity port roadmap (Phases 10–13)

Why Unity at this stage: native app stores are where IAP lives. While you *can* do PWA + Stripe, App Store and Play Store rules around web-based purchases are hostile, and discovery on the stores beats discovery via URL sharing for a paid game. Unity also gives you a cleaner path to console / Apple TV / Android TV / VR later.

**What transfers from the web MVP**:
- ✅ All art, audio, level designs, stance reference data, map manifests
- ✅ Action detection logic (TypeScript → C# port; same thresholds, same coordinate conventions, same algorithms)
- ✅ Backend / broker (becomes a real backend with accounts; same WebSocket protocol, just authenticated)
- ✅ Game design, tuning constants, balance from validation playtests

**What gets rewritten**:
- ❌ Phaser game scene → Unity scene (use the same map manifests as input)
- ❌ MediaPipe JS calls → MediaPipeUnityPlugin or native Mediapipe iOS/Android bindings
- ❌ Phone PWA shell → Unity Android + iOS apps
- ❌ WebSocket client → Unity `NativeWebSocket` package (same protocol)

---

### **Phase 10 — Backend with accounts, purchases, ownership**

**Goal**: a real backend the Unity apps can authenticate against and that gates map access.

**Deliverables**:
- Supabase project (or Node + Postgres equivalent) with these tables:
  - `users` (id, email, auth_provider, display_name, created_at)
  - `map_ownership` (user_id, map_id, source: 'free'|'purchase'|'earned', acquired_at)
  - `purchases` (id, user_id, platform: 'apple'|'google', product_id, receipt_blob, status, created_at)
  - `scores` (user_id, map_id, score, duration, action_counts_json, created_at)
  - `unlock_progress` (user_id, rule_kind, rule_target, progress_json, completed_at)
  - `tournaments` (id, name, map_id, starts_at, ends_at, prize_map_id)
  - `tournament_entries` (tournament_id, user_id, best_score)
- Edge Functions (or REST endpoints):
  - `POST /auth/*` — handled by Supabase Auth
  - `POST /purchases/verify` — validates Apple/Google receipts, grants ownership
  - `POST /scores` — records run, evaluates unlock rules
  - `GET /maps` — returns owned + available maps for the user
  - `GET /leaderboards/:mapId` — top scores
- Broker upgrade: WebSocket connections now require a JWT from Supabase Auth; rooms are owned by the authenticated user

**Tasks for Claude Code**:
1. Spin up Supabase project (manual, get keys), wire schema migrations as SQL files in `packages/backend/migrations/`
2. Implement Apple receipt validation against `https://buy.itunes.apple.com/verifyReceipt` (production) and `https://sandbox.itunes.apple.com/verifyReceipt` (sandbox), with proper retry semantics
3. Implement Google Play receipt validation via `androidpublisher` API
4. Server-side unlock-rule evaluator (runs on every `POST /scores`, idempotent)
5. Broker JWT verification middleware

**Acceptance**:
- Sandbox purchase on iOS test device → receipt POSTed → `map_ownership` row appears → map shows as owned
- Score posted that crosses an unlock threshold → ownership granted with `source='earned'`
- Unauthenticated WebSocket connection rejected

---

### **Phase 11 — Unity phone app (controller)**

**Goal**: native iOS + Android app replacing the web PWA, with same pose detection and event protocol.

**Stack**:
- Unity 2023 LTS or Unity 6 (latest LTS at Phase 11 time)
- **MediaPipeUnityPlugin** by `homuler` (community-maintained Unity wrapper around Google's Mediapipe — most mature option) **OR** native iOS Mediapipe + Android Mediapipe bridges if you need the official builds
- **NativeWebSocket** package for WebSocket
- **Unity IAP** (`com.unity.purchasing`) — or RevenueCat as an abstraction layer over Apple/Google billing (highly recommended; saves weeks)
- Supabase Unity SDK (or REST calls via `UnityWebRequest`) for auth and API

**Deliverables**:
- Unity project at `unity/PoseRunnerController/`
- Scenes: `Splash`, `Auth`, `Calibration`, `Pairing` (QR scanner + manual code entry), `Active` (running session, shows status only — no game on phone)
- C# port of all detectors from Phase 3 (one C# file per detector, same constants):
  - `Detectors/Jump.cs`, `Duck.cs`, `Lean.cs`, `Punch.cs`, `Stance.cs`
  - Shared `RingBuffer<PoseSnapshot>`, `OneEuroFilter`, `Calibration` modules
- Mediapipe pose graph configured for `pose_landmark_lite` with GPU delegate
- WebSocket client speaking the same `RoomMessage` protocol from Phase 5 (with JWT now)
- IAP integration: shop scene listing available maps, "Buy" → IAP → server verification → ownership unlocked
- Account scene: sign in with Apple, Google, or email
- App icons, splash screens, store screenshots

**C# port note**: keep the Unity C# detector code structurally identical to the TypeScript version. Same constants in a `DetectorConfig` ScriptableObject. This makes it trivial to back-port tuning changes from web playtests, and to fix bugs once and apply both places.

**Tasks for Claude Code**:
1. Bootstrap Unity project structure (Claude Code can scaffold C# files but Unity Editor work — scenes, prefabs, asset import — is manual or via templates)
2. Port detectors line-by-line from TS to C#, with NUnit tests using recorded JSON fixtures (same fixtures as Phase 3 vitest tests)
3. MediaPipeUnityPlugin integration following its `Pose Tracking` sample
4. Implement WebSocket client mirroring `controller/src/net/ws.ts`
5. RevenueCat or Unity IAP integration; ensure entitlements sync to Supabase
6. Build pipelines: Xcode for iOS, Gradle for Android, both producing release-signed builds via CI

**Acceptance**:
- App installs from TestFlight + Google Play internal testing
- Same recorded-buffer fixtures produce identical action events in C# as in TS (deterministic parity)
- Sandbox purchase grants map ownership server-side within 5 sec
- Connects to broker, pairs with TV (web or Unity), gameplay events flow

---

### **Phase 12 — Unity TV app**

**Goal**: replace the Phaser web game with a Unity build that loads map manifests and renders premium-quality maps.

**Stack**:
- Same Unity LTS as the phone app (so detectors and shared types live in one Unity package)
- Universal Render Pipeline (URP) for nice visuals without breaking lower-end hardware
- Cinemachine for camera work
- DOTween for tweens

**Distribution options** (pick based on validation insights):
- **A. WebGL build** deployed to web — keeps "open URL on smart TV browser" workflow, but Unity WebGL is heavier (~30 MB initial load) and audio/perf is worse than native
- **B. Apple TV (tvOS)** + **Android TV** native apps — cleanest UX, real app store discoverability, but adds two more build targets
- **C. Desktop builds** (macOS, Windows, Linux) for laptop-to-TV via HDMI — easiest to ship, lowest reach
- **Recommended**: ship A + C at launch (free for everyone), add B in a follow-up release once revenue justifies the platform fees

**Deliverables**:
- Unity project at `unity/PoseRunnerTV/`
- Map loader: reads `MapManifest` JSON, instantiates obstacle patterns, theme, music
- All five premium maps + free map as scenes / prefab variants
- Pairing scene with QR (use `ZXing.Net` for QR generation), supporting up to 4 simultaneous controllers
- Game scene: 3 lanes, player rig, obstacle pool, parallax, particles, post-processing
- Receives action events via WebSocket; same `InputSystem` semantics as Phaser version, now per-slot
- **Split-screen layout system**: `MatchManager` driving 1, 2, or 4 viewports via Unity cameras with `rect` set to `(0,0,1,1)`, `(0,0,0.5,1)+(0.5,0,0.5,1)`, or quad layout. Each viewport owns one player rig.
- **Mode rules (ScriptableObject-based)**: `SoloMode`, `ScoreBattleMode`, `CoopSurvivalMode`, `RaceMode` — each defines win condition, world sharing, end-of-match presentation
- **Remote-multiplayer renderer**: when only one local controller is in the room but other slots are filled by remote players, render local player full-screen with a compact remote-player HUD (lane indicator, score, status pip)
- Game-over scene with per-slot scores, winner banner (in competitive modes), and combined-score submission (in cooperative modes)

**Tasks for Claude Code**:
1. Scaffold scenes, manager singletons, and core systems
2. Port `InputSystem` from Phaser → Unity C# (event consumer, same event types, per-slot routing)
3. Map manifest loader + spawn pattern executor (deterministic from a seed for shared-world modes)
4. `MatchManager` orchestrating viewport layout + mode rules
5. Score submission per slot to backend after each run; cooperative modes submit a combined entry tagged with all participants
6. Build configurations for WebGL, macOS, Windows, Linux

**Acceptance**:
- Free map plays end-to-end with phone controller (solo)
- 2-controller local Score Battle: split-screen, two scores, winner declared
- 2-controller local Co-op Survival: shared end-of-match, combined score banked toward unlock progress
- Remote multiplayer (two laptops, two phones, different networks): each TV shows local-full-screen + remote HUD, < 200 ms input-to-display delta
- Premium map only loads if **at least one player in the room** owns it (host-grants-access model — encourages buying because friends benefit)
- Score submitted to backend, visible on per-mode leaderboards

---

### **Phase 12b — Tournaments, async multiplayer, replay sharing**

**Goal**: extend the multiplayer foundation into discovery and retention features.

**Deliverables**:
- **Tournaments**: weekly server-scheduled events on a featured map, leaderboard prize = ownership of an earnable-tier map. Backend already has `tournaments` + `tournament_entries` tables from Phase 10; this phase adds the in-app discovery UI, entry flow, and prize-grant on completion.
- **Async multiplayer (ghost runs)**: Score Battle against a friend's recorded run. Backend stores the action-event stream of each run (small — a few hundred events at most for a 90-sec run); replay scene reconstructs the friend's player from the event stream while you play live. No real-time connection needed.
- **Replay sharing**: render a 15-sec highlight of the player's best moments (auto-detected via score deltas + stance matches) as an MP4 using Unity Recorder, with a watermark + invite link. One-tap share to TikTok / Instagram / WhatsApp. This is the viral hook — every share carries a referral link.
- **Friend system**: add by username or contact, see friends' best scores per map, challenge directly into an async match.

**Why now (not stretch)**: the validation phase showed if local co-op is fun. If yes, async multiplayer + tournaments are the retention multiplier — they keep solo players engaged when no friend is physically present. Without these, the game is fun-but-spiky; with them, daily active use becomes plausible.

**Tasks for Claude Code**:
1. Backend: tournament scheduler (cron or scheduled Edge Function), prize-grant on `ends_at`
2. Replay storage: gzipped JSON action streams in Supabase Storage, indexed by `score_id`
3. Ghost-run renderer in Unity: a phantom player rig consumes a recorded action stream the same way the live `InputSystem` consumes WebSocket events
4. Highlight detector: rule-based (top score delta over 3-sec windows, perfect stance matches, near-misses) → list of timestamps → Unity Recorder export
5. Share-sheet integration via native plugins (`Share` via SharePlugin or similar)
6. Friends table + invite flow

**Acceptance**:
- Weekly tournament runs end-to-end: starts on schedule, accepts entries, ends, grants prize map to top finisher
- A user can challenge a friend; friend gets a notification; friend's app shows the ghost run when they accept
- Highlight clip renders < 30 sec post-match, opens share sheet with link
- Click on a shared link opens the App Store listing with a referral attribution

---

### **Phase 13 — Store launch**

**Goal**: ship to App Store + Google Play.

**Deliverables**:
- App Store Connect listing (controller app), screenshots, preview video, description, keywords
- Google Play Console listing (controller app), same assets
- Store products configured: 5 individual map IAPs + 1 bundle IAP
- Privacy policy + terms (must explain camera usage clearly; Apple is strict)
- Apple App Privacy "Nutrition Label" filled out: camera data is processed on-device, never uploaded
- Onboarding flow: explain camera-on-phone-pointing-at-you setup with an animated illustration
- Launch checklist:
  - Both apps approved
  - Backend deployed at production scale (autoscale on Supabase or migrate to dedicated)
  - Web version still live as a "Try in browser before installing" option
  - One launch tournament with a free unlock map as the prize
  - Press kit: 2-min gameplay video, GIFs, one-pager
- Post-launch:
  - Monitor crash rate (Unity Analytics or Sentry)
  - Funnel analytics: install → first play → first match → first purchase
  - A/B test the post-tutorial paywall placement

**Acceptance**:
- Both apps live in stores, downloadable, reviewed
- End-to-end purchase from a real user account works on production
- Web version still functional as funnel into the native apps

---

## 7. Key technical pitfalls to plan for

1. **iOS getUserMedia + HTTPS**: Safari requires HTTPS even on LAN. Either install mkcert root CA on phone, use Tailscale (gives you a real https URL), or develop entirely against a deployed staging.
2. **Front vs rear camera framing**: Player aims phone at themselves → use `facingMode: 'user'` if phone is propped on a tripod facing them. If they're playing solo and phone is on a stand pointing back at them, this is the right call. (Document the setup clearly: phone on a tripod 2 m back at chest height.)
3. **Lighting**: Pose accuracy collapses below ~150 lux. Add a "quality check" warning if the average landmark `visibility` drops below 0.6 for 3 sec.
4. **Phone overheats**: continuous GPU inference + camera = warm phone after ~20 min. Drop to 20 fps if `requestIdleCallback` reports thermal throttling, or document max session length.
5. **NAT on broker deployment**: WebSocket alone is fine. If you ever switch to WebRTC DataChannel for off-LAN play, you'll need STUN (free, e.g. Google's `stun:stun.l.google.com:19302`) and probably TURN (paid, e.g. Twilio or self-hosted coturn). LAN-only stays simple.
6. **MediaPipe model loading**: 5–10 MB download first time. Pre-cache the `.task` file in a Service Worker so subsequent loads are instant.
7. **One-Euro tuning**: too smooth = laggy detection; too jittery = false fires. Start with `beta = 0.007` and only raise if you see lag.
8. **Punch detection vs lane-change confusion**: a hard lean can cause the wrist to swing forward in z. Mitigate by gating punch on `shoulder.z` being roughly stationary (torso isn't moving forward).

---

## 8. Stretch goals (post-launch)

- **4-player local**: 2×2 viewport quad layout, 4 phones in one room — party mode (the protocol already supports up to slot 4)
- **Custom stances**: players record their own target poses, save to a "stance pack" — premium creator economy
- **Workout mode**: count squats, jumps, push-ups; export to Apple Health / Google Fit (separate IAP; broadens audience beyond gamers)
- **Spectator mode**: third+ devices joining as `tv` only, watching a live multiplayer session — useful for streaming and for teaching new players
- **AR overlay**: composite the runner onto the player's camera feed on the phone (small-screen variant when no TV is around)
- **Live replay scrubbing**: scrub through a saved replay frame-by-frame to study form — appeals to the workout-mode audience
- **Apple TV / Android TV native apps**: Phase 12 "B" option as a follow-up release
- **Subscription tier**: $4.99/month "all maps + future maps + tournaments" alternative to per-map purchases; A/B against per-map model in retention vs ARPU
- **Custom obstacle editor**: let players design and share maps; UGC drives long-tail content beyond what the team can ship

---

## 9. How to drive this with Claude Code

1. Drop this file at the repo root as `BUILD_PLAN.md`
2. In Claude Code: `Read BUILD_PLAN.md and execute Phase 0. Stop and summarize when done.`
3. Verify acceptance criteria yourself before moving on
4. For each subsequent phase: `Execute Phase N per BUILD_PLAN.md`
5. When a detector misbehaves, drop a recorded buffer JSON into `packages/controller/test/fixtures/` and ask Claude Code to write a vitest case that exercises the failure, then fix until green

---

## 10. Reference links (verified working)

**Web MVP (Phases 0–8)**
- MediaPipe Pose Landmarker for Web — https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- MediaPipe in a Web Worker (vanilla JS guide) — https://ankdev.me/blog/how-to-run-mediapipe-task-vision-in-a-web-worker
- Phaser 3 endless runner with object pooling (Feronato) — https://emanueleferonato.com/2018/11/13/build-a-html5-endless-runner-with-phaser-in-a-few-lines-of-code-using-arcade-physics-and-featuring-object-pooling/
- Ourcade Infinite Runner template (TypeScript) — https://github.com/ourcade/infinite-runner-template-phaser3
- One-Euro filter paper — https://gery.casiez.net/1euro/
- Pose-controlled game prior art — https://github.com/everythingishacked/Gamebody
- MediaPipe pose detection games (GitHub topic) — https://github.com/topics/mediapipe-pose

**Unity port (Phases 10–13)**
- MediaPipeUnityPlugin (homuler) — https://github.com/homuler/MediaPipeUnityPlugin
- Unity NativeWebSocket — https://github.com/endel/NativeWebSocket
- Unity IAP (official) — https://docs.unity3d.com/Packages/com.unity.purchasing@latest
- RevenueCat (IAP abstraction, recommended) — https://www.revenuecat.com/docs/getting-started/installation/unity
- Supabase Unity client — https://github.com/supabase-community/supabase-csharp
- Apple receipt validation — https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
- Google Play receipt validation — https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
- ZXing.Net (QR generation in Unity) — https://github.com/micjahn/ZXing.Net
- App Store Review Guidelines (camera usage) — https://developer.apple.com/app-store/review/guidelines/#privacy
