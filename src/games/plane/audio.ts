/** WebAudio only: wind, prop buzz, winding clicks, snap, thuds. No asset files. */
export class PAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { f: BiquadFilterNode; g: GainNode };
  private prop!: { o: OscillatorNode; o2: OscillatorNode; g: GainNode };
  private creak!: { o: OscillatorNode; g: GainNode };
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

      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 500;
      f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f);
      f.connect(g);
      g.connect(this.master);
      s.start();
      this.wind = { f, g };

      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 60;
      const o2 = c.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 30;
      const pf = c.createBiquadFilter();
      pf.type = 'lowpass';
      pf.frequency.value = 500;
      const pg = c.createGain();
      pg.gain.value = 0;
      o.connect(pf);
      o2.connect(pf);
      pf.connect(pg);
      pg.connect(this.master);
      o.start();
      o2.start();
      this.prop = { o, o2, g: pg };

      const co = c.createOscillator();
      co.type = 'triangle';
      co.frequency.value = 300;
      const cg = c.createGain();
      cg.gain.value = 0;
      co.connect(cg);
      cg.connect(this.master);
      co.start();
      this.creak = { o: co, g: cg };

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

  /** continuous: windy air rush, prop buzz, rubber creak (0..1 tension) */
  loops(airspeed: number, thrust01: number, tension: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.wind.g.gain.setTargetAtTime(Math.min(0.2, airspeed * 0.022), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + airspeed * 90, t, 0.1);
    this.prop.g.gain.setTargetAtTime(thrust01 > 0.01 ? 0.03 + thrust01 * 0.05 : 0, t, 0.08);
    this.prop.o.frequency.setTargetAtTime(40 + thrust01 * 120, t, 0.1);
    this.prop.o2.frequency.setTargetAtTime(20 + thrust01 * 60, t, 0.1);
    const cr = tension > 0.8 ? (tension - 0.8) * 0.5 : 0;
    this.creak.g.gain.setTargetAtTime(cr * 0.2, t, 0.05);
    this.creak.o.frequency.setTargetAtTime(220 + tension * 500 + Math.random() * 40, t, 0.03);
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
  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  click(pitch = 0) {
    this.tone(900 + pitch * 40, 500 + pitch * 20, 0.04, 'square', 0.07);
  }
  perfect() {
    this.tone(1200, 1500, 0.08, 'triangle', 0.12);
  }
  snap() {
    this.burst(0.12, 3500, 0.9, 'highpass');
    this.tone(180, 50, 0.35, 'sawtooth', 0.3, 0.05);
    this.tone(90, 40, 0.3, 'square', 0.25, 0.12);
  }
  launch() {
    this.burst(0.35, 1400, 0.35, 'bandpass');
    this.tone(300, 700, 0.25, 'sine', 0.12);
  }
  thud() {
    this.burst(0.25, 500, 0.4);
    this.tone(120, 50, 0.2, 'sine', 0.35);
  }
  rustle() {
    this.burst(0.6, 2500, 0.3, 'bandpass');
    this.burst(0.4, 1500, 0.2, 'bandpass', 0.2);
  }
  coo() {
    this.tone(420, 300, 0.12, 'triangle', 0.1);
    this.tone(430, 280, 0.15, 'triangle', 0.1, 0.14);
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
  beep() {
    this.tone(700, 700, 0.07, 'square', 0.1);
  }
  dispose() {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
