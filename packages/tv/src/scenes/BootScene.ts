// Generates all placeholder textures procedurally so the runner is playable
// without any art pipeline. Replace with real sprite atlases later.
import Phaser from 'phaser';

const PLAYER_W = 96;
const PLAYER_H = 144;
const OB_W = 96;
const OB_H = 96;

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    // Load map manifests bundled into /public/maps.json
    this.load.json('maps-seed', '/maps.json');
  }

  create() {
    // ---- player atlas: run / jump / duck / punch-l / punch-r / dead ----
    this.buildAtlas('player', PLAYER_W, PLAYER_H, [
      { name: 'run-0',     draw: (c) => playerBody(c, '#5dd6ff', 'run') },
      { name: 'jump-0',    draw: (c) => playerBody(c, '#5dd6ff', 'jump') },
      { name: 'duck-0',    draw: (c) => playerBody(c, '#5dd6ff', 'duck') },
      { name: 'punch-l-0', draw: (c) => playerBody(c, '#5dd6ff', 'punch-l') },
      { name: 'punch-r-0', draw: (c) => playerBody(c, '#5dd6ff', 'punch-r') },
      { name: 'dead-0',    draw: (c) => playerBody(c, '#7a4a4a', 'dead') },
    ]);

    // ---- obstacle atlas ----
    this.buildAtlas('obstacle-atlas', OB_W, OB_H, [
      { name: 'low-bar-0',    draw: (c) => bar(c, '#d18a4d', 'low') },
      { name: 'high-bar-0',   draw: (c) => bar(c, '#d14d4d', 'high') },
      { name: 'wall-0',       draw: (c) => wall(c, '#909294') },
      { name: 'breakable-0',  draw: (c) => breakable(c, '#a87836') },
      { name: 'coin-0',       draw: (c) => coin(c, '#ffd24a') },
      { name: 'gate-t-pose',  draw: (c) => stanceGate(c, 'T') },
      { name: 'gate-warrior-2',    draw: (c) => stanceGate(c, 'W2') },
      { name: 'gate-tree-pose',    draw: (c) => stanceGate(c, 'TR') },
      { name: 'gate-sumo-squat',   draw: (c) => stanceGate(c, 'SQ') },
      { name: 'gate-downward-dog', draw: (c) => stanceGate(c, 'DD') },
      { name: 'gate-lotus',        draw: (c) => stanceGate(c, 'LO') },
      { name: 'gate-fighter-stance', draw: (c) => stanceGate(c, 'FS') },
    ]);

    // ---- parallax layers used by phnom-penh-streets ----
    this.buildTile('pp-sky',      1920, 1080, (c) => gradient(c, '#0c1830', '#162a52'));
    this.buildTile('pp-skyline',  1920, 1080, (c) => skyline(c, '#1a2748', '#293c66'));
    this.buildTile('pp-tuktuks',  1920, 1080, (c) => ground(c, '#101620', '#1f2a3a'));

    // Generic fallbacks for the other maps (one shared dark sky tile keyed by every other assetId
    // referenced in maps.json so map switching doesn't crash if textures are missing)
    const fallbackIds = [
      'jungle-canopy', 'jungle-pillars', 'jungle-vines',
      'tokyo-stars', 'tokyo-buildings', 'tokyo-billboards',
    ];
    for (const id of fallbackIds) {
      this.buildTile(id, 1920, 1080, (c) => gradient(c, '#0a0f1c', '#1f2a3a'));
    }

    this.scene.start('Pairing');
  }

  // ---- texture helpers ----
  private buildAtlas(
    key: string,
    fw: number,
    fh: number,
    frames: { name: string; draw: (ctx: CanvasRenderingContext2D) => void }[],
  ) {
    const cols = frames.length;
    const tex = this.textures.createCanvas(key, fw * cols, fh);
    if (!tex) return;
    const ctx = tex.getContext();
    for (let i = 0; i < frames.length; i++) {
      ctx.save();
      ctx.translate(i * fw, 0);
      ctx.clearRect(0, 0, fw, fh);
      frames[i].draw(ctx);
      ctx.restore();
      tex.add(frames[i].name, 0, i * fw, 0, fw, fh);
    }
    tex.refresh();
  }

  private buildTile(
    key: string,
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) {
    const tex = this.textures.createCanvas(key, w, h);
    if (!tex) return;
    draw(tex.getContext());
    tex.refresh();
  }
}

// =============================================================================
// Drawing primitives — intentionally bold, flat, readable from across the room
// =============================================================================

function playerBody(ctx: CanvasRenderingContext2D, color: string, mode: string) {
  const w = ctx.canvas.width / 6; // atlas slot width
  // since we're drawing in a translated frame slot, width is constant 96
  const FW = 96, FH = 144;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(FW / 2, FH - 8, 28, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  void w;

  let cy = FH * 0.45;
  let bodyH = FH * 0.55;
  if (mode === 'duck')  { cy = FH * 0.65; bodyH = FH * 0.35; }
  if (mode === 'jump')  { cy = FH * 0.40; }
  if (mode === 'dead')  { cy = FH * 0.65; bodyH = FH * 0.20; }

  // body
  ctx.fillStyle = color;
  roundRect(ctx, FW / 2 - 22, cy - bodyH / 2, 44, bodyH, 10);
  ctx.fill();

  // head
  ctx.fillStyle = '#f0d7b2';
  ctx.beginPath();
  ctx.arc(FW / 2, cy - bodyH / 2 - 14, 14, 0, Math.PI * 2);
  ctx.fill();

  // arms
  ctx.fillStyle = color;
  if (mode === 'punch-l') {
    roundRect(ctx, FW / 2 - 44, cy - 6, 30, 12, 5); ctx.fill();
  } else if (mode === 'punch-r') {
    roundRect(ctx, FW / 2 + 14, cy - 6, 30, 12, 5); ctx.fill();
  } else {
    roundRect(ctx, FW / 2 - 30, cy - 4, 8, 24, 4); ctx.fill();
    roundRect(ctx, FW / 2 + 22, cy - 4, 8, 24, 4); ctx.fill();
  }
}

function bar(ctx: CanvasRenderingContext2D, color: string, kind: 'low' | 'high') {
  const FW = 96, FH = 96;
  ctx.fillStyle = color;
  if (kind === 'low') {
    roundRect(ctx, 4, FH - 20, FW - 8, 14, 4); ctx.fill();
  } else {
    roundRect(ctx, 4, 6, FW - 8, 14, 4); ctx.fill();
    // posts
    ctx.fillRect(8, 6, 6, FH - 22);
    ctx.fillRect(FW - 14, 6, 6, FH - 22);
  }
}

function wall(ctx: CanvasRenderingContext2D, color: string) {
  const FW = 96, FH = 96;
  ctx.fillStyle = color;
  roundRect(ctx, 6, 6, FW - 12, FH - 12, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, FW - 28, FH - 28);
}

function breakable(ctx: CanvasRenderingContext2D, color: string) {
  const FW = 96, FH = 96;
  ctx.fillStyle = color;
  roundRect(ctx, 6, 6, FW - 12, FH - 12, 6); ctx.fill();
  // cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 30); ctx.lineTo(45, 55); ctx.lineTo(35, 80);
  ctx.moveTo(70, 20); ctx.lineTo(55, 50); ctx.lineTo(75, 75);
  ctx.stroke();
}

function coin(ctx: CanvasRenderingContext2D, color: string) {
  const FW = 96, FH = 96;
  const r = 26;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(FW / 2, FH / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#7a5a10';
  ctx.font = 'bold 28px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', FW / 2, FH / 2 + 2);
}

function stanceGate(ctx: CanvasRenderingContext2D, label: string) {
  const FW = 96, FH = 96;
  ctx.strokeStyle = '#b46cff';
  ctx.lineWidth = 6;
  roundRect(ctx, 6, 6, FW - 12, FH - 12, 12); ctx.stroke();
  ctx.fillStyle = '#b46cff';
  ctx.font = 'bold 24px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, FW / 2, FH / 2);
}

function gradient(ctx: CanvasRenderingContext2D, top: string, bot: string) {
  const { width: w, height: h } = ctx.canvas;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function skyline(ctx: CanvasRenderingContext2D, base: string, light: string) {
  gradient(ctx, '#0c1830', base);
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = light;
  // a few crude buildings
  for (let i = 0; i < 14; i++) {
    const bw = 80 + ((i * 73) % 100);
    const bh = 180 + ((i * 211) % 280);
    const bx = (i * 160) % w;
    const by = h * 0.55 - bh;
    ctx.fillRect(bx, by, bw, bh);
    // windows
    ctx.fillStyle = 'rgba(255, 220, 120, 0.5)';
    for (let r = 0; r < bh - 40; r += 22) {
      for (let cc = 0; cc < bw - 14; cc += 18) {
        if (((i + r + cc) % 5) === 0) {
          ctx.fillRect(bx + 6 + cc, by + 8 + r, 8, 10);
        }
      }
    }
    ctx.fillStyle = light;
  }
}

function ground(ctx: CanvasRenderingContext2D, top: string, base: string) {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.5);
  ctx.fillStyle = base;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);
  // lane stripes
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 4;
  for (let x = 0; x < w; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.5 + 6);
    ctx.lineTo(x + 60, h * 0.5 + 6);
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
