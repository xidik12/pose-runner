// Obstacle pool + factory + scroll + collision detection.
// Each obstacle kind has a distinct mesh template so the player can read
// what action to take from the silhouette alone.
import * as THREE from 'three';
import {
  laneX, LANE_WIDTH, SPAWN_AHEAD, DESPAWN_BEHIND,
  PUNCH_REACH_M, INVINCIBILITY_MS,
  COLOR_LOG, COLOR_DUCK_BAR, COLOR_DUCK_STRIPE, COLOR_WALL,
  COLOR_BREAKABLE, COLOR_FLOAT, COLOR_FLOAT_GLOW, COLOR_COIN,
} from './constants';
import type { Player } from './Player';

export type ObstacleKind =
  | 'log'           // jump
  | 'beam'          // duck (spans all lanes)
  | 'wall'          // lane change (single lane)
  | 'crate'         // punch (single lane)
  | 'floatCrate'    // jump + punch
  | 'coin';         // pickup

export interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: 0 | 1 | 2 | 'all';
  worldZ: number;          // negative = ahead, +z = behind
  group: THREE.Group;
  // bounding box in world coords (computed from kind)
  halfX: number;
  halfZ: number;
  topY: number;
  bottomY: number;
  hp: number;
  scored: boolean;         // already counted toward avoidance score
  destroyed: boolean;      // for crates that got punched
  destroyAnimAt: number;   // ms timestamp for destroy tween
}

export interface CollisionResult {
  died: boolean;
  damaged: boolean;
  destroyedCrates: Obstacle[];
  collectedCoins: Obstacle[];
  passedAvoided: Obstacle[];
}

const POOL_SIZE = 48;

export type OnSpawnCallback = (kind: ObstacleKind, group: THREE.Group) => void;

export class Obstacles {
  private pool: Obstacle[] = [];
  private group = new THREE.Group();
  private scene: THREE.Scene;
  private spawnCallbacks: OnSpawnCallback[] = [];

  onSpawn(cb: OnSpawnCallback) { this.spawnCallbacks.push(cb); }

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    for (let i = 0; i < POOL_SIZE; i++) {
      const ob: Obstacle = {
        active: false, kind: 'log', lane: 1, worldZ: 0,
        group: new THREE.Group(),
        halfX: 0.5, halfZ: 0.4, topY: 0.5, bottomY: 0,
        hp: 1, scored: false, destroyed: false, destroyAnimAt: 0,
      };
      ob.group.visible = false;
      this.group.add(ob.group);
      this.pool.push(ob);
    }
    scene.add(this.group);
  }

  spawn(kind: ObstacleKind, lane: 0 | 1 | 2 | 'all', zOffset = 0) {
    const ob = this.pool.find((o) => !o.active);
    if (!ob) return;
    ob.active = true;
    ob.kind = kind;
    ob.lane = lane;
    ob.worldZ = -SPAWN_AHEAD + zOffset;
    ob.scored = false;
    ob.destroyed = false;
    ob.destroyAnimAt = 0;
    ob.hp = 1;
    rebuildMesh(ob);
    placeMesh(ob);
    ob.group.visible = true;
    for (const cb of this.spawnCallbacks) cb(kind, ob.group);
  }

  scroll(dt: number, speed: number) {
    for (const ob of this.pool) {
      if (!ob.active) continue;
      ob.worldZ += speed * dt;
      placeMesh(ob);
      // Destroy animation
      if (ob.destroyed) {
        const t = Math.min(1, (performance.now() - ob.destroyAnimAt) / 250);
        ob.group.scale.setScalar(1 + t * 0.6);
        const firstMesh = ob.group.children[0] as THREE.Mesh | undefined;
        if (firstMesh && firstMesh.material instanceof THREE.MeshLambertMaterial) {
          firstMesh.material.opacity = 1 - t;
        }
        if (t >= 1) this.recycle(ob);
        continue;
      }
      // Despawn after passing player
      if (ob.worldZ > DESPAWN_BEHIND) this.recycle(ob);
    }
  }

  /**
   * Test all active obstacles against player hitbox.
   * Returns categorized outcomes; engine applies score + death.
   */
  collide(player: Player, now: number): CollisionResult {
    const out: CollisionResult = { died: false, damaged: false, destroyedCrates: [], collectedCoins: [], passedAvoided: [] };
    const hb = player.hitbox();
    const punching = player.punchActiveAt(now);

    for (const ob of this.pool) {
      if (!ob.active || ob.destroyed) continue;

      // Punch reach: any active punch can destroy a crate within reach IN ITS LANE/ANY LANE
      if (punching && (ob.kind === 'crate' || ob.kind === 'floatCrate')) {
        const inReach = ob.worldZ < 0 && ob.worldZ > -PUNCH_REACH_M;
        const laneMatch = ob.lane === 'all' || ob.lane === player.lane;
        if (inReach && laneMatch) {
          // For floatCrate, must also be jumping (mesh is at y=1.5)
          if (ob.kind === 'floatCrate' && !player.isJumping()) continue;
          ob.destroyed = true;
          ob.destroyAnimAt = performance.now();
          out.destroyedCrates.push(ob);
          continue;
        }
      }

      // Coin pickup: just z-overlap + lane match, no avoidance check
      if (ob.kind === 'coin') {
        const zOverlap = Math.abs(ob.worldZ) < ob.halfZ + hb.halfZ;
        const xMatch = ob.lane === 'all' || Math.abs(hb.cx - laneX(ob.lane)) < hb.halfX + ob.halfX;
        if (zOverlap && xMatch) {
          ob.destroyed = true; ob.destroyAnimAt = performance.now();
          out.collectedCoins.push(ob);
        }
        continue;
      }

      // Generic obstacle collision: at z ≈ 0 (player plane)
      const zOverlap = Math.abs(ob.worldZ) < ob.halfZ + hb.halfZ;
      if (!zOverlap) continue;

      const xMatch = ob.lane === 'all' || Math.abs(hb.cx - laneX(ob.lane)) < hb.halfX + ob.halfX;
      if (!xMatch) {
        // Wrong lane → passed by, count as avoided once
        if (!ob.scored && ob.worldZ > 0) { ob.scored = true; out.passedAvoided.push(ob); }
        continue;
      }

      // Forgiving clearance:
      //   - jumping clears any ground-level obstacle (log, crate)
      //   - ducking clears any overhead obstacle (beam)
      //   - walls (2.5m tall) cannot be jumped — must lane change
      let cleared = false;
      if (ob.kind === 'log' || ob.kind === 'crate') {
        cleared = player.isJumping();
      } else if (ob.kind === 'beam') {
        cleared = player.isDucking() || player.cameraY() < ob.bottomY;
      } else if (ob.kind === 'wall') {
        cleared = false; // must lane change
      } else if (ob.kind === 'floatCrate') {
        // floats at y=1.5 — only collides when player jumps into it
        cleared = !player.isJumping();
      }

      if (cleared) {
        if (!ob.scored) { ob.scored = true; out.passedAvoided.push(ob); }
        continue;
      }
      if (player.invincible(now)) continue;
      // Apply hit to player; only sets out.died if HP runs out.
      const killed = player.applyHit(now);
      if (killed) out.died = true;
      else out.damaged = true;
      // Either way, this obstacle is "consumed" — mark scored so we don't double-hit
      ob.scored = true;
    }
    return out;
  }

  reset() {
    for (const ob of this.pool) this.recycle(ob);
  }

  private recycle(ob: Obstacle) {
    ob.active = false;
    ob.destroyed = false;
    ob.group.visible = false;
    ob.group.scale.setScalar(1);
    ob.group.position.set(0, 0, -10000);
    while (ob.group.children.length) {
      const c = ob.group.children.pop()!;
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
      const m = (c as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose()); else (m as THREE.Material)?.dispose();
    }
  }
}

// =============================================================================
// Mesh factories — each kind produces a distinct silhouette
// =============================================================================

function rebuildMesh(ob: Obstacle) {
  while (ob.group.children.length) ob.group.children.pop();
  switch (ob.kind) {
    case 'log': buildLog(ob); break;
    case 'beam': buildBeam(ob); break;
    case 'wall': buildWall(ob); break;
    case 'crate': buildCrate(ob); break;
    case 'floatCrate': buildFloatCrate(ob); break;
    case 'coin': buildCoin(ob); break;
  }
}

function buildLog(ob: Obstacle) {
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 1.4, 10),
    new THREE.MeshLambertMaterial({ color: COLOR_LOG, transparent: true }),
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.4;
  ob.group.add(log);
  ob.halfX = 0.7; ob.halfZ = 0.4; ob.topY = 0.8; ob.bottomY = 0;
}

function buildBeam(ob: Obstacle) {
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 0.3, 0.5),
    new THREE.MeshLambertMaterial({ color: COLOR_DUCK_BAR, transparent: true }),
  );
  beam.position.y = 1.7;
  ob.group.add(beam);
  // hazard stripes
  for (let i = -2; i <= 2; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.32, 0.52),
      new THREE.MeshLambertMaterial({ color: COLOR_DUCK_STRIPE, transparent: true }),
    );
    stripe.position.set(i * 0.9, 1.7, 0);
    ob.group.add(stripe);
  }
  // posts at each end
  const postMat = new THREE.MeshLambertMaterial({ color: '#5a3d1f', transparent: true });
  const lpost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 6), postMat);
  lpost.position.set(-2.6, 0.85, 0);
  const rpost = lpost.clone(); rpost.position.x = 2.6;
  ob.group.add(lpost, rpost);
  ob.halfX = 2.6; ob.halfZ = 0.3; ob.topY = 1.85; ob.bottomY = 1.55;
}

function buildWall(ob: Obstacle) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_WIDTH * 0.95, 2.5, 0.5),
    new THREE.MeshLambertMaterial({ color: COLOR_WALL, transparent: true }),
  );
  wall.position.y = 1.25;
  ob.group.add(wall);
  // metal strapping for visual variety
  const strapMat = new THREE.MeshLambertMaterial({ color: '#444', transparent: true });
  for (const y of [0.4, 1.25, 2.1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.96, 0.08, 0.51), strapMat);
    strap.position.y = y;
    ob.group.add(strap);
  }
  ob.halfX = LANE_WIDTH * 0.475; ob.halfZ = 0.3; ob.topY = 2.5; ob.bottomY = 0;
}

function buildCrate(ob: Obstacle) {
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.0, 1.0),
    new THREE.MeshLambertMaterial({ color: COLOR_BREAKABLE, transparent: true }),
  );
  crate.position.y = 0.5;
  ob.group.add(crate);
  // crack overlay (thin black box on the front)
  const crackMat = new THREE.MeshLambertMaterial({ color: '#222', transparent: true });
  const crack1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 1.01), crackMat);
  crack1.position.set(0.1, 0.55, 0); ob.group.add(crack1);
  const crack2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.01), crackMat);
  crack2.position.set(-0.1, 0.4, 0); ob.group.add(crack2);
  ob.halfX = 0.5; ob.halfZ = 0.5; ob.topY = 1.0; ob.bottomY = 0;
}

function buildFloatCrate(ob: Obstacle) {
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshLambertMaterial({ color: COLOR_FLOAT, emissive: COLOR_FLOAT_GLOW, emissiveIntensity: 0.4, transparent: true }),
  );
  crate.position.y = 1.7;
  ob.group.add(crate);
  // crack
  const crackMat = new THREE.MeshLambertMaterial({ color: '#222', transparent: true });
  const crack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.91), crackMat);
  crack.position.set(0.1, 1.7, 0); ob.group.add(crack);
  ob.halfX = 0.45; ob.halfZ = 0.45; ob.topY = 2.15; ob.bottomY = 1.25;
}

function buildCoin(ob: Obstacle) {
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.06, 16),
    new THREE.MeshLambertMaterial({ color: COLOR_COIN, emissive: COLOR_COIN, emissiveIntensity: 0.3, transparent: true }),
  );
  coin.rotation.x = Math.PI / 2;
  coin.position.y = 1.0;
  ob.group.add(coin);
  ob.halfX = 0.4; ob.halfZ = 0.4; ob.topY = 1.4; ob.bottomY = 0.6;
}

function placeMesh(ob: Obstacle) {
  const x = ob.lane === 'all' ? 0 : laneX(ob.lane);
  ob.group.position.set(x, 0, ob.worldZ);
  // gentle spin on coin
  if (ob.kind === 'coin' && ob.group.children[0]) {
    ob.group.children[0].rotation.y += 0.08;
  }
}
