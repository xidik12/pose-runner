// Lightweight particle pool. All particles are billboard sprites with
// shared canvas textures (no GLTF / no shader).
import * as THREE from 'three';

interface Particle {
  sprite: THREE.Sprite;
  active: boolean;
  vx: number; vy: number; vz: number;
  life: number; // ms remaining
  maxLife: number;
  startScale: number;
  endScale: number;
}

const POOL_SIZE = 64;

let cachedSparkTex: THREE.Texture | null = null;
let cachedDustTex: THREE.Texture | null = null;

function sparkTexture(): THREE.Texture {
  if (cachedSparkTex) return cachedSparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 220, 1)');
  grad.addColorStop(0.5, 'rgba(255, 210, 74, 0.7)');
  grad.addColorStop(1, 'rgba(255, 210, 74, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  cachedSparkTex = new THREE.CanvasTexture(c);
  cachedSparkTex.colorSpace = THREE.SRGBColorSpace;
  return cachedSparkTex;
}

function dustTexture(): THREE.Texture {
  if (cachedDustTex) return cachedDustTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(180, 150, 120, 0.85)');
  grad.addColorStop(1, 'rgba(80, 60, 50, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  cachedDustTex = new THREE.CanvasTexture(c);
  cachedDustTex.colorSpace = THREE.SRGBColorSpace;
  return cachedDustTex;
}

export class Particles {
  private group = new THREE.Group();
  private pool: Particle[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({
        sprite, active: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0,
        startScale: 0.4, endScale: 1.0,
      });
    }
  }

  /** Burst of sparkles at a world position (gold sparkle for coins). */
  burstCoin(pos: THREE.Vector3, count = 6) {
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;
      p.sprite.material = new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthWrite: false, opacity: 1 });
      p.sprite.position.copy(pos);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2;
      p.vx = Math.cos(angle) * speed;
      p.vy = 1.5 + Math.random() * 2;
      p.vz = Math.sin(angle) * speed * 0.5;
      p.maxLife = p.life = 500 + Math.random() * 250;
      p.startScale = 0.4; p.endScale = 0.05;
      p.sprite.scale.setScalar(p.startScale);
      p.sprite.visible = true;
    }
  }

  /** Continuous dust trail behind the boulder (call each frame while active). */
  dustPuff(pos: THREE.Vector3, intensity: number) {
    if (Math.random() > intensity * 0.5) return;
    const p = this.acquire();
    if (!p) return;
    p.sprite.material = new THREE.SpriteMaterial({ map: dustTexture(), transparent: true, depthWrite: false, opacity: 0.7 });
    p.sprite.position.set(pos.x + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * 1);
    p.vx = (Math.random() - 0.5) * 0.5;
    p.vy = 0.4 + Math.random() * 0.5;
    p.vz = 1 + Math.random() * 1.5;
    p.maxLife = p.life = 700 + Math.random() * 400;
    p.startScale = 0.6 + Math.random() * 0.4;
    p.endScale = 1.4 + Math.random() * 0.6;
    p.sprite.scale.setScalar(p.startScale);
    p.sprite.visible = true;
  }

  tick(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt * 1000;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = 1 - p.life / p.maxLife; // 0 → 1
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy -= 4 * dt; // gravity
      const scale = p.startScale + (p.endScale - p.startScale) * t;
      p.sprite.scale.setScalar(scale);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
  }

  dispose() {
    for (const p of this.pool) {
      (p.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.pool.length = 0;
  }

  private acquire(): Particle | null {
    for (const p of this.pool) {
      if (!p.active) { p.active = true; return p; }
    }
    return null;
  }
}
