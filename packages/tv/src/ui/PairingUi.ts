// Full-screen pairing overlay: title, QR, room code, slot pips, mode label.
import QRCode from 'qrcode';
import type { PlayerSlot, RoomState } from '@pose-runner/shared';
import { CONTROLLER_URL } from '../config';

export interface PairingUiCallbacks {
  onKeyboardSolo: () => void;  // dev shortcut: SPACE
}

export class PairingUi {
  private el: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private codeEl: HTMLDivElement;
  private linkEl: HTMLAnchorElement;
  private qrEl: HTMLImageElement;
  private slotEls: HTMLDivElement[] = [];
  private modeEl: HTMLDivElement;
  private roomCode: string;
  private cb: PairingUiCallbacks;

  constructor(roomCode: string, cb: PairingUiCallbacks) {
    this.roomCode = roomCode;
    this.cb = cb;
    const root = document.getElementById('ui-root')!;
    this.el = document.createElement('div');
    this.el.className = 'pairing';
    Object.assign(this.el.style, {
      position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #0a0d14 0%, #142036 100%)',
      color: '#e8eaf0', padding: '5vh 5vw', boxSizing: 'border-box', textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);

    this.el.innerHTML = `
      <div style="font-size:7vh;font-weight:800;letter-spacing:0.05em;margin-bottom:1vh">POSE-RUNNER</div>
      <div style="font-size:2.2vh;color:#92a0bd;margin-bottom:3vh">scan with your phone camera</div>
      <img id="pairing-qr" style="width:34vh;height:34vh;background:#0a0d14;border-radius:18px;padding:8px" />
      <div id="pairing-code" style="font-family:ui-monospace,monospace;font-size:9vh;font-weight:800;letter-spacing:0.18em;margin:2vh 0 0">------</div>
      <a id="pairing-link" style="font-family:ui-monospace,monospace;font-size:1.6vh;color:#6fb0ff;text-decoration:none;margin-bottom:3vh"></a>
      <div style="display:flex;gap:1.4vh;margin-bottom:2vh" id="pairing-slots"></div>
      <div id="pairing-mode" style="font-size:2.2vh;color:#c8d3e8"></div>
      <div id="pairing-status" style="font-size:2vh;color:#92a0bd;margin-top:2vh">waiting for player…</div>
      <div style="font-size:1.6vh;color:#5d6b88;margin-top:auto;padding-top:3vh">SPACE for solo keyboard test</div>
    `;
    root.appendChild(this.el);

    this.qrEl = this.el.querySelector('#pairing-qr')!;
    this.codeEl = this.el.querySelector('#pairing-code')!;
    this.linkEl = this.el.querySelector('#pairing-link')!;
    this.statusEl = this.el.querySelector('#pairing-status')!;
    this.modeEl = this.el.querySelector('#pairing-mode')!;

    const slotRow = this.el.querySelector('#pairing-slots') as HTMLDivElement;
    for (let i = 1; i <= 4; i++) {
      const pip = document.createElement('div');
      Object.assign(pip.style, {
        padding: '1vh 2vh', borderRadius: '12px', background: '#1a2235',
        color: '#5d6b88', fontSize: '1.8vh', fontWeight: '700', minWidth: '12vh',
      } as Partial<CSSStyleDeclaration>);
      pip.textContent = `P${i} —`;
      slotRow.appendChild(pip);
      this.slotEls.push(pip);
    }

    this.codeEl.textContent = roomCode;
    const url = `${CONTROLLER_URL}/?room=${roomCode}`;
    this.linkEl.textContent = url;
    this.linkEl.href = url;
    QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: '#e8eaf0', light: '#0a0d14' } })
      .then((dataUrl) => { this.qrEl.src = dataUrl; });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.hidden) { e.preventDefault(); this.cb.onKeyboardSolo(); }
    });
  }

  private hidden = false;

  applyState(state: RoomState) {
    for (let i = 0; i < 4; i++) {
      const slot = (i + 1) as PlayerSlot;
      const c = state.controllers.find((cc) => cc.slot === slot);
      const pip = this.slotEls[i];
      if (!c) {
        pip.style.background = '#1a2235';
        pip.style.color = '#5d6b88';
        pip.textContent = `P${slot} —`;
      } else if (c.ready && c.calibrated) {
        pip.style.background = '#2c8a4a';
        pip.style.color = '#fff';
        pip.textContent = `P${slot} ✓ ready`;
      } else if (c.calibrated) {
        pip.style.background = '#33526e';
        pip.style.color = '#fff';
        pip.textContent = `P${slot} • tap ready`;
      } else {
        pip.style.background = '#33526e';
        pip.style.color = '#cdd6e4';
        pip.textContent = `P${slot} • calibrate`;
      }
    }
    const n = state.controllers.length;
    if (n === 0) {
      this.statusEl.textContent = 'waiting for player…';
      this.modeEl.textContent = '';
    } else if (n === 1) {
      this.modeEl.textContent = 'Mode: Solo';
      this.statusEl.textContent = state.controllers[0].ready ? 'starting…' : 'calibrate + tap ready';
    } else {
      this.modeEl.textContent = `Mode: Score Battle (${state.controllers.length} players, 90 s)`;
      const allReady = state.controllers.every((c) => c.ready && c.calibrated);
      this.statusEl.textContent = allReady ? 'starting…' : 'all players: calibrate + ready';
    }
  }

  hide() { this.hidden = true; this.el.style.display = 'none'; }
  show() { this.hidden = false; this.el.style.display = 'flex'; }
  destroy() { this.el.remove(); }
  get roomCodeStr() { return this.roomCode; }
}
