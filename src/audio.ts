/**
 * Procedural Web Audio for Starfall Blade.
 * Zero external audio files: ambient celestial pad, blade swooshes,
 * crystalline slice chimes, star nova explosions, and void thuds.
 * DynamicsCompressor ensures clean levels (target p90 -29 dBFS).
 */
const PENTA = [0, 2, 4, 7, 9];

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private padGain: GainNode | null = null;
  muted = false;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }

    const ctx = this.ctx;
    this.master = new GainNode(ctx, { gain: this.muted ? 0 : 0.55 });
    const comp = new DynamicsCompressorNode(ctx, {
      threshold: -18,
      knee: 12,
      ratio: 5,
      attack: 0.003,
      release: 0.25,
    });
    this.master.connect(comp).connect(ctx.destination);

    // Warm ambient reverb impulse
    this.verb = new ConvolverNode(ctx, { buffer: this.createReverbBuffer(2.4) });
    const verbGain = new GainNode(ctx, { gain: 0.32 });
    this.verb.connect(verbGain).connect(this.master);

    this.startAmbientPad();
  }

  private createReverbBuffer(secs: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
      }
    }
    return b;
  }

  private startAmbientPad() {
    const ctx = this.ctx!;
    this.padGain = new GainNode(ctx, { gain: 0 });
    const filter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 650,
      Q: 0.5,
    });

    this.padGain.connect(filter).connect(this.master);
    filter.connect(this.verb);

    // Cosmic open fifths (D - A - D - F#)
    const freqs = [146.83, 220.0, 293.66, 369.99];
    for (const [i, f] of freqs.entries()) {
      const osc = new OscillatorNode(ctx, {
        type: i % 2 === 0 ? 'sine' : 'triangle',
        frequency: f,
        detune: (i - 1.5) * 4,
      });
      const g = new GainNode(ctx, { gain: 0.045 });
      osc.connect(g).connect(this.padGain);
      osc.start();
    }

    this.padGain.gain.setTargetAtTime(0.45, ctx.currentTime, 2.0);
  }

  /** Quick blade whoosh when slicing at high speed */
  slash() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;

    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 2.0 });
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.12);

    const g = new GainNode(ctx, { gain: 0.14 });
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
  }

  /** Crystal sliced: combo determines harmonic pitch */
  slice(combo: number, kind: 'crystal' | 'prism' | 'gold' | 'star') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const step = Math.min(combo - 1, 14);
    const octave = Math.floor(step / 5);
    const note = PENTA[step % 5];
    const semis = note + octave * 12 + (kind === 'gold' ? 7 : kind === 'star' ? 12 : 0);
    const baseFreq = 523.25 * Math.pow(2, semis / 12); // C5 upwards

    const g = new GainNode(ctx, { gain: 0 });
    g.connect(this.master);
    g.connect(this.verb);

    // Fundamental + overtone
    const osc1 = new OscillatorNode(ctx, { type: 'sine', frequency: baseFreq });
    const osc2 = new OscillatorNode(ctx, {
      type: kind === 'gold' ? 'triangle' : 'sine',
      frequency: baseFreq * 2,
    });

    const o1Gain = new GainNode(ctx, { gain: 0.22 });
    const o2Gain = new GainNode(ctx, { gain: kind === 'gold' ? 0.16 : 0.08 });

    osc1.connect(o1Gain).connect(g);
    osc2.connect(o2Gain).connect(g);

    g.gain.linearRampToValueAtTime(0.24, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 1.5);
    osc2.stop(t + 1.5);
  }

  /** Nova blast / Pinch release detonation */
  nova() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Sub bass drop
    const sub = new OscillatorNode(ctx, { type: 'sine', frequency: 140 });
    sub.frequency.exponentialRampToValueAtTime(35, t + 0.6);

    const g = new GainNode(ctx, { gain: 0.35 });
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

    sub.connect(g).connect(this.master);
    sub.start(t);
    sub.stop(t + 0.75);

    // Sparkle harmonic
    const chord = [880, 1174, 1396, 1760];
    for (const f of chord) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      const og = new GainNode(ctx, { gain: 0.05 });
      og.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(og).connect(this.verb);
      o.start(t);
      o.stop(t + 1.3);
    }
  }

  /** Void hit: jarring, dissonant low impact */
  void() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const o1 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 75 });
    const o2 = new OscillatorNode(ctx, { type: 'triangle', frequency: 79 }); // Detuned dissonance

    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 320 });
    const g = new GainNode(ctx, { gain: 0.3 });
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.master);

    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.5);
    o2.stop(t + 0.5);
  }

  /** Cosmic shockwave on two-hand clap */
  shockwave() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: 220 });
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.8);

    const g = new GainNode(ctx, { gain: 0.4 });
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

    osc.connect(g).connect(this.master);
    osc.connect(this.verb);

    osc.start(t);
    osc.stop(t + 1.3);
  }

  end() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 220 });
    o.frequency.exponentialRampToValueAtTime(110, t + 2.5);
    const g = new GainNode(ctx, { gain: 0.2 });
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(g).connect(this.verb).connect(this.master);
    o.start(t);
    o.stop(t + 2.9);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }
}
