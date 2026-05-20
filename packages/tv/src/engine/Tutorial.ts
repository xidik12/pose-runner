// 3D floating labels above the first few obstacles of a player's first match.
// Uses canvas textures projected onto sprites; cheap and HUD-quality readable.
import * as THREE from 'three';
import type { ObstacleKind } from './Obstacles';

const LABELS: Partial<Record<ObstacleKind, { text: string; color: string }>> = {
  log:        { text: 'JUMP',   color: '#5dd6ff' },
  beam:       { text: 'DUCK',   color: '#ff8060' },
  wall:       { text: 'DODGE',  color: '#ffd24a' },
  crate:      { text: 'PUNCH',  color: '#ff8030' },
  floatCrate: { text: 'JUMP + PUNCH', color: '#b46cff' },
  coin:       { text: 'GRAB',   color: '#ffd24a' },
};

const STORAGE_KEY = 'pose-runner:tutorial-done:v1';

export class Tutorial {
  private active: boolean;
  private scene: THREE.Scene;
  private labels: Array<{ sprite: THREE.Sprite; followObj: THREE.Object3D; offsetY: number; fadeAfterMs: number }> = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.active = !this.isDone();
  }

  isActive(): boolean { return this.active; }

  private isDone(): boolean {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }
  markDone() {
    this.active = false;
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  }

  /** Attach a label sprite above an obstacle group; auto-removed by `tick()`. */
  attachLabel(kind: ObstacleKind, obstacleGroup: THREE.Object3D, nowMs: number) {
    if (!this.active) return;
    const def = LABELS[kind];
    if (!def) return;
    const sprite = makeLabelSprite(def.text, def.color);
    sprite.position.set(0, 2.8, 0);
    obstacleGroup.add(sprite);
    this.labels.push({ sprite, followObj: obstacleGroup, offsetY: 2.8, fadeAfterMs: nowMs + 4000 });
  }

  /** Per-frame: detach + dispose old sprites; gently bob existing ones. */
  tick(dt: number, nowMs: number) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      // Bob
      l.sprite.position.y = l.offsetY + Math.sin(nowMs * 0.005) * 0.15;
      // Fade out + remove
      const mat = l.sprite.material as THREE.SpriteMaterial;
      if (nowMs > l.fadeAfterMs) {
        mat.opacity = Math.max(0, mat.opacity - dt * 1.5);
        if (mat.opacity <= 0) {
          l.followObj.remove(l.sprite);
          mat.map?.dispose();
          mat.dispose();
          this.labels.splice(i, 1);
        }
      }
    }
  }

  dispose() {
    for (const l of this.labels) {
      l.followObj.remove(l.sprite);
      const mat = l.sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.labels.length = 0;
  }
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // Background pill
  ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
  roundRect(ctx, 16, 28, 480, 72, 28);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  // Text
  ctx.fillStyle = color;
  ctx.font = 'bold 56px "Bungee", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.5, 0.9, 1);
  sprite.renderOrder = 100;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
