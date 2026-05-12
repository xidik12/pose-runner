import Phaser from 'phaser';
import type { MatchResult } from '@pose-runner/shared';

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create(data: { result: MatchResult }) {
    const { width: w, height: h } = this.scale;
    const r = data.result;
    const p = r.perPlayer[0];

    this.add.rectangle(0, 0, w, h, 0x07090e).setOrigin(0, 0);

    this.add.text(w / 2, h * 0.20, 'RUN COMPLETE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '64px', color: '#e8eaf0', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(w / 2, h * 0.36, `${p.score}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '160px', color: '#5dd6ff', fontStyle: 'bold',
    }).setOrigin(0.5);

    const stats = [
      `jumps ${p.jumps}   ducks ${p.ducks}   punches ${p.punches}   lanes ${p.laneChanges}`,
      `avoided ${p.obstaclesAvoided}   coins ${p.coinsCollected}   broken ${p.obstaclesBroken}   stances ${p.perfectStanceMatches}`,
      `${Math.round(r.durationMs / 1000)}s · ${r.mapId}`,
    ];
    stats.forEach((line, i) => {
      this.add.text(w / 2, h * 0.55 + i * 30, line, {
        fontFamily: 'ui-monospace, monospace', fontSize: '20px', color: '#c8d3e8',
      }).setOrigin(0.5);
    });

    this.add.text(w / 2, h * 0.85, 'press SPACE for another run', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#92a0bd',
    }).setOrigin(0.5);

    this.input.keyboard?.once('keydown-SPACE', () => {
      this.scene.start('Pairing');
    });

    // Auto-return after 8s
    this.time.delayedCall(8000, () => this.scene.start('Pairing'));
  }
}
