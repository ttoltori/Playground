export interface Ctl {
  drive: number; // tracks: + forward
  steer: number; // + right
  swing: number; // + counter-clockwise (left)
  boom: number; // + up
  stick: number; // + extend out
  curl: number; // + curl in (scoop)
  slow: boolean;
  cam: boolean; // edge-triggered
}
export interface ControlSource { read(): Ctl; dispose(): void }

export const emptyCtl = (): Ctl => ({ drive: 0, steer: 0, swing: 0, boom: 0, stick: 0, curl: 0, slow: false, cam: false });
const dz = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : v);

export class KeyboardControls implements ControlSource {
  private down = new Set<string>();
  private camWas = false;
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
    s.drive = k('KeyW') - k('KeyS');
    s.steer = k('KeyD') - k('KeyA');
    s.swing = k('KeyQ') - k('KeyE');
    s.boom = k('ArrowUp', 'KeyR') - k('ArrowDown', 'KeyF');
    s.stick = k('ArrowRight') - k('ArrowLeft');
    s.curl = k('KeyZ') - k('KeyX', 'Space');
    s.slow = !!k('ShiftLeft', 'ShiftRight');
    let cam = !!k('KeyC', 'KeyV');
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const a = gp.axes;
      if (dz(a[1] ?? 0)) s.drive = -dz(a[1]);
      if (dz(a[0] ?? 0)) s.steer = dz(a[0]);
      if (dz(a[2] ?? 0)) s.stick = dz(a[2]);
      if (dz(a[3] ?? 0)) s.boom = -dz(a[3]);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      if (b(4)) s.swing = 1;
      if (b(5)) s.swing = -1;
      if (b(0)) s.curl = 1;
      if (b(1)) s.curl = -1;
      cam ||= b(3);
    }
    s.cam = cam && !this.camWas;
    this.camWas = cam;
    return s;
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Two floating virtual sticks (left = tracks, right = boom/stick) + swing/curl/camera buttons. Also reads the keyboard. */
export class TouchControls implements ControlSource {
  private root: HTMLDivElement;
  private kb = new KeyboardControls();
  private sticks = [0, 1].map(() => ({ id: -1, ox: 0, oy: 0, x: 0, y: 0 }));
  private held = new Set<string>();
  private camQueued = false;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'xc-touch';
    root.innerHTML = `
      <div class="xc-zone l"><div class="xc-base"><div class="xc-knob"></div></div><span class="xc-lbl">🚜 주행</span></div>
      <div class="xc-zone r"><div class="xc-base"><div class="xc-knob"></div></div><span class="xc-lbl">🦾 붐 ↕ · 스틱 ↔</span></div>
      <div class="xc-btns">
        <button data-b="swL" class="tb">↺<small>스윙</small></button>
        <button data-b="swR" class="tb">↻<small>스윙</small></button>
        <button data-b="cam" class="tb mid">🎥<small>시점</small></button>
        <button data-b="curlOut" class="tb">⤵<small>쏟기</small></button>
        <button data-b="curlIn" class="tb">⤴<small>오므림</small></button>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.querySelectorAll<HTMLDivElement>('.xc-zone').forEach((zone, i) => {
      const st = this.sticks[i];
      const base = zone.querySelector('.xc-base') as HTMLDivElement;
      const knob = zone.querySelector('.xc-knob') as HTMLDivElement;
      const R = 52;
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
    });
    root.querySelectorAll<HTMLButtonElement>('.tb').forEach((b) => {
      const name = b.dataset.b!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        if (name === 'cam') this.camQueued = true;
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
    const [l, r] = this.sticks;
    if (l.id !== -1) {
      s.steer = dz(l.x);
      s.drive = -dz(l.y);
    }
    if (r.id !== -1) {
      s.stick = dz(r.x);
      s.boom = -dz(r.y);
    }
    if (this.held.has('swL')) s.swing = 1;
    if (this.held.has('swR')) s.swing = -1;
    if (this.held.has('curlIn')) s.curl = 1;
    if (this.held.has('curlOut')) s.curl = -1;
    if (this.camQueued) {
      s.cam = true;
      this.camQueued = false;
    }
    return s;
  }
  dispose() {
    this.kb.dispose();
    this.root.remove();
  }
}
