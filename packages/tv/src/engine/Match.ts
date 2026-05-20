// Match orchestrator: owns 1..N PlayerWorlds, mode rule, viewport layout.
import * as THREE from 'three';
import type { ActionEvent, GameMode, MapManifest, MatchResult, PlayerSlot } from '@pose-runner/shared';
import type { Renderer } from './Renderer';
import { PlayerWorld } from './PlayerWorld';
import { modeFor, type MatchMode } from './modes';
import { viewportsFor } from '../ui/ViewportLayout';

export class Match {
  readonly worlds: Map<PlayerSlot, PlayerWorld> = new Map();
  readonly mode: MatchMode;
  readonly mapId: string;
  readonly startedAtMs: number;
  readonly slots: PlayerSlot[];
  active = true;

  constructor(mode: GameMode, mapId: string, manifest: MapManifest, seed: number, slots: PlayerSlot[], renderer: Renderer, startedAtMs: number) {
    this.mode = modeFor(mode);
    this.mapId = mapId;
    this.startedAtMs = startedAtMs;
    this.slots = slots;

    const { w, h } = renderer.size();
    const vps = viewportsFor(slots.length, w, h);
    const treeFactor = slots.length === 1 ? 1.0 : slots.length === 2 ? 0.6 : 0.4;
    slots.forEach((slot, i) => {
      const aspect = vps[i].w / vps[i].h;
      const world = new PlayerWorld(slot, manifest, seed + slot, aspect, startedAtMs, { treeDensityFactor: treeFactor });
      this.worlds.set(slot, world);
    });
  }

  routeAction(slot: PlayerSlot, ev: ActionEvent, nowMs: number) {
    this.worlds.get(slot)?.handleAction(ev, nowMs);
  }

  update(dt: number, nowMs: number): { ended: boolean; stageChanges: Array<{ slot: PlayerSlot; stage: number }> } {
    if (!this.active) return { ended: false, stageChanges: [] };
    const stageChanges: Array<{ slot: PlayerSlot; stage: number }> = [];
    for (const [slot, world] of this.worlds.entries()) {
      const r = world.update(dt, nowMs);
      if (r.newStage !== null) stageChanges.push({ slot, stage: r.newStage });
    }
    if (this.mode.isOver(nowMs, this.startedAtMs, this.worlds)) {
      this.active = false;
      return { ended: true, stageChanges };
    }
    return { ended: false, stageChanges };
  }

  buildResult(nowMs: number): MatchResult {
    return this.mode.buildResult(nowMs, this.startedAtMs, this.worlds, this.mapId);
  }

  remainingMs(nowMs: number): number | null {
    const t = this.mode.timerMs();
    if (t === null) return null;
    return Math.max(0, t - (nowMs - this.startedAtMs));
  }

  resize(renderer: Renderer) {
    const { w, h } = renderer.size();
    const vps = viewportsFor(this.slots.length, w, h);
    this.slots.forEach((slot, i) => {
      const world = this.worlds.get(slot);
      if (!world) return;
      world.setAspect(vps[i].w / vps[i].h);
    });
  }

  viewportsForRender(renderer: Renderer): Array<{ scene: THREE.Scene; camera: THREE.Camera; vp: { x: number; y: number; w: number; h: number } }> {
    const { w, h } = renderer.size();
    const vps = viewportsFor(this.slots.length, w, h);
    const out: Array<{ scene: THREE.Scene; camera: THREE.Camera; vp: { x: number; y: number; w: number; h: number } }> = [];
    this.slots.forEach((slot, i) => {
      const world = this.worlds.get(slot);
      if (world) out.push({ scene: world.scene, camera: world.camera, vp: vps[i] });
    });
    return out;
  }

  /** Release all GPU resources held by per-slot worlds. */
  dispose() {
    for (const world of this.worlds.values()) world.dispose();
    this.worlds.clear();
  }
}
