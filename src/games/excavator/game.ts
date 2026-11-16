import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml, fmtTime } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { Particles } from '../forklift/particles';
import { XAudio } from './audio';
import { emptyCtl, KeyboardControls, TouchControls, type Ctl, type ControlSource } from './input';
import { LEVELS, type Box3 } from './levels';
import { DIM, fk, LIM, TRAVEL_POSE, buildExcavator, type Joints } from './machine';
import { TRUCK, buildSite, buildTruck, truckToLocal, truckWorldBoxes, type Pile, type Site, type Truck } from './scene';

const DIRT = 0x7a5230;
const BUCKET_CAP = 1.0; // m3
const STEP = 1 / 60;

const RADIO = {
  start: [
    '📻 반장: 오늘 토공 물량 장난 아니다. 정시퇴근하고 싶으면 퍼라!',
    '📻 반장: 삽질은 인류의 오랜 전통이다. 근데 너는 기계로 해라.',
    '📻 반장: 흙은 퍼고, 트럭은 건들지 말고. 간단하지?',
    '📻 반장: 사장님이 드론으로 보고 계신다. 폼 나게 퍼!',
  ],
  idle: [
    '📻 반장: 거기 너무 천천히 파는 거 아니냐? 땅이 먼저 퇴근하겠다.',
    '📻 반장: 이 현장 일당은 흙 한 삽에 달려있다.',
    '📻 반장: 커피 마시면서 해도 되는데... 빨리 마시고 해라.',
    '📻 반장: 버킷은 오므려서 들어라. 웃으면서 들지 말고.',
  ],
  deliver: ['📻 반장: 오~ 상차 깔끔하네!', '📻 반장: 그래 그거야, 흙이 알아서 들어갔네.', '📻 반장: 덤프 기사님이 웃으신다.', '📻 반장: 이 맛에 포크레인 탄다!'],
  waste: ['📻 반장: 야! 흙은 트럭에 실어야지, 길바닥에 뿌리냐!', '📻 반장: 그건 현장 조경이냐?', '📻 반장: 흙이 도망간다, 잡아!'],
  crash: ['📻 반장: 쾅 소리 났는데?! 괜찮아? 아니 트럭 말이야.', '📻 반장: 보험 처리 되려나... 시간 깎인다!', '📻 반장: 그 트럭 월부 남았다. 살살 해라.'],
  gas: ['📻 반장: 가스관 터졌다!! 오늘 저녁 삼겹살은 취소다!', '📻 반장: 깃발이 장식인 줄 알았냐!', '📻 반장: 도시가스 아저씨 벌써 출발하셨다...'],
  worker: ['📻 반장: 사람 조심!! 안전모는 밟으면 안 된다!', '📻 반장: 작업자 놀라서 도시락 쏟았다.'],
  combo: ['📻 반장: 스윙하면서 투하? 이거 영상 찍어야겠네.', '📻 반장: 오 감 좋은데? 쿠션 있는 스윙이다.'],
  truckFull: ['📻 반장: 1호차 만차! 2호차 들어온다, 비켜줘라.', '📻 반장: 한 대 가득 채웠다. 다음 차 대기!'],
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const CSS = `
.xc-hud .xc-left{position:absolute;top:56px;left:12px;display:flex;flex-direction:column;gap:6px;width:170px}
.xc-bar{background:#000a;border-radius:8px;padding:4px 8px;font-size:12px;line-height:1.3}
.xc-bar .tr{height:8px;border-radius:4px;background:#fff2;margin-top:3px;overflow:hidden}
.xc-bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .08s}
.xc-bar.bed i{background:#c28a52}
.xc-bar.q i{background:var(--good)}
.xc-pen{font-size:13px;color:#ff8a8a}.xc-pen b{color:var(--good);margin-left:8px}
.xc-tip{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);background:#000b;padding:6px 14px;border-radius:20px;font-size:14px;white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis}
.xc-tip:empty{display:none}
.xc-tip.warn{color:#ffb0b0;outline:2px solid var(--bad)}
.xc-tip.ok{color:var(--good);outline:2px solid var(--good)}
canvas.xc-mini{position:absolute;top:56px;right:8px;width:150px;height:110px;border-radius:8px;border:1px solid #fff3;background:#0008}
.xc-hud .hud-center{font-size:56px}
.xc-touch{position:absolute;inset:0;pointer-events:none;z-index:10}
.xc-zone{position:absolute;bottom:0;width:31%;height:64%;pointer-events:auto;touch-action:none}
.xc-zone.l{left:0}.xc-zone.r{right:0}
.xc-lbl{position:absolute;bottom:128px;color:#fff6;font-size:12px}
.xc-zone.l .xc-lbl{left:22px}.xc-zone.r .xc-lbl{right:22px}
.xc-base{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;background:#fff1;border:2px solid #fff3;top:calc(100% - 92px)}
.xc-zone.l .xc-base{left:84px}.xc-zone.r .xc-base{left:calc(100% - 84px)}
.xc-base.active{background:#fff2}
.xc-knob{position:absolute;left:31px;top:31px;width:50px;height:50px;border-radius:50%;background:#ffffffaa;box-shadow:0 2px 10px #0008}
.xc-btns{position:absolute;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:6px;pointer-events:auto}
.xc-btns .tb{width:54px;height:54px;font-size:20px;border-radius:14px;padding:0}
.xc-btns .tb small{font-size:9px;margin-top:2px}
.xc-btns .tb.mid{width:44px;height:44px;align-self:flex-end;font-size:16px}
.xc-btns .tb.mid small{display:none}
@media (hover:none){.xc-tip{bottom:78px;font-size:12px;padding:4px 10px}.xc-hud .xc-left{width:140px;top:50px}canvas.xc-mini{width:112px;height:82px}.xc-hud .hud-center{font-size:38px}}
`;

interface DumpSession { loaded: number; deliv: number; waste: number; swingAtStart: number }

export class ExcavatorGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly audio = new XAudio();
  readonly cfg;
  site: Site;
  mach;
  trucks: Truck[] = [];
  ti = 0; // current truck index
  nextTruckAt = -1;
  parts: Particles;
  src: ControlSource;
  private touch: TouchControls | null = null;
  private styleEl: HTMLStyleElement;
  private hud: HTMLDivElement;
  private hudEl: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private lastMini = 0;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private disposed = false;
  paused = false;

  // machine state
  m = {
    x: 0, z: 0, yaw: 0, vl: 0, vr: 0, sw: 0, sv: 0,
    j: { ...TRAVEL_POSE } as Joints, bv: 0, pv: 0, cv: 0, wob: 0, spin: 0,
  };
  fill = 0;
  digging = false;
  holding = false;

  // run state
  t = 0;
  elapsed = 0;
  started = false;
  finished = false;
  private finishAt = -1;
  private ended = false;
  penalty = 0;
  bonus = 0;
  delivered = 0;
  wasted = 0;
  quota: number;
  accidents = 0;
  gasHits = 0;
  workerHits = 0;
  cleanDumps = 0;
  combos = 0;
  streak = 0;
  private sess: DumpSession | null = null;
  private accCool = 0;
  private bumpCool = 0;
  private spillCool = 0;
  private wobCool = 0;
  private radioCool = 20;
  private camMode = 0;
  private camYaw = 0;
  private shake = 0;
  private lastHit = false;
  private tmpBoxes: Box3[] = [];

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    this.cfg = LEVELS[clamp(opts.level, 1, LEVELS.length) - 1];
    const cfg = this.cfg;
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    const shadows = !isTouchDevice();
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';

    this.scene.background = new THREE.Color(cfg.sky);
    this.scene.fog = new THREE.Fog(cfg.fog, cfg.night ? 25 : 60, cfg.night ? 90 : 150);
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 400);

    this.site = buildSite(cfg, shadows);
    this.scene.add(this.site.group);
    this.mach = buildExcavator(opts.color, cfg.night);
    this.mach.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = shadows;
    });
    this.scene.add(this.mach.root);
    this.parts = new Particles(this.scene, mobile ? 140 : 260);

    const t0 = buildTruck(cfg.trucks[0], shadows);
    this.trucks.push(t0);
    this.scene.add(t0.group);
    this.quota = cfg.trucks.reduce((a, t) => a + t.cap, 0);

    Object.assign(this.m, { x: cfg.start.x, z: cfg.start.z, yaw: cfg.start.yaw });
    this.camYaw = cfg.start.yaw;

    // HUD
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    const h = (this.hud = document.createElement('div'));
    h.className = 'hud xc-hud';
    h.style.cssText = 'left:0;top:0;width:100%;height:100%';
    h.innerHTML = `
      <div class="hud-top">
        <div class="hud-name" style="--pc:#${opts.color.toString(16).padStart(6, '0')}">${escapeHtml(opts.nickname)}</div>
        <div class="hud-time" data-k="time">0:00.0</div>
      </div>
      <div class="xc-left">
        <div class="xc-bar q"><span data-k="qt">🚚 0.0 / ${this.quota} m³</span><div class="tr"><i data-k="qb"></i></div></div>
        <div class="xc-bar"><span data-k="bt">🪣 버킷 0%</span><div class="tr"><i data-k="bb"></i></div></div>
        <div class="xc-bar bed"><span data-k="tt">🚛 적재함 0.0 / 0</span><div class="tr"><i data-k="tb"></i></div></div>
        <div class="xc-pen" data-k="pen"></div>
      </div>
      <canvas class="xc-mini" width="300" height="220"></canvas>
      <div class="xc-tip" data-k="tip"></div>
      <div class="hud-center" data-k="center"></div>
      <div class="toasts"></div>`;
    container.appendChild(h);
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.hudEl[e.dataset.k!] = e));
    this.mini = h.querySelector('canvas')!;

    this.src = isTouchDevice() ? (this.touch = new TouchControls(container)) : new KeyboardControls();

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.toast(pick(RADIO.start), 'radio');
    this.sync();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ helpers
  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.camMode === 1 ? 72 : w / h < 1.2 ? 72 : 58;
    this.camera.updateProjectionMatrix();
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'radio' = 'info') {
    const box = this.hud.querySelector('.toasts')!;
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild?.remove();
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3400);
  }
  private center(text: string) {
    this.hudEl.center.textContent = text;
  }

  addPenalty(sec: number, msg: string, kind: 'crash' | 'gas' | 'worker') {
    this.penalty += sec;
    this.shake = 1;
    this.accCool = 1.2;
    if (kind === 'gas') this.gasHits++;
    else if (kind === 'worker') this.workerHits++;
    else this.accidents++;
    this.streak = 0;
    this.toast(`${msg} +${sec}초`, 'bad');
    if (kind !== 'gas') this.audio.crash();
    this.toast(pick(kind === 'gas' ? RADIO.gas : kind === 'worker' ? RADIO.worker : RADIO.crash), 'radio');
  }
  private addBonus(sec: number, msg: string) {
    this.bonus += sec;
    this.toast(`${msg} -${sec.toFixed(1)}초`, 'good');
    this.audio.good();
  }

  private curTruck(): Truck | null {
    const t = this.trucks[this.ti];
    return t && t.state === 'parked' ? t : null;
  }

  private cabYaw() {
    return this.m.yaw + this.m.sw;
  }

  /** world point from planar [r,y] on the arm plane */
  private armW(r: number, y: number): [number, number, number] {
    const cy = this.cabYaw();
    return [this.m.x + Math.sin(cy) * r, y, this.m.z + Math.cos(cy) * r];
  }

  /** public: current bucket tip/mouth etc. in world space */
  arm() {
    const p = fk(this.m.j);
    return {
      tip: this.armW(p.tip[0], p.tip[1]),
      mouth: this.armW(p.mouth[0], p.mouth[1]),
      stick: this.armW(p.stickEnd[0], p.stickEnd[1]),
      open: p.open,
      reach: p.tip[0],
    };
  }

  private armPoints(): [number, number, number][] {
    const p = fk(this.m.j);
    const pv: [number, number] = [DIM.pivotR, DIM.pivotY];
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const pts = [mid(pv, p.boomEnd), p.boomEnd, mid(p.boomEnd, p.stickEnd), p.stickEnd, p.mouth, p.tip].map(([r, y]) => this.armW(r, y));
    const cy = this.cabYaw();
    const c = Math.cos(cy);
    const s = Math.sin(cy);
    for (const [lx, lz] of [[1.35, -2.5], [-1.35, -2.5], [0, -2.8]]) pts.push([this.m.x + lx * c + lz * s, 1.8, this.m.z - lx * s + lz * c]);
    return pts;
  }

  private allBoxes(): { list: Box3[]; truckFrom: number } {
    const b = this.tmpBoxes;
    b.length = 0;
    for (const x of this.site.boxes) b.push(x);
    const from = b.length;
    for (const t of this.trucks) if (t.state !== 'gone') truckWorldBoxes(t, b);
    return { list: b, truckFrom: from };
  }

  /** index of first arm point inside a solid, -1 if none; also reports whether it was a truck */
  private armHit(): { idx: number; truck: boolean } {
    const { list, truckFrom } = this.allBoxes();
    const pts = this.armPoints();
    const mg = 0.2;
    for (let bi = 0; bi < list.length; bi++) {
      const b = list[bi];
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i];
        if (x > b.x0 - mg && x < b.x1 + mg && z > b.z0 - mg && z < b.z1 + mg && y > b.y0 - mg && y < b.y1 + mg) {
          if (y < 0.05 && i === 5 && b.y1 < 0.8) continue; // teeth in ground-level clutter are fine
          return { idx: i, truck: bi >= truckFrom };
        }
      }
    }
    return { idx: -1, truck: false };
  }

  private pileSX = (p: Pile) => Math.pow(Math.max(p.v, 0) / p.v0, 0.45);
  private pileSY = (p: Pile) => Math.pow(Math.max(p.v, 0) / p.v0, 0.6);
  private pileSurf(p: Pile, d: number) {
    const R = p.R * this.pileSX(p);
    return d >= R ? 0 : p.H * this.pileSY(p) * (1 - d / R);
  }
  private pileAt(x: number, y: number, z: number): Pile | null {
    for (const p of this.site.piles) {
      if (p.v < 0.04) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.R * this.pileSX(p) + 0.3 && y < this.pileSurf(p, d) + 0.35) return p;
    }
    return null;
  }

  /** ground + arm limits; returns false when the arm could not satisfy the ground constraint */
  private groundFix(j: Joints): boolean {
    for (let i = 0; i < 10; i++) {
      const p = fk(j);
      const dy = Math.min(p.tip[1] + 0.3, p.stickEnd[1] - 0.25, p.mouth[1] + 0.2);
      if (dy >= 0) return true;
      const lever = Math.max(2, Math.abs(p.tip[0] - DIM.pivotR));
      j.boom = clamp(j.boom - dy / lever, LIM.boom[0], LIM.boom[1]);
      if (j.boom >= LIM.boom[1]) return false;
    }
    return fk(j).tip[1] > -0.4;
  }

  // ------------------------------------------------------------ simulation
  step(dt: number) {
    if (this.ended) return;
    this.t += dt;
    const c: Ctl = this.src.read();
    if (c.cam) this.toggleCam();
    const act = Math.abs(c.drive) + Math.abs(c.steer) + Math.abs(c.swing) + Math.abs(c.boom) + Math.abs(c.stick) + Math.abs(c.curl);
    if (!this.started && act > 0.01 && !this.finished) {
      this.started = true;
      this.center('');
    }
    if (this.started && !this.finished) this.elapsed += dt;
    this.accCool = Math.max(0, this.accCool - dt);
    this.bumpCool = Math.max(0, this.bumpCool - dt);
    this.spillCool = Math.max(0, this.spillCool - dt);
    this.wobCool = Math.max(0, this.wobCool - dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.finished) {
      c.drive = c.steer = c.swing = c.boom = c.stick = c.curl = 0;
    }

    this.updateTrucks(dt);
    this.updateWorkers(dt);

    const m = this.m;
    const load = 1 - 0.15 * this.fill;
    const sp = (c.slow ? 0.45 : 1) * load;

    // --- tracks
    const p0 = fk(m.j);
    const ext = clamp((p0.tip[0] - 5.5) / 3, 0, 1) + clamp((p0.tip[1] - 2.6) / 3, 0, 1);
    const vmax = 2.8 * (1 - 0.3 * clamp(ext, 0, 1)) * sp;
    const tl = clamp(c.drive + c.steer * 0.5, -1, 1) * vmax;
    const tr = clamp(c.drive - c.steer * 0.5, -1, 1) * vmax;
    const kt = Math.min(1, dt * 2.6);
    m.vl += (tl - m.vl) * kt;
    m.vr += (tr - m.vr) * kt;
    const v = (m.vl + m.vr) / 2;
    const om = (m.vr - m.vl) / 2.7;
    m.yaw += om * dt;
    m.x += Math.sin(m.yaw) * v * dt;
    m.z += Math.cos(m.yaw) * v * dt;
    const push = this.resolveTracks();
    if (push > 0.015 && Math.abs(v) > 0.8 && this.bumpCool <= 0) {
      this.bumpCool = 0.6;
      this.audio.bump();
      this.shake = Math.max(this.shake, 0.25);
    }
    const sz = this.cfg.size;
    m.x = clamp(m.x, sz.x0 + 2.2, sz.x1 - 2.2);
    m.z = clamp(m.z, sz.z0 + 2.2, sz.z1 - 2.2);

    // --- joints + swing (remember previous state to block on collision)
    const prevJ = { ...m.j };
    const prevSw = m.sw;
    const prevPts = this.armPoints();
    const kh = Math.min(1, dt * 5.5);
    m.bv += (c.boom * 0.7 * sp - m.bv) * kh;
    m.pv += (-c.stick * 0.85 * sp - m.pv) * kh;
    m.cv += (c.curl * 1.5 * sp - m.cv) * kh;
    m.j.boom += m.bv * dt;
    m.j.phi += m.pv * dt;
    m.j.curl += m.cv * dt;
    if (m.j.boom <= LIM.boom[0] || m.j.boom >= LIM.boom[1]) m.bv = 0;
    if (m.j.phi <= LIM.phi[0] || m.j.phi >= LIM.phi[1]) m.pv = 0;
    if (m.j.curl <= LIM.curl[0] || m.j.curl >= LIM.curl[1]) m.cv = 0;
    m.j.boom = clamp(m.j.boom, LIM.boom[0], LIM.boom[1]);
    m.j.phi = clamp(m.j.phi, LIM.phi[0], LIM.phi[1]);
    m.j.curl = clamp(m.j.curl, LIM.curl[0], LIM.curl[1]);
    const swTarget = c.swing * 1.3 * sp;
    const opposing = c.swing !== 0 && Math.sign(c.swing) !== Math.sign(m.sv) && Math.abs(m.sv) > 0.1;
    const ks = c.swing !== 0 ? (opposing ? 3.4 : 2.2) : 1.9;
    m.sv += (swTarget - m.sv) * Math.min(1, dt * ks);
    m.sw += m.sv * dt;
    if (m.sw > Math.PI) m.sw -= Math.PI * 2;
    if (m.sw < -Math.PI) m.sw += Math.PI * 2;

    const okGround = this.groundFix(m.j);
    let hit = this.armHit();
    if (!okGround || (hit.idx >= 0 && !this.lastHit)) {
      const newPts = this.armPoints();
      let speed = 0;
      if (hit.idx >= 0) {
        const a = prevPts[hit.idx];
        const b = newPts[hit.idx];
        speed = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / dt;
      }
      Object.assign(m.j, prevJ);
      m.sw = prevSw;
      m.bv = m.pv = m.cv = 0;
      m.sv *= -0.15;
      if (hit.idx >= 0) {
        if (speed > 1.6 && this.accCool <= 0) {
          this.addPenalty(hit.truck ? 4 : 2, hit.idx >= 6 ? '카운터웨이트가 쾅!' : hit.truck ? '덤프트럭을 박았다!' : '장애물을 쳤다!', 'crash');
        } else if (this.bumpCool <= 0) {
          this.bumpCool = 0.4;
          this.audio.bump();
        }
      }
      hit = this.armHit();
    }
    this.lastHit = hit.idx >= 0;

    // --- stability / wobble
    const pose = fk(m.j);
    const ext2 = clamp((pose.tip[0] - 5.5) / 3, 0, 1) + clamp((pose.tip[1] - 2.6) / 3, 0, 1) + this.fill * 0.25;
    const wobTarget = (Math.abs(v) / 2.8 + Math.abs(om) * 0.35) * ext2 * 1.1;
    m.wob += (wobTarget - m.wob) * Math.min(1, dt * 3);
    m.spin += dt * (4 + m.wob * 10);
    if (m.wob > 0.8 && this.wobCool <= 0) {
      this.wobCool = 4;
      this.toast('⚠ 차체가 휘청! 팔을 접고 천천히 이동!', 'bad');
    }

    this.digAndDump(dt);
    this.gasCheck(dt);

    // ambient radio
    this.radioCool -= dt;
    if (this.radioCool <= 0 && this.started && !this.finished) {
      this.radioCool = 28 + Math.random() * 14;
      this.toast(pick(RADIO.idle), 'radio');
    }

    // audio
    const activity = clamp(act / 3, 0, 1);
    const joint = clamp((Math.abs(m.bv) + Math.abs(m.pv) + Math.abs(m.cv) + Math.abs(m.sv)) / 2.5, 0, 1);
    this.audio.update(dt, activity, joint, clamp(Math.abs(v) / 2.8 + Math.abs(om) * 0.4, 0, 1), this.digging ? 1 : 0, v < -0.3);

    // finish
    if (!this.finished && this.delivered >= this.quota - 0.005) {
      this.finished = true;
      this.finishAt = this.t + 1.6;
      this.center('🏁 작업 완료!');
      this.audio.horn();
      this.toast('📻 반장: 수고했다! 퇴근해라!', 'radio');
    }
    if (this.finished && this.t >= this.finishAt) this.finish();

    this.particlesAndRain(dt);
    this.sync();
  }

  private resolveTracks(): number {
    const m = this.m;
    const { list } = this.allBoxes();
    let maxPush = 0;
    const circles: [number, number, number][] = [[-1.3, 1.6, 0], [0, 1.65, 0], [1.3, 1.6, 0]];
    for (let pass = 0; pass < 2; pass++) {
      for (const [off, r] of circles) {
        const cx = m.x + Math.sin(m.yaw) * off;
        const cz = m.z + Math.cos(m.yaw) * off;
        let px = 0;
        let pz = 0;
        for (const b of list) {
          if (b.y0 > 1.0) continue;
          const nx = clamp(cx, b.x0, b.x1);
          const nz = clamp(cz, b.z0, b.z1);
          let dx = cx - nx;
          let dz = cz - nz;
          const d = Math.hypot(dx, dz);
          if (d < r) {
            if (d < 1e-4) {
              // center inside box: push out along the shallowest axis
              const cands = [[cx - b.x0 + r, -1, 0], [b.x1 - cx + r, 1, 0], [cz - b.z0 + r, 0, -1], [b.z1 - cz + r, 0, 1]].sort((a, b2) => a[0] - b2[0]);
              dx = cands[0][1];
              dz = cands[0][2];
              px += dx * cands[0][0];
              pz += dz * cands[0][0];
            } else {
              px += (dx / d) * (r - d);
              pz += (dz / d) * (r - d);
            }
          }
        }
        for (const p of this.site.piles) {
          if (p.v < 0.04) continue;
          const pr = p.R * this.pileSX(p) * 0.55 + r;
          const dx = cx - p.x;
          const dz = cz - p.z;
          const d = Math.hypot(dx, dz);
          if (d < pr && d > 1e-4) {
            px += (dx / d) * (pr - d);
            pz += (dz / d) * (pr - d);
          }
        }
        for (const w of this.site.workers) {
          const dx = cx - w.x;
          const dz = cz - w.z;
          const d = Math.hypot(dx, dz);
          if (d < r + 0.45) {
            if (w.stun <= 0 && this.accCool <= 0) {
              w.stun = 3.5;
              w.mesh.rotation.z = 1.35;
              this.addPenalty(6, '작업자와 접촉! 🦺', 'worker');
            }
            if (d > 1e-4) {
              px += (dx / d) * (r + 0.45 - d) * 0.8;
              pz += (dz / d) * (r + 0.45 - d) * 0.8;
            }
          }
        }
        m.x += px;
        m.z += pz;
        maxPush = Math.max(maxPush, Math.hypot(px, pz));
      }
    }
    return maxPush;
  }

  private digAndDump(dt: number) {
    const m = this.m;
    const a = this.arm();
    const [tx, ty, tz] = a.tip;
    this.digging = false;
    const pile = this.pileAt(tx, ty, tz);
    if (pile && this.fill < BUCKET_CAP) {
      const rate = 0.6 * Math.max(0, m.cv) + 0.35 * Math.max(0, m.pv);
      if (rate > 0.02) {
        const take = Math.min(rate * dt, BUCKET_CAP - this.fill, pile.v);
        if (take > 0) {
          if (this.sess) this.closeSession();
          this.fill += take;
          pile.v -= take;
          this.digging = true;
          if (Math.random() < 0.5) {
            this.parts.spawn(tx, Math.max(ty, 0.1), tz, (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3, DIRT, 0.6, 0.18, 14);
          }
          if (pile.v < 0.04) {
            pile.v = 0;
            this.toast('흙더미 소진!', 'info');
          }
        }
      }
    }
    this.holding = a.open > 0.32;

    // leak / dump
    if (this.fill > 0.001 && !pile) {
      const leak = Math.max(0, 0.32 - a.open) * 2.6;
      const amt = Math.min(this.fill, leak * dt);
      if (amt > 0) this.dumpAmount(amt, a.mouth);
    }
    // spill when carrying carelessly
    if (this.holding && this.fill > 0.05) {
      const lat = Math.abs(m.sv) * a.reach;
      const s = Math.max(0, lat - 5.5) * 0.15 + Math.max(0, m.wob - 0.5) * 0.3;
      if (s > 0) {
        const amt = Math.min(this.fill, s * dt);
        this.fill -= amt;
        this.wasted += amt;
        this.parts.spawn(a.mouth[0], a.mouth[1] + 0.3, a.mouth[2], Math.cos(this.cabYaw()) * Math.sign(m.sv) * 3, 2, -Math.sin(this.cabYaw()) * Math.sign(m.sv) * 3, DIRT, 0.7, 0.2, 18);
        if (this.spillCool <= 0) {
          this.spillCool = 3;
          this.toast('흙이 흘러내린다! 스윙은 살살!', 'bad');
          this.audio.spill();
        }
      }
    }
    if (this.fill < 0.003) {
      this.fill = 0;
      if (this.sess) this.closeSession();
    }
  }

  private dumpAmount(amt: number, mouth: [number, number, number]) {
    if (!this.sess) this.sess = { loaded: this.fill, deliv: 0, waste: 0, swingAtStart: Math.abs(this.m.sv) };
    this.fill -= amt;
    const n = Math.max(1, Math.round(amt * 60));
    for (let i = 0; i < n; i++) {
      this.parts.spawn(mouth[0] + (Math.random() - 0.5) * 0.8, mouth[1], mouth[2] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2, -1, (Math.random() - 0.5) * 1.2, DIRT, 0.5, 0.16, 16);
    }
    const tr = this.curTruck();
    if (tr) {
      const [lx, lz] = truckToLocal(tr, mouth[0], mouth[2]);
      if (Math.abs(lx) < TRUCK.bedHalfX && lz > TRUCK.bedZ0 && lz < TRUCK.bedZ1 && mouth[1] > TRUCK.floorY) {
        const room = Math.max(0, tr.cap - tr.loaded);
        const ok = Math.min(room, amt);
        tr.loaded += ok;
        this.delivered += ok;
        this.sess.deliv += ok;
        this.sess.waste += amt - ok;
        this.wasted += amt - ok;
        if (tr.loaded >= tr.cap - 0.004) this.truckFull(tr);
        return;
      }
    }
    for (const p of this.site.piles) {
      if (Math.hypot(mouth[0] - p.x, mouth[2] - p.z) < p.R * this.pileSX(p) * 0.9) {
        p.v = Math.min(p.v0, p.v + amt);
        this.sess.waste += amt * 0.5;
        return;
      }
    }
    this.wasted += amt;
    this.sess.waste += amt;
  }

  private closeSession() {
    const s = this.sess;
    this.sess = null;
    if (!s || s.loaded < 0.3) return;
    if (s.deliv >= s.loaded * 0.85 && s.waste < 0.1 * s.loaded + 0.02) {
      this.cleanDumps++;
      this.streak++;
      this.audio.ding();
      this.toast(pick(RADIO.deliver), 'radio');
      if (s.loaded >= 0.9 && s.swingAtStart > 0.5) {
        this.combos++;
        this.addBonus(1, '스윙 투하 콤보! 💪');
        this.toast(pick(RADIO.combo), 'radio');
      } else this.addBonus(0.5, s.loaded >= 0.9 ? '깔끔한 만땅 투하!' : '깔끔한 투하');
      if (this.streak > 0 && this.streak % 3 === 0) this.addBonus(1.5, `🔥 ${this.streak}연속 클린!`);
    } else if (s.waste > 0.25) {
      this.streak = 0;
      this.toast(pick(RADIO.waste), 'radio');
    }
  }

  private truckFull(tr: Truck) {
    if (this.delivered >= this.quota - 0.005) return;
    tr.state = 'leaving';
    tr.speed = 0;
    this.audio.horn();
    this.toast(pick(RADIO.truckFull), 'radio');
    this.nextTruckAt = -1;
  }

  private gasCheck(dt: number) {
    const tip = this.arm().tip;
    for (const g of this.site.gas) {
      g.cool = Math.max(0, g.cool - dt);
      if (g.cool > 0) continue;
      if (Math.hypot(tip[0] - g.x, tip[2] - g.z) < g.r && tip[1] < -0.1) {
        g.cool = 4;
        this.addPenalty(8, '💥 가스관 파손!!', 'gas');
        this.audio.hiss();
        for (let i = 0; i < 40; i++) {
          this.parts.spawn(g.x + (Math.random() - 0.5), 0.3, g.z + (Math.random() - 0.5), (Math.random() - 0.5) * 3, 7 + Math.random() * 7, (Math.random() - 0.5) * 3, 0xf4f4f4, 1.3, 0.35, 6, 0.4);
        }
      }
    }
  }

  private updateTrucks(dt: number) {
    const cur = this.trucks[this.ti];
    if (cur) {
      const fx = Math.sin(cur.yaw);
      const fz = Math.cos(cur.yaw);
      if (cur.state === 'leaving') {
        cur.speed = Math.min(12, cur.speed + 3.2 * dt);
        cur.x += fx * cur.speed * dt;
        cur.z += fz * cur.speed * dt;
        const d = Math.hypot(cur.x - cur.px, cur.z - cur.pz);
        if (this.nextTruckAt < 0 && d > 14 && this.ti + 1 < this.cfg.trucks.length) this.nextTruckAt = this.t;
        if (d > 70) {
          cur.state = 'gone';
          cur.group.visible = false;
        }
      }
    }
    if (this.nextTruckAt >= 0 && this.t >= this.nextTruckAt && this.ti + 1 < this.cfg.trucks.length) {
      this.ti++;
      this.nextTruckAt = -1;
      const cfg = this.cfg.trucks[this.ti];
      const nt = buildTruck(cfg, !isTouchDevice());
      nt.state = 'arriving';
      nt.x = cfg.x - Math.sin(cfg.yaw) * 46;
      nt.z = cfg.z - Math.cos(cfg.yaw) * 46;
      this.trucks.push(nt);
      this.scene.add(nt.group);
      this.audio.horn();
      this.toast('🚛 2호차 입장! 잠깐 쉬어라.', 'info');
    }
    const t = this.trucks[this.ti];
    if (t && t.state === 'arriving') {
      const d = Math.hypot(t.px - t.x, t.pz - t.z);
      const sp = clamp(d * 0.9, 1.6, 9);
      if (d <= sp * dt + 0.02) {
        t.x = t.px;
        t.z = t.pz;
        t.state = 'parked';
        this.audio.thud();
        this.toast('📻 반장: 차 섰다! 퍼 담아라!', 'radio');
      } else {
        t.x += ((t.px - t.x) / d) * sp * dt;
        t.z += ((t.pz - t.z) / d) * sp * dt;
      }
    }
  }

  private updateWorkers(dt: number) {
    for (const w of this.site.workers) {
      if (w.stun > 0) {
        w.stun -= dt;
        if (w.stun <= 0.4) w.mesh.rotation.z *= 0.8;
        if (w.stun <= 0) w.mesh.rotation.z = 0;
        continue;
      }
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      const tgt = w.toB ? w.b : w.a;
      const dx = tgt[0] - w.x;
      const dz = tgt[1] - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) {
        w.toB = !w.toB;
        w.wait = 1.2;
      } else {
        w.x += (dx / d) * w.speed * dt;
        w.z += (dz / d) * w.speed * dt;
        w.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  private particlesAndRain(dt: number) {
    this.parts.update(dt);
    const rain = this.site.rain;
    if (rain) {
      const pos = rain.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const cx = this.m.x;
      const cz = this.m.z;
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= 28 * dt;
        arr[i + 4] -= 28 * dt;
        if (arr[i + 4] < 0) {
          const x = cx + (Math.random() - 0.5) * 50;
          const z = cz + (Math.random() - 0.5) * 50;
          const y = 22 + Math.random() * 4;
          arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
          arr[i + 3] = x - 0.12; arr[i + 4] = y - 0.9; arr[i + 5] = z;
        }
      }
      pos.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ visuals
  /** push simulation state into meshes */
  sync() {
    const m = this.m;
    const M = this.mach;
    M.root.position.set(m.x, 0, m.z);
    M.root.rotation.set(Math.sin(m.spin * 1.3) * m.wob * 0.03, m.yaw, Math.sin(m.spin) * m.wob * 0.045);
    M.cab.rotation.y = m.sw;
    M.boomG.rotation.x = -m.j.boom;
    M.stickG.rotation.x = m.j.phi;
    M.bucketG.rotation.x = m.j.curl;
    M.bucketDirt.scale.y = Math.max(0.001, this.fill * 0.7);
    M.bucketDirt.visible = this.fill > 0.02;
    M.beacon.visible = Math.floor(this.t * 3) % 2 === 0;
    M.treadL.offset.y -= (m.vl * STEP) / 0.575;
    M.treadR.offset.y -= (m.vr * STEP) / 0.575;
    for (const p of this.site.piles) {
      p.mesh.visible = p.v >= 0.04;
      const sx = this.pileSX(p);
      p.mesh.scale.set(sx, this.pileSY(p), sx);
    }
    for (const t of this.trucks) {
      t.group.position.set(t.x, 0, t.z);
      t.dirt.scale.y = Math.max(0.001, 1.35 * (t.loaded / t.cap));
      t.dirt.visible = t.loaded > 0.02;
    }
    for (const w of this.site.workers) {
      w.mesh.position.set(w.x, 0, w.z);
      w.mesh.position.y = Math.abs(w.mesh.rotation.z) > 0.2 ? 0.3 : 0;
    }
    for (const g of this.site.gas) g.flags.visible = true;
    // guidance marker
    const mk = this.site.marker;
    let tgt: [number, number, number] | null = null;
    if (!this.finished) {
      if (this.fill < 0.35) {
        let best = 1e9;
        for (const p of this.site.piles) {
          if (p.v < 0.15) continue;
          const d = Math.hypot(p.x - m.x, p.z - m.z);
          if (d < best) {
            best = d;
            tgt = [p.x, p.H * this.pileSY(p) + 2.2, p.z];
          }
        }
      } else {
        const tr = this.curTruck();
        if (tr) {
          const c = Math.cos(tr.yaw);
          const s = Math.sin(tr.yaw);
          tgt = [tr.x + TRUCK.bedCenterZ * s, 5.2, tr.z + TRUCK.bedCenterZ * c];
        }
      }
    }
    mk.visible = !!tgt;
    if (tgt) mk.position.set(tgt[0], tgt[1] + Math.sin(this.t * 4) * 0.3, tgt[2]);
    mk.rotation.y += 0.03;
    if (M.headlight) M.headlight.visible = true;
  }

  private toggleCam() {
    this.camMode = (this.camMode + 1) % 2;
    this.mach.cab.traverse((o) => {
      if (o.name === 'glass') o.visible = this.camMode === 0;
    });
    this.layout();
  }
  get camLabel() {
    return this.camMode === 0 ? '3인칭' : '운전석';
  }

  private updateCamera(dt: number) {
    const m = this.m;
    const cy = this.cabYaw();
    const cam = this.camera;
    const sh = this.shake;
    if (this.camMode === 0) {
      this.camYaw += angDiff(cy, this.camYaw) * Math.min(1, dt * 2.6);
      const y = this.camYaw;
      const ex = Math.sin(y);
      const ez = Math.cos(y);
      cam.position.set(m.x - ex * 12.5, 9.2, m.z - ez * 12.5);
      cam.lookAt(m.x + ex * 3.5, 1.4, m.z + ez * 3.5);
    } else {
      const c = Math.cos(cy);
      const s = Math.sin(cy);
      cam.position.set(m.x + 0.8 * c + 0.1 * s, 3.1, m.z - 0.8 * s + 0.1 * c);
      cam.lookAt(cam.position.x + Math.sin(cy) * 10, 1.4, cam.position.z + Math.cos(cy) * 10);
      this.camYaw = cy;
    }
    if (sh > 0 || m.wob > 0.3) {
      const k = sh * 0.5 + Math.max(0, m.wob - 0.3) * 0.15;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
      cam.position.z += (Math.random() - 0.5) * k;
    }
  }

  private hint(): { text: string; cls: string } {
    const touch = !!this.touch;
    const k = (a: string, b: string) => (touch ? b : a);
    if (this.finished) return { text: '', cls: '' };
    if (this.m.wob > 0.75) return { text: '⚠ 차체가 휘청! 팔을 접고 천천히', cls: 'warn' };
    if (!this.started) return { text: '🟫 흙더미로 접근하세요 — 조작하면 타이머 시작', cls: '' };
    const m = this.m;
    const a = this.arm();
    if (this.fill < 0.35) {
      let best: Pile | null = null;
      let bd = 1e9;
      for (const p of this.site.piles) {
        if (p.v < 0.15) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) return { text: '흙이 없다!', cls: 'warn' };
      if (this.digging) return { text: `계속 오므려라! (${k('Z', '⤴')})`, cls: 'ok' };
      if (bd > 9.8) return { text: `🟫 흙더미 쪽으로 주행 (${k('W/A/D', '왼쪽 스틱')})`, cls: '' };
      if (bd < 3.6) return { text: '너무 가깝다 — 후진!', cls: 'warn' };
      if (!this.pileAt(a.tip[0], a.tip[1], a.tip[2])) {
        const sd = Math.abs(angDiff(Math.atan2(best.x - m.x, best.z - m.z), this.cabYaw()));
        if (sd > 0.3) return { text: `흙더미 쪽으로 스윙 (${k('Q/E', '↺ ↻')})`, cls: '' };
        return { text: `버킷을 흙더미에 넣고 오므려라 (${k('Z', '⤴')})`, cls: '' };
      }
      return { text: `오므려라! (${k('Z', '⤴')})`, cls: 'ok' };
    }
    const tr = this.curTruck();
    if (!tr) return { text: '🚛 다음 트럭 입장 대기 중...', cls: '' };
    const c = Math.cos(tr.yaw);
    const s = Math.sin(tr.yaw);
    const bx = tr.x + TRUCK.bedCenterZ * s;
    const bz = tr.z + TRUCK.bedCenterZ * c;
    const bd = Math.hypot(bx - m.x, bz - m.z);
    const [lx, lz] = truckToLocal(tr, a.mouth[0], a.mouth[2]);
    const over = Math.abs(lx) < TRUCK.bedHalfX && lz > TRUCK.bedZ0 && lz < TRUCK.bedZ1;
    if (this.fill > 0.02 && over && a.mouth[1] > TRUCK.floorY) return { text: this.holding ? `지금! 버킷을 펴라 (${k('X', '⤵')})` : '쏟는 중...', cls: 'ok' };
    if (bd > 9.6) return { text: '🚛 트럭 쪽으로 이동 (팔은 접고!)', cls: '' };
    if (a.tip[1] < 2.8 && a.reach > bd - 2) return { text: '붐을 들어라! 적재함 벽에 걸린다', cls: 'warn' };
    return { text: `트럭 적재함 위로 스윙 (${k('Q/E', '↺ ↻')}) + 팔 뻗기`, cls: '' };
  }

  private updateHud(now: number) {
    const e = this.hudEl;
    e.time.textContent = fmtTime(Math.max(0, this.elapsed + this.penalty - this.bonus));
    e.qt.textContent = `🚚 ${this.delivered.toFixed(1)} / ${this.quota} m³`;
    (e.qb as HTMLElement).style.width = `${clamp(this.delivered / this.quota, 0, 1) * 100}%`;
    e.bt.textContent = `🪣 버킷 ${Math.round(this.fill * 100)}%${this.holding || this.fill < 0.02 ? '' : ' (쏟아짐!)'}`;
    (e.bb as HTMLElement).style.width = `${this.fill * 100}%`;
    const tr = this.trucks[this.ti];
    e.tt.textContent = tr ? `🚛 ${this.ti + 1}호차 ${tr.loaded.toFixed(1)} / ${tr.cap}${tr.state !== 'parked' ? ' (이동중)' : ''}` : '';
    (e.tb as HTMLElement).style.width = `${tr ? (tr.loaded / tr.cap) * 100 : 0}%`;
    e.pen.innerHTML = `${this.penalty > 0 ? `페널티 +${this.penalty.toFixed(0)}s` : ''}${this.bonus > 0 ? `<b>보너스 -${this.bonus.toFixed(1)}s</b>` : ''}`;
    const h = this.hint();
    e.tip.textContent = h.text;
    e.tip.className = 'xc-tip ' + h.cls;
    if (now - this.lastMini > 100) {
      this.lastMini = now;
      this.drawMini();
    }
  }

  private drawMini() {
    const c = this.mini;
    const g = c.getContext('2d')!;
    const sz = this.cfg.size;
    const W = sz.x1 - sz.x0;
    const D = sz.z1 - sz.z0;
    const k = Math.min(c.width / W, c.height / D);
    const ox = (c.width - W * k) / 2;
    const oy = (c.height - D * k) / 2;
    // world +x is screen-left (facing +z up), keep north-up with x mirrored for intuitive orientation
    const px = (x: number) => ox + (sz.x1 - x) * k;
    const py = (z: number) => oy + (sz.z1 - z) * k;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#2b2418';
    g.fillRect(ox, oy, W * k, D * k);
    for (const b of this.site.boxes.slice(4)) {
      g.fillStyle = '#6b7280';
      g.fillRect(px(b.x1), py(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
    for (const gz of this.site.gas) {
      g.fillStyle = 'rgba(255,60,50,0.5)';
      g.beginPath();
      g.arc(px(gz.x), py(gz.z), gz.r * k, 0, 7);
      g.fill();
    }
    for (const p of this.site.piles) {
      if (p.v < 0.04) continue;
      g.fillStyle = '#b07a42';
      g.beginPath();
      g.arc(px(p.x), py(p.z), Math.max(3, p.R * this.pileSX(p) * k), 0, 7);
      g.fill();
    }
    for (const t of this.trucks) {
      if (t.state === 'gone') continue;
      g.save();
      g.translate(px(t.x), py(t.z));
      g.rotate(Math.PI - t.yaw);
      g.fillStyle = '#f2b705';
      g.fillRect(-1.2 * k, -3.9 * k, 2.4 * k, 7.8 * k);
      g.fillStyle = '#fff';
      g.fillRect(-1.2 * k, 1.5 * k, 2.4 * k, 2.4 * k);
      g.restore();
    }
    for (const w of this.site.workers) {
      g.fillStyle = '#ff7a00';
      g.fillRect(px(w.x) - 3, py(w.z) - 3, 6, 6);
    }
    g.save();
    g.translate(px(this.m.x), py(this.m.z));
    g.rotate(Math.PI - this.m.yaw);
    g.fillStyle = '#' + this.opts.color.toString(16).padStart(6, '0');
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.strokeRect(-1.3 * k, -2.2 * k, 2.6 * k, 4.4 * k);
    g.fillRect(-1.3 * k, -2.2 * k, 2.6 * k, 4.4 * k);
    g.restore();
    // cab/arm direction
    const cy = this.cabYaw();
    g.strokeStyle = '#ffd400';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px(this.m.x), py(this.m.z));
    g.lineTo(px(this.m.x + Math.sin(cy) * 8.5), py(this.m.z + Math.cos(cy) * 8.5));
    g.stroke();
  }

  // ------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.step(STEP);
        this.acc -= STEP;
      }
    }
    this.updateCamera(dt);
    this.updateHud(now);
    this.renderer.render(this.scene, this.camera);
  };

  private finish() {
    if (this.ended) return;
    this.ended = true;
    const total = Math.max(1, this.elapsed + this.penalty - this.bonus);
    const clean = this.accidents + this.gasHits + this.workerHits === 0;
    const title = clean ? '🏆 무사고 굴착 장인!' : total < 90 ? '⚡ 광속 삽질러' : '🚧 공사 완료!';
    this.opts.onEnd({
      timeMs: Math.round(total * 1000),
      title,
      detail: [
        { label: '순수 작업 시간', value: fmtTime(this.elapsed) },
        { label: '상차량', value: `${this.delivered.toFixed(1)} m³` },
        { label: '흘리고 버린 흙', value: `${this.wasted.toFixed(1)} m³` },
        { label: '깔끔 투하', value: `${this.cleanDumps}회 (콤보 ${this.combos})` },
        { label: '사고 / 가스관 / 작업자', value: `${this.accidents} / ${this.gasHits} / ${this.workerHits}` },
        { label: '페널티', value: `+${this.penalty.toFixed(0)}s` },
        { label: '보너스', value: `-${this.bonus.toFixed(1)}s` },
      ],
    });
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.lastFrame = performance.now();
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.src.dispose();
    this.audio.dispose();
    this.hud.remove();
    this.styleEl.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

export { emptyCtl };
