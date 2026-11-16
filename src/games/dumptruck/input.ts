import { KEYMAP_SOLO, KeyboardControls, type ControlSource, type ControlState } from '../forklift/input';

/** On-screen stick (steer + gas / brake-reverse) and big bed buttons for phones. Merges with the keyboard. */
export class DumpTouchControls implements ControlSource {
  private root: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Set<string>();
  private camQueued = false;
  private kb = new KeyboardControls(KEYMAP_SOLO, 0);
  private knob: HTMLDivElement;
  private base: HTMLDivElement;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'touch-ui dt-touch';
    root.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div><span class="stick-hint">▲ 가속 · ▼ 브레이크/후진 · ◀▶ 핸들</span></div>
      <div class="btn-grid">
        <button data-b="liftUp" class="tb lift">⏫<small>덤프 올림</small></button>
        <button data-b="liftDown" class="tb lift">⏬<small>내림</small></button>
        <button data-b="cam" class="tb small">🎥<small>시점</small></button>
        <button data-b="brake" class="tb brake">🛑<small>브레이크</small></button>
        <button data-b="horn" class="tb small">📯<small>빵!</small></button>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    this.base = root.querySelector('.stick-base') as HTMLDivElement;
    this.knob = root.querySelector('.stick-knob') as HTMLDivElement;
    const zone = root.querySelector('.stick-zone') as HTMLDivElement;

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stick.id = t.identifier;
      this.stick.ox = t.clientX;
      this.stick.oy = t.clientY;
      this.stick.x = 0;
      this.stick.y = 0;
      const r = zone.getBoundingClientRect();
      this.base.style.left = `${t.clientX - r.left}px`;
      this.base.style.top = `${t.clientY - r.top}px`;
      this.base.classList.add('active');
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stick.id) continue;
        const R = 55;
        let dx = t.clientX - this.stick.ox;
        let dy = t.clientY - this.stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.stick.x = dx / R;
        this.stick.y = dy / R;
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stick.id) continue;
        this.stick.id = -1;
        this.stick.x = 0;
        this.stick.y = 0;
        this.knob.style.transform = '';
        this.base.classList.remove('active');
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    root.querySelectorAll<HTMLButtonElement>('.tb').forEach((b) => {
      const name = b.dataset.b!;
      const down = (e: Event) => {
        e.preventDefault();
        if (name === 'cam') this.camQueued = true;
        this.held.add(name);
        b.classList.add('on');
      };
      const up = (e: Event) => {
        e.preventDefault();
        this.held.delete(name);
        b.classList.remove('on');
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      b.addEventListener('mouseleave', up);
    });
  }

  read(): ControlState {
    const s = this.kb.read();
    if (this.stick.id !== -1) {
      const sx = this.stick.x;
      const sy = -this.stick.y;
      const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - 0.14) / 0.7));
      s.steer = dz(sx);
      s.throttle = dz(sy);
    }
    if (this.held.has('liftUp')) s.lift = 1;
    if (this.held.has('liftDown')) s.lift = -1;
    s.handbrake ||= this.held.has('brake');
    s.horn ||= this.held.has('horn');
    if (this.camQueued) {
      s.camPressed = true;
      this.camQueued = false;
    }
    return s;
  }

  dispose() {
    this.root.remove();
  }
}
