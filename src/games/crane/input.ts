export interface CraneInput {
  slew: number; // -1 (left) .. 1 (right)
  trolley: number; // -1 (in) .. 1 (out)
  hoist: number; // -1 (lower) .. 1 (raise)
  action: boolean; // edge: attach / release
  cam: boolean; // edge: cycle camera
}
export const emptyInput = (): CraneInput => ({ slew: 0, trolley: 0, hoist: 0, action: false, cam: false });

const KEYS = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  out: ['KeyW'], in: ['KeyS'],
  up: ['KeyR', 'ArrowUp', 'KeyE', 'PageUp'], down: ['KeyF', 'ArrowDown', 'KeyQ', 'PageDown'],
  action: ['Space', 'Enter'], cam: ['KeyC', 'KeyV'],
};

export const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export class CraneControls {
  private pressed = new Set<string>();
  private actWas = false;
  private camWas = false;
  private root: HTMLDivElement | null = null;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Set<string>();
  private actQ = false;
  private camQ = false;
  private base: HTMLDivElement | null = null;
  private knob: HTMLDivElement | null = null;
  private onKd = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.pressed.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  private onKu = (e: KeyboardEvent) => this.pressed.delete(e.code);
  private onBlur = () => this.pressed.clear();

  constructor(parent: HTMLElement, touch: boolean) {
    window.addEventListener('keydown', this.onKd);
    window.addEventListener('keyup', this.onKu);
    window.addEventListener('blur', this.onBlur);
    if (touch) this.buildTouch(parent);
  }

  private buildTouch(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'cr-touch';
    root.innerHTML = `
      <div class="cr-stickzone"><div class="cr-stickbase"><div class="cr-stickknob"></div></div>
        <span class="cr-stickhint">좌우 선회 · 위아래 트롤리</span></div>
      <div class="cr-btns">
        <div class="cr-col">
          <button data-b="cam" class="cr-tb sm">🎥<small>시점</small></button>
          <button data-b="act" class="cr-tb act">🪝<small>걸기/풀기</small></button>
        </div>
        <div class="cr-col">
          <button data-b="up" class="cr-tb">▲<small>감기</small></button>
          <button data-b="down" class="cr-tb">▼<small>풀기</small></button>
        </div>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    this.base = root.querySelector('.cr-stickbase') as HTMLDivElement;
    this.knob = root.querySelector('.cr-stickknob') as HTMLDivElement;
    const zone = root.querySelector('.cr-stickzone') as HTMLDivElement;
    const R = 52;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      const r = zone.getBoundingClientRect();
      this.base!.style.left = `${e.clientX - r.left}px`;
      this.base!.style.top = `${e.clientY - r.top}px`;
      this.base!.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      this.knob!.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      this.knob!.style.transform = '';
      this.base!.classList.remove('active');
      this.base!.style.left = '';
      this.base!.style.top = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    root.querySelectorAll<HTMLButtonElement>('.cr-tb').forEach((b) => {
      const name = b.dataset.b!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        if (name === 'act') this.actQ = true;
        if (name === 'cam') this.camQ = true;
        this.held.add(name);
        b.classList.add('on');
      });
      const up = () => {
        this.held.delete(name);
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });
  }

  read(): CraneInput {
    const k = (codes: string[]) => codes.some((c) => this.pressed.has(c));
    const s = emptyInput();
    s.slew = (k(KEYS.right) ? 1 : 0) - (k(KEYS.left) ? 1 : 0);
    s.trolley = (k(KEYS.out) ? 1 : 0) - (k(KEYS.in) ? 1 : 0);
    s.hoist = (k(KEYS.up) ? 1 : 0) - (k(KEYS.down) ? 1 : 0);
    let act = k(KEYS.action);
    let cam = k(KEYS.cam);
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      if (dz(gp.axes[0] ?? 0)) s.slew = dz(gp.axes[0]);
      if (dz(gp.axes[1] ?? 0)) s.trolley = -dz(gp.axes[1]);
      if (dz(gp.axes[3] ?? 0)) s.hoist = -dz(gp.axes[3]);
      if (gp.buttons[12]?.pressed) s.hoist = 1;
      if (gp.buttons[13]?.pressed) s.hoist = -1;
      act ||= !!gp.buttons[0]?.pressed;
      cam ||= !!gp.buttons[3]?.pressed;
    }
    if (this.stick.id !== -1) {
      const sh = (v: number) => {
        const a = Math.abs(v);
        if (a < 0.14) return 0;
        const n = (a - 0.14) / 0.86;
        return Math.sign(v) * (0.55 * n + 0.45 * n * n);
      };
      s.slew = sh(this.stick.x);
      s.trolley = -sh(this.stick.y);
    }
    if (this.held.has('up')) s.hoist = 1;
    if (this.held.has('down')) s.hoist = -1;
    s.action = (act && !this.actWas) || this.actQ;
    s.cam = (cam && !this.camWas) || this.camQ;
    this.actQ = this.camQ = false;
    this.actWas = act;
    this.camWas = cam;
    return s;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKd);
    window.removeEventListener('keyup', this.onKu);
    window.removeEventListener('blur', this.onBlur);
    this.root?.remove();
  }
}

export const TOUCH_CSS = `
.cr-touch{position:absolute;inset:0;pointer-events:none;z-index:10}
.cr-stickzone{position:absolute;left:0;bottom:0;width:46%;height:68%;pointer-events:auto;touch-action:none}
.cr-stickhint{position:absolute;left:18px;bottom:128px;color:#fff6;font-size:11px;font-weight:600;text-shadow:0 1px 3px #000}
.cr-stickbase{position:absolute;left:84px;top:calc(100% - 96px);width:116px;height:116px;margin:-58px 0 0 -58px;border-radius:50%;background:#ffffff14;border:2px solid #ffffff44}
.cr-stickbase.active{background:#ffffff26}
.cr-stickknob{position:absolute;left:33px;top:33px;width:50px;height:50px;border-radius:50%;background:#ffffffb0;box-shadow:0 2px 10px #0008}
.cr-btns{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:flex-end;pointer-events:none}
.cr-col{display:flex;flex-direction:column;gap:10px;pointer-events:auto}
.cr-tb{width:74px;height:66px;border-radius:16px;border:2px solid #ffffff55;background:#000a;color:#fff;font-size:24px;line-height:1;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center}
.cr-tb small{display:block;font-size:10px;margin-top:3px;color:#fffc}
.cr-tb.on{background:var(--accent,#ffcc33);color:#000}
.cr-tb.on small{color:#000}
.cr-tb.act{width:92px;height:84px;border-color:#ffcc33;font-size:30px}
.cr-tb.sm{height:44px;font-size:17px;flex-direction:row;gap:5px;width:92px}
.cr-tb.sm small{margin:0}
.cr-tb.hint{animation:crpulse .8s infinite alternate}
@media (max-height:520px){.cr-tb{width:66px;height:56px;font-size:21px}.cr-tb.act{width:84px;height:74px}.cr-tb.sm{height:38px;width:84px}}
`;
