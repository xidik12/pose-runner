// One player's complete world: scene, camera, player rig, track, env, obstacles, patterns.
// Match owns N of these, one per slot.
import * as THREE from 'three';
import type { ActionEvent, PlayerSlot, MapManifest } from '@pose-runner/shared';
import { makeSeededRng } from '@pose-runner/shared';
import { Player } from './Player';
import { Track } from './Track';
import { Environment } from './Environment';
import { Obstacles } from './Obstacles';
import { Patterns } from './Patterns';
import { Boulder, type BoulderTickResult } from './Boulder';
import { gameAudio } from './Audio';
import { Tutorial } from './Tutorial';
import { Particles } from './Particles';
import {
  SCROLL_START, SCROLL_RAMP, SCROLL_MAX, FOG_FAR,
} from './constants';

export interface PlayerWorldStats {
  score: number;
  coins: number;
  obstaclesAvoided: number;
  obstaclesBroken: number;
  jumps: number;
  ducks: number;
  punches: number;
  laneChanges: number;
  diedAtMs: number | null;
}

export interface PlayerWorldOpts {
  treeDensityFactor?: number;
}

export class PlayerWorld {
  readonly slot: PlayerSlot;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: Player;
  readonly track: Track;
  readonly env: Environment;
  readonly obstacles: Obstacles;
  readonly patterns: Patterns;
  readonly boulder: Boulder;
  readonly tutorial: Tutorial;
  readonly particles: Particles;

  private startedAtMs: number;
  private aliveSinceMs: number;
  alive = true;
  score = 0;
  stage = 1;
  /** Distance traveled in meters (cumulative scrollSpeed * dt while running). */
  distanceM = 0;

  constructor(slot: PlayerSlot, manifest: MapManifest, seed: number, viewportAspect: number, startedAtMs: number, opts: PlayerWorldOpts = {}) {
    this.slot = slot;
    this.startedAtMs = startedAtMs;
    this.aliveSinceMs = startedAtMs;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, viewportAspect, 0.1, FOG_FAR + 10);

    const rng = makeSeededRng(seed);
    this.track = new Track(this.scene);
    this.env = new Environment(this.scene, rng, { treeDensityFactor: opts.treeDensityFactor ?? 1.0 });
    this.obstacles = new Obstacles(this.scene);
    this.patterns = new Patterns(rng, this.obstacles, startedAtMs);
    this.player = new Player(this.camera);
    this.boulder = new Boulder(this.scene);
    this.tutorial = new Tutorial(this.scene);
    this.particles = new Particles(this.scene);
    // Wire tutorial labels into obstacle spawn — labels attach to spawned groups
    if (this.tutorial.isActive()) {
      this.obstacles.onSpawn((kind, group) => this.tutorial.attachLabel(kind, group, performance.now()));
    }
    void manifest; // reserved for difficulty curve (we use SCROLL_* constants for MVP)
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Latest boulder tick (read by HUD between updates). */
  lastBoulder: BoulderTickResult = { damage: 0, distanceM: null, urgency: 0, state: 'inactive' };

  /** Per-frame tick. Returns whether the player just died this frame. */
  update(dt: number, nowMs: number): { diedThisFrame: boolean; coinsCollected: number; cratesBroken: number; obstaclesAvoided: number; newStage: number | null } {
    const elapsed = (nowMs - this.startedAtMs) / 1000;
    const speed = Math.min(SCROLL_MAX, SCROLL_START + (elapsed / 10) * SCROLL_RAMP);
    // Ramp spawn cadence inversely with speed (more frequent obstacles over time)
    const spawnInterval = Math.max(700, 1800 - elapsed * 12);
    this.patterns.setSpawnInterval(spawnInterval);

    // Stage detection (every 25 sec we cross a stage threshold; cap at 5)
    const newStageVal = Math.min(5, 1 + Math.floor(elapsed / 25));
    let newStage: number | null = null;
    if (newStageVal !== this.stage) {
      this.stage = newStageVal;
      newStage = newStageVal;
    }

    // Gate world scroll by player.runConfidence. Stationary = world stops.
    // Floor of 0.15 even when not running: keeps minimal motion so it never
    // feels totally frozen during brief detection lulls (kids forgiving).
    const runGate = Math.max(0.15, this.player.runConfidence);
    const gatedSpeed = speed * runGate;

    if (this.alive) {
      this.distanceM += gatedSpeed * dt;
      this.track.scroll(dt, gatedSpeed);
      this.env.scroll(dt, gatedSpeed);
      this.obstacles.scroll(dt, gatedSpeed);
      this.patterns.tick(dt, nowMs);
      this.tutorial.tick(dt, nowMs);
      // Once player has cleared the first stage they "know the game" — mark tutorial done
      if (this.tutorial.isActive() && elapsed > 25) this.tutorial.markDone();
      this.player.update(dt, nowMs);
      const cr = this.obstacles.collide(this.player, nowMs);
      let diedThisFrame = false;
      if (cr.died) {
        this.alive = false;
        diedThisFrame = true;
      }
      // Score deltas + visual feedback (priority: damage > death override)
      const coins = cr.collectedCoins.length;
      const broken = cr.destroyedCrates.length;
      const avoided = cr.passedAvoided.length;
      this.player.stats.coin += coins;
      this.player.stats.broken += broken;
      this.player.stats.avoided += avoided;
      // damage / death flashes are set inside player.applyHit; coin/break only flash if no damage this frame
      if (!cr.died && !cr.damaged) {
        if (coins > 0) {
          this.player.triggerFlash('coin', nowMs);
          for (const c of cr.collectedCoins) {
            this.particles.burstCoin(c.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 5);
          }
          gameAudio.play('coin');
        }
        else if (broken > 0) {
          this.player.triggerFlash('break', nowMs);
          for (const c of cr.destroyedCrates) {
            this.particles.burstCoin(c.group.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 8);
          }
          gameAudio.play('punch');
        }
      }
      // Boulder chase mechanic — only while alive
      const boulderResult = this.boulder.update(dt, nowMs, this.player.runConfidence);
      // Boulder rumble — start/stop based on state, intensity follows urgency
      const prevState: string = this.lastBoulder.state;
      const curState: string = boulderResult.state;
      if (curState === 'chasing') {
        gameAudio.startBoulder(boulderResult.urgency);
        if (boulderResult.distanceM !== null) {
          this.particles.dustPuff(new THREE.Vector3(0, 0, boulderResult.distanceM), boulderResult.urgency);
        }
      } else if (prevState === 'chasing') {
        gameAudio.stopBoulder();
      }
      this.lastBoulder = boulderResult;
      // Tick particles every frame
      this.particles.tick(dt);
      if (boulderResult.damage > 0 && !this.player.isDead()) {
        for (let i = 0; i < boulderResult.damage && !this.player.isDead(); i++) {
          const killed = this.player.applyHit(nowMs);
          if (killed) { this.alive = false; diedThisFrame = true; break; }
        }
      }
      this.score = this.computeScore(elapsed);
      return { diedThisFrame, coinsCollected: coins, cratesBroken: broken, obstaclesAvoided: avoided, newStage };
    } else {
      // Keep player camera shake/decay running
      this.player.update(dt, nowMs);
      // Track + obstacles continue scrolling so the world doesn't freeze visually
      this.track.scroll(dt, gatedSpeed * 0.4);
      this.env.scroll(dt, gatedSpeed * 0.4);
      this.obstacles.scroll(dt, gatedSpeed * 0.4);
      return { diedThisFrame: false, coinsCollected: 0, cratesBroken: 0, obstaclesAvoided: 0, newStage: null };
    }
  }

  handleAction(ev: ActionEvent, nowMs: number) {
    if (!this.alive) return;
    this.player.handleAction(ev, nowMs);
  }

  computeScore(elapsedSec: number): number {
    const s = this.player.stats;
    // Distance is the main score driver now (rewards running).
    // Per-second survival kept as a small floor.
    const survival = Math.floor(elapsedSec);
    const distanceScore = Math.floor(this.distanceM) * 2;
    return survival + distanceScore + s.coin * 10 + s.avoided * 25 + s.broken * 50;
  }

  buildStats(nowMs: number): PlayerWorldStats {
    const s = this.player.stats;
    return {
      score: this.score,
      coins: s.coin,
      obstaclesAvoided: s.avoided,
      obstaclesBroken: s.broken,
      jumps: s.jump, ducks: s.duck, punches: s.punch, laneChanges: s.lane,
      diedAtMs: this.alive ? null : nowMs - this.startedAtMs,
    };
  }

  /** Walk the scene graph and dispose all GPU resources. */
  dispose() {
    this.tutorial.dispose();
    this.particles.dispose();
    this.scene.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) {
        for (const mm of m) {
          if (mm.map) mm.map.dispose();
          mm.dispose();
        }
      } else if (m && typeof m.dispose === 'function') {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
    // Clear the scene's children list
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}
