export interface Ctl {
  thrSet: number | null; // absolute engine-telegraph request (touch stick), null = leave as is
  thrDelta: number; // -1..1 ramp request (keyboard)
  stop: boolean; // edge: all stop
  rudder: number; // + = right (starboard)
  port: boolean; // fire port broadside (held)
  stbd: boolean; // fire starboard broadside (held)
  torp: boolean; // edge
  wind: boolean; // held: re-wind the rubber band
  pump: boolean; // held: pump out flood water
  cam: boolean; // edge
  assist: boolean; // touch aim-assist: held fire buttons wait for a level roll
}
export interface ControlSource { read(): Ctl; dispose(): void }
export const emptyCtl = (): Ctl => ({ thrSet: null, thrDelta: 0, stop: false, rudder: 0, port: false, stbd: false, torp: false, wind: false, pump: false, cam: false, assist: false });
const dz = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : v);

export class KeyboardControls implements ControlSource {
  private down = new Set<string>();
  private was = { torp: false, cam: false, stop: false };
  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  private onUp = (e: KeyboardEvent) => this.down.delete(e.code);
  private onBlur = () => this.down.clear();
  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  read(): Ctl {
    const k = (...c: string[]) => (c.some((x) => this.down.has(x)) ? 1 : 0);
    const s = emptyCtl();
    s.thrDelta = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    s.rudder = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    s.port = !!k('KeyQ');
    s.stbd = !!k('KeyE');
    s.wind = !!k('KeyR');
    s.pump = !!k('KeyF');
    const torp = !!k('Space');
    const cam = !!k('KeyC', 'KeyV');
    const stop = !!k('KeyX');
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const a = gp.axes;
      if (dz(a[1] ?? 0)) s.thrDelta = -dz(a[1]);
      if (dz(a[0] ?? 0)) s.rudder = dz(a[0]);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      s.port ||= b(4);
      s.stbd ||= b(5);
    }
    s.torp = torp && !this.was.torp;
    s.cam = cam && !this.was.cam;
    s.stop = stop && !this.was.stop;
    this.was = { torp, cam, stop };
    return s;
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Landscape phone layout: left stick = engine telegraph (↕, latches when you let go) + rudder (↔); right cluster = guns / torpedo / wind / pump / camera. */
export class TouchControls implements ControlSource {
  private root: HTMLDivElement;
  private kb = new KeyboardControls();
  private st = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Set<string>();
  private edge = new Set<string>();

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'sh-touch';
    root.innerHTML = `
      <div class="sh-zone"><div class="sh-base"><div class="sh-knob"></div></div><span class="sh-lbl">⚙ 위=전진 아래=후진 좌우=방향타<br>손을 떼도 속도 유지</span></div>
      <div class="sh-btns">
        <div class="sh-row sm">
          <button data-b="stop" class="tb sm">⏹<small>정지</small></button>
          <button data-b="pump" class="tb sm">🪣<small>펌프</small></button>
          <button data-b="wind" class="tb sm">🔄<small>감기</small></button>
          <button data-b="cam" class="tb sm">🎥<small>시점</small></button>
        </div>
        <div class="sh-row">
          <button data-b="port" class="tb gun">◀<small>좌현</small></button>
          <button data-b="stbd" class="tb gun">▶<small>우현</small></button>
          <button data-b="torp" class="tb torp">🚀<small>어뢰</small></button>
        </div>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    const zone = root.querySelector('.sh-zone') as HTMLDivElement;
    const base = zone.querySelector('.sh-base') as HTMLDivElement;
    const knob = zone.querySelector('.sh-knob') as HTMLDivElement;
    const R = 52;
    const st = this.st;
    zone.addEventListener('pointerdown', (e) => {
      if (st.id !== -1) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      st.id = e.pointerId;
      st.ox = e.clientX;
      st.oy = e.clientY;
      st.x = st.y = 0;
      const r = zone.getBoundingClientRect();
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      base.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== st.id) return;
      let dx = e.clientX - st.ox;
      let dy = e.clientY - st.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      st.x = dx / R;
      st.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== st.id) return;
      st.id = -1;
      st.x = st.y = 0;
      knob.style.transform = '';
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    root.querySelectorAll<HTMLButtonElement>('.tb').forEach((b) => {
      const name = b.dataset.b!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.edge.add(name);
        this.held.add(name);
        b.classList.add('on');
      });
      const up = () => {
        this.held.delete(name);
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  read(): Ctl {
    const s = this.kb.read();
    s.assist = true;
    const l = this.st;
    if (l.id !== -1) {
      s.rudder = dz(l.x, 0.1);
      const v = -l.y;
      if (Math.abs(v) > 0.3) s.thrSet = v > 0 ? Math.min(1, (v - 0.2) * 1.25) : Math.max(-0.5, v * 0.7);
    }
    if (this.held.has('port')) s.port = true;
    if (this.held.has('stbd')) s.stbd = true;
    if (this.held.has('wind')) s.wind = true;
    if (this.held.has('pump')) s.pump = true;
    if (this.edge.has('torp')) s.torp = true;
    if (this.edge.has('cam')) s.cam = true;
    if (this.edge.has('stop')) s.stop = true;
    this.edge.clear();
    return s;
  }
  dispose() {
    this.kb.dispose();
    this.root.remove();
  }
}
