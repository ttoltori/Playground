/** Synthesized crane sounds (WebAudio, no assets). */
export class CraneAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private motors: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; base: number }[] = [];
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private alarm!: GainNode;
  private alarmT = 0;

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    // 3 motors: slew, trolley, hoist
    for (const base of [70, 110, 150]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = base;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.motors.push({ osc, gain, filter, base });
    }
    // wind
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
    // overload alarm
    const ao = c.createOscillator();
    ao.type = 'square';
    ao.frequency.value = 880;
    this.alarm = c.createGain();
    this.alarm.gain.value = 0;
    ao.connect(this.alarm);
    this.alarm.connect(this.master);
    ao.start();
  }

  resume() {
    this.ctx?.resume();
  }
  suspend(p: boolean) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }
  setMuted(m: boolean) {
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  /** speeds are normalised -1..1 */
  update(dt: number, slew: number, trolley: number, hoist: number, wind: number, height: number, overload: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = [slew, trolley, hoist];
    this.motors.forEach((m, i) => {
      const s = Math.abs(sp[i]);
      m.osc.frequency.setTargetAtTime(m.base + s * 60 + (sp[i] > 0 ? 8 : 0), t, 0.08);
      m.filter.frequency.setTargetAtTime(200 + s * 500, t, 0.08);
      m.gain.gain.setTargetAtTime(s > 0.02 ? 0.025 + s * 0.05 : 0, t, 0.12);
    });
    this.windGain.gain.setTargetAtTime(Math.min(0.2, 0.012 + wind * 0.012 + height * 0.0008), t, 0.4);
    this.windFilter.frequency.setTargetAtTime(350 + wind * 80, t, 0.4);
    if (overload) {
      this.alarmT += dt;
      this.alarm.gain.setTargetAtTime(this.alarmT % 0.5 < 0.25 ? 0.07 : 0, t, 0.005);
    } else {
      this.alarmT = 0;
      this.alarm.gain.setTargetAtTime(0, t, 0.01);
    }
  }

  private noise(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  clank() {
    this.tone(520, 0.14, 0.14, 'square');
    this.tone(780, 0.1, 0.1, 'square', 0.04);
    this.noise(0.08, 3000, 0.12, 'highpass');
  }
  release() {
    this.tone(400, 0.1, 0.1, 'square');
    this.noise(0.06, 2500, 0.08, 'highpass');
  }
  thud(power: number) {
    this.noise(0.3, 500 + power * 80, Math.min(0.8, 0.15 + power * 0.1));
    this.tone(70, 0.25, Math.min(0.5, 0.15 + power * 0.06), 'sine', 0, -35);
  }
  crash(power: number) {
    this.thud(power + 3);
    this.noise(0.5, 1800, 0.25, 'bandpass');
  }
  glass() {
    for (let i = 0; i < 7; i++) this.tone(2000 + Math.random() * 3500, 0.3, 0.06, 'sine', i * 0.03);
    this.noise(0.45, 4500, 0.3, 'highpass');
  }
  deliver(perfect: boolean) {
    const notes = perfect ? [523, 659, 784, 1046] : [523, 784];
    notes.forEach((n, i) => this.tone(n, 0.25, 0.14, 'square', i * 0.08));
  }
  radio() {
    this.noise(0.12, 2200, 0.1, 'bandpass');
    this.tone(1400, 0.05, 0.04, 'square');
  }
  warn() {
    this.tone(660, 0.12, 0.1, 'triangle');
    this.tone(660, 0.12, 0.1, 'triangle', 0.18);
  }
  countdown(go: boolean) {
    this.tone(go ? 880 : 440, go ? 0.5 : 0.2, 0.18, 'square');
  }
  fanfare() {
    [523, 659, 784, 1046, 784, 1046].forEach((n, i) => this.tone(n, 0.3, 0.14, 'square', i * 0.12));
  }

  dispose() {
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
