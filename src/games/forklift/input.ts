export interface ControlState {
  throttle: number; // -1..1
  steer: number; // -1 (left) .. 1 (right)
  lift: number; // -1..1
  handbrake: boolean;
  turbo: boolean;
  horn: boolean;
  camPressed: boolean; // edge-triggered, consumed by game
}

export interface ControlSource {
  read(): ControlState;
  dispose(): void;
}

const empty = (): ControlState => ({
  throttle: 0, steer: 0, lift: 0, handbrake: false, turbo: false, horn: false, camPressed: false,
});

interface KeyMap {
  up: string[]; down: string[]; left: string[]; right: string[];
  liftUp: string[]; liftDown: string[]; brake: string[]; turbo: string[]; horn: string[]; cam: string[];
}

export const KEYMAP_P1: KeyMap = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  liftUp: ['KeyR'], liftDown: ['KeyF'], brake: ['Space'], turbo: ['ShiftLeft'], horn: ['KeyH'], cam: ['KeyC'],
};
export const KEYMAP_SOLO: KeyMap = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  liftUp: ['KeyR', 'KeyE', 'PageUp'], liftDown: ['KeyF', 'KeyQ', 'PageDown'], brake: ['Space'],
  turbo: ['ShiftLeft', 'ShiftRight'], horn: ['KeyH'], cam: ['KeyC', 'KeyV'],
};
export const KEYMAP_P2: KeyMap = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  liftUp: ['Period', 'Numpad8'], liftDown: ['Comma', 'Numpad2'], brake: ['Slash', 'Numpad0'],
  turbo: ['ShiftRight', 'Numpad5'], horn: ['KeyL', 'NumpadEnter'], cam: ['KeyM', 'Numpad1'],
};

const pressed = new Set<string>();
let listening = false;
function ensureListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    pressed.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => pressed.delete(e.code));
  window.addEventListener('blur', () => pressed.clear());
}

export class KeyboardControls implements ControlSource {
  private camWas = false;
  constructor(private map: KeyMap, private gamepadIndex: number | null = null) {
    ensureListeners();
  }
  read(): ControlState {
    const k = (codes: string[]) => codes.some((c) => pressed.has(c));
    const s = empty();
    s.throttle = (k(this.map.up) ? 1 : 0) - (k(this.map.down) ? 1 : 0);
    s.steer = (k(this.map.right) ? 1 : 0) - (k(this.map.left) ? 1 : 0);
    s.lift = (k(this.map.liftUp) ? 1 : 0) - (k(this.map.liftDown) ? 1 : 0);
    s.handbrake = k(this.map.brake);
    s.turbo = k(this.map.turbo);
    s.horn = k(this.map.horn);
    let cam = k(this.map.cam);

    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads?.()[this.gamepadIndex];
      if (gp) {
        const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
        const rt = gp.buttons[7]?.value ?? 0;
        const lt = gp.buttons[6]?.value ?? 0;
        if (rt || lt) s.throttle = rt - lt;
        else if (dz(gp.axes[1])) s.throttle = -dz(gp.axes[1]);
        if (dz(gp.axes[0])) s.steer = dz(gp.axes[0]);
        if (dz(gp.axes[3] ?? 0)) s.lift = -dz(gp.axes[3]);
        if (gp.buttons[12]?.pressed) s.lift = 1;
        if (gp.buttons[13]?.pressed) s.lift = -1;
        s.handbrake ||= !!gp.buttons[0]?.pressed;
        s.turbo ||= !!gp.buttons[1]?.pressed || !!gp.buttons[5]?.pressed;
        s.horn ||= !!gp.buttons[2]?.pressed;
        cam ||= !!gp.buttons[3]?.pressed;
      }
    }
    s.camPressed = cam && !this.camWas;
    this.camWas = cam;
    return s;
  }
  dispose() {}
}

/** On-screen joystick + buttons for phones. Merges with keyboard so desktop still works. */
export class TouchControls implements ControlSource {
  private root: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Set<string>();
  private camQueued = false;
  private kb: KeyboardControls;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.kb = new KeyboardControls(KEYMAP_SOLO, 0);
    const root = document.createElement('div');
    root.className = 'touch-ui';
    root.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div><span class="stick-hint">주행</span></div>
      <div class="btn-grid">
        <button data-b="liftUp" class="tb lift">▲<small>포크</small></button>
        <button data-b="turbo" class="tb turbo">🔥<small>터보</small></button>
        <button data-b="liftDown" class="tb lift">▼<small>포크</small></button>
        <button data-b="brake" class="tb brake">🌀<small>드리프트</small></button>
        <button data-b="cam" class="tb small">🎥<small>시점</small></button>
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
      s.steer = Math.abs(sx) < 0.12 ? 0 : sx;
      s.throttle = Math.abs(sy) < 0.12 ? 0 : sy;
    }
    if (this.held.has('liftUp')) s.lift = 1;
    if (this.held.has('liftDown')) s.lift = -1;
    s.turbo ||= this.held.has('turbo');
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

export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
