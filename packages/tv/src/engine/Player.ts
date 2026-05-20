// First-person camera rig + state machine + hand overlay for one player slot.
// Receives ActionEvents, drives camera transform, exposes hitbox.
import * as THREE from 'three';
import type { ActionEvent } from '@pose-runner/shared';
import {
  laneX, LANE_CHANGE_MS, JUMP_INITIAL_VY, GRAVITY,
  PLAYER_EYE_Y, PLAYER_DUCK_Y, DUCK_HOLD_MS,
  PUNCH_DURATION_MS, INVINCIBILITY_MS,
} from './constants';
import { gameAudio } from './Audio';

export interface PlayerStats {
  jump: number; duck: number; punch: number; lane: number;
  coin: number; avoided: number; broken: number; perfectStance: number;
}

export type EdgeFlash = 'jump' | 'duck' | 'lane' | 'punch' | 'death' | 'coin' | 'break' | 'damage' | null;

export interface Hitbox {
  cx: number; cy: number; halfX: number; halfZ: number; topY: number;
}

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  private hands: THREE.Group;
  private leftHand: THREE.Mesh;
  private rightHand: THREE.Mesh;

  // state
  lane: 0 | 1 | 2 = 1;
  private laneFromX = 0;
  private laneToX_ = 0;
  private laneTweenStart = 0;
  private vy = 0;
  private y = 0;
  private cyTarget = PLAYER_EYE_Y;
  private cy = PLAYER_EYE_Y;
  private duckExpiresAt = 0;
  private invincibleUntil = 0;
  private punchActiveSide: 'L' | 'R' | null = null;
  private punchExpiresAt = 0;
  private dead = false;
  private deathAt = 0;

  // hp + damage shake
  hp = 3;
  readonly maxHp = 3;
  private damageShakeUntil = 0;
  private damageShakeStart = 0;

  /** Smoothed run-in-place confidence; gates world scroll. 0 = stationary, 1 = full speed. */
  runConfidence = 0;
  private runConfTarget = 0;

  // feedback
  flashKind: EdgeFlash = null;
  flashUntil = 0;

  stats: PlayerStats = {
    jump: 0, duck: 0, punch: 0, lane: 0,
    coin: 0, avoided: 0, broken: 0, perfectStance: 0,
  };

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.set(laneX(this.lane), PLAYER_EYE_Y, 0);
    this.camera.lookAt(laneX(this.lane), PLAYER_EYE_Y, -10);

    // Hand overlay — child of camera so always in view
    this.hands = new THREE.Group();
    const handGeo = new THREE.BoxGeometry(0.18, 0.14, 0.28);
    const handMat = new THREE.MeshLambertMaterial({ color: '#f0d7b2' });
    this.leftHand = new THREE.Mesh(handGeo, handMat);
    this.rightHand = new THREE.Mesh(handGeo, handMat);
    this.leftHand.position.set(-0.32, -0.45, -0.55);
    this.rightHand.position.set(+0.32, -0.45, -0.55);
    this.hands.add(this.leftHand, this.rightHand);
    this.camera.add(this.hands);
  }

  handleAction(ev: ActionEvent, now: number) {
    if (this.dead) return;
    switch (ev.type) {
      case 'JUMP':
        if (this.y === 0) { this.vy = JUMP_INITIAL_VY; this.stats.jump++; this.flash('jump', now); gameAudio.play('jump'); }
        break;
      case 'DUCK':
        this.cyTarget = PLAYER_DUCK_Y;
        this.duckExpiresAt = now + DUCK_HOLD_MS;
        this.stats.duck++;
        this.flash('duck', now);
        break;
      case 'LEAN_LEFT':
        if (this.lane > 0) { this.startLaneTween(this.lane - 1 as 0 | 1 | 2, now); this.flash('lane', now); }
        break;
      case 'LEAN_RIGHT':
        if (this.lane < 2) { this.startLaneTween(this.lane + 1 as 0 | 1 | 2, now); this.flash('lane', now); }
        break;
      case 'PUNCH_LEFT':
        this.punchActiveSide = 'L';
        this.punchExpiresAt = now + PUNCH_DURATION_MS;
        this.stats.punch++;
        this.flash('punch', now);
        gameAudio.play('punch');
        break;
      case 'PUNCH_RIGHT':
        this.punchActiveSide = 'R';
        this.punchExpiresAt = now + PUNCH_DURATION_MS;
        this.stats.punch++;
        this.flash('punch', now);
        gameAudio.play('punch');
        break;
      case 'RUN':
        // Continuous; only the latest matters. Smooth in update().
        this.runConfTarget = ev.confidence;
        break;
      // STANCE_MATCH and IDLE: noop in MVP
    }
  }

  private startLaneTween(target: 0 | 1 | 2, now: number) {
    this.laneFromX = this.camera.position.x;
    this.lane = target;
    this.laneToX_ = laneX(target);
    this.laneTweenStart = now;
    this.stats.lane++;
  }

  private flash(kind: EdgeFlash, now: number) {
    this.flashKind = kind;
    this.flashUntil = now + 180;
  }

  /** External callers (engine) flash for events like coin pickup. */
  triggerFlash(kind: EdgeFlash, now: number) {
    this.flash(kind, now);
  }

  update(dt: number, now: number) {
    if (this.dead) {
      // Camera shake decay
      const t = Math.min(1, (now - this.deathAt) / 600);
      const decay = 0.25 * (1 - t);
      this.camera.position.x = this.laneToX_ + Math.sin((now - this.deathAt) * 0.06) * decay;
      this.camera.position.y = Math.max(0.4, PLAYER_EYE_Y - t * 1.0);
      return;
    }

    // Lane change tween (cubic ease-out)
    if (this.laneTweenStart) {
      const u = Math.min(1, (now - this.laneTweenStart) / LANE_CHANGE_MS);
      const eased = 1 - Math.pow(1 - u, 3);
      this.camera.position.x = this.laneFromX + (this.laneToX_ - this.laneFromX) * eased;
      if (u >= 1) this.laneTweenStart = 0;
    }

    // Vertical (jump) physics + landing sound
    if (this.y > 0 || this.vy > 0) {
      const wasAirborne = this.y > 0;
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0;
        if (wasAirborne) gameAudio.play('land');
      }
    }

    // Duck → restore standing height when expired
    if (this.cyTarget < PLAYER_EYE_Y && now > this.duckExpiresAt) {
      this.cyTarget = PLAYER_EYE_Y;
    }
    // Smoothly lerp cy → cyTarget
    this.cy += (this.cyTarget - this.cy) * Math.min(1, dt * 10);

    // Smooth runConfidence: rise fast, decay slower (so brief lulls don't freeze world)
    if (this.runConfTarget > this.runConfidence) {
      this.runConfidence += (this.runConfTarget - this.runConfidence) * Math.min(1, dt * 8);
    } else {
      this.runConfidence += (this.runConfTarget - this.runConfidence) * Math.min(1, dt * 1.8);
    }

    this.camera.position.y = this.y + this.cy;

    // Damage shake — quick lateral wobble, decays
    if (now < this.damageShakeUntil) {
      const t = (now - this.damageShakeStart) / 280;
      const decay = 1 - t;
      const shake = Math.sin((now - this.damageShakeStart) * 0.07) * 0.18 * decay;
      this.camera.position.x += shake;
      this.camera.position.y += Math.cos((now - this.damageShakeStart) * 0.09) * 0.06 * decay;
    }

    // Punch reset
    if (this.punchActiveSide && now > this.punchExpiresAt) {
      this.punchActiveSide = null;
    }
    // Animate hand thrust
    const baseLZ = -0.55, baseRZ = -0.55;
    const thrust = -0.40;
    if (this.punchActiveSide === 'L') {
      const u = 1 - (this.punchExpiresAt - now) / PUNCH_DURATION_MS;
      this.leftHand.position.z = baseLZ + thrust * Math.sin(u * Math.PI);
    } else {
      this.leftHand.position.z = baseLZ;
    }
    if (this.punchActiveSide === 'R') {
      const u = 1 - (this.punchExpiresAt - now) / PUNCH_DURATION_MS;
      this.rightHand.position.z = baseRZ + thrust * Math.sin(u * Math.PI);
    } else {
      this.rightHand.position.z = baseRZ;
    }

    // Subtle camera bob to suggest forward motion (~5cm sinusoidal)
    const bobAmp = this.y > 0 ? 0 : 0.04;
    this.camera.position.y += Math.sin(now * 0.012) * bobAmp;
  }

  hitbox(): Hitbox {
    return {
      cx: this.camera.position.x,
      cy: this.y,                // player floor y (jumping shifts feet up)
      halfX: 0.4,
      halfZ: 0.4,
      topY: this.y + this.cy + 0.2,
    };
  }

  /** Camera Y in the world (for ducking under high obstacles). */
  cameraY(): number {
    return this.camera.position.y;
  }

  punchActiveAt(now: number): 'L' | 'R' | null {
    return this.punchActiveSide && now < this.punchExpiresAt ? this.punchActiveSide : null;
  }

  isDucking(): boolean {
    return this.cyTarget < PLAYER_EYE_Y;
  }

  isJumping(): boolean {
    return this.y > 0;
  }

  /** Apply one hit; returns true if this hit killed the player. */
  applyHit(now: number): boolean {
    if (this.dead) return false;
    if (this.invincible(now)) return false;
    this.hp -= 1;
    this.setInvincibleFor(now, INVINCIBILITY_MS);
    this.damageShakeStart = now;
    this.damageShakeUntil = now + 280;
    if (this.hp <= 0) {
      this.dead = true;
      this.deathAt = now;
      this.flash('death', now);
      gameAudio.play('death');
      return true;
    }
    this.flash('damage', now);
    gameAudio.play('damage');
    return false;
  }

  /** Force-kill (used by mode rules, never collisions). */
  forceKill(now: number) {
    if (this.dead) return;
    this.hp = 0;
    this.dead = true;
    this.deathAt = now;
    this.flash('death', now);
  }

  isDead() { return this.dead; }
  invincible(now: number) { return now < this.invincibleUntil; }
  setInvincibleFor(now: number, ms: number) { this.invincibleUntil = now + ms; }
}
