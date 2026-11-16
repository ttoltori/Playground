/** All sounds are synthesized with WebAudio – no asset downloads. */
export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engines: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }[] = [];
  private beepers: { osc: OscillatorNode; gain: GainNode; phase: number }[] = [];
  private horns: { o1: OscillatorNode; o2: OscillatorNode; gain: GainNode }[] = [];
  private hydraulics: { osc: OscillatorNode; gain: GainNode }[] = [];
  muted = false;

  init(players: number) {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    for (let i = 0; i < players; i++) {
      const c = this.ctx;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = c.createOscillator();
      osc2.type = 'square';
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc2.start();
      this.engines.push({ osc, osc2, gain, filter });

      const b = c.createOscillator();
      b.type = 'square';
      b.frequency.value = 1150;
      const bg = c.createGain();
      bg.gain.value = 0;
      b.connect(bg);
      bg.connect(this.master);
      b.start();
      this.beepers.push({ osc: b, gain: bg, phase: 0 });

      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = 'square';
      o2.type = 'square';
      o1.frequency.value = 370;
      o2.frequency.value = 466;
      const hg = c.createGain();
      hg.gain.value = 0;
      o1.connect(hg);
      o2.connect(hg);
      hg.connect(this.master);
      o1.start();
      o2.start();
      this.horns.push({ o1, o2, gain: hg });

      const h = c.createOscillator();
      h.type = 'triangle';
      h.frequency.value = 180;
      const hgain = c.createGain();
      hgain.gain.value = 0;
      h.connect(hgain);
      hgain.connect(this.master);
      h.start();
      this.hydraulics.push({ osc: h, gain: hgain });
    }
  }

  resume() {
    this.ctx?.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  update(i: number, dt: number, speed: number, throttle: number, reversing: boolean, horn: boolean, lifting: number, volume = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = this.engines[i];
    if (e) {
      const rpm = 55 + Math.abs(speed) * 9 + Math.abs(throttle) * 25;
      e.osc.frequency.setTargetAtTime(rpm, t, 0.05);
      e.osc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
      e.filter.frequency.setTargetAtTime(300 + Math.abs(throttle) * 600 + Math.abs(speed) * 40, t, 0.05);
      e.gain.gain.setTargetAtTime(0.06 * volume + Math.abs(throttle) * 0.05 * volume, t, 0.1);
    }
    const b = this.beepers[i];
    if (b) {
      if (reversing) {
        b.phase += dt;
        const on = b.phase % 1.0 < 0.5;
        b.gain.gain.setTargetAtTime(on ? 0.05 * volume : 0, t, 0.005);
      } else {
        b.phase = 0;
        b.gain.gain.setTargetAtTime(0, t, 0.01);
      }
    }
    const h = this.horns[i];
    if (h) h.gain.gain.setTargetAtTime(horn ? 0.08 * volume : 0, t, 0.01);
    const hy = this.hydraulics[i];
    if (hy) {
      hy.gain.gain.setTargetAtTime(lifting ? 0.04 * volume : 0, t, 0.05);
      hy.osc.frequency.setTargetAtTime(lifting > 0 ? 210 : 150, t, 0.1);
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

  crash(power: number) {
    this.noise(0.35, 900, Math.min(0.9, 0.2 + power * 0.08));
    this.tone(80, 0.3, 0.3, 'sine', 0, -40);
  }
  clank() {
    this.tone(620, 0.15, 0.12, 'square');
    this.tone(930, 0.12, 0.08, 'square', 0.03);
  }
  cone() {
    this.tone(300, 0.12, 0.15, 'triangle', 0, -150);
  }
  glass() {
    for (let i = 0; i < 6; i++) this.tone(2000 + Math.random() * 3000, 0.25, 0.06, 'sine', i * 0.03);
    this.noise(0.4, 4000, 0.3, 'highpass');
  }
  deliver(perfect: boolean) {
    const notes = perfect ? [523, 659, 784, 1046] : [523, 784];
    notes.forEach((n, i) => this.tone(n, 0.25, 0.15, 'square', i * 0.08));
  }
  pickup() {
    this.tone(440, 0.08, 0.1, 'square');
    this.tone(660, 0.1, 0.1, 'square', 0.06);
  }
  countdown(go: boolean) {
    this.tone(go ? 880 : 440, go ? 0.5 : 0.2, 0.2, 'square');
  }
  whoosh() {
    this.noise(0.5, 1200, 0.25, 'bandpass');
  }
  fanfare() {
    [523, 659, 784, 1046, 784, 1046].forEach((n, i) => this.tone(n, 0.3, 0.15, 'square', i * 0.12));
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
