// Sky color, fog, sun + ambient lighting, instanced trees on both sides.
import * as THREE from 'three';
import {
  TRACK_WIDTH, TRACK_SEG_COUNT, TRACK_SEG_LEN, DESPAWN_BEHIND,
  TREE_PER_SIDE_M, FOG_NEAR, FOG_FAR, FOG_COLOR, SKY_BOT,
} from './constants';

export interface EnvironmentOpts {
  treeDensityFactor: number;  // 1.0 solo, 0.6 in 2P, 0.4 in 4P
}

export class Environment {
  private group = new THREE.Group();
  private trunkMesh: THREE.InstancedMesh;
  private foliageMesh: THREE.InstancedMesh;
  private treeZ: number[] = [];   // current world z per tree (left+right interleaved)
  private treeX: number[] = [];   // world x per tree
  private dummy = new THREE.Object3D();
  private totalTrackLen: number;

  constructor(scene: THREE.Scene, rng: () => number, opts: EnvironmentOpts = { treeDensityFactor: 1.0 }) {
    scene.background = new THREE.Color(SKY_BOT);
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    scene.add(new THREE.HemisphereLight('#cfe9ff', '#3a4b6a', 0.8));
    const sun = new THREE.DirectionalLight('#ffffff', 0.9);
    sun.position.set(2, 6, 4);
    scene.add(sun);

    this.totalTrackLen = TRACK_SEG_COUNT * TRACK_SEG_LEN;
    const baseDensity = TREE_PER_SIDE_M * opts.treeDensityFactor;
    const perSide = Math.max(8, Math.floor(this.totalTrackLen * baseDensity));
    const total = perSide * 2;

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.6, 6);
    const foliageGeo = new THREE.ConeGeometry(1.6, 3.6, 8);
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#5a3d1f' });
    const foliageMat = new THREE.MeshLambertMaterial({ color: '#3f7a3a' });

    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, total);
    this.foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, total);
    this.group.add(this.trunkMesh, this.foliageMesh);

    // Initial layout — distribute along track depth, randomized side offsets.
    for (let i = 0; i < total; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = DESPAWN_BEHIND - (i / total) * this.totalTrackLen;
      const x = side * (TRACK_WIDTH / 2 + 4 + rng() * 20);
      this.treeZ.push(z);
      this.treeX.push(x);
      this.placeTree(i, x, z);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.foliageMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.group);
  }

  scroll(dt: number, speed: number) {
    const dz = speed * dt;
    for (let i = 0; i < this.treeZ.length; i++) {
      this.treeZ[i] += dz;
      if (this.treeZ[i] > DESPAWN_BEHIND) {
        this.treeZ[i] -= this.totalTrackLen;
      }
      this.placeTree(i, this.treeX[i], this.treeZ[i]);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.foliageMesh.instanceMatrix.needsUpdate = true;
  }

  private placeTree(i: number, x: number, z: number) {
    // trunk (centered around y=0.8)
    this.dummy.position.set(x, 0.8, z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.trunkMesh.setMatrixAt(i, this.dummy.matrix);
    // foliage (cone above trunk)
    this.dummy.position.set(x, 2.6 + Math.sin(i * 0.7) * 0.4, z);
    this.dummy.updateMatrix();
    this.foliageMesh.setMatrixAt(i, this.dummy.matrix);
  }
}
