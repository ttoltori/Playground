/** All sounds are synthesized with WebAudio – no asset downloads. */
export class ShipAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng!: { o1: OscillatorNode; o2: OscillatorNode; filt: BiquadFilterNode; gain: GainNode };
  private water!: { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode };
  muted = false;
  private unlock = () => this.ctx?.resume();

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(c.destination);
    // little rubber-band/electric motor whine
    const o1 = c.createOscillator();
    o1.type = 'triangle';
    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;
    const gain = c.createGain();
    gain.gain.value = 0;
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(gain);
    gain.connect(this.master);
    o1.start();
    o2.start();
    this.eng = { o1, o2, filt, gain };
    // water lapping: looped filtered noise
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 400;
    const wg = c.createGain();
    wg.gain.value = 0.03;
    src.connect(wf);
    wf.connect(wg);
    wg.connect(this.master);
    src.start();
    this.water = { src, filt: wf, gain: wg };
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.5;
  }

  /** speed01 0..1, wind01 0..1 (motor weakens as the band unwinds), swirl 0..1 (drain gurgle) */
  update(speed01: number, wind01: number, swirl: number, winding: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = this.eng;
    const f = 90 + speed01 * 120;
    e.o1.frequency.setTargetAtTime(f * (0.6 + 0.4 * wind01), t, 0.15);
    e.o2.frequency.setTargetAtTime(f * 1.5 * (0.6 + 0.4 * wind01), t, 0.15);
    e.filt.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.1);
    e.gain.gain.setTargetAtTime(winding ? 0 : Math.min(0.05, speed01 * 0.05), t, 0.15);
    this.water.filt.frequency.setTargetAtTime(300 + speed01 * 500 + swirl * 500, t, 0.2);
    this.water.gain.gain.setTargetAtTime(0.025 + speed01 * 0.04 + swirl * 0.06, t, 0.2);
  }

  private noise(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0) {
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
    src.start(c.currentTime + delay);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  gun(big = false, far = 0) {
    const v = (big ? 0.6 : 0.4) / (1 + far * 0.04);
    this.noise(big ? 0.5 : 0.25, big ? 600 : 1100, v);
    this.tone(big ? 90 : 140, 0.2, 0.3 * v * 2, 'square', 0, -60);
  }
  splash(far = 0) {
    this.noise(0.35, 1800, 0.22 / (1 + far * 0.05), 'bandpass');
  }
  hit(big = false) {
    this.noise(big ? 0.6 : 0.3, big ? 500 : 900, big ? 0.6 : 0.4);
    this.tone(big ? 70 : 110, 0.25, 0.25, 'sawtooth', 0, -40);
    this.noise(0.12, 3000, 0.25, 'highpass', 0.04); // plastic crack
  }
  torp() {
    this.tone(260, 0.18, 0.2, 'triangle', 0, 500); // spring boing
    this.tone(700, 0.3, 0.1, 'sine', 0.05, -300);
    this.noise(0.4, 900, 0.2, 'bandpass', 0.05);
  }
  ratchet() {
    this.noise(0.04, 3200, 0.22, 'bandpass');
    this.tone(520 + Math.random() * 80, 0.03, 0.08, 'square');
  }
  pump() {
    this.noise(0.12, 700, 0.2, 'bandpass');
    this.tone(150, 0.08, 0.1, 'sine', 0, -40);
  }
  pick() {
    this.tone(660, 0.1, 0.18, 'square');
    this.tone(990, 0.16, 0.18, 'square', 0.08);
  }
  duck() {
    this.tone(1100, 0.12, 0.2, 'square', 0, 500);
    this.tone(1500, 0.08, 0.15, 'square', 0.1, -300);
  }
  radio() {
    this.noise(0.1, 1800, 0.12, 'bandpass');
    this.tone(900, 0.05, 0.05, 'square');
  }
  bell() {
    for (let i = 0; i < 3; i++) this.tone([880, 660, 880][i], 0.25, 0.18, 'sine', i * 0.2);
  }
  pour() {
    this.noise(1.2, 700, 0.5, 'lowpass');
  }
  sink() {
    this.noise(1.6, 400, 0.4);
    for (let i = 0; i < 6; i++) this.tone(300 + i * 40, 0.12, 0.1, 'sine', i * 0.2, 200);
  }
  drip() {
    this.tone(1400, 0.06, 0.08, 'sine', 0, -500);
  }
  empty() {
    this.tone(180, 0.06, 0.12, 'square');
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 0.2, 'square', i * 0.12));
  }
  lose() {
    [392, 311, 233, 156].forEach((f, i) => this.tone(f, 0.35, 0.2, 'sawtooth', i * 0.18));
  }

  dispose() {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    try {
      this.eng?.o1.stop();
      this.eng?.o2.stop();
      this.water?.src.stop();
    } catch { /* already stopped */ }
    this.ctx?.close();
    this.ctx = null;
  }
}
