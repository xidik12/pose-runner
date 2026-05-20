// Chasing boulder. Spawns when the player stops running for too long; closes
// in from behind. If the player resumes running, it retreats. If it catches
// up to z=0, the player takes a big hit.
import * as THREE from 'three';
import { FOG_FAR } from './constants';

const SPAWN_AFTER_IDLE_MS = 2000;   // start chasing after 2s of standing still
const SPAWN_DISTANCE = 30;           // m behind the player (positive z = behind in our convention)
const CHASE_SPEED = 5.0;             // m/s closing in
const RETREAT_SPEED = 6.0;           // m/s if player runs again (retreats slightly faster than it chases)
const HIT_DAMAGE = 2;                // HP cost when boulder catches up
const RETREAT_DESPAWN_DISTANCE = 60; // boulder despawns once pushed this far back

export type BoulderState = 'inactive' | 'chasing' | 'retreating';

export interface BoulderTickResult {
  /** non-zero when the boulder JUST hit the player this frame */
  damage: number;
  /** for HUD: m of remaining distance, or null if boulder inactive */
  distanceM: number | null;
  /** for HUD: 0..1 how urgent the warning should be */
  urgency: number;
  state: BoulderState;
}

export class Boulder {
  private mesh: THREE.Mesh;
  private group: THREE.Group;
  private z = SPAWN_DISTANCE;        // current world z (positive = behind player)
  private state: BoulderState = 'inactive';
  private idleSinceMs = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    // Big dark sphere (boulder) + small dust ring
    const geo = new THREE.IcosahedronGeometry(1.6, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#3a2a1a', emissive: '#180c08', emissiveIntensity: 0.2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 1.6;
    this.group.add(this.mesh);
    // Subtle ground ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.7, 24),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.group.add(ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Per-frame tick. Pass current player runConfidence (0-1) and current ms. */
  update(dt: number, nowMs: number, runConfidence: number): BoulderTickResult {
    if (this.state === 'inactive') {
      // Track idle time
      if (runConfidence < 0.3) {
        if (this.idleSinceMs === 0) this.idleSinceMs = nowMs;
        if (nowMs - this.idleSinceMs >= SPAWN_AFTER_IDLE_MS) {
          this.state = 'chasing';
          this.z = SPAWN_DISTANCE;
          this.group.visible = true;
        }
      } else {
        this.idleSinceMs = 0;
      }
      return { damage: 0, distanceM: null, urgency: 0, state: this.state };
    }

    // Active boulder — chase or retreat based on runConfidence
    if (runConfidence > 0.4) {
      this.state = 'retreating';
      this.z += RETREAT_SPEED * dt;
      if (this.z > RETREAT_DESPAWN_DISTANCE) {
        this.state = 'inactive';
        this.idleSinceMs = 0;
        this.group.visible = false;
        return { damage: 0, distanceM: null, urgency: 0, state: this.state };
      }
    } else {
      this.state = 'chasing';
      this.z -= CHASE_SPEED * dt;
    }

    // Place + rotate (visual rolling)
    this.group.position.z = this.z;
    this.mesh.rotation.x += dt * 4;

    // Hit detection — damage when boulder reaches the player
    let damage = 0;
    if (this.z <= 0) {
      damage = HIT_DAMAGE;
      // Knock the boulder back so it doesn't keep hitting every frame
      this.z = 8;
      this.state = 'inactive';
      this.idleSinceMs = nowMs;
      this.group.visible = false;
    }

    const distanceM = Math.max(0, this.z);
    // Urgency curve: ramps up as boulder gets close
    const urgency = this.state === 'chasing'
      ? Math.min(1, Math.max(0, 1 - distanceM / SPAWN_DISTANCE))
      : Math.max(0, 0.4 - (this.z - SPAWN_DISTANCE) / 30);

    return { damage, distanceM, urgency, state: this.state };
  }

  reset() {
    this.state = 'inactive';
    this.idleSinceMs = 0;
    this.z = SPAWN_DISTANCE;
    this.group.visible = false;
  }

  /** Make the boulder visible from the side a bit (so player can see it via fog
   *  edge if they happen to look). Not strictly needed since first-person camera
   *  faces forward — HUD does the warning. Hook for a rear-view mirror later. */
  isActive(): boolean { return this.state !== 'inactive'; }
}
