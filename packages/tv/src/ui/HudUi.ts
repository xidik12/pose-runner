// Per-viewport HUD overlay: score chip, lane indicator, ping, edge flash.
import type { PlayerSlot } from '@pose-runner/shared';
import { uiRectsFor } from './ViewportLayout';
import {
  HUD_TINT_JUMP, HUD_TINT_DUCK, HUD_TINT_LANE, HUD_TINT_PUNCH, HUD_TINT_DEATH,
  HUD_TINT_COIN, HUD_TINT_BREAK,
} from '../engine/constants';
import type { Player, EdgeFlash } from '../engine/Player';

interface SlotHud {
  root: HTMLDivElement;
  scoreEl: HTMLDivElement;
  distEl: HTMLDivElement;
  coinEl: HTMLDivElement;
  hpEls: HTMLDivElement[];
  flashEl: HTMLDivElement;
  pingEl: HTMLDivElement;
  laneEls: HTMLDivElement[];
  boulderEl: HTMLDivElement;
  boulderBarEl: HTMLDivElement;
  runStatusEl: HTMLDivElement;
}

export class HudUi {
  private root: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private slots = new Map<PlayerSlot, SlotHud>();

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '20',
    } as Partial<CSSStyleDeclaration>);

    this.timerEl = document.createElement('div');
    Object.assign(this.timerEl.style, {
      position: 'absolute', top: '2vh', left: '50%', transform: 'translateX(-50%)',
      fontFamily: 'ui-monospace, monospace', fontSize: '5vh', fontWeight: '800',
      color: '#fff', textShadow: '0 2px 6px rgba(0,0,0,0.7)', padding: '0 1.5vh',
      background: 'rgba(0,0,0,0.35)', borderRadius: '12px', display: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.timerEl);

    this.countdownEl = document.createElement('div');
    Object.assign(this.countdownEl.style, {
      position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      fontSize: '30vh', fontWeight: '900', color: '#fff', textShadow: '0 4px 16px rgba(0,0,0,0.8)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.countdownEl);

    document.getElementById('ui-root')!.appendChild(this.root);
  }

  setSlots(slots: PlayerSlot[]) {
    // Clear existing
    for (const s of this.slots.values()) s.root.remove();
    this.slots.clear();

    const { innerWidth: W, innerHeight: H } = window;
    const vps = uiRectsFor(slots.length, W, H);
    slots.forEach((slot, i) => {
      const vp = vps[i];
      const root = document.createElement('div');
      Object.assign(root.style, {
        position: 'absolute', left: vp.x + 'px', top: vp.y + 'px',
        width: vp.w + 'px', height: vp.h + 'px', overflow: 'hidden',
      } as Partial<CSSStyleDeclaration>);

      // Edge flash — full-viewport tinted overlay
      const flashEl = document.createElement('div');
      Object.assign(flashEl.style, {
        position: 'absolute', inset: '0', background: 'transparent',
        transition: 'background 0.15s linear', pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>);
      root.appendChild(flashEl);

      // Top-left chip group: Score + Coin counter + HP hearts (vertical stack)
      const topLeftCol = document.createElement('div');
      Object.assign(topLeftCol.style, {
        position: 'absolute', top: '5%', left: '5%',
        display: 'flex', flexDirection: 'column', gap: '1vh',
      } as Partial<CSSStyleDeclaration>);
      root.appendChild(topLeftCol);

      const scoreEl = document.createElement('div');
      Object.assign(scoreEl.style, {
        fontFamily: '"Bungee", system-ui, sans-serif', fontSize: '4vh', fontWeight: '800', color: '#fff',
        textShadow: '0 2px 6px rgba(0,0,0,0.7)',
        padding: '0.6vh 1.4vh', background: 'rgba(0,0,0,0.45)', borderRadius: '12px',
        display: 'inline-block', letterSpacing: '0.04em',
      } as Partial<CSSStyleDeclaration>);
      scoreEl.textContent = `P${slot}  0`;
      topLeftCol.appendChild(scoreEl);

      // Distance counter (just below score)
      const distEl = document.createElement('div');
      Object.assign(distEl.style, {
        fontFamily: 'ui-monospace, monospace', fontSize: '2.4vh', fontWeight: '700', color: '#5dd6ff',
        textShadow: '0 2px 6px rgba(0,0,0,0.7)',
        padding: '0.3vh 1vh', background: 'rgba(0,0,0,0.35)', borderRadius: '10px',
        display: 'inline-block',
      } as Partial<CSSStyleDeclaration>);
      distEl.textContent = '0 m';
      topLeftCol.appendChild(distEl);

      // Coin counter
      const coinEl = document.createElement('div');
      Object.assign(coinEl.style, {
        fontFamily: 'system-ui, sans-serif', fontSize: '2.6vh', fontWeight: '700', color: '#ffd24a',
        textShadow: '0 2px 6px rgba(0,0,0,0.7)',
        padding: '0.4vh 1vh', background: 'rgba(0,0,0,0.4)', borderRadius: '10px',
        display: 'inline-block',
      } as Partial<CSSStyleDeclaration>);
      coinEl.textContent = '★ 0';
      topLeftCol.appendChild(coinEl);

      // HP hearts (3 by default)
      const hpRow = document.createElement('div');
      Object.assign(hpRow.style, {
        display: 'flex', gap: '0.6vh',
        padding: '0.4vh 1vh', background: 'rgba(0,0,0,0.4)', borderRadius: '10px',
      } as Partial<CSSStyleDeclaration>);
      const hpEls: HTMLDivElement[] = [];
      for (let h = 0; h < 3; h++) {
        const heart = document.createElement('div');
        Object.assign(heart.style, {
          fontSize: '2.6vh', color: '#ff4d6d', textShadow: '0 2px 4px rgba(0,0,0,0.6)',
          transition: 'transform 0.18s, opacity 0.18s',
        } as Partial<CSSStyleDeclaration>);
        heart.textContent = '♥';
        hpRow.appendChild(heart);
        hpEls.push(heart);
      }
      topLeftCol.appendChild(hpRow);

      // Ping
      const pingEl = document.createElement('div');
      Object.assign(pingEl.style, {
        position: 'absolute', top: '5%', right: '5%',
        fontFamily: 'ui-monospace, monospace', fontSize: '1.8vh', color: '#cde',
        background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '0.4vh 1vh',
      } as Partial<CSSStyleDeclaration>);
      pingEl.textContent = '— ms';
      root.appendChild(pingEl);

      // Lane pips (3 small dots at the bottom)
      const laneEls: HTMLDivElement[] = [];
      const laneRow = document.createElement('div');
      Object.assign(laneRow.style, {
        position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '1.5vh',
      } as Partial<CSSStyleDeclaration>);
      for (let l = 0; l < 3; l++) {
        const pip = document.createElement('div');
        Object.assign(pip.style, {
          width: '2vh', height: '2vh', borderRadius: '50%',
          background: 'rgba(255,255,255,0.3)', border: '2px solid rgba(255,255,255,0.6)',
        } as Partial<CSSStyleDeclaration>);
        laneRow.appendChild(pip);
        laneEls.push(pip);
      }
      root.appendChild(laneRow);

      // Boulder warning — large red banner at top-center of viewport
      const boulderEl = document.createElement('div');
      Object.assign(boulderEl.style, {
        position: 'absolute', top: '8%', left: '50%', transform: 'translateX(-50%)',
        padding: '1.4vh 3vh', borderRadius: '14px',
        background: 'rgba(190, 30, 30, 0.92)', color: '#fff',
        fontSize: '4.5vh', fontWeight: '900', letterSpacing: '0.1em',
        textShadow: '0 3px 10px rgba(0,0,0,0.7)',
        display: 'none', boxShadow: '0 0 40px rgba(255, 60, 60, 0.6)',
      } as Partial<CSSStyleDeclaration>);
      boulderEl.textContent = 'RUN!';
      root.appendChild(boulderEl);

      // Boulder distance bar (right edge)
      const boulderBarEl = document.createElement('div');
      Object.assign(boulderBarEl.style, {
        position: 'absolute', right: '5%', top: '20%', width: '0.8vh', height: '60%',
        background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden',
        display: 'none',
      } as Partial<CSSStyleDeclaration>);
      const boulderBarFill = document.createElement('div');
      Object.assign(boulderBarFill.style, {
        position: 'absolute', bottom: '0', left: '0', right: '0',
        background: '#ff3030', transition: 'height 0.15s linear, background 0.2s',
      } as Partial<CSSStyleDeclaration>);
      boulderBarEl.appendChild(boulderBarFill);
      root.appendChild(boulderBarEl);

      // Run status indicator (bottom-right) — shows "RUN!" prompt when stationary
      const runStatusEl = document.createElement('div');
      Object.assign(runStatusEl.style, {
        position: 'absolute', bottom: '5%', right: '5%',
        padding: '0.6vh 1.4vh', background: 'rgba(0,0,0,0.55)',
        borderRadius: '12px', fontSize: '2.2vh', fontWeight: '700',
        color: '#92a0bd', transition: 'color 0.2s, background 0.2s',
      } as Partial<CSSStyleDeclaration>);
      runStatusEl.textContent = '⏵ run in place';
      root.appendChild(runStatusEl);

      this.root.appendChild(root);
      this.slots.set(slot, {
        root, scoreEl, distEl, coinEl, hpEls, flashEl, pingEl, laneEls,
        boulderEl, boulderBarEl: boulderBarFill, runStatusEl,
      });
    });
  }

  updateSlot(
    slot: PlayerSlot, score: number, player: Player, pingMs: number, nowMs: number,
    boulder?: { distanceM: number | null; urgency: number; state: string },
    distanceM?: number,
  ) {
    const hud = this.slots.get(slot);
    if (!hud) return;
    if (distanceM !== undefined) {
      hud.distEl.textContent = `${distanceM.toFixed(0)} m`;
    }
    const prevScore = parseInt(hud.scoreEl.dataset.score || '0', 10);
    if (score !== prevScore) {
      hud.scoreEl.textContent = `P${slot}  ${score}`;
      hud.scoreEl.dataset.score = String(score);
      hud.scoreEl.style.transform = 'scale(1.18)';
      hud.scoreEl.style.transition = 'transform 0.18s ease-out';
      setTimeout(() => { hud.scoreEl.style.transform = 'scale(1.0)'; }, 90);
    }

    // Coin counter
    const coinCount = player.stats.coin;
    const prevCoin = parseInt(hud.coinEl.dataset.coin || '0', 10);
    if (coinCount !== prevCoin) {
      hud.coinEl.textContent = `★ ${coinCount}`;
      hud.coinEl.dataset.coin = String(coinCount);
      hud.coinEl.style.transform = 'scale(1.3)';
      hud.coinEl.style.transition = 'transform 0.2s ease-out';
      setTimeout(() => { hud.coinEl.style.transform = 'scale(1.0)'; }, 100);
    }

    // HP hearts: dim + shrink lost ones
    for (let i = 0; i < hud.hpEls.length; i++) {
      const heart = hud.hpEls[i];
      if (i < player.hp) {
        heart.style.opacity = '1';
        heart.style.transform = 'scale(1)';
      } else {
        heart.style.opacity = '0.2';
        heart.style.transform = 'scale(0.7)';
      }
    }

    hud.pingEl.textContent = `${pingMs} ms`;
    hud.pingEl.style.color = pingMs > 200 ? '#ff8060' : pingMs > 120 ? '#ffd24a' : '#cde';

    // Run-status indicator (green = running, gray = stopped)
    if (player.runConfidence > 0.4) {
      hud.runStatusEl.textContent = `▶ running ${Math.round(player.runConfidence * 100)}%`;
      hud.runStatusEl.style.color = '#4dd185';
      hud.runStatusEl.style.background = 'rgba(20, 90, 50, 0.55)';
    } else {
      hud.runStatusEl.textContent = '⏵ run in place';
      hud.runStatusEl.style.color = '#ffd24a';
      hud.runStatusEl.style.background = 'rgba(80, 60, 20, 0.55)';
    }

    // Boulder warning
    if (boulder && boulder.state === 'chasing' && boulder.distanceM !== null) {
      hud.boulderEl.style.display = 'block';
      hud.boulderBarEl.parentElement!.style.display = 'block';
      const dist = boulder.distanceM;
      // Pulse opacity based on urgency
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(nowMs * 0.012));
      hud.boulderEl.style.opacity = String(boulder.urgency * pulse);
      hud.boulderEl.textContent = dist < 5 ? '⚠ DANGER!' : `RUN! ${dist.toFixed(0)}m`;
      // Bar fill: 0% at distance 30, 100% at distance 0
      const fillPct = Math.min(100, Math.max(0, (1 - dist / 30) * 100));
      hud.boulderBarEl.style.height = `${fillPct}%`;
      hud.boulderBarEl.style.background = dist < 8 ? '#ff0040' : dist < 15 ? '#ff6020' : '#ffa020';
    } else {
      hud.boulderEl.style.display = 'none';
      hud.boulderBarEl.parentElement!.style.display = 'none';
    }

    // Lane pips
    for (let l = 0; l < 3; l++) {
      hud.laneEls[l].style.background = l === player.lane
        ? '#5dd6ff'
        : 'rgba(255,255,255,0.2)';
    }

    // Edge flash
    if (player.flashKind && nowMs < player.flashUntil) {
      hud.flashEl.style.background = tintFor(player.flashKind);
    } else {
      hud.flashEl.style.background = 'transparent';
    }
  }

  setTimer(remainingMs: number | null) {
    if (remainingMs === null) {
      this.timerEl.style.display = 'none';
    } else {
      this.timerEl.style.display = 'block';
      this.timerEl.textContent = formatTimer(remainingMs);
    }
  }

  showCountdown(text: string) {
    this.countdownEl.style.display = 'flex';
    this.countdownEl.textContent = text;
  }
  hideCountdown() {
    this.countdownEl.style.display = 'none';
  }

  /** Brief stage banner (1.4s) shown center-screen on stage transition. */
  flashStage(stage: number) {
    const banner = document.createElement('div');
    Object.assign(banner.style, {
      position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%) scale(0.6)',
      padding: '2vh 5vh', borderRadius: '20px', fontSize: '8vh', fontWeight: '900', color: '#fff',
      background: 'rgba(255, 100, 50, 0.85)', textShadow: '0 4px 16px rgba(0,0,0,0.7)',
      pointerEvents: 'none', zIndex: '30',
      transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s',
      letterSpacing: '0.08em',
    } as Partial<CSSStyleDeclaration>);
    banner.textContent = `STAGE ${stage}`;
    this.root.appendChild(banner);
    requestAnimationFrame(() => {
      banner.style.transform = 'translate(-50%, -50%) scale(1.0)';
    });
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translate(-50%, -50%) scale(1.3)';
    }, 1100);
    setTimeout(() => banner.remove(), 1500);
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }
  destroy() { this.root.remove(); }
}

function tintFor(k: EdgeFlash): string {
  switch (k) {
    case 'jump':  return HUD_TINT_JUMP;
    case 'duck':  return HUD_TINT_DUCK;
    case 'lane':  return HUD_TINT_LANE;
    case 'punch': return HUD_TINT_PUNCH;
    case 'death': return HUD_TINT_DEATH;
    case 'coin':  return HUD_TINT_COIN;
    case 'break': return HUD_TINT_BREAK;
    default: return 'transparent';
  }
}

function formatTimer(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${s}`;
}
