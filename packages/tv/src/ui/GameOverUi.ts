// End-of-match scoreboard overlay with personal-best celebration.
import type { MatchResult } from '@pose-runner/shared';
import { records, type MapRecord } from '../engine/Records';
import { gameAudio } from '../engine/Audio';

export interface GameOverDetails {
  distancesM: Record<number, number>;  // slot → meters traveled
}

export class GameOverUi {
  private el: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private onRestart?: () => void;
  private autoTimer?: number;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', inset: '0', display: 'none', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(7, 9, 14, 0.92)', color: '#e8eaf0',
      padding: '5vh 5vw', textAlign: 'center', zIndex: '40',
    } as Partial<CSSStyleDeclaration>);
    this.el.innerHTML = `
      <div id="go-title" style="font-size:7vh;font-weight:900;margin-bottom:3vh;letter-spacing:0.05em">RUN COMPLETE</div>
      <div id="go-body"></div>
      <div id="go-hint" style="font-size:2.2vh;color:#92a0bd;margin-top:5vh">press OK / SPACE to play again</div>
    `;
    this.bodyEl = this.el.querySelector('#go-body')!;
    this.hintEl = this.el.querySelector('#go-hint')!;
    document.getElementById('ui-root')!.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (this.el.style.display === 'none') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.trigger();
      }
    });
  }

  show(result: MatchResult, details: GameOverDetails, onRestart: () => void) {
    this.onRestart = onRestart;
    const winner = result.winnerSlot;
    const players = result.perPlayer.sort((a, b) => b.score - a.score);
    const titleEl = this.el.querySelector('#go-title') as HTMLDivElement;

    // Update records and detect celebrations (single-player only for now)
    let celebrated = false;
    let updatedRecord: MapRecord | null = null;
    let newBestFlags = { score: false, distance: false, run: false };
    if (players.length === 1) {
      const p = players[0];
      const dist = details.distancesM[p.slot] ?? 0;
      const upd = records.update(result.mapId, { score: p.score, distance: dist, durationMs: result.durationMs });
      updatedRecord = upd.record;
      newBestFlags = { score: upd.isNewBestScore, distance: upd.isNewBestDistance, run: upd.isNewLongestRun };
      celebrated = upd.isNewBestScore || upd.isNewBestDistance || upd.isNewLongestRun;
      if (celebrated) gameAudio.play('levelUp');
    }

    titleEl.textContent = celebrated ? '🎉 NEW BEST!' : 'RUN COMPLETE';
    titleEl.style.color = celebrated ? '#ffd24a' : '#e8eaf0';

    let body = '';
    if (winner !== null) {
      body += `<div style="font-size:5vh;color:#ffd24a;margin-bottom:3vh;font-weight:900">P${winner} WINS</div>`;
    } else if (result.combinedScore !== undefined) {
      body += `<div style="font-size:5vh;color:#5dd6ff;margin-bottom:3vh;font-weight:900">COMBINED ${result.combinedScore}</div>`;
    }
    body += '<div style="display:flex;gap:3vh;justify-content:center;flex-wrap:wrap">';
    for (const p of players) {
      const isWinner = winner === p.slot;
      const dist = details.distancesM[p.slot] ?? 0;
      // Per-stat NEW-BEST badges (single-player)
      const badge = (text: string) =>
        `<div style="display:inline-block;background:#ffd24a;color:#0a0d14;font-weight:900;font-size:1.4vh;padding:0.2vh 0.8vh;border-radius:6px;margin-left:0.6vh;vertical-align:middle;animation:pulse 0.8s infinite alternate">${text}</div>`;
      body += `
        <div style="background:${isWinner || celebrated ? 'rgba(255,210,74,0.16)' : 'rgba(255,255,255,0.05)'};
                    border:2px solid ${isWinner || celebrated ? '#ffd24a' : 'rgba(255,255,255,0.12)'};
                    border-radius:18px;padding:3vh 4vh;min-width:24vh">
          <div style="font-size:2.4vh;color:#92a0bd">PLAYER ${p.slot}</div>
          <div style="font-size:8vh;font-weight:900;color:#fff;margin:1vh 0;letter-spacing:-0.02em">${p.score}${newBestFlags.score ? badge('NEW BEST') : ''}</div>
          <div style="font-size:2.4vh;color:#5dd6ff;margin-bottom:1.5vh">${dist.toFixed(0)} m${newBestFlags.distance ? badge('FARTHEST') : ''}</div>
          <div style="font-size:1.6vh;color:#c8d3e8;line-height:1.7">
            jumps ${p.jumps} · ducks ${p.ducks} · punches ${p.punches}<br/>
            lane ${p.laneChanges} · coin ${p.coinsCollected} · broke ${p.obstaclesBroken}<br/>
            avoided ${p.obstaclesAvoided}
          </div>
        </div>`;
    }
    body += '</div>';

    // Records summary (single-player)
    if (updatedRecord) {
      body += `
        <div style="margin-top:3vh;font-size:2vh;color:#92a0bd;line-height:1.7">
          ${updatedRecord.totalRuns} runs · best ${updatedRecord.bestScore} pts · ${updatedRecord.bestDistance.toFixed(0)} m · ${(updatedRecord.bestRunMs / 1000).toFixed(1)}s
        </div>`;
    }
    body += `<div style="margin-top:3vh;font-size:1.8vh;color:#6fb0ff">${(result.durationMs / 1000).toFixed(1)} s · ${result.mapId}</div>`;
    this.bodyEl.innerHTML = body;

    this.el.style.display = 'flex';
    this.hintEl.textContent = 'press OK / SPACE to play again (auto in 8s)';

    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => this.trigger(), 8000);
  }

  private trigger() {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = undefined; }
    this.el.style.display = 'none';
    this.onRestart?.();
  }

  hide() { this.el.style.display = 'none'; if (this.autoTimer) clearTimeout(this.autoTimer); }
  destroy() { this.el.remove(); }
}
