// QR + 6-char room code. Waits for a controller to join, then transitions to Game.
import Phaser from 'phaser';
import QRCode from 'qrcode';
import { randomRoomCode } from '@pose-runner/shared';
import { TvBrokerClient } from '../net/ws';
import { BROKER_URL, CONTROLLER_URL } from '../config';

export class PairingScene extends Phaser.Scene {
  private broker!: TvBrokerClient;
  private codeText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private qrSprite?: Phaser.GameObjects.Image;
  private roomCode!: string;
  private hasController = false;

  constructor() { super('Pairing'); }

  async create() {
    const { width: w, height: h } = this.scale;
    // background
    this.add.rectangle(0, 0, w, h, 0x07090e).setOrigin(0, 0);

    this.add.text(w / 2, h * 0.10, 'POSE-RUNNER', {
      fontFamily: 'system-ui, sans-serif', fontSize: '72px', color: '#e8eaf0', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(w / 2, h * 0.18, 'point your phone camera at the QR', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#92a0bd',
    }).setOrigin(0.5);

    this.roomCode = randomRoomCode();
    const joinUrl = `${CONTROLLER_URL}/?room=${this.roomCode}`;

    // Generate QR as data URL → load into Phaser as image
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 480, margin: 1,
      color: { dark: '#e8eaf0', light: '#0a0d14' },
    });
    const tex = await loadDataUrlAsTexture(this, 'room-qr', qrDataUrl);
    if (tex) {
      this.qrSprite = this.add.image(w / 2, h * 0.50, 'room-qr');
      this.qrSprite.setDisplaySize(420, 420);
    }

    this.codeText = this.add.text(w / 2, h * 0.78, this.roomCode, {
      fontFamily: 'ui-monospace, monospace', fontSize: '96px', color: '#e8eaf0', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(w / 2, h * 0.85, joinUrl, {
      fontFamily: 'ui-monospace, monospace', fontSize: '18px', color: '#6fb0ff',
    }).setOrigin(0.5);

    this.statusText = this.add.text(w / 2, h * 0.93, 'waiting for player…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#c8d3e8',
    }).setOrigin(0.5);

    // Connect to broker
    this.broker = new TvBrokerClient({
      url: BROKER_URL,
      room: this.roomCode,
      onJoined:   () => this.statusText.setText('waiting for player…'),
      onPeerUp:   (role, slot) => {
        if (role === 'controller') {
          this.hasController = true;
          this.statusText.setText(`P${slot} connected — calibrate, then tap ready`);
        }
      },
      onPeerDown: (role) => {
        if (role === 'controller') {
          this.hasController = false;
          this.statusText.setText('player disconnected — waiting…');
        }
      },
      onState: (state) => {
        const c = state.controllers[0];
        if (!c) return;
        if (c.ready && c.calibrated) {
          this.statusText.setText('starting…');
        } else if (c.calibrated) {
          this.statusText.setText(`P${c.slot} calibrated — tap ready`);
        } else if (this.hasController) {
          this.statusText.setText(`P${c.slot} connected — calibrate, then tap ready`);
        }
      },
      onMatchStart: (seed, mapId, durationMs) => {
        this.scene.start('Game', { seed, mapId, broker: this.broker, durationMs });
      },
    });
    this.broker.connect();

    // dev affordance: press SPACE to skip pairing (useful for solo dev testing without a phone)
    this.input.keyboard?.on('keydown-SPACE', () => {
      this.scene.start('Game', {
        seed: Math.floor(Math.random() * 0xffffffff),
        mapId: 'phnom-penh-streets',
        broker: this.broker,
        durationMs: undefined,
        keyboardFallback: true,
      });
    });

    // Pulse animation on the code
    this.tweens.add({
      targets: this.codeText, alpha: { from: 1, to: 0.55 },
      duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }
}

function loadDataUrlAsTexture(scene: Phaser.Scene, key: string, dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (scene.textures.exists(key)) return resolve(true);
    scene.load.once(`filecomplete-image-${key}`, () => resolve(true));
    scene.load.once('loaderror', () => resolve(false));
    scene.load.image(key, dataUrl);
    scene.load.start();
  });
}
