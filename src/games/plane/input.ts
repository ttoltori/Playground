/** Keyboard + touch input for the rubber-band plane. Both feed one shared `Inp` state. */
export interface Inp {
  windHold: boolean; // winding button / space held
  holdT: number; // how long it has been held (s)
  taps: number; // queued winding taps
  spin: number; // queued turns from circular finger gesture
  done: boolean; // finish winding (edge)
  fire: boolean; // throw (edge)
  cont: boolean; // continue after landing (edge)
  cam: boolean; // camera toggle (edge)
  plane: number; // selected plane index (edge) or -1
  kx: number; // keyboard steer -1..1
  ky: number;
  sx: number; // touch stick -1..1 (flight trim)
  sy: number;
  dragX: number; // accumulated drag pixels (aim)
  dragY: number;
}

export const newInp = (): Inp => ({ windHold: false, holdT: 0, taps: 0, spin: 0, done: false, fire: false, cont: false, cam: false, plane: -1, kx: 0, ky: 0, sx: 0, sy: 0, dragX: 0, dragY: 0 });

export interface Controls {
  inp: Inp;
  dispose(): void;
}

export class KeyboardControls implements Controls {
  inp = newInp();
  private down = new Set<string>();
  private onDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = e.code;
    if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) {
      if (c === 'Space') {
        this.inp.taps++;
        this.inp.fire = true;
        this.inp.cont = true;
        this.inp.windHold = true;
        this.inp.holdT = 0;
      }
      if (c === 'Enter' || c === 'KeyF') {
        this.inp.done = true;
        this.inp.cont = true;
      }
      if (c === 'KeyC') this.inp.cam = true;
      if (c === 'Digit1') this.inp.plane = 0;
      if (c === 'Digit2') this.inp.plane = 1;
      if (c === 'Digit3') this.inp.plane = 2;
    }
    this.down.add(c);
    this.axes();
  };
  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
    if (e.code === 'Space') this.inp.windHold = false;
    this.axes();
  };
  private onBlur = () => {
    this.down.clear();
    this.inp.windHold = false;
    this.axes();
  };
  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  private axes() {
    const d = this.down;
    const any = (...k: string[]) => k.some((x) => d.has(x));
    this.inp.kx = (any('ArrowRight', 'KeyD') ? 1 : 0) - (any('ArrowLeft', 'KeyA') ? 1 : 0);
    this.inp.ky = (any('ArrowUp', 'KeyW') ? 1 : 0) - (any('ArrowDown', 'KeyS') ? 1 : 0);
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Phone landscape UI: gesture zone (spin to wind / drag to aim / floating stick to trim) + big buttons. */
export class TouchControls implements Controls {
  inp = newInp();
  readonly root: HTMLDivElement;
  private pid = -1;
  private ox = 0;
  private oy = 0;
  private lx = 0;
  private ly = 0;
  private la = 0;
  private moved = 0;

  constructor(container: HTMLElement, private phase: () => string) {
    const r = (this.root = document.createElement('div'));
    r.className = 'touch-ui pl-touch';
    r.innerHTML = `
      <div class="pl-zone"><div class="pl-hint" data-k="hint"></div><div class="pl-ring"></div><div class="pl-stick"><i></i></div></div>
      <div class="pl-tb">
        <button class="tb small pl-cam" data-b="cam">🎥</button>
        <button class="tb pl-done" data-b="done">✋<small>다 감았다</small></button>
        <button class="pl-big pl-windb" data-b="wind">🌀<small>감기</small></button>
        <button class="pl-big pl-throw" data-b="fire">🚀<small>던지기</small></button>
        <button class="tb pl-next" data-b="cont">▶<small>다음</small></button>
      </div>`;
    container.appendChild(r);
    const zone = r.querySelector<HTMLElement>('.pl-zone')!;
    const stick = r.querySelector<HTMLElement>('.pl-stick')!;
    const knob = stick.querySelector('i') as HTMLElement;
    const ang = (x: number, y: number) => {
      const b = zone.getBoundingClientRect();
      return Math.atan2(y - (b.top + b.height * 0.55), x - (b.left + b.width * 0.5));
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.pid !== -1) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.pid = e.pointerId;
      this.ox = this.lx = e.clientX;
      this.oy = this.ly = e.clientY;
      this.la = ang(e.clientX, e.clientY);
      this.moved = 0;
      if (this.phase() === 'fly') {
        const b = zone.getBoundingClientRect();
        stick.style.left = `${e.clientX - b.left}px`;
        stick.style.top = `${e.clientY - b.top}px`;
        stick.classList.add('active');
      }
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      const ph = this.phase();
      const dx = e.clientX - this.lx;
      const dy = e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (ph === 'wind') {
        const a = ang(e.clientX, e.clientY);
        let d = a - this.la;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.la = a;
        this.inp.spin += (Math.abs(d) / (Math.PI * 2)) * 9;
      } else if (ph === 'aim') {
        this.inp.dragX += dx;
        this.inp.dragY += dy;
      } else if (ph === 'fly') {
        const R = 56;
        let sx = (e.clientX - this.ox) / R;
        let sy = -(e.clientY - this.oy) / R;
        const m = Math.hypot(sx, sy);
        if (m > 1) {
          sx /= m;
          sy /= m;
        }
        this.inp.sx = sx;
        this.inp.sy = sy;
        knob.style.transform = `translate(${sx * R}px, ${-sy * R}px)`;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pid) return;
      this.pid = -1;
      this.inp.sx = this.inp.sy = 0;
      knob.style.transform = '';
      stick.classList.remove('active');
      if (this.phase() === 'land' && this.moved < 12) this.inp.cont = true;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    r.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => {
      const name = b.dataset.b!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        if (name === 'wind') {
          this.inp.windHold = true;
          this.inp.holdT = 0;
          this.inp.taps++;
        } else if (name === 'done') this.inp.done = true;
        else if (name === 'fire') this.inp.fire = true;
        else if (name === 'cont') this.inp.cont = true;
        else if (name === 'cam') this.inp.cam = true;
      });
      const up = () => {
        b.classList.remove('on');
        if (name === 'wind') this.inp.windHold = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }
  setPhase(ph: string) {
    this.root.dataset.ph = ph;
  }
  dispose() {
    this.root.remove();
  }
}
