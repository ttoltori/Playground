/** WebAudio only: engine, hydraulics, dirt, horns, crashes. No asset files. */
export class XAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng!: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private hyd!: { o: OscillatorNode; g: GainNode };
  private rumble!: { f: BiquadFilterNode; g: GainNode };
  private scrape!: { f: BiquadFilterNode; g: GainNode };
  private beep!: GainNode;
  private noise!: AudioBuffer;
  private beepPhase = 0;
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

      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = c.createGain();
      g.gain.value = 0.07;
      const o1 = c.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 38;
      const o2 = c.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 19;
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this.master);
      o1.start();
      o2.start();
      this.eng = { o1, o2, f, g };

      const ho = c.createOscillator();
      ho.type = 'triangle';
      ho.frequency.value = 300;
      const hg = c.createGain();
      hg.gain.value = 0;
      ho.connect(hg);
      hg.connect(this.master);
      ho.start();
      this.hyd = { o: ho, g: hg };

      this.rumble = this.loopNoise('lowpass', 160, 0);
      this.scrape = this.loopNoise('bandpass', 700, 0);

      const bo = c.createOscillator();
      bo.type = 'square';
      bo.frequency.value = 1100;
      this.beep = c.createGain();
      this.beep.gain.value = 0;
      bo.connect(this.beep);
      this.beep.connect(this.master);
      bo.start();
    } catch {
      this.ctx = null;
    }
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  private loopNoise(type: BiquadFilterType, freq: number, gain: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start();
    return { f, g };
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.5;
  }

  /** activity 0..1 (any control), joint 0..1 (arm motion), track 0..1, dig 0..1, reversing */
  update(dt: number, activity: number, joint: number, track: number, dig: number, reversing: boolean) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const rpm = 36 + activity * 22 + track * 10;
    this.eng.o1.frequency.setTargetAtTime(rpm, t, 0.1);
    this.eng.o2.frequency.setTargetAtTime(rpm / 2, t, 0.1);
    this.eng.f.frequency.setTargetAtTime(300 + activity * 300, t, 0.1);
    this.eng.g.gain.setTargetAtTime(0.06 + activity * 0.05, t, 0.1);
    this.hyd.g.gain.setTargetAtTime(joint * 0.035, t, 0.05);
    this.hyd.o.frequency.setTargetAtTime(240 + joint * 160, t, 0.08);
    this.rumble.g.gain.setTargetAtTime(track * 0.22, t, 0.08);
    this.scrape.g.gain.setTargetAtTime(dig * 0.25, t, 0.05);
    if (reversing) {
      this.beepPhase += dt;
      this.beep.gain.setTargetAtTime(this.beepPhase % 1 < 0.5 ? 0.04 : 0, t, 0.005);
    } else this.beep.gain.setTargetAtTime(0, t, 0.02);
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

  crash() {
    this.burst(0.5, 1800, 0.7);
    this.tone(120, 40, 0.4, 'square', 0.35);
  }
  bump() {
    this.tone(90, 50, 0.15, 'square', 0.2);
  }
  thud() {
    this.burst(0.3, 400, 0.4);
    this.tone(110, 45, 0.25, 'sine', 0.4);
  }
  ding() {
    this.tone(880, 880, 0.25, 'sine', 0.22);
    this.tone(1320, 1320, 0.35, 'sine', 0.2, 0.1);
  }
  good() {
    this.tone(660, 660, 0.12, 'triangle', 0.2);
    this.tone(990, 990, 0.2, 'triangle', 0.2, 0.09);
  }
  horn() {
    this.tone(220, 220, 0.7, 'sawtooth', 0.14);
    this.tone(277, 277, 0.7, 'sawtooth', 0.12);
  }
  hiss() {
    this.burst(1.0, 5000, 0.5, 'highpass');
  }
  spill() {
    this.burst(0.25, 900, 0.18, 'bandpass');
  }

  dispose() {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
