/**
 * Procedural Web Audio for the whole arcade. No audio files: everything is synthesised.
 *
 * One AudioContext, one master bus through a compressor, a shared reverb, and a pad whose chord changes per game.
 * Noise buffers are made once and reused; every voice stops itself so nodes are garbage-collected.
 */
const PENTA = [0, 2, 4, 7, 9];

export type PadTheme = 'hub' | 'cosmic' | 'synth' | 'dojo';

const PADS: Record<PadTheme, { freqs: number[]; cutoff: number; gain: number }> = {
  hub: { freqs: [130.81, 196.0, 261.63, 329.63], cutoff: 520, gain: 0.32 },
  cosmic: { freqs: [146.83, 220.0, 293.66, 369.99], cutoff: 650, gain: 0.45 },
  synth: { freqs: [110.0, 164.81, 220.0, 261.63], cutoff: 900, gain: 0.34 },
  dojo: { freqs: [146.83, 174.61, 220.0, 293.66], cutoff: 560, gain: 0.3 },
};

const MASTER = 0.55;

export class Sound {
  ctx: AudioContext | null = null;
  muted = false;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padOsc: OscillatorNode[] = [];
  private noise!: AudioBuffer;
  private theme: PadTheme = 'hub';
  private lastSlash = 0;

  /** Must be called from a user gesture the first time (browsers block audio before one). */
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
    this.master = new GainNode(ctx, { gain: this.muted ? 0 : MASTER });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -18, knee: 12, ratio: 5, attack: 0.003, release: 0.25 });
    this.master.connect(comp).connect(ctx.destination);

    this.verb = new ConvolverNode(ctx, { buffer: this.reverbBuffer(2.4) });
    this.verb.connect(new GainNode(ctx, { gain: 0.3 })).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.buildPad();
    this.setTheme(this.theme);
  }

  private reverbBuffer(secs: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    }
    return b;
  }

  private buildPad() {
    const ctx = this.ctx!;
    this.padGain = new GainNode(ctx, { gain: 0 });
    this.padFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 600, Q: 0.5 });
    this.padGain.connect(this.padFilter).connect(this.master);
    this.padFilter.connect(this.verb);
    for (let i = 0; i < 4; i++) {
      const osc = new OscillatorNode(ctx, { type: i % 2 === 0 ? 'sine' : 'triangle', frequency: 110, detune: (i - 1.5) * 4 });
      osc.connect(new GainNode(ctx, { gain: 0.045 })).connect(this.padGain);
      osc.start();
      this.padOsc.push(osc);
    }
  }

  /** Crossfades the background pad to another game's chord. */
  setTheme(theme: PadTheme) {
    this.theme = theme;
    const ctx = this.ctx;
    if (!ctx || !this.padGain || !this.padFilter) return;
    const t = ctx.currentTime;
    const p = PADS[theme];
    this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(p.freqs[i], t, 0.6));
    this.padFilter.frequency.setTargetAtTime(p.cutoff, t, 0.8);
    this.padGain.gain.setTargetAtTime(p.gain, t, 1.2);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ building blocks
  private get live() {
    return !!this.ctx && !this.muted;
  }

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1.5, wet = false, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noise });
    const f = new BiquadFilterNode(ctx, { type, frequency: f0, Q: q });
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    if (wet) g.connect(this.verb);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, wet = false, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = new OscillatorNode(ctx, { type, frequency: f0 });
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    if (wet) g.connect(this.verb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chime(freq: number, gain: number, dur = 1.2, delay = 0) {
    this.tone('sine', freq, freq, dur, gain, true, delay);
    this.tone('sine', freq * 2, freq * 2, dur * 0.6, gain * 0.35, true, delay);
  }

  // ------------------------------------------------------------------ shared UI
  uiHover() {
    if (!this.live) return;
    this.tone('sine', 880, 880, 0.08, 0.05);
  }
  uiSelect() {
    if (!this.live) return;
    this.chime(659.25, 0.12, 0.5);
    this.chime(987.77, 0.08, 0.6, 0.06);
  }
  countdown(final = false) {
    if (!this.live) return;
    this.tone('square', final ? 1046.5 : 523.25, final ? 1046.5 : 523.25, final ? 0.35 : 0.12, 0.06);
  }
  tick() {
    if (!this.live) return;
    this.tone('sine', 1500, 1500, 0.05, 0.08);
  }
  end() {
    if (!this.live) return;
    this.tone('sine', 220, 110, 2.6, 0.2, true);
  }
  fanfare() {
    if (!this.live) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.chime(f, 0.13, 1.0, i * 0.09));
  }

  // ------------------------------------------------------------------ blade games
  /** Blade whoosh, throttled so a fast hand doesn't machine-gun it. */
  slash(intensity = 1) {
    if (!this.live) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastSlash < 0.16) return;
    this.lastSlash = now;
    this.noiseBurst(0.16, 'bandpass', 2400 + Math.random() * 600, 500, 0.12 * intensity, 1.8);
  }

  /** Starfall crystal chime: pitch climbs the pentatonic scale with the combo. */
  slice(combo: number, kind: 'crystal' | 'prism' | 'gold' | 'star') {
    if (!this.live) return;
    const step = Math.min(combo - 1, 14);
    const semis = PENTA[step % 5] + Math.floor(step / 5) * 12 + (kind === 'gold' ? 7 : kind === 'star' ? 12 : 0);
    const f = 523.25 * Math.pow(2, semis / 12);
    this.chime(f, 0.2, 1.3);
    if (kind === 'gold') this.tone('triangle', f * 2, f * 2, 0.6, 0.06, true);
  }

  nova() {
    if (!this.live) return;
    this.tone('sine', 140, 35, 0.7, 0.35);
    for (const f of [880, 1174, 1396, 1760]) this.tone('sine', f, f, 1.2, 0.05, true);
  }

  void() {
    if (!this.live) return;
    this.tone('sawtooth', 75, 60, 0.45, 0.22);
    this.tone('triangle', 79, 62, 0.45, 0.22);
  }

  shockwave() {
    if (!this.live) return;
    this.tone('triangle', 220, 55, 1.2, 0.38, true);
    this.noiseBurst(0.9, 'lowpass', 3000, 120, 0.2, 0.7, true);
  }

  /** Fruit: wet squelch + crunch, brighter for bigger combos. */
  splat(combo = 1) {
    if (!this.live) return;
    this.noiseBurst(0.18, 'lowpass', 1800, 300, 0.24, 2.5);
    this.noiseBurst(0.07, 'highpass', 4000, 2500, 0.08, 1);
    this.tone('sine', 260 + combo * 30, 120, 0.12, 0.1);
  }

  comboChime(n: number) {
    if (!this.live) return;
    for (let i = 0; i < Math.min(n, 6); i++) this.chime(523.25 * Math.pow(2, PENTA[i % 5] / 12 + Math.floor(i / 5)), 0.09, 0.7, i * 0.06);
  }

  launch() {
    if (!this.live) return;
    this.noiseBurst(0.22, 'bandpass', 300, 900, 0.05, 1.2);
  }

  fuse() {
    if (!this.live) return;
    this.noiseBurst(0.3, 'highpass', 6000, 5000, 0.03, 0.8);
  }

  explosion(size = 1) {
    if (!this.live) return;
    this.tone('sine', 120 * (1.2 - size * 0.2), 30, 0.6 + size * 0.4, 0.4 * Math.min(1.2, size));
    this.noiseBurst(0.5 + size * 0.6, 'lowpass', 2500, 80, 0.3 * Math.min(1.2, size), 0.8, true);
  }

  lifeLost() {
    if (!this.live) return;
    this.tone('square', 330, 165, 0.35, 0.07);
    this.tone('square', 247, 123, 0.45, 0.06, false, 0.12);
  }

  powerup() {
    if (!this.live) return;
    [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.08, true, i * 0.05));
  }

  freeze() {
    if (!this.live) return;
    this.noiseBurst(1.2, 'bandpass', 8000, 2000, 0.08, 6, true);
    [1318.5, 1760, 2093].forEach((f, i) => this.chime(f, 0.06, 1.4, i * 0.08));
  }

  // ------------------------------------------------------------------ shooter
  gunshot(rapid = false) {
    if (!this.live) return;
    this.noiseBurst(rapid ? 0.08 : 0.14, 'bandpass', 3200, 600, rapid ? 0.12 : 0.18, 0.9);
    this.tone('square', rapid ? 900 : 700, 120, rapid ? 0.06 : 0.1, rapid ? 0.05 : 0.08);
    this.tone('sine', 160, 50, 0.12, 0.18);
  }

  hit() {
    if (!this.live) return;
    this.tone('triangle', 1800, 1400, 0.05, 0.08);
  }

  emptyClick() {
    if (!this.live) return;
    this.noiseBurst(0.03, 'highpass', 3500, 3000, 0.12, 2);
  }

  reload() {
    if (!this.live) return;
    this.noiseBurst(0.06, 'bandpass', 1800, 1200, 0.15, 4);
    this.noiseBurst(0.08, 'bandpass', 900, 700, 0.18, 4, false, 0.42);
    this.tone('square', 220, 330, 0.06, 0.05, false, 0.45);
  }

  damage() {
    if (!this.live) return;
    this.tone('sawtooth', 110, 40, 0.5, 0.25);
    this.noiseBurst(0.35, 'lowpass', 1200, 100, 0.25, 1);
  }

  alarm() {
    if (!this.live) return;
    for (let i = 0; i < 3; i++) this.tone('square', 660, 440, 0.22, 0.05, false, i * 0.28);
  }

  waveStart() {
    if (!this.live) return;
    this.tone('sawtooth', 110, 220, 0.6, 0.06, true);
    this.chime(440, 0.08, 0.8, 0.1);
    this.chime(659.25, 0.08, 0.9, 0.25);
  }
}
