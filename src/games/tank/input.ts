export interface Ctl {
  drive: number; // + forward
  steer: number; // + right
  turret: number; // + clockwise (right)
  elev: number; // + longer range
  fire: boolean; // level (held / tapped)
  cam: boolean; // edge-triggered
  auto: boolean; // edge-triggered: toggle auto-fire
}
export interface ControlSource { read(): Ctl; dispose(): void; setAutoUi?(on: boolean): void }
export const emptyCtl = (): Ctl => ({ drive: 0, steer: 0, turret: 0, elev: 0, fire: false, cam: false, auto: false });
const dz = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : v);

export class KeyboardControls implements ControlSource {
  private down = new Set<string>();
  private camWas = false;
  private autoWas = false;
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
    s.turret = k('KeyE', 'ArrowRight') - k('KeyQ', 'ArrowLeft');
    s.elev = k('ArrowUp', 'KeyR') - k('ArrowDown', 'KeyF');
    s.fire = !!k('Space', 'Enter');
    let cam = !!k('KeyC', 'KeyV');
    let auto = !!k('KeyT');
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const a = gp.axes;
      if (dz(a[1] ?? 0)) s.drive = -dz(a[1]);
      if (dz(a[0] ?? 0)) s.steer = dz(a[0]);
      if (dz(a[2] ?? 0)) s.turret = dz(a[2]);
      if (dz(a[3] ?? 0)) s.elev = -dz(a[3]);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      s.fire ||= b(0) || b(7) || b(5);
      cam ||= b(3);
      auto ||= b(2);
    }
    s.cam = cam && !this.camWas;
    s.auto = auto && !this.autoWas;
    this.camWas = cam;
    this.autoWas = auto;
    return s;
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Landscape phone layout: left stick = tracks, right stick = turret (←→) and range (↑↓) + tap to fire, big 🔥 button in the middle. */
export class TouchControls implements ControlSource {
  private root: HTMLDivElement;
  private kb = new KeyboardControls();
  private sticks = [0, 1].map(() => ({ id: -1, ox: 0, oy: 0, x: 0, y: 0, t0: 0, moved: 0 }));
  private held = new Set<string>();
  private camQ = false;
  private autoQ = false;
  private tapQ = 0;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'tk-touch';
    root.innerHTML = `
      <div class="tk-zone l"><div class="tk-base"><div class="tk-knob"></div></div><span class="tk-lbl">🛞 주행</span></div>
      <div class="tk-zone r"><div class="tk-base"><div class="tk-knob"></div></div><span class="tk-lbl">🎯 포탑 ↔ · 사거리 ↕ · 탭=발사</span></div>
      <div class="tk-btns">
        <button data-b="auto" class="tb mid on" data-auto="1">🤖<small>자동</small></button>
        <button data-b="fire" class="tb fire">🔥<small>발사</small></button>
        <button data-b="cam" class="tb mid">🎥<small>시점</small></button>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.querySelectorAll<HTMLDivElement>('.tk-zone').forEach((zone, i) => {
      const st = this.sticks[i];
      const base = zone.querySelector('.tk-base') as HTMLDivElement;
      const knob = zone.querySelector('.tk-knob') as HTMLDivElement;
      const R = 50;
      zone.addEventListener('pointerdown', (e) => {
        if (st.id !== -1) return;
        e.preventDefault();
        zone.setPointerCapture(e.pointerId);
        st.id = e.pointerId;
        st.ox = e.clientX;
        st.oy = e.clientY;
        st.x = st.y = st.moved = 0;
        st.t0 = performance.now();
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
        st.moved = Math.max(st.moved, d);
        if (d > R) { dx *= R / d; dy *= R / d; }
        st.x = dx / R;
        st.y = dy / R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== st.id) return;
        if (i === 1 && st.moved < 12 && performance.now() - st.t0 < 260) this.tapQ = 3; // tap on the aim pad = fire
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
        if (name === 'cam') this.camQ = true;
        if (name === 'auto') {
          this.autoQ = true;
          return;
        }
        this.held.add(name);
        b.classList.add('on');
      });
      const up = () => {
        if (name === 'auto') return;
        this.held.delete(name);
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  setAutoUi(on: boolean) {
    this.root.querySelector('[data-b=auto]')?.classList.toggle('on', on);
  }

  read(): Ctl {
    const s = this.kb.read();
    const [l, r] = this.sticks;
    if (l.id !== -1) {
      s.steer = dz(l.x);
      s.drive = -dz(l.y);
    }
    if (r.id !== -1) {
      const x = dz(r.x, 0.1);
      s.turret = Math.sign(x) * Math.abs(x) ** 1.4;
      s.elev = -dz(r.y, 0.25);
    }
    if (this.held.has('fire') || this.tapQ > 0) s.fire = true;
    if (this.tapQ > 0) this.tapQ--;
    if (this.camQ) { s.cam = true; this.camQ = false; }
    if (this.autoQ) { s.auto = true; this.autoQ = false; }
    return s;
  }
  dispose() {
    this.kb.dispose();
    this.root.remove();
  }
}
