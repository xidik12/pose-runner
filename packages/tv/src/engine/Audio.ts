// Procedural sound effects via Web Audio API.
// No asset files — every sound synthesized from oscillators + envelopes.
// All sounds are short (< 0.6s) and lightweight.

type Sfx = 'jump' | 'land' | 'coin' | 'punch' | 'damage' | 'death' | 'levelUp' | 'boulder';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private boulderLoop: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** Must be called from a user-gesture handler (click/keydown) to satisfy
   *  browser autoplay policy. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) return;
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
    } catch {
      // No-op; game still works silently
    }
  }

  play(sfx: Sfx) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    switch (sfx) {
      case 'jump':    this.synthJump(now); break;
      case 'land':    this.synthLand(now); break;
      case 'coin':    this.synthCoin(now); break;
      case 'punch':   this.synthPunch(now); break;
      case 'damage':  this.synthDamage(now); break;
      case 'death':   this.synthDeath(now); break;
      case 'levelUp': this.synthLevelUp(now); break;
    }
  }

  /** Start a continuous rumble at given intensity 0..1. */
  startBoulder(intensity: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    if (this.boulderLoop) {
      this.boulderLoop.gain.gain.linearRampToValueAtTime(intensity * 0.18, this.ctx.currentTime + 0.15);
      return;
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    // Slight FM for rumble character
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 8;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0;
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    gain.gain.linearRampToValueAtTime(intensity * 0.18, this.ctx.currentTime + 0.15);
    this.boulderLoop = { osc, gain };
  }

  stopBoulder() {
    if (!this.boulderLoop || !this.ctx) return;
    const { osc, gain } = this.boulderLoop;
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
    setTimeout(() => { osc.stop(); }, 300);
    this.boulderLoop = null;
  }

  // -----------------------------------------------------------------
  // Synth helpers — each is a short envelope-shaped oscillator chord
  // -----------------------------------------------------------------

  private synthJump(t: number) {
    // Quick pitch sweep up, "whoop"
    this.tone(t, { freqStart: 300, freqEnd: 700, duration: 0.18, gain: 0.3, type: 'sine' });
  }

  private synthLand(t: number) {
    // Short low thud
    this.tone(t, { freqStart: 140, freqEnd: 80, duration: 0.14, gain: 0.4, type: 'triangle' });
  }

  private synthCoin(t: number) {
    // Two-tone ding (C5 then E5)
    this.tone(t, { freqStart: 523, freqEnd: 523, duration: 0.08, gain: 0.25, type: 'sine' });
    this.tone(t + 0.06, { freqStart: 659, freqEnd: 659, duration: 0.15, gain: 0.25, type: 'sine' });
  }

  private synthPunch(t: number) {
    // Sharp noise burst + low sub
    this.noiseBurst(t, 0.08, 0.4);
    this.tone(t, { freqStart: 80, freqEnd: 50, duration: 0.12, gain: 0.5, type: 'square' });
  }

  private synthDamage(t: number) {
    // Harsh detuned dual oscillator
    this.tone(t, { freqStart: 220, freqEnd: 160, duration: 0.25, gain: 0.4, type: 'sawtooth' });
    this.tone(t, { freqStart: 215, freqEnd: 155, duration: 0.25, gain: 0.3, type: 'sawtooth' });
  }

  private synthDeath(t: number) {
    // Descending sweep + noise
    this.tone(t, { freqStart: 440, freqEnd: 80, duration: 0.6, gain: 0.5, type: 'sawtooth' });
    this.noiseBurst(t, 0.6, 0.3);
  }

  private synthLevelUp(t: number) {
    // Ascending arpeggio C E G C
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this.tone(t + i * 0.08, { freqStart: f, freqEnd: f, duration: 0.18, gain: 0.3, type: 'triangle' });
    });
  }

  private tone(
    t: number,
    opt: { freqStart: number; freqEnd: number; duration: number; gain: number; type: OscillatorType },
  ) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opt.type;
    osc.frequency.setValueAtTime(opt.freqStart, t);
    osc.frequency.linearRampToValueAtTime(opt.freqEnd, t + opt.duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(opt.gain, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opt.duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + opt.duration + 0.05);
  }

  private noiseBurst(t: number, duration: number, gainVal: number) {
    if (!this.ctx || !this.master) return;
    const bufSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = gainVal;
    src.connect(gain).connect(this.master);
    src.start(t);
  }
}

// Singleton (the Game owns it; UI overlays import to play sounds on user gesture)
export const gameAudio = new GameAudio();
