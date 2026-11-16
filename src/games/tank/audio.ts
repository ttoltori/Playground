/** All sounds are synthesized with WebAudio – no asset downloads. */
export class TankAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motor!: { o1: OscillatorNode; o2: OscillatorNode; filt: BiquadFilterNode; gain: GainNode };
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
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    const gain = c.createGain();
    gain.gain.value = 0;
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(gain);
    gain.connect(this.master);
    o1.start();
    o2.start();
    this.motor = { o1, o2, filt, gain };
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.5;
  }

  /** speed01: 0..1 average track speed; turning: pivot amount; battery01 */
  update(speed01: number, turning: number, turretMove: number, battery01: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.motor;
    const f = 70 + speed01 * 80 + turning * 40 + turretMove * 20;
    m.o1.frequency.setTargetAtTime(f * (0.6 + 0.4 * battery01), t, 0.08);
    m.o2.frequency.setTargetAtTime(f * 3.02, t, 0.08);
    m.filt.frequency.setTargetAtTime(350 + speed01 * 700 + turning * 300, t, 0.08);
    m.gain.gain.setTargetAtTime(Math.min(0.1, 0.012 + speed01 * 0.05 + turning * 0.04 + turretMove * 0.02), t, 0.1);
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
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(power: boolean, far = 0) {
    const v = far ? 0.25 / (1 + far * 0.05) : 0.5;
    this.noise(0.18, power ? 900 : 1400, v, 'lowpass');
    this.tone(power ? 120 : 190, 0.14, 0.3 * v * 2, 'square', 0, -90);
    this.tone(1800, 0.05, 0.08 * v * 2, 'square');
  }
  boom(big = false) {
    this.noise(big ? 0.9 : 0.45, big ? 500 : 800, big ? 0.7 : 0.45);
    this.tone(big ? 70 : 100, big ? 0.6 : 0.3, 0.3, 'sawtooth', 0, -40);
  }
  clack(heavy = false) {
    this.noise(0.07, heavy ? 2400 : 3500, heavy ? 0.5 : 0.3, 'bandpass');
    this.tone(heavy ? 420 : 700, 0.05, 0.12, 'square');
  }
  ping() {
    this.noise(0.1, 4200, 0.25, 'highpass');
    this.tone(2400, 0.2, 0.1, 'sine', 0, -600);
  }
  pick() {
    this.tone(660, 0.1, 0.18, 'square');
    this.tone(990, 0.16, 0.18, 'square', 0.08);
  }
  marble() {
    this.tone(1500 + Math.random() * 300, 0.06, 0.1, 'sine');
  }
  empty() {
    this.tone(180, 0.06, 0.12, 'square');
  }
  radio() {
    this.noise(0.1, 1800, 0.12, 'bandpass');
    this.tone(900, 0.05, 0.05, 'square');
  }
  meow() {
    this.tone(520, 0.35, 0.2, 'triangle', 0, 400);
    this.tone(900, 0.25, 0.16, 'triangle', 0.2, -500);
  }
  bell() {
    for (let i = 0; i < 3; i++) this.tone([784, 659, 523][i], 0.4, 0.2, 'sine', i * 0.28);
  }
  flip() {
    this.noise(0.25, 600, 0.4);
    this.tone(160, 0.2, 0.2, 'sawtooth', 0, -60);
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
      this.motor?.o1.stop();
      this.motor?.o2.stop();
    } catch { /* already stopped */ }
    this.ctx?.close();
    this.ctx = null;
  }
}
