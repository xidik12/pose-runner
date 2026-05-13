// packages/tv/src/scenes/RunScene.ts
// =============================================================================
// One player's run. The MatchScene instantiates 1-4 of these into separate
// viewports and routes incoming action events to the correct one by slot.
//
// Owns:
//   - 3 lanes (left, center, right)
//   - player sprite + animation state machine
//   - obstacle pool (avoid alloc during gameplay)
//   - parallax background layers
//   - scoring + stat counters (reports back to MatchScene via callbacks)
//   - reaction to action events from the broker
// =============================================================================

import Phaser from 'phaser';
import {
  type ActionEvent, type MapManifest, type PlayerSlot,
  type PatternRef, type DifficultyPoint,
  makeSeededRng,
} from '@pose-runner/shared';

// ---------------------------------------------------------------------------
// Init args (passed by MatchScene via scene.add(key, RunScene, true, data))
// ---------------------------------------------------------------------------

export interface RunSceneInit {
  slot: PlayerSlot;
  manifest: MapManifest;
  /** Different from sharedSeed — each player gets a unique seed in non-shared modes */
  seed: number;
  /** Set when mode requires identical obstacle stream across players (Race) */
  sharedSeed: number | null;
  /** Phaser camera viewport in screen pixels */
  viewport: { x: number; y: number; w: number; h: number };
  /** Callbacks back to MatchScene */
  onScore: (score: number) => void;
  onDeath: () => void;
  onStat: (key: 'coin' | 'avoided' | 'broken' | 'perfectStance' | 'jump' | 'duck' | 'punch' | 'lane', n: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_COUNT = 3;
const LANE_WIDTH_FAR = 14;       // half-width of one lane at the horizon
const LANE_WIDTH_NEAR = 220;     // half-width of one lane at the player
const HORIZON_Y_FRAC = 0.42;     // fraction of viewport height for the horizon
const PLAYER_GROUND_Y = 0.82;    // fraction of viewport height for the player
const PERSPECTIVE_EXP = 1.7;     // higher = more aggressive depth foreshortening
const JUMP_HEIGHT_PX = 180;
const JUMP_DURATION_MS = 600;
const DUCK_DURATION_MS = 500;
const PUNCH_REACH_PX = 90;
const PUNCH_WINDOW_MS = 250;
const COIN_VALUE = 10;
const OBSTACLE_AVOID_VALUE = 25;
const OBSTACLE_BREAK_VALUE = 50;
const PERFECT_STANCE_VALUE = 100;
const POOL_SIZE = 40;

// ---------------------------------------------------------------------------
// Player state machine
// ---------------------------------------------------------------------------

type PlayerAnim = 'run' | 'jump' | 'duck' | 'punch-left' | 'punch-right' | 'dead';

interface PlayerState {
  lane: 0 | 1 | 2;
  anim: PlayerAnim;
  animUntilMs: number;
  isInvulnerable: boolean;
  invulnUntilMs: number;
  lastPunchAtMs: number;
  lastPunchSide: 'left' | 'right' | null;
}

// ---------------------------------------------------------------------------
// Obstacle pool
// ---------------------------------------------------------------------------

type ObstacleKind = 'lowBar' | 'highBar' | 'wall' | 'breakable' | 'coin' | 'stanceGate';

interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: 0 | 1 | 2 | 'all';
  /** vertical position the player must satisfy: 'high' = duck, 'low' = jump, 'any' = avoid by lane */
  avoidance: 'high' | 'low' | 'any';
  sprite: Phaser.GameObjects.Sprite;
  z: number;             // 0 (far) → 1 (at player)
  /** for stance gates: which stanceId is required */
  stanceId?: string;
  /** for breakables: hp */
  hp: number;
}

// ---------------------------------------------------------------------------
// RunScene
// ---------------------------------------------------------------------------

export class RunScene extends Phaser.Scene {
  // injected
  private slot!: PlayerSlot;
  private manifest!: MapManifest;
  private rng!: () => number;
  private viewport!: { x: number; y: number; w: number; h: number };
  private onScore!: RunSceneInit['onScore'];
  private onDeath!: RunSceneInit['onDeath'];
  private onStat!: RunSceneInit['onStat'];

  // visuals
  private parallaxLayers: Phaser.GameObjects.TileSprite[] = [];
  private groundGfx!: Phaser.GameObjects.Graphics;   // perspective lanes + scrolling stripes
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private scoreText!: Phaser.GameObjects.Text;
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private stripePhase = 0;

  // logic
  private pState!: PlayerState;
  private pool: Obstacle[] = [];
  private timeMs = 0;
  private spawnAccumMs = 0;
  private nextSpawnMs = 0;
  private score = 0;
  private dead = false;

  // pending actions buffered between ticks (network → game thread)
  private actionQueue: ActionEvent[] = [];

  init(data: RunSceneInit) {
    this.slot = data.slot;
    this.manifest = data.manifest;
    this.rng = makeSeededRng(data.sharedSeed ?? data.seed);
    this.viewport = data.viewport;
    this.onScore = data.onScore;
    this.onDeath = data.onDeath;
    this.onStat = data.onStat;

    this.pState = {
      lane: 1,
      anim: 'run',
      animUntilMs: 0,
      isInvulnerable: false,
      invulnUntilMs: 0,
      lastPunchAtMs: 0,
      lastPunchSide: null,
    };
  }

  preload() {
    // assets are loaded once at boot; map-specific themes referenced by id
    // example: this.load.atlas('player', '/atlas/player.png', '/atlas/player.json');
  }

  create() {
    // Camera: render this scene only into our viewport
    this.camera = this.cameras.main;
    this.camera.setViewport(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
    this.camera.setBackgroundColor('#101218');

    // Parallax: only the SKY layers scroll horizontally to suggest scenery drift.
    // Anything below the horizon is replaced with our perspective lanes.
    const skyOnly = this.manifest.theme.parallaxLayers.slice(0, 2);
    for (const layer of skyOnly) {
      const ts = this.add.tileSprite(0, 0, this.viewport.w, this.viewport.h * HORIZON_Y_FRAC, layer.assetId);
      ts.setOrigin(0, 0);
      ts.setData('speed', layer.speed);
      ts.setDepth(0);
      this.parallaxLayers.push(ts);
    }

    // Ground gradient + perspective lanes (drawn each frame)
    this.groundGfx = this.add.graphics();
    this.groundGfx.setDepth(5);

    // Player + soft shadow
    const playerX = this.laneToX(this.pState.lane);
    const playerY = this.viewport.h * PLAYER_GROUND_Y;
    this.playerShadow = this.add.ellipse(playerX, playerY + 18, 80, 18, 0x000000, 0.45);
    this.playerShadow.setDepth(40);
    this.playerSprite = this.add.sprite(playerX, playerY, 'player', 'run-0');
    this.playerSprite.setDepth(50);

    // HUD: score in top-left of viewport
    this.scoreText = this.add.text(16, 12, '0', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '32px',
      color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    });
    this.scoreText.setDepth(100);

    // Initialize obstacle pool — pre-allocate so no alloc during gameplay
    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = this.add.sprite(-9999, -9999, 'obstacle-atlas', 'wall-0');
      sprite.setVisible(false);
      this.pool.push({
        active: false, kind: 'wall', lane: 0, avoidance: 'any',
        sprite, z: 0, hp: 1,
      });
    }

    // Schedule first obstacle batch
    this.nextSpawnMs = this.curve(0).spawnInterval * 1000;
  }

  // -------------------------------------------------------------------------
  // External API
  // -------------------------------------------------------------------------

  consumeAction(event: ActionEvent) {
    if (this.dead) return;
    this.actionQueue.push(event);
  }

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------

  update(_time: number, deltaMs: number) {
    if (this.dead) return;
    this.timeMs += deltaMs;

    // 1. Drain any queued action events
    while (this.actionQueue.length) {
      this.handleAction(this.actionQueue.shift()!);
    }

    // 2. Update player anim state (clear timeouts)
    if (this.pState.animUntilMs <= this.timeMs && this.pState.anim !== 'run') {
      this.pState.anim = 'run';
      this.playerSprite.setFrame('run-0');
    }
    if (this.pState.invulnUntilMs <= this.timeMs) {
      this.pState.isInvulnerable = false;
    }

    // 3. Update parallax (sky drift) + lane stripes (forward depth)
    const cur = this.curve(this.timeMs / 1000);
    for (const layer of this.parallaxLayers) {
      layer.tilePositionX += cur.scrollSpeed * (layer.getData('speed') as number) * (deltaMs / 1000) * 0.3;
    }
    this.stripePhase = (this.stripePhase + cur.scrollSpeed * (deltaMs / 1000) / 600) % 1;
    this.drawGround();

    // 4. Update obstacles
    this.tickObstacles(cur.scrollSpeed, deltaMs);

    // Keep shadow under the player on lane change
    this.playerShadow.x = this.playerSprite.x;

    // 5. Spawning
    this.spawnAccumMs += deltaMs;
    if (this.spawnAccumMs >= this.nextSpawnMs) {
      this.spawnAccumMs = 0;
      this.nextSpawnMs = cur.spawnInterval * 1000;
      this.spawnPattern();
    }

    // 6. Push score
    this.onScore(this.score);
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  private handleAction(ev: ActionEvent) {
    switch (ev.type) {
      case 'JUMP':       this.startJump(); break;
      case 'DUCK':       this.startDuck(); break;
      case 'LEAN_LEFT':  this.changeLane(-1); break;
      case 'LEAN_RIGHT': this.changeLane(1); break;
      case 'PUNCH_LEFT': this.startPunch('left'); break;
      case 'PUNCH_RIGHT':this.startPunch('right'); break;
      case 'STANCE_MATCH': {
        const stanceId = ev.meta?.stanceId as string | undefined;
        this.handleStance(stanceId, (ev.confidence ?? 0) >= 0.95);
        break;
      }
      case 'IDLE': /* used for lean→center, no-op */ break;
    }
  }

  private startJump() {
    if (this.pState.anim === 'jump' || this.pState.anim === 'duck') return;
    this.pState.anim = 'jump';
    this.pState.animUntilMs = this.timeMs + JUMP_DURATION_MS;
    this.onStat('jump', 1);
    this.tweens.add({
      targets: this.playerSprite,
      y: { from: this.viewport.h * PLAYER_GROUND_Y, to: this.viewport.h * PLAYER_GROUND_Y - JUMP_HEIGHT_PX },
      duration: JUMP_DURATION_MS / 2,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
    this.playerSprite.setFrame('jump-0');
  }

  private startDuck() {
    if (this.pState.anim === 'jump') return;
    this.pState.anim = 'duck';
    this.pState.animUntilMs = this.timeMs + DUCK_DURATION_MS;
    this.onStat('duck', 1);
    this.playerSprite.setFrame('duck-0');
    // shrink hitbox via scaleY
    this.tweens.add({
      targets: this.playerSprite,
      scaleY: { from: 1, to: 0.55 },
      duration: 80, yoyo: true, hold: DUCK_DURATION_MS - 160,
    });
  }

  private changeLane(delta: -1 | 1) {
    const next = this.pState.lane + delta;
    if (next < 0 || next > 2) return;
    this.pState.lane = next as 0 | 1 | 2;
    this.onStat('lane', 1);
    this.tweens.add({
      targets: this.playerSprite,
      x: this.laneToX(this.pState.lane),
      duration: 120, ease: 'Sine.easeOut',
    });
  }

  private startPunch(side: 'left' | 'right') {
    this.pState.anim = side === 'left' ? 'punch-left' : 'punch-right';
    this.pState.animUntilMs = this.timeMs + PUNCH_WINDOW_MS;
    this.pState.lastPunchAtMs = this.timeMs;
    this.pState.lastPunchSide = side;
    this.onStat('punch', 1);
    this.playerSprite.setFrame(side === 'left' ? 'punch-l-0' : 'punch-r-0');

    // Look for breakable obstacles in punch range, in the player's lane
    for (const ob of this.pool) {
      if (!ob.active || ob.kind !== 'breakable') continue;
      if (ob.lane !== this.pState.lane && ob.lane !== 'all') continue;
      const distPx = Math.abs(ob.sprite.x - this.playerSprite.x) + Math.abs(ob.sprite.y - this.playerSprite.y);
      if (distPx < PUNCH_REACH_PX) {
        ob.hp -= 1;
        if (ob.hp <= 0) {
          this.deactivate(ob);
          this.score += OBSTACLE_BREAK_VALUE;
          this.onStat('broken', 1);
        }
      }
    }
  }

  private handleStance(stanceId: string | undefined, perfect: boolean) {
    // Find any active stance gate the player must pass
    for (const ob of this.pool) {
      if (!ob.active || ob.kind !== 'stanceGate') continue;
      if (ob.z < 0.55 || ob.z > 0.95) continue; // only when near player
      if (ob.stanceId !== stanceId) continue;
      this.deactivate(ob);
      this.score += OBSTACLE_AVOID_VALUE + (perfect ? PERFECT_STANCE_VALUE : 0);
      if (perfect) this.onStat('perfectStance', 1);
      this.onStat('avoided', 1);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Obstacle lifecycle
  // -------------------------------------------------------------------------

  private tickObstacles(scrollSpeed: number, deltaMs: number) {
    const dz = (scrollSpeed * deltaMs) / 1000 / 1200; // tune: 1200 px = full lane depth
    for (const ob of this.pool) {
      if (!ob.active) continue;
      ob.z += dz;
      this.positionObstacle(ob);

      // Collision check at z ≈ 1.0 (at player)
      if (ob.z >= 1.0) {
        // not yet handled / not avoided
        if (this.checkCollision(ob)) this.die();
        else this.scoreAvoidance(ob);
        this.deactivate(ob);
      }
    }
  }

  private checkCollision(ob: Obstacle): boolean {
    if (this.pState.isInvulnerable) return false;

    const inLane = ob.lane === 'all' || ob.lane === this.pState.lane;
    if (!inLane) return false; // wrong lane = automatic miss = automatic avoid

    switch (ob.avoidance) {
      case 'low':  return this.pState.anim !== 'jump';   // must jump
      case 'high': return this.pState.anim !== 'duck';   // must duck
      case 'any':  return true;                           // wall — must lane-change
    }
  }

  private scoreAvoidance(ob: Obstacle) {
    if (ob.kind === 'coin') {
      this.score += COIN_VALUE;
      this.onStat('coin', 1);
    } else if (ob.kind !== 'stanceGate') {
      this.score += OBSTACLE_AVOID_VALUE;
      this.onStat('avoided', 1);
    } else {
      // stance gate that wasn't triggered counts as a miss penalty (no points)
    }
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  private spawnPattern() {
    const t = this.timeMs / 1000;
    const tNorm = Math.min(1, t / this.manifest.length);

    // Pick a pattern weighted by the lerped weights at current t
    const weighted: { ref: PatternRef; w: number }[] = [];
    let total = 0;
    for (const ref of this.manifest.obstaclePatterns) {
      const w = ref.weightAtStart + (ref.weightAtEnd - ref.weightAtStart) * tNorm;
      if (w <= 0) continue;
      weighted.push({ ref, w });
      total += w;
    }
    if (total === 0) return;

    let pick = this.rng() * total;
    let chosen = weighted[0].ref;
    for (const { ref, w } of weighted) {
      pick -= w;
      if (pick <= 0) { chosen = ref; break; }
    }

    this.executePattern(chosen.id);
  }

  /**
   * Patterns are server-side data structures in a real build (json).
   * Here we hardcode a few representative shapes — replace with a registry
   * looked up by id from /assets/patterns.json in the actual repo.
   */
  private executePattern(id: string) {
    switch (id) {
      case 'single-jump':
        this.spawnObstacle('lowBar', this.randomLane(), 'low');
        break;
      case 'single-duck':
        this.spawnObstacle('highBar', this.randomLane(), 'high');
        break;
      case 'lane-shift':
        this.spawnObstacle('wall', this.randomLane(), 'any');
        break;
      case 'jump-coin':
        this.spawnObstacle('lowBar', 1, 'low');
        this.spawnObstacle('coin',   1, 'high');
        break;
      case 'duck-jump':
        this.spawnObstacle('highBar', 1, 'high');
        this.scheduleSpawn(800, () => this.spawnObstacle('lowBar', 1, 'low'));
        break;
      case 'breakable-wall':
        this.spawnObstacle('breakable', this.randomLane(), 'any');
        break;
      case 'breakable-bag':
        this.spawnObstacle('breakable', this.randomLane(), 'any');
        break;
      case 'stance-gate':
        if (this.manifest.stanceSet.length > 0) {
          const stanceId = this.manifest.stanceSet[Math.floor(this.rng() * this.manifest.stanceSet.length)];
          this.spawnObstacle('stanceGate', 'all', 'any', { stanceId });
        }
        break;
      case 'rapid-lane':
        this.spawnObstacle('wall', this.randomLane(), 'any');
        this.scheduleSpawn(400, () => this.spawnObstacle('wall', this.randomLane(), 'any'));
        break;
      case 'triple-combo':
        this.spawnObstacle('lowBar', 1, 'low');
        this.scheduleSpawn(500, () => this.spawnObstacle('highBar', 1, 'high'));
        this.scheduleSpawn(1000, () => this.spawnObstacle('wall', this.randomLane(), 'any'));
        break;
      // additional pattern ids (long-jump, double-stance, punch-combo, etc.) follow same template
    }
  }

  private scheduleSpawn(delayMs: number, fn: () => void) {
    this.time.delayedCall(delayMs, fn);
  }

  private spawnObstacle(
    kind: ObstacleKind,
    lane: 0 | 1 | 2 | 'all',
    avoidance: 'high' | 'low' | 'any',
    extras: { stanceId?: string } = {},
  ) {
    const ob = this.pool.find((o) => !o.active);
    if (!ob) return; // pool exhausted — drop the obstacle
    ob.active = true;
    ob.kind = kind;
    ob.lane = lane;
    ob.avoidance = avoidance;
    ob.z = 0;
    ob.hp = kind === 'breakable' ? 1 : 1;
    ob.stanceId = extras.stanceId;

    const frame = kind === 'lowBar'      ? 'low-bar-0'
                : kind === 'highBar'     ? 'high-bar-0'
                : kind === 'wall'        ? 'wall-0'
                : kind === 'breakable'   ? 'breakable-0'
                : kind === 'coin'        ? 'coin-0'
                : kind === 'stanceGate'  ? `gate-${extras.stanceId}`
                : 'wall-0';

    ob.sprite.setFrame(frame);
    ob.sprite.setVisible(true);
    this.positionObstacle(ob);
  }

  private positionObstacle(ob: Obstacle) {
    // True perspective: both X and Y interpolate from a horizon vanishing point.
    const yTop = this.viewport.h * HORIZON_Y_FRAC;
    const yBot = this.viewport.h * PLAYER_GROUND_Y;
    const t = Math.pow(ob.z, PERSPECTIVE_EXP);
    const y = yTop + (yBot - yTop) * t;

    const cx = this.viewport.w / 2;
    const targetX = ob.lane === 'all' ? cx : this.laneToX(ob.lane);
    const x = cx + (targetX - cx) * t;

    const scale = 0.08 + 0.92 * t;
    ob.sprite.setPosition(x, y);
    ob.sprite.setScale(scale);
    ob.sprite.setDepth(20 + ob.z * 30);
  }

  private drawGround() {
    const g = this.groundGfx;
    const w = this.viewport.w, h = this.viewport.h;
    const cx = w / 2;
    const yTop = h * HORIZON_Y_FRAC;
    const yBot = h * (PLAYER_GROUND_Y + 0.04);
    g.clear();

    // 1) Ground fill — vertical gradient from horizon down via a stack of rects
    const STEPS = 28;
    for (let i = 0; i < STEPS; i++) {
      const t0 = i / STEPS;
      const t1 = (i + 1) / STEPS;
      const y0 = yTop + (yBot - yTop) * t0;
      const y1 = yTop + (yBot - yTop) * t1;
      // Lerp dark→slightly-lighter as we approach the player
      const shade = Math.round(0x12 + 0x1c * t0);
      const color = (shade << 16) | ((shade + 4) << 8) | (shade + 10);
      g.fillStyle(color, 1);
      g.fillRect(0, y0, w, y1 - y0 + 1);
    }

    // 2) Lane boundaries — 4 perspective lines for 3 lanes (far edges converge at cx,yTop)
    const farHalf = LANE_WIDTH_FAR * 1.5;
    const nearHalf = LANE_WIDTH_NEAR * 1.5;
    g.lineStyle(2, 0x3a4b6a, 0.85);
    for (let i = -1.5; i <= 1.5; i += 1) {
      const xNear = cx + i * LANE_WIDTH_NEAR;
      const xFar = cx + (i / 1.5) * farHalf;
      g.beginPath();
      g.moveTo(xFar, yTop);
      g.lineTo(xNear, yBot);
      g.strokePath();
    }

    // 3) Scrolling lane stripes — dashed segments racing toward the player along
    //    each of the two inner lane boundaries.
    const STRIPE_COUNT = 12;
    g.lineStyle(4, 0xffd24a, 0.9);
    for (const innerIdx of [-0.5, 0.5]) {
      for (let s = 0; s < STRIPE_COUNT; s++) {
        // dash phase scrolls 0..1; convert to z position with perspective
        let segT = (s / STRIPE_COUNT + this.stripePhase) % 1;
        // ease so stripes appear evenly spaced in WORLD space (not screen)
        segT = Math.pow(segT, 1 / PERSPECTIVE_EXP);

        const segT2 = Math.min(1, segT + 0.5 / STRIPE_COUNT);
        const lerp = (t: number) => yTop + (yBot - yTop) * Math.pow(t, PERSPECTIVE_EXP);
        const y0 = lerp(segT);
        const y1 = lerp(segT2);
        const lerpX = (t: number) =>
          cx + (cx + innerIdx * LANE_WIDTH_NEAR - cx) * Math.pow(t, PERSPECTIVE_EXP);
        const x0 = lerpX(segT);
        const x1 = lerpX(segT2);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
      }
    }

    // 4) Horizon glow
    const glow = g.fillGradientStyle
      ? null
      : null;
    void glow;
    g.fillStyle(0x5dd6ff, 0.18);
    g.fillRect(0, yTop - 2, w, 3);
  }

  private deactivate(ob: Obstacle) {
    ob.active = false;
    ob.sprite.setVisible(false);
    ob.sprite.setPosition(-9999, -9999);
  }

  // -------------------------------------------------------------------------
  // Lane / camera helpers
  // -------------------------------------------------------------------------

  private laneToX(lane: 0 | 1 | 2): number {
    const cx = this.viewport.w / 2;
    return cx + (lane - 1) * LANE_WIDTH_NEAR;
  }

  private randomLane(): 0 | 1 | 2 {
    return Math.floor(this.rng() * LANE_COUNT) as 0 | 1 | 2;
  }

  // -------------------------------------------------------------------------
  // Difficulty curve interpolation
  // -------------------------------------------------------------------------

  private curve(tSec: number): { scrollSpeed: number; spawnInterval: number } {
    const points = this.manifest.difficultyCurve;
    if (tSec <= points[0].t) return { scrollSpeed: points[0].scrollSpeed, spawnInterval: points[0].spawnInterval };
    if (tSec >= points[points.length - 1].t) {
      const last = points[points.length - 1];
      return { scrollSpeed: last.scrollSpeed, spawnInterval: last.spawnInterval };
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (tSec >= a.t && tSec <= b.t) {
        const u = (tSec - a.t) / (b.t - a.t);
        return {
          scrollSpeed: a.scrollSpeed + (b.scrollSpeed - a.scrollSpeed) * u,
          spawnInterval: a.spawnInterval + (b.spawnInterval - a.spawnInterval) * u,
        };
      }
    }
    return { scrollSpeed: 240, spawnInterval: 1.6 };
  }

  // -------------------------------------------------------------------------
  // Death
  // -------------------------------------------------------------------------

  private die() {
    if (this.dead) return;
    this.dead = true;
    this.pState.anim = 'dead';
    this.playerSprite.setFrame('dead-0');
    this.cameras.main.shake(180, 0.01);
    this.cameras.main.flash(120, 200, 30, 30);
    this.onDeath();
  }
}
