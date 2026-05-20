// Recycled wooden plank segments + side rails. Player is stationary at z=0;
// segments scroll toward +Z and recycle to the far end when they pass.
import * as THREE from 'three';
import {
  TRACK_WIDTH, TRACK_SEG_LEN, TRACK_SEG_COUNT, DESPAWN_BEHIND,
  PLANK_LIGHT, PLANK_DARK, RAIL_COLOR, WATER_COLOR,
} from './constants';

export class Track {
  private group = new THREE.Group();
  private segments: THREE.Mesh[] = [];
  private leftRailPosts: THREE.InstancedMesh;
  private rightRailPosts: THREE.InstancedMesh;
  private leftRailBeam: THREE.Mesh;
  private rightRailBeam: THREE.Mesh;
  private water: THREE.Mesh;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    // Plank segments — alternate light/dark for stripe legibility
    const segGeo = new THREE.BoxGeometry(TRACK_WIDTH, 0.12, TRACK_SEG_LEN);
    for (let i = 0; i < TRACK_SEG_COUNT; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? PLANK_LIGHT : PLANK_DARK });
      const seg = new THREE.Mesh(segGeo, mat);
      // initial layout: from z = +DESPAWN_BEHIND back to z = -SPAWN_AHEAD-ish
      seg.position.set(0, 0, DESPAWN_BEHIND - i * TRACK_SEG_LEN);
      this.segments.push(seg);
      this.group.add(seg);
    }

    // Side rails — instanced posts every TRACK_SEG_LEN, plus a long beam.
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: RAIL_COLOR });
    this.leftRailPosts = new THREE.InstancedMesh(postGeo, postMat, TRACK_SEG_COUNT);
    this.rightRailPosts = new THREE.InstancedMesh(postGeo, postMat, TRACK_SEG_COUNT);
    this.group.add(this.leftRailPosts, this.rightRailPosts);

    const beamGeo = new THREE.BoxGeometry(0.08, 0.08, TRACK_SEG_COUNT * TRACK_SEG_LEN);
    const beamMat = new THREE.MeshLambertMaterial({ color: RAIL_COLOR });
    this.leftRailBeam = new THREE.Mesh(beamGeo, beamMat);
    this.rightRailBeam = new THREE.Mesh(beamGeo, beamMat);
    this.leftRailBeam.position.set(-TRACK_WIDTH / 2 - 0.1, 0.85, 0);
    this.rightRailBeam.position.set(+TRACK_WIDTH / 2 + 0.1, 0.85, 0);
    this.group.add(this.leftRailBeam, this.rightRailBeam);

    // Water on the sides (large plane below path level)
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(120, TRACK_SEG_COUNT * TRACK_SEG_LEN + 100),
      new THREE.MeshLambertMaterial({ color: WATER_COLOR }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -0.6, 0);
    this.group.add(this.water);

    this.relayoutPosts();
    scene.add(this.group);
  }

  /** Returns total length covered by track in meters (used for beam length). */
  totalLength(): number {
    return TRACK_SEG_COUNT * TRACK_SEG_LEN;
  }

  /** Scroll all segments forward by speed*dt; recycle past-player segments to back. */
  scroll(dt: number, speed: number) {
    const dz = speed * dt;
    const totalLen = this.totalLength();
    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z > DESPAWN_BEHIND) {
        seg.position.z -= totalLen;
      }
    }
    this.relayoutPosts();
  }

  private relayoutPosts() {
    // Posts mirror plank-segment positions on both rails.
    for (let i = 0; i < this.segments.length; i++) {
      const z = this.segments[i].position.z;
      // left
      this.dummy.position.set(-TRACK_WIDTH / 2 - 0.1, 0.45, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.leftRailPosts.setMatrixAt(i, this.dummy.matrix);
      // right
      this.dummy.position.set(+TRACK_WIDTH / 2 + 0.1, 0.45, z);
      this.dummy.updateMatrix();
      this.rightRailPosts.setMatrixAt(i, this.dummy.matrix);
    }
    this.leftRailPosts.instanceMatrix.needsUpdate = true;
    this.rightRailPosts.instanceMatrix.needsUpdate = true;
  }
}
