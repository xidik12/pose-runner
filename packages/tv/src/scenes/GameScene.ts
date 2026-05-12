// Solo-mode game scene. Hosts a single RunScene at full-viewport.
// (Co-op / split-screen comes later via MatchScene; this is the MVP path.)
import Phaser from 'phaser';
import type { ActionEvent, MapManifest, MatchResult, PlayerSlot } from '@pose-runner/shared';
import { RunScene, type RunSceneInit } from './RunScene';
import { TvBrokerClient } from '../net/ws';

interface GameInit {
  seed: number;
  mapId: string;
  broker: TvBrokerClient;
  durationMs?: number;
  keyboardFallback?: boolean;
}

const RUN_KEY = 'Run_solo';

export class GameScene extends Phaser.Scene {
  private broker!: TvBrokerClient;
  private slot: PlayerSlot = 1;
  private startedAt = 0;
  private score = 0;
  private stats = blankStats();
  private dead = false;
  private mapId = '';
  private hudText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private durationMs?: number;
  private keyboardFallback = false;
  private endTimer?: Phaser.Time.TimerEvent;

  constructor() { super('Game'); }

  init(data: GameInit) {
    this.broker = data.broker;
    this.mapId = data.mapId;
    this.durationMs = data.durationMs;
    this.keyboardFallback = !!data.keyboardFallback;
    this.dead = false;
    this.score = 0;
    this.stats = blankStats();
  }

  create() {
    const { width: w, height: h } = this.scale;
    this.startedAt = this.time.now;

    // Resolve map manifest
    const seed = this.cache.json.get('maps-seed') as { maps: MapManifest[] };
    const manifest = seed.maps.find((m) => m.id === this.mapId) ?? seed.maps[0];

    const initData: RunSceneInit = {
      slot: this.slot,
      manifest,
      seed: this.time.now,
      sharedSeed: null,
      viewport: { x: 0, y: 0, w, h },
      onScore: (s) => { this.score = s; },
      onDeath: () => this.handleDeath(),
      onStat:  (k, n) => { (this.stats as any)[k] = ((this.stats as any)[k] ?? 0) + n; },
    };

    // Add the RunScene (with a unique key so we can reset between matches)
    if (this.scene.get(RUN_KEY)) this.scene.remove(RUN_KEY);
    this.scene.add(RUN_KEY, RunScene, true, initData);

    // HUD on top of the run scene's camera
    this.hudText = this.add.text(w / 2, 24, '0', {
      fontFamily: 'system-ui, sans-serif', fontSize: '36px', color: '#e8eaf0',
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);

    this.statusText = this.add.text(24, h - 36, '', {
      fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#92a0bd',
    }).setScrollFactor(0).setDepth(1000);

    // Route incoming actions to the RunScene
    this.broker = this.injectActionListener(this.broker);

    // Optional fixed timer (Score Battle)
    if (this.durationMs) {
      this.endTimer = this.time.delayedCall(this.durationMs, () => this.endMatch());
    }

    // Keyboard fallback for dev when no phone is paired
    if (this.keyboardFallback) {
      this.bindKeyboardFallback();
      this.statusText.setText('keyboard: ←/→ lane · ↑ jump · ↓ duck · A/D punch · S stance');
    }
  }

  update() {
    this.hudText.setText(String(this.score));
    if (this.broker) {
      this.statusText.setText(
        `${this.mapId} · score ${this.score} · ping ${this.broker.pingMs} ms` +
        (this.keyboardFallback ? ' · KEYBOARD' : '')
      );
    }
  }

  private injectActionListener(broker: TvBrokerClient): TvBrokerClient {
    // The TvBrokerClient is shared with PairingScene; we hook its onActionEvent
    // by replacing the option callback. The simpler choice for now is to listen
    // on the *raw* websocket via a passthrough — but our wrapper already has a slot.
    // We re-bind by reassigning the option through a tiny adapter:
    (broker as unknown as { _opts?: { onActionEvent?: (m: any) => void } });
    // Re-route by overriding the field directly (BrokerClient stores opts privately;
    // simplest path is to add a public attach in TvBrokerClient — but for the MVP we
    // just monkey-patch).
    (broker as any).opts.onActionEvent = (msg: any) => {
      const ev = msg.event as ActionEvent;
      const run = this.scene.get(RUN_KEY) as RunScene | undefined;
      if (run && !this.dead) run.consumeAction(ev);
    };
    return broker;
  }

  private handleDeath() {
    if (this.dead) return;
    this.dead = true;
    this.time.delayedCall(900, () => this.endMatch());
  }

  private endMatch() {
    this.endTimer?.remove(false);
    const durationMs = this.time.now - this.startedAt;
    const result: MatchResult = {
      mode: this.durationMs ? 'score-battle' : 'solo',
      mapId: this.mapId,
      durationMs,
      perPlayer: [{
        slot: this.slot,
        score: this.score,
        coinsCollected: this.stats.coin,
        obstaclesAvoided: this.stats.avoided,
        obstaclesBroken: this.stats.broken,
        perfectStanceMatches: this.stats.perfectStance,
        jumps: this.stats.jump, ducks: this.stats.duck,
        punches: this.stats.punch, laneChanges: this.stats.lane,
        diedAt: this.dead ? durationMs : null,
      }],
      winnerSlot: null,
    };
    this.broker.reportMatchEnd(result);
    if (this.scene.get(RUN_KEY)) this.scene.remove(RUN_KEY);
    this.scene.start('GameOver', { result });
  }

  private bindKeyboardFallback() {
    const send = (ev: ActionEvent) => {
      const run = this.scene.get(RUN_KEY) as RunScene | undefined;
      if (run && !this.dead) run.consumeAction(ev);
    };
    const now = () => performance.now();
    this.input.keyboard?.on('keydown-LEFT',  () => send({ type: 'LEAN_LEFT',  timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-RIGHT', () => send({ type: 'LEAN_RIGHT', timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-UP',    () => send({ type: 'JUMP',       timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-DOWN',  () => send({ type: 'DUCK',       timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-A',     () => send({ type: 'PUNCH_LEFT', timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-D',     () => send({ type: 'PUNCH_RIGHT',timestamp: now(), confidence: 1 }));
    this.input.keyboard?.on('keydown-S',     () => send({ type: 'STANCE_MATCH', timestamp: now(), confidence: 1, meta: { stanceId: 't-pose' } }));
  }
}

function blankStats() {
  return { coin: 0, avoided: 0, broken: 0, perfectStance: 0, jump: 0, duck: 0, punch: 0, lane: 0 };
}
