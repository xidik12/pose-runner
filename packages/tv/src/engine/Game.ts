// Top-level orchestrator: wires WS broker events into Match lifecycle and
// drives the render loop.
import type { ActionEvent, GameMode, MapManifest, MatchResult, PlayerSlot, RoomState } from '@pose-runner/shared';
import { randomRoomCode } from '@pose-runner/shared';
import { Renderer } from './Renderer';
import { Match } from './Match';
import { TvBrokerClient } from '../net/ws';
import { BROKER_URL } from '../config';
import { PairingUi } from '../ui/PairingUi';
import { HudUi } from '../ui/HudUi';
import { GameOverUi } from '../ui/GameOverUi';
import { COUNTDOWN_SECONDS } from './constants';
import { gameAudio } from './Audio';

type Phase = 'pairing' | 'countdown' | 'match' | 'gameover';

export class Game {
  private renderer: Renderer;
  private broker: TvBrokerClient;
  private pairing: PairingUi;
  private hud: HudUi;
  private gameOver: GameOverUi;
  private match: Match | null = null;
  private phase: Phase = 'pairing';
  private roomCode: string;
  private roomState: RoomState | null = null;
  private mapManifest: MapManifest | null = null;
  private countdownStartsAt = 0;
  private lastT = performance.now();
  private wakeLock: WakeLockSentinel | null = null;
  private keyboardSolo = false;

  constructor() {
    this.renderer = new Renderer();
    this.roomCode = randomRoomCode();
    // Audio context must be unlocked from a user gesture (autoplay policy)
    const unlockAudio = () => { gameAudio.unlock(); window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.pairing = new PairingUi(this.roomCode, {
      onKeyboardSolo: () => this.startKeyboardSolo(),
    });
    this.hud = new HudUi();
    this.hud.hide();
    this.gameOver = new GameOverUi();

    this.broker = new TvBrokerClient({
      url: BROKER_URL,
      room: this.roomCode,
      onJoined: (state) => { this.roomState = state; this.pairing.applyState(state); },
      onState:  (state) => { this.roomState = state; this.pairing.applyState(state); },
      onPeerUp: () => {/* state diff handled via onState */},
      onPeerDown: () => {/* same */},
      onMatchStart: (seed, mapId, durationMs) => this.startMatchFromBroker(seed, mapId, durationMs),
      onActionEvent: (msg) => {
        if (this.phase === 'match' && this.match) {
          this.match.routeAction(msg.slot, msg.event, performance.now());
        }
      },
    });
    this.broker.connect();

    // Load map manifest (bundled into /maps.json)
    fetch('/maps.json')
      .then((r) => r.json())
      .then((seed: { maps: MapManifest[] }) => { this.mapManifest = seed.maps[0]; });

    window.addEventListener('resize', () => this.handleResize());

    requestAnimationFrame(this.frame);
  }

  private startMatchFromBroker(seed: number, mapId: string, _durationMs?: number) {
    if (!this.roomState) return;
    if (!this.mapManifest) {
      console.warn('match-start before map loaded; deferring 200ms');
      setTimeout(() => this.startMatchFromBroker(seed, mapId, _durationMs), 200);
      return;
    }
    const slots = this.roomState.controllers.map((c) => c.slot).sort((a, b) => a - b);
    if (slots.length === 0) return;
    const mode: GameMode = slots.length >= 2 ? 'score-battle' : 'solo';
    this.beginMatch(mode, mapId, seed, slots);
  }

  private startKeyboardSolo() {
    if (this.phase !== 'pairing') return;
    if (!this.mapManifest) {
      setTimeout(() => this.startKeyboardSolo(), 100);
      return;
    }
    if (!this.keyboardSolo) {
      this.keyboardSolo = true;
      this.bindKeyboardActions(1);  // bind only once per session
    }
    this.beginMatch('solo', this.mapManifest.id, Math.floor(Math.random() * 0xffffffff), [1]);
  }

  private beginMatch(mode: GameMode, mapId: string, seed: number, slots: PlayerSlot[]) {
    this.pairing.hide();
    this.requestWakeLock();
    this.hud.setSlots(slots);
    this.hud.show();

    // 3-2-1 countdown then start
    this.phase = 'countdown';
    this.countdownStartsAt = performance.now();
    const startedAt = performance.now() + COUNTDOWN_SECONDS * 1000;
    this.match = new Match(mode, mapId, this.mapManifest!, seed, slots, this.renderer, startedAt);
  }

  private endMatch(result: MatchResult) {
    this.releaseWakeLock();
    gameAudio.stopBoulder();
    this.broker.reportMatchEnd(result);
    this.phase = 'gameover';
    this.hud.hide();
    // Gather per-slot distance for the score breakdown
    const distancesM: Record<number, number> = {};
    if (this.match) {
      for (const [slot, world] of this.match.worlds.entries()) distancesM[slot] = world.distanceM;
    }
    this.gameOver.show(result, { distancesM }, () => this.returnToPairing());
  }

  private returnToPairing() {
    // Dispose previous match's GPU resources before nulling
    if (this.match) { this.match.dispose(); this.match = null; }
    this.phase = 'pairing';
    this.pairing.show();
    if (this.roomState) this.pairing.applyState(this.roomState);
  }

  private bindKeyboardActions(slot: PlayerSlot) {
    const send = (ev: ActionEvent) => {
      if (this.phase === 'match' && this.match) {
        this.match.routeAction(slot, ev, performance.now());
      }
    };
    const now = () => performance.now();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'ArrowLeft':  send({ type: 'LEAN_LEFT',  timestamp: now(), confidence: 1 }); break;
        case 'ArrowRight': send({ type: 'LEAN_RIGHT', timestamp: now(), confidence: 1 }); break;
        case 'ArrowUp':    send({ type: 'JUMP',       timestamp: now(), confidence: 1 }); break;
        case 'ArrowDown':  send({ type: 'DUCK',       timestamp: now(), confidence: 1 }); break;
        case 'KeyA':       send({ type: 'PUNCH_LEFT', timestamp: now(), confidence: 1 }); break;
        case 'KeyD':       send({ type: 'PUNCH_RIGHT',timestamp: now(), confidence: 1 }); break;
      }
    });
  }

  private handleResize() {
    this.renderer.handleResize();
    if (this.match) this.match.resize(this.renderer);
    if (this.phase === 'match' && this.match) {
      const slots = [...this.match.worlds.keys()];
      this.hud.setSlots(slots);
    }
  }

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator.wakeLock as any).request('screen');
      }
    } catch { /* no-op */ }
  }
  private releaseWakeLock() {
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
  }

  private frame = (t: number) => {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    const now = t;

    // Countdown phase: render the match world but freeze gameplay
    if (this.phase === 'countdown' && this.match) {
      const remaining = (this.match.startedAtMs - now) / 1000;
      if (remaining <= 0) {
        this.phase = 'match';
        this.hud.hideCountdown();
      } else {
        this.hud.showCountdown(remaining > 1 ? `${Math.ceil(remaining)}` : 'GO!');
      }
      // Render the world without ticking it
      this.renderer.renderViewports(this.match.viewportsForRender(this.renderer));
    } else if (this.phase === 'match' && this.match) {
      const result = this.match.update(dt, now);
      // Update HUDs
      for (const [slot, world] of this.match.worlds.entries()) {
        this.hud.updateSlot(slot, world.score, world.player, this.broker.pingMs, now, world.lastBoulder, world.distanceM);
      }
      this.hud.setTimer(this.match.remainingMs(now));
      // Stage banner + level-up sound on transitions (skip stage 1)
      for (const sc of result.stageChanges) {
        if (sc.stage > 1) { this.hud.flashStage(sc.stage); gameAudio.play('levelUp'); }
      }
      if (result.ended) this.endMatch(this.match.buildResult(now));
      this.renderer.renderViewports(this.match.viewportsForRender(this.renderer));
    } else {
      // pairing or gameover — clear with sky color so canvas isn't black
      this.renderer.renderViewports([]);
    }
    requestAnimationFrame(this.frame);
  };
}
