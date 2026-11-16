/** WebAudio only: motor whine, beeps, crash, cheers. No asset files. */
export class MAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng!: { o: OscillatorNode; o2: OscillatorNode; g: GainNode };
  private noise!: AudioBuffer;
  muted = false;
  private unlock = () => this.ctx?.resume();

  constructor() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(c.destination);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 200;
      const o2 = c.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 100;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this.master);
      o.start();
      o2.start();
      this.eng = { o, o2, g };
      window.addEventListener('pointerdown', this.unlock);
      window.addEventListener('keydown', this.unlock);
    } catch {
      this.ctx = null;
    }
  }

  /** v in 0..~18 u/s; on=false silences the motor */
  motor(v: number, on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eng.o.frequency.setTargetAtTime(160 + v * 55, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(80 + v * 27, t, 0.05);
    this.eng.g.gain.setTargetAtTime(on && !this.muted ? 0.035 + Math.min(0.03, v * 0.002) : 0, t, 0.08);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, slide = 0) {
    const c = this.ctx;
    if (!c || this.muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  private burst(dur: number, freq: number, vol: number) {
    const c = this.ctx;
    if (!c || this.muted) return;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start();
    s.stop(c.currentTime + dur + 0.02);
  }

  beep(go = false) {
    this.tone(go ? 1040 : 640, go ? 0.45 : 0.16, 'square', 0.14);
  }
  click() {
    this.tone(520, 0.05, 'triangle', 0.1);
  }
  crash() {
    this.burst(0.5, 900, 0.5);
    this.tone(140, 0.4, 'sawtooth', 0.2, -90);
  }
  thud() {
    this.burst(0.15, 300, 0.3);
    this.tone(90, 0.12, 'sine', 0.25, -40);
  }
  cheer() {
    [0, 80, 160].forEach((d, i) => setTimeout(() => this.tone(700 + i * 160 + Math.random() * 60, 0.18, 'triangle', 0.12, 220), d));
  }
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'square', 0.1), i * 110));
  }
  sad() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.14), i * 180));
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m && this.ctx) this.eng.g.gain.value = 0;
  }
  suspend(s: boolean) {
    if (!this.ctx) return;
    if (s) void this.ctx.suspend();
    else void this.ctx.resume();
  }
  dispose() {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    try {
      this.eng?.o.stop();
      this.eng?.o2.stop();
    } catch {
      /* already stopped */
    }
    void this.ctx?.close();
  }
}
