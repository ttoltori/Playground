/** WebAudio only (no asset files): pump chuff, valve hiss, 펑!, launch whoosh, chute, splash, cheers. */
export class RAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private air!: { f: BiquadFilterNode; g: GainNode };
  private hiss!: { f: BiquadFilterNode; g: GainNode };
  muted = false;
  private unlock = () => this.ctx?.resume();

  constructor() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(c.destination);
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const loop = (freq: number, q: number) => {
        const s = c.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = c.createGain();
        g.gain.value = 0;
        s.connect(f);
        f.connect(g);
        g.connect(this.master);
        s.start();
        return { f, g };
      };
      this.air = loop(500, 0.6); // wind / air rush in flight
      this.hiss = loop(5000, 1.2); // valve hiss
      window.addEventListener('pointerdown', this.unlock);
      window.addEventListener('keydown', this.unlock);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.5;
  }

  /** continuous loops: airspeed (m/s) rush and valve hiss 0..1 */
  loops(airspeed: number, hiss: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.air.g.gain.setTargetAtTime(Math.min(0.22, airspeed * 0.006), t, 0.1);
    this.air.f.frequency.setTargetAtTime(250 + airspeed * 40, t, 0.1);
    this.hiss.g.gain.setTargetAtTime(hiss * 0.12, t, 0.04);
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0, sweepTo = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  pump(pitch = 0) {
    this.burst(0.09, 1800 + pitch * 20, 0.22, 'bandpass');
    this.tone(140 + pitch * 2, 90, 0.07, 'sine', 0.12);
  }
  beep() {
    this.tone(700, 700, 0.07, 'square', 0.09);
  }
  tick() {
    this.tone(1000, 800, 0.03, 'square', 0.05);
  }
  warn() {
    this.tone(880, 880, 0.08, 'square', 0.08);
  }
  pop() {
    this.burst(0.35, 1200, 0.9, 'lowpass', 0, 200);
    this.tone(160, 40, 0.3, 'sine', 0.5);
    this.burst(0.5, 3000, 0.3, 'highpass', 0.05);
  }
  launch() {
    this.burst(0.5, 2500, 0.55, 'bandpass', 0, 600);
    this.tone(220, 900, 0.3, 'sawtooth', 0.12);
    this.burst(0.15, 800, 0.5);
  }
  chute() {
    this.burst(0.25, 700, 0.4, 'bandpass', 0, 1800);
    this.tone(300, 200, 0.2, 'triangle', 0.1);
  }
  rip() {
    this.burst(0.25, 3500, 0.5, 'highpass');
  }
  thud() {
    this.burst(0.25, 500, 0.45);
    this.tone(120, 50, 0.2, 'sine', 0.4);
  }
  splash() {
    this.burst(0.7, 2200, 0.5, 'bandpass', 0, 600);
    this.tone(500, 200, 0.25, 'sine', 0.2, 0.05);
  }
  bonk() {
    this.tone(220, 80, 0.2, 'square', 0.25);
    this.burst(0.1, 900, 0.4);
  }
  good() {
    this.tone(660, 660, 0.12, 'triangle', 0.2);
    this.tone(990, 990, 0.2, 'triangle', 0.2, 0.09);
    this.tone(1320, 1320, 0.3, 'triangle', 0.18, 0.2);
  }
  cheer() {
    for (let i = 0; i < 4; i++) this.burst(0.5, 1800 + i * 300, 0.12, 'bandpass', i * 0.06);
  }
  dispose() {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
