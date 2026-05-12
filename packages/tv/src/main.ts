import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PairingScene } from './scenes/PairingScene';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#07090e',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [BootScene, PairingScene, GameScene, GameOverScene],
  render: { pixelArt: false, antialias: true },
});
