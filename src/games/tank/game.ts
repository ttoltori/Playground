import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml, fmtTime } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { Particles } from '../forklift/particles';
import { mulberry32 } from '../forklift/rng';
import { TankAudio } from './audio';
import { KeyboardControls, TouchControls, type Ctl, type ControlSource } from './input';
import { buildLevel, circleVsObs, pointInObs, type EnemyKind, type Level, type Obs } from './level';
import {
  buildCat, buildFloor, buildMarble, buildPickup, buildProp, buildRoom, buildTank, resetMats, type CatModel, type TankModel,
} from './models';

export const STEP = 1 / 60;
const G = 18; // shell gravity
const PITCH = 0.38; // fixed launch angle (rad); range is chosen by shell speed
const MAX_RANGE = 44;
const MIN_RANGE = 5;
const TUR_RATE = 1.7; // player turret traverse (rad/s)
const DEATH_PENALTY = 120; // seconds added when the player tank is destroyed
const BONUS_CAP = 40;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const pick = <T,>(a: T[], r: () => number = Math.random) => a[Math.floor(r() * a.length)];
const hex6 = (c: number) => '#' + c.toString(16).padStart(6, '0');

const RADIO = {
  start: ['📢 형: 야, 건전지 새 거 끼웠다. 한판 붙자!', '📢 형: 장판 위에서 승부다. 먼저 뒤집히는 놈이 짜장면 쏘기!', '📢 동생: 형, 이번엔 안 봐준다?'],
  kill: ['📢 형: 야 반칙이야! 다시 해!', '📢 형: 아 그거 내 탱크 아니야, 본드 마르기 전이었어!', '📢 형: 한 대 남았다, 한 대만 더 뽑자!', '📢 동생: 우와 터졌다 터졌어!'],
  rear: ['📢 형: 뒤통수 치기 없기!', '📢 동생: 엉덩이가 약점이다!'],
  front: ['📢 형: 앞은 안 뚫려 ㅋㅋ', '📢 동생: 정면은 장갑이 두껍다니까~'],
  hurt: ['📢 동생: 형 맞았어! 부품 떨어졌다!', '📢 형: 조립 설명서 다시 봐라~'],
  low: ['📢 동생: 본드! 본드 어딨어?!', '📢 형: 부품 다 떨어지겠다 ㅋㅋ'],
  battery: ['📢 동생: 건전지 약해졌다, 느려터졌네~', '📢 형: 새 건전지는 장판 위에 있다!'],
  idle: ['📢 형: 거기서 뭐 하냐, 가만있으면 표적이야.', '📢 동생: 구슬 조심해! 굴러온다!', '📢 형: 이불 언덕은 느려서 못 올라갈걸?'],
  tip: ['📢 형: 뒤집혔다 ㅋㅋㅋ', '📢 동생: 문지방은 천천히 넘어야지!'],
};

type Kind = 'player' | EnemyKind;
type AiState = 'patrol' | 'hunt' | 'engage' | 'cover';
interface Ai {
  state: AiState;
  st: number;
  wp: number;
  lastX: number;
  lastZ: number;
  alert: number;
  strafe: number;
  strafeT: number;
  stuckT: number;
  px: number;
  pz: number;
  chkT: number;
  unstick: number;
  coverX: number;
  coverZ: number;
  coverCool: number;
  pause: number;
  burst: number;
  burstT: number;
  sees: boolean;
  losT: number;
}

export interface Tank {
  id: number;
  team: 0 | 1;
  kind: Kind;
  x: number; z: number; yaw: number;
  y: number; pitch: number; roll: number;
  vl: number; vr: number; cl: number; cr: number;
  sx: number; sz: number; vx: number; vz: number;
  speed: number;
  ty: number;
  reload: number;
  hp: number; maxHp: number;
  alive: boolean;
  tipT: number; tipAcc: number; tipSide: number;
  maxV: number; scale: number; radius: number; hitR: number;
  armorF: number; armorS: number;
  rate: number; reloadT: number; dmg: number;
  hitFlash: number; recoil: number;
  ai?: Ai;
  sentry: boolean;
  model: TankModel;
  smokeT: number;
}

interface Shell {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  team: 0 | 1; owner: Tank; power: boolean; ric: number; life: number;
  ox: number; oz: number; age: number; trail: number; dead: boolean; mesh: THREE.Mesh;
}
interface Marble { x: number; z: number; vx: number; vz: number; r: number; mesh: THREE.Mesh; y: number; hitCool: number }
interface Pickup { kind: 'bat' | 'glue' | 'pow'; x: number; z: number; got: boolean; mesh: THREE.Group; ph: number }
interface Debris { o: THREE.Object3D; vx: number; vy: number; vz: number; sx: number; sy: number; life: number }
interface Cat {
  x: number; z: number; yaw: number; awake: boolean; t: number; grump: number; quiet: number; swung: boolean; model: CatModel; obs: Obs;
}

/** shell speed so the arc (fixed launch angle) passes through height yT at horizontal distance D from a muzzle at height y0 */
function shotSpeed(y0: number, D: number, yT: number) {
  const c = Math.cos(PITCH);
  const den = 2 * c * c * (y0 + D * Math.tan(PITCH) - yT);
  if (den < 0.05) return 70;
  return Math.min(70, Math.sqrt((G * D * D) / den));
}

const CSS = `
.tk-hud .hud-top{right:150px}
.tk-en{font-size:20px;color:#ffd0c8}
.tk-adj{font-size:13px;color:var(--good)}.tk-adj b{color:#ff9a9a;font-weight:700}
.tk-left{position:absolute;top:56px;left:12px;display:flex;flex-direction:column;gap:5px;width:172px}
.tk-bar{background:#000a;border-radius:8px;padding:3px 8px;font-size:12px;line-height:1.3}
.tk-bar .tr{height:7px;border-radius:4px;background:#fff2;margin-top:2px;overflow:hidden}
.tk-bar i{display:block;height:100%;width:0;background:var(--good);transition:width .08s}
.tk-bar.bat i{background:var(--accent)}.tk-bar.rl i{background:#7ab8ff}
.tk-bar.low i{background:var(--bad)}
.tk-pw{font-size:12px;color:#ffb066;min-height:14px}
canvas.tk-mini{position:absolute;top:50px;right:8px;width:138px;height:98px;border-radius:8px;border:1px solid #fff3;background:#0007}
.tk-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;opacity:.85}
.tk-cross::before,.tk-cross::after{content:'';position:absolute;background:#fff;box-shadow:0 0 3px #000}
.tk-cross::before{left:8px;top:0;width:2px;height:18px}.tk-cross::after{top:8px;left:0;height:2px;width:18px}
.tk-imp{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;display:none;pointer-events:none}
.tk-imp i{position:absolute;inset:3px;border:2px solid #ffe14a;border-radius:50%;box-shadow:0 0 5px #000}
.tk-imp i::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#ffe14a;border-radius:50%}
.tk-imp b{position:absolute;left:36px;top:9px;font-size:11px;color:#ffe14a;text-shadow:0 1px 3px #000;font-weight:700;white-space:nowrap}
.tk-imp.lock i{border-color:#ff4a4a;animation:blink .25s infinite alternate}.tk-imp.lock i::after{background:#ff4a4a}.tk-imp.lock b{color:#ff8a8a}
.tk-scope{position:absolute;inset:0;display:none;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 36%,#000d 62%)}
.tk-hud.fp .tk-scope{display:block}
.tk-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:11px;color:#fff9;background:#0006;padding:3px 10px;border-radius:10px;white-space:nowrap}
.tk-hud .hud-center{font-size:60px}
.tk-touch{position:absolute;inset:0;pointer-events:none;z-index:10}
.tk-zone{position:absolute;bottom:0;width:36%;height:68%;pointer-events:auto;touch-action:none}
.tk-zone.l{left:0}.tk-zone.r{right:0}
.tk-lbl{position:absolute;bottom:136px;color:#fff7;font-size:11px;text-shadow:0 1px 3px #000}
.tk-zone.l .tk-lbl{left:18px}.tk-zone.r .tk-lbl{right:12px;text-align:right}
.tk-base{position:absolute;width:108px;height:108px;margin:-54px 0 0 -54px;border-radius:50%;background:#fff1;border:2px solid #fff3;top:calc(100% - 84px)}
.tk-zone.l .tk-base{left:80px}.tk-zone.r .tk-base{left:calc(100% - 80px)}
.tk-base.active{background:#fff2}
.tk-knob{position:absolute;left:29px;top:29px;width:50px;height:50px;border-radius:50%;background:#ffffffaa;box-shadow:0 2px 10px #0008}
.tk-btns{position:absolute;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:8px;align-items:flex-end;pointer-events:auto}
.tk-btns .tb{width:54px;height:54px;font-size:20px;border-radius:14px;padding:0}
.tk-btns .tb small{font-size:9px;margin-top:2px}
.tk-btns .tb.fire{width:76px;height:76px;font-size:30px;border-radius:50%;border-color:var(--hot);background:#5a1a0acc}
.tk-btns .tb.mid{width:46px;height:46px;font-size:17px}
.tk-btns .tb.mid small{font-size:8px}
@media (hover:none){.tk-left{width:138px;top:46px}canvas.tk-mini{width:112px;height:80px;top:44px}.tk-hud .hud-center{font-size:38px}.tk-hud .toasts{top:70px}.tk-hud .toast{font-size:12px;padding:5px 10px}}
`;

export class TankGame implements MiniGame {
  // ----- three
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private parts: Particles;
  private styleEl: HTMLStyleElement;
  private hud: HTMLDivElement;
  private hudEl: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private toasts: { el: HTMLElement; t: number }[] = [];
  private resizeObs: ResizeObserver;
  private shells: Shell[] = [];
  private shellPool: THREE.Mesh[] = [];
  private wire: THREE.Line;
  private trail: [number, number][] = [];
  private audio = new TankAudio();
  private touch = false;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private disposed = false;
  private paused = false;
  private lastHud = 0;
  private lastMini = 0;

  // ----- sim
  level: Level;
  src: ControlSource;
  tanks: Tank[] = [];
  player!: Tank;
  marbles: Marble[] = [];
  pickups: Pickup[] = [];
  debris: Debris[] = [];
  cat: Cat | null = null;
  state: 'intro' | 'run' | 'won' | 'lost' | 'done' = 'intro';
  introT = 2.4;
  endT = 0;
  t = 0;
  elapsed = 0;
  bonus = 0;
  penalty = 0;
  kills = 0;
  shotsFired = 0;
  shotsHit = 0;
  rearHits = 0;
  longHits = 0;
  ricHits = 0;
  cleanKills = 0;
  tips = 0;
  catHits = 0;
  powerShots = 0;
  battery = 100;
  aimD = 22;
  autoFire = false;
  camMode = 0;
  momFreeze = 0;
  private momDone = false;
  private noDmgSince = true;
  private idleT = 0;
  private radioCool = 18;
  private lowWarned = false;
  private batWarned = false;
  private camYaw = 0;
  private shake = 0;
  private rng: () => number;
  private catPenaltyCool = 0;
  lockTarget: Tank | null = null;
  predicted = { x: 0, z: 0, y: 0, hit: false, d: 0 };
  endCalled = false;

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    resetMats();
    this.level = buildLevel(opts.level);
    const cfg = this.level.cfg;
    this.rng = mulberry32(cfg.seed * 7 + 1);
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.touch = isTouchDevice();
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    const shadows = !isTouchDevice();
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(cfg.dim ? 0x3a3040 : 0xf4ecd8);
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 220);

    // lights
    this.scene.add(new THREE.HemisphereLight(cfg.dim ? 0x8a7a9a : 0xfff3dc, cfg.dim ? 0x3a2a20 : 0x9a7a50, cfg.dim ? 0.9 : 1.25));
    this.sun = new THREE.DirectionalLight(cfg.dim ? 0xaaa0d0 : 0xfff0d0, cfg.dim ? 0.5 : 1.7);
    this.sun.position.set(cfg.hx * 0.35 + 14, 34, -cfg.hz + 14);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(1024, 1024);
      const sc = this.sun.shadow.camera;
      sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
    }
    this.scene.add(this.sun, this.sun.target);

    // world
    this.scene.add(buildRoom(this.level));
    this.scene.add(buildFloor(this.level));
    for (const o of this.level.obstacles) {
      const m = buildProp(o);
      m.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = shadows; });
      this.scene.add(m);
      if (o.type === 'lamp') {
        const pl = new THREE.PointLight(0xffc27a, 1100, 70, 1.6);
        pl.position.set(o.x, 12.8, o.z);
        this.scene.add(pl);
      }
    }
    this.parts = new Particles(this.scene, mobile ? 160 : 300);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
      m.visible = false;
      this.scene.add(m);
      this.shellPool.push(m);
    }
    // wire (유선 리모컨)
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    this.wire = new THREE.Line(wg, new THREE.LineBasicMaterial({ color: 0x111111 }));
    this.wire.frustumCulled = false;
    this.scene.add(this.wire);

    // actors
    this.player = this.spawnTank('player', cfg.start.x, cfg.start.z, cfg.start.yaw, 0);
    for (const e of cfg.enemies) {
      const t = this.spawnTank(e.kind, e.x, e.z, e.yaw, 1, e.patrol, !!e.sentry);
      void t;
    }
    for (const p of cfg.pickups) {
      const mesh = buildPickup(p.kind);
      mesh.position.set(p.x, this.level.terrain.h(p.x, p.z), p.z);
      this.scene.add(mesh);
      this.pickups.push({ kind: p.kind, x: p.x, z: p.z, got: false, mesh, ph: this.rng() * 6 });
    }
    this.spawnMarbles();
    if (cfg.cat) this.spawnCat(cfg.cat);
    this.camYaw = this.player.ty;

    // HUD
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    const h = (this.hud = document.createElement('div'));
    h.className = 'hud tk-hud';
    h.style.cssText = 'left:0;top:0;width:100%;height:100%';
    h.innerHTML = `
      <div class="tk-scope"></div>
      <div class="hud-top">
        <div class="hud-name" style="--pc:${hex6(opts.color)}">${escapeHtml(opts.nickname)}</div>
        <div class="hud-time" data-k="time">0:00.0</div>
        <div class="tk-en" data-k="en"></div>
        <div class="tk-adj" data-k="adj"></div>
      </div>
      <div class="tk-left">
        <div class="tk-bar hp"><span data-k="hpt"></span><div class="tr"><i data-k="hpb"></i></div></div>
        <div class="tk-bar bat"><span data-k="bt"></span><div class="tr"><i data-k="bb"></i></div></div>
        <div class="tk-bar rl"><span data-k="rt"></span><div class="tr"><i data-k="rb"></i></div></div>
        <div class="tk-pw" data-k="pw"></div>
      </div>
      <canvas class="tk-mini" width="276" height="196"></canvas>
      <div class="tk-cross"></div>
      <div class="tk-imp" data-k="imp"><i></i><b data-k="impd"></b></div>
      <div class="hud-center" data-k="center"></div>
      <div class="toasts"></div>
      ${this.touch ? '' : '<div class="tk-hint">WASD 주행 · Q/E 또는 ←/→ 포탑 · ↑/↓ 사거리 · Space 발사 · T 자동사격 · C 시점</div>'}`;
    container.appendChild(h);
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.hudEl[e.dataset.k!] = e));
    this.mini = h.querySelector('canvas')!;

    this.autoFire = this.touch;
    this.src = this.touch ? new TouchControls(container) : new KeyboardControls();
    this.src.setAutoUi?.(this.autoFire);
    this.audio.init();

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.toast(pick(RADIO.start, this.rng), 'radio');
    this.sync();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ construction helpers
  private spawnTank(kind: Kind, x: number, z: number, yaw: number, team: 0 | 1, patrol: [number, number][] = [], sentry = false): Tank {
    const cfg = this.level.cfg;
    const boss = kind === 'boss';
    const scale = boss ? 1.7 : 1;
    const hull = kind === 'player' ? 0x6a7a3a : kind === 'tiger' ? 0x8c939b : kind === 'panther' ? 0x9a8f6a : 0x34457a;
    const accent = kind === 'player' ? this.opts.color : kind === 'tiger' ? 0xc83a3a : kind === 'panther' ? 0xe0b020 : 0xc03030;
    const model = buildTank(hull, accent, scale, { boss, player: kind === 'player' });
    this.scene.add(model.root);
    const shadows = this.renderer.shadowMap.enabled;
    model.root.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = shadows; });
    const base = {
      player: { hp: 100, v: 5.4, rate: TUR_RATE, rl: 2.4, dmg: 24 },
      tiger: { hp: 72, v: 3.7, rate: 1.0, rl: 4.2, dmg: 14 },
      panther: { hp: 56, v: 4.6, rate: 1.25, rl: 3.6, dmg: 13 },
      boss: { hp: 170, v: 2.7, rate: 0.85, rl: 3.4, dmg: 20 },
    }[kind];
    const enemy = kind !== 'player';
    const t: Tank = {
      id: this.tanks.length, team, kind, x, z, yaw, y: 0, pitch: 0, roll: 0,
      vl: 0, vr: 0, cl: 0, cr: 0, sx: 0, sz: 0, vx: 0, vz: 0, speed: 0, ty: yaw, reload: enemy ? 2 + this.rng() * 3 : 0,
      hp: base.hp, maxHp: base.hp, alive: true, tipT: 0, tipAcc: 0, tipSide: 1,
      maxV: base.v * (enemy ? cfg.speedK : 1), scale, radius: 0.88 * scale, hitR: 1.15 * scale,
      armorF: boss ? 0.25 : 0.3, armorS: boss ? 0.9 : 1,
      rate: base.rate, reloadT: base.rl * (enemy ? cfg.reloadK : 1), dmg: base.dmg,
      hitFlash: 0, recoil: 0, sentry, model, smokeT: 0,
    };
    if (enemy) {
      t.ai = {
        state: 'patrol', st: 0, wp: 0, lastX: x, lastZ: z, alert: 0, strafe: this.rng() < 0.5 ? -1 : 1, strafeT: 2 + this.rng() * 3,
        stuckT: 0, px: x, pz: z, chkT: 0, unstick: 0, coverX: x, coverZ: z, coverCool: 0, pause: 0, burst: 0, burstT: 0, sees: false, losT: 0,
      };
      (t as Tank & { patrol: [number, number][] }).patrol = patrol.length ? patrol : [[x, z]];
      t.yaw = t.ty = yaw;
    }
    this.tanks.push(t);
    this.poseTank(t);
    return t;
  }

  private spawnMarbles() {
    const { hx, hz } = this.level.cfg;
    const n = this.level.cfg.marbles;
    for (let i = 0; i < n; i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 30; tries++) {
        x = (this.rng() - 0.5) * (hx * 2 - 8);
        z = (this.rng() - 0.5) * (hz * 2 - 8);
        const nearStart = Math.hypot(x - this.level.cfg.start.x, z - this.level.cfg.start.z) < 8;
        if (!nearStart && !this.level.obstacles.some((o) => pointInObs(x, z, o, 1.2)) && this.level.terrain.soft(x, z) < 0.2) break;
      }
      const mesh = buildMarble(i, 0.5);
      this.scene.add(mesh);
      this.marbles.push({ x, z, vx: 0, vz: 0, r: 0.5, mesh, y: 0, hitCool: 0 });
    }
  }

  private spawnCat(c: { x: number; z: number; yaw: number }) {
    const model = buildCat();
    this.scene.add(model.root);
    const obs: Obs = { kind: 'cyl', type: 'yogang', x: c.x, z: c.z, hx: 0, hz: 0, r: 2.1, rot: 0, h: 1.8, cos: 1, sin: 0, spec: [], tall: true };
    this.cat = { x: c.x, z: c.z, yaw: c.yaw, awake: false, t: 0, grump: 0, quiet: 0, swung: false, model, obs };
    this.level.obstacles.push(obs);
  }

  // ------------------------------------------------------------ public helpers
  setSource(s: ControlSource) {
    this.src.dispose();
    this.src = s;
    s.setAutoUi?.(this.autoFire);
  }

  enemies() { return this.tanks.filter((t) => t.team === 1); }
  enemiesLeft() { return this.tanks.filter((t) => t.team === 1 && t.alive).length; }
  netTime() { return this.elapsed + this.penalty - this.bonus; }

  snapshot() {
    const p = this.player;
    return {
      state: this.state, t: this.t, elapsed: this.elapsed, net: this.netTime(), bonus: this.bonus, penalty: this.penalty,
      player: { x: p.x, z: p.z, yaw: p.yaw, ty: p.ty, hp: p.hp, alive: p.alive, reload: p.reload, speed: p.speed, tip: p.tipT, y: p.y },
      battery: this.battery, aimD: this.aimD, left: this.enemiesLeft(), kills: this.kills,
      shotsFired: this.shotsFired, shotsHit: this.shotsHit,
      enemies: this.enemies().map((e) => ({ kind: e.kind, x: e.x, z: e.z, yaw: e.yaw, hp: e.hp, alive: e.alive, state: e.ai?.state, ty: e.ty, y: e.y })),
      shells: this.shells.length, marbles: this.marbles.map((m) => [m.x, m.z]),
    };
  }

  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.2 ? 75 : 62;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ toasts & hud
  toast(msg: string, cls: 'radio' | 'good' | 'bad' = 'radio') {
    const box = this.hud?.querySelector('.toasts');
    if (!box) return;
    if (this.toasts.some((x) => x.el.textContent === msg && this.t - x.t < 4)) return;
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = msg;
    box.appendChild(el);
    this.toasts.push({ el, t: this.t });
    while (this.toasts.length > 3) this.toasts.shift()!.el.remove();
    if (cls === 'radio') this.audio.radio();
  }

  private updateToasts() {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const a = this.t - this.toasts[i].t;
      if (a > 4.2) {
        this.toasts[i].el.remove();
        this.toasts.splice(i, 1);
      } else if (a > 3.6) this.toasts[i].el.classList.add('out');
    }
  }

  private addBonus(sec: number, why: string) {
    const room = BONUS_CAP - this.bonus;
    if (room <= 0) return;
    const s = Math.min(sec, room);
    this.bonus += s;
    this.toast(`⏱ −${s.toFixed(1)}초 ${why}`, 'good');
  }
  private addPenalty(sec: number, why: string) {
    this.penalty += sec;
    this.toast(`⏱ +${sec.toFixed(0)}초 ${why}`, 'bad');
  }

  private updateHud() {
    const e = this.hudEl;
    const p = this.player;
    const set = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };
    set(e.time, fmtTime(this.state === 'intro' ? 0 : this.elapsed));
    set(e.en, `🎯 적 ${this.enemiesLeft()}대`);
    const adj = this.penalty || this.bonus ? `${this.bonus ? `−${this.bonus.toFixed(1)}s ` : ''}${this.penalty ? '+' + this.penalty.toFixed(0) + 's' : ''}` : '';
    set(e.adj, adj);
    set(e.hpt, `🔩 부품 내구도 ${Math.max(0, Math.ceil(p.hp))}`);
    (e.hpb as HTMLElement).style.width = `${clamp(p.hp / p.maxHp, 0, 1) * 100}%`;
    e.hpb.parentElement!.parentElement!.classList.toggle('low', p.hp < 30);
    set(e.bt, `🔋 건전지 ${Math.round(this.battery)}%`);
    (e.bb as HTMLElement).style.width = `${this.battery}%`;
    e.bb.parentElement!.parentElement!.classList.toggle('low', this.battery < 20);
    const rl = p.reload > 0 ? 1 - p.reload / p.reloadT : 1;
    set(e.rt, p.reload > 0 ? `장전 중 ${p.reload.toFixed(1)}s` : this.powerShots > 0 ? '🧨 화약 장전 완료!' : '🟢 장전 완료');
    (e.rb as HTMLElement).style.width = `${rl * 100}%`;
    set(e.pw, `${this.powerShots > 0 ? `🧨 화약탄 ${this.powerShots}발 ` : ''}${this.autoFire ? '🤖 자동사격' : ''}${p.tipT > 0 ? ' 🙃 뒤집힘!' : ''}`);
    this.hud.classList.toggle('fp', this.camMode === 1);
    const c = e.center;
    if (this.state === 'intro') set(c, this.introT > 1.6 ? '준비...' : this.introT > 0.8 ? '조준!' : '출격!');
    else if (this.state === 'won') set(c, '🏆 전멸!');
    else if (this.state === 'lost') set(c, '💥 격파당함');
    else if (this.t - this.runStart < 1.2) set(c, '출격!');
    else set(c, '');
  }
  private runStart = 0;

  private updateImpactMarker() {
    const imp = this.hudEl.imp;
    const p = this.predicted;
    if (!this.player.alive || this.state === 'won') {
      imp.style.display = 'none';
      return;
    }
    const v = new THREE.Vector3(p.x, p.y + 0.1, p.z).project(this.camera);
    if (v.z > 1 || v.z < -1) {
      imp.style.display = 'none';
      return;
    }
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    imp.style.display = 'block';
    imp.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    imp.classList.toggle('lock', p.hit);
    this.hudEl.impd.textContent = `${Math.round(p.d)}m`;
  }

  private drawMini() {
    const cv = this.mini;
    const g = cv.getContext('2d')!;
    const { hx, hz } = this.level.cfg;
    const W = cv.width;
    const H = cv.height;
    const k = Math.min((W - 8) / (hx * 2), (H - 8) / (hz * 2));
    const px = (x: number) => W / 2 + x * k;
    const py = (z: number) => H / 2 + z * k;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#d6ae6288';
    g.fillRect(px(-hx), py(-hz), hx * 2 * k, hz * 2 * k);
    for (const a of this.level.terrain.hills) {
      g.fillStyle = a.h > 0 ? '#e8789a99' : '#3c9ea099';
      g.beginPath();
      g.arc(px(a.x), py(a.z), a.r * k, 0, 7);
      g.fill();
    }
    g.lineCap = 'round';
    for (const r of this.level.terrain.ridges) {
      g.strokeStyle = r.mat === 'wood' ? '#7a4a26' : '#e8789a';
      g.lineWidth = Math.max(2, r.w * k);
      g.beginPath();
      g.moveTo(px(r.x1), py(r.z1));
      g.lineTo(px(r.x2), py(r.z2));
      g.stroke();
    }
    g.fillStyle = '#3a2a1c';
    for (const o of this.level.obstacles) {
      if (o.kind === 'cyl') {
        g.beginPath();
        g.arc(px(o.x), py(o.z), Math.max(2, o.r * k), 0, 7);
        g.fill();
      } else {
        g.save();
        g.translate(px(o.x), py(o.z));
        g.rotate(o.rot);
        g.fillRect(-o.hx * k, -o.hz * k, o.hx * 2 * k, o.hz * 2 * k);
        g.restore();
      }
    }
    for (const pk of this.pickups) {
      if (pk.got) continue;
      g.fillStyle = pk.kind === 'bat' ? '#ffd400' : pk.kind === 'glue' ? '#2ee66b' : '#ff7a1f';
      g.fillRect(px(pk.x) - 3, py(pk.z) - 3, 6, 6);
    }
    for (const m of this.marbles) {
      g.fillStyle = '#9cf';
      g.fillRect(px(m.x) - 1, py(m.z) - 1, 3, 3);
    }
    for (const t of this.tanks) {
      if (!t.alive) continue;
      g.save();
      g.translate(px(t.x), py(t.z));
      g.rotate(t.yaw);
      g.fillStyle = t.team === 0 ? hex6(this.opts.color) : t.kind === 'boss' ? '#ff2a2a' : '#ff6a4a';
      const s = t.kind === 'boss' ? 8 : 5.5;
      g.beginPath();
      g.moveTo(0, -s * 1.3);
      g.lineTo(s, s);
      g.lineTo(-s, s);
      g.closePath();
      g.fill();
      if (t.team === 0) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
      g.restore();
      if (t.team === 0) {
        g.strokeStyle = '#ffe14a';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px(t.x), py(t.z));
        g.lineTo(px(t.x + Math.sin(t.ty) * 9), py(t.z - Math.cos(t.ty) * 9));
        g.stroke();
      }
    }
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
    this.render(dt, now);
  };

  /** advance the camera, meshes and HUD (not part of the deterministic sim) */
  render(dt: number, now = performance.now()) {
    this.sync();
    this.updateCamera(dt);
    if (now - this.lastHud > 80) {
      this.updateHud();
      this.lastHud = now;
    }
    if (now - this.lastMini > 150) {
      this.drawMini();
      this.lastMini = now;
    }
    this.updateImpactMarker();
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.lastFrame = performance.now();
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  // ------------------------------------------------------------ the simulation step
  step(dt: number) {
    this.t += dt;
    this.updateToasts();
    this.catPenaltyCool = Math.max(0, this.catPenaltyCool - dt);
    if (this.state === 'intro') {
      this.introT -= dt;
      if (this.introT <= 0) {
        this.state = 'run';
        this.runStart = this.t;
      }
    }
    if (this.state === 'run') this.elapsed += dt;
    const live = this.state === 'run';
    const c = this.src.read();
    if (c.cam) this.camMode = (this.camMode + 1) % 2;
    if (c.auto) {
      this.autoFire = !this.autoFire;
      this.src.setAutoUi?.(this.autoFire);
      this.toast(this.autoFire ? '🤖 자동사격 ON' : '🤖 자동사격 OFF', 'good');
    }
    if (live || this.state === 'intro') this.playerControl(c, dt, live);
    else this.player.cl = this.player.cr = 0;
    this.momFreeze = Math.max(0, this.momFreeze - dt);
    for (const t of this.tanks) {
      if (t.ai && t.alive) this.aiThink(t, dt);
    }
    for (const t of this.tanks) this.moveTank(t, dt);
    this.collide();
    this.updateShells(dt);
    this.updateMarbles(dt);
    this.updateCat(dt);
    this.updatePickups(dt);
    this.updateEvents(dt);
    this.updateFx(dt);
    this.parts.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.state === 'won' || this.state === 'lost') {
      this.endT += dt;
      if (this.endT > 1.8) this.finish();
    }
    const p = this.player;
    this.audio.update(Math.abs(p.speed) / p.maxV, Math.abs(p.vl - p.vr) / (2 * p.maxV), Math.abs(c.turret), this.battery / 100);
  }

  // ------------------------------------------------------------ player
  private quant(v: number) {
    const a = Math.abs(v);
    return a < 0.3 ? 0 : a < 0.72 ? 0.55 * Math.sign(v) : Math.sign(v);
  }

  private playerControl(c: Ctl, dt: number, live: boolean) {
    const p = this.player;
    if (!p.alive) return;
    if (!live) {
      p.cl = p.cr = 0;
      return;
    }
    p.cl = this.quant(clamp(c.drive + c.steer, -1, 1));
    p.cr = this.quant(clamp(c.drive - c.steer, -1, 1));
    if (p.tipT > 0) p.cl = p.cr = 0;
    // battery drain
    const use = (Math.abs(p.vl) + Math.abs(p.vr)) / (2 * p.maxV);
    this.battery = Math.max(0, this.battery - dt * (0.12 + use * 1.2 + Math.abs(c.turret) * 0.2));
    if (this.battery < 25 && !this.batWarned) {
      this.batWarned = true;
      this.toast(pick(RADIO.battery, this.rng), 'radio');
    }
    if (this.battery > 40) this.batWarned = false;
    // turret
    const tipped = p.tipT > 0;
    if (!tipped) {
      p.ty += c.turret * TUR_RATE * dt;
      this.aimD = clamp(this.aimD + c.elev * 15 * dt, MIN_RANGE, MAX_RANGE);
    }
    // aim assist
    const coneR = this.touch ? 0.2 : 0.09;
    const lock = this.findLock(coneR);
    this.lockTarget = lock;
    if (lock && !tipped) {
      const T = Math.hypot(lock.x - p.x, lock.z - p.z) / 24;
      const lx = lock.x + lock.vx * T * (this.touch ? 0.7 : 0.45);
      const lz = lock.z + lock.vz * T * (this.touch ? 0.7 : 0.45);
      const D = Math.hypot(lx - p.x, lz - p.z) - 2.1;
      this.aimD += (clamp(D, MIN_RANGE, MAX_RANGE) - this.aimD) * Math.min(1, 7 * dt);
      if (this.touch && Math.abs(c.turret) < 0.4) {
        const diff = wrap(Math.atan2(lx - p.x, -(lz - p.z)) - p.ty);
        p.ty += clamp(diff, -1.5 * dt, 1.5 * dt);
      }
    }
    this.predict();
    // fire
    p.reload = Math.max(0, p.reload - dt);
    p.recoil = Math.max(0, p.recoil - dt * 1.5);
    let want = c.fire;
    if (this.autoFire && lock && p.reload <= 0) {
      const diff = Math.abs(wrap(Math.atan2(lock.x - p.x, -(lock.z - p.z)) - p.ty));
      if (diff < 0.06 && this.predicted.hit) want = true;
    }
    if (want && !tipped) {
      if (p.reload <= 0) this.firePlayer();
    }
    if (c.fire && p.reload > 0 && this.idleT <= 0) {
      this.idleT = 0.4;
      this.audio.empty();
    }
    this.idleT = Math.max(0, this.idleT - dt);
  }

  private findLock(cone: number): Tank | null {
    const p = this.player;
    let best: Tank | null = null;
    let bs = 1e9;
    for (const e of this.tanks) {
      if (e.team !== 1 || !e.alive) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > MAX_RANGE + 3 || d < 3) continue;
      const diff = Math.abs(wrap(Math.atan2(dx, -dz) - p.ty));
      if (diff > cone * (1 + 2 / Math.max(1, d / 12))) continue;
      const s = diff * (1 + d / 50);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  private muzzle(t: Tank, yaw: number): [number, number, number] {
    const L = 2.15 * t.scale;
    return [t.x + Math.sin(yaw) * L, t.y + 1.12 * t.scale + 0.12, t.z - Math.cos(yaw) * L];
  }

  private spawnShell(t: Tank, yaw: number, D: number, power: boolean, yT: number) {
    const [mx, my, mz] = this.muzzle(t, yaw);
    const v = shotSpeed(my, D, yT);
    const ch = Math.cos(PITCH) * v;
    const mesh = this.shellPool.find((m) => !m.visible) ?? this.shellPool[0];
    mesh.visible = true;
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(power ? 0xff5a1f : t.team === 0 ? 0xffe14a : 0xd8e0ff);
    mesh.scale.setScalar(power ? 1.5 : 1);
    const s: Shell = {
      x: mx, y: my, z: mz, vx: Math.sin(yaw) * ch, vy: Math.sin(PITCH) * v, vz: -Math.cos(yaw) * ch,
      team: t.team, owner: t, power, ric: 0, life: 4, ox: t.x, oz: t.z, age: 0, trail: 0, dead: false, mesh,
    };
    this.shells.push(s);
    t.recoil = 1;
    this.parts.burst(mx, my, mz, 5, 0xfff2b0, 3, 0.12, 0.3);
    this.parts.spawn(mx, my, mz, 0, 0.5, 0, 0xffe9a0, 0.12, 0.7, 0, 3);
    const dp = Math.hypot(t.x - this.player.x, t.z - this.player.z);
    this.audio.shot(power, t.team === 1 ? dp : 0);
  }

  private firePlayer() {
    const p = this.player;
    const power = this.powerShots > 0;
    if (power) this.powerShots--;
    this.spawnShell(p, p.ty, this.aimD, power, this.aimYT);
    p.reload = power ? p.reloadT * 0.75 : p.reloadT;
    p.sx -= Math.sin(p.ty) * 1.6;
    p.sz += Math.cos(p.ty) * 1.6;
    this.shotsFired++;
    this.shake = Math.max(this.shake, 0.35);
    this.lastShotPower = power;
    // noise alerts nearby enemies
    for (const e of this.tanks) {
      if (e.team !== 1 || !e.alive || !e.ai) continue;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 42) {
        e.ai.alert = Math.max(e.ai.alert, 6);
        e.ai.lastX = p.x;
        e.ai.lastZ = p.z;
        if (e.ai.state === 'patrol') e.ai.state = 'hunt';
      }
    }
  }
  lastShotPower = false;
  aimYT = 0;

  // ------------------------------------------------------------ prediction (for the HUD marker and auto-fire)
  private predict() {
    const p = this.player;
    const [mx, my, mz] = this.muzzle(p, p.ty);
    const lk = this.lockTarget;
    const lockOk = !!lk && lk.alive && Math.abs(wrap(Math.atan2(lk.x - p.x, -(lk.z - p.z)) - p.ty)) < 0.25;
    this.aimYT = lockOk ? lk!.y + 0.7 : this.level.terrain.h(mx + Math.sin(p.ty) * this.aimD, mz - Math.cos(p.ty) * this.aimD);
    const v = shotSpeed(my, this.aimD, this.aimYT);
    const ch = Math.cos(PITCH) * v;
    let x = mx, y = my, z = mz;
    let vx = Math.sin(p.ty) * ch, vy = Math.sin(PITCH) * v, vz = -Math.cos(p.ty) * ch;
    let hit = false;
    const dt = 0.025;
    for (let i = 0; i < 160; i++) {
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const nz = z + vz * dt;
      vy -= G * dt;
      x = nx; y = ny; z = nz;
      for (const e of this.tanks) {
        if (e.team !== 1 || !e.alive) continue;
        if (Math.hypot(e.x - x, e.z - z) < e.hitR + 0.5 && y > e.y && y < e.y + 1.9 * e.scale) hit = true;
      }
      if (hit) break;
      if (y <= this.level.terrain.h(x, z) || Math.abs(x) > this.level.cfg.hx || Math.abs(z) > this.level.cfg.hz) break;
      let blocked = false;
      for (const o of this.level.obstacles) if (y < o.h && pointInObs(x, z, o)) { blocked = true; break; }
      if (blocked) break;
    }
    this.predicted = { x, z, y: Math.max(y, this.level.terrain.h(x, z)), hit, d: Math.hypot(x - p.x, z - p.z) };
  }

  // ------------------------------------------------------------ motion
  private motorFactor(t: Tank) {
    if (t.kind !== 'player') return this.momFreeze > 0 ? 0.3 : 1;
    const b = this.battery;
    if (b <= 0) return 0.22;
    return b > 25 ? 1 : 0.3 + 0.7 * (b / 25);
  }

  private moveTank(t: Tank, dt: number) {
    if (!t.alive) return;
    const terrain = this.level.terrain;
    t.hitFlash = Math.max(0, t.hitFlash - dt);
    if (t.tipT > 0) {
      t.tipT -= dt;
      t.cl = t.cr = 0;
      if (t.tipT <= 0) {
        t.tipT = 0;
        if (t === this.player) this.audio.flip();
      }
    }
    const mf = this.motorFactor(t);
    const tl = t.cl * t.maxV * mf;
    const tr = t.cr * t.maxV * mf;
    const A = 20; // jerky wired-remote motor: reaches full speed in ~0.27s
    t.vl += clamp(tl - t.vl, -A * dt, A * dt);
    t.vr += clamp(tr - t.vr, -A * dt, A * dt);
    const fx = Math.sin(t.yaw);
    const fz = -Math.cos(t.yaw);
    const soft = terrain.soft(t.x, t.z);
    const [gx, gz] = terrain.grad(t.x, t.z);
    const along = gx * fx + gz * fz;
    const slopeF = along > 0 ? 1 - Math.min(0.7, along * (0.8 + 0.5 * soft)) : 1 + Math.min(0.25, -along * 0.3);
    let fwd = ((t.vl + t.vr) / 2) * (1 - 0.25 * soft) * slopeF;
    const omega = ((t.vl - t.vr) * 0.2 * (1 - 0.2 * soft)) / Math.sqrt(t.scale);
    t.yaw += omega * dt;
    // slipping down steep blanket slopes, knock-back decay
    const gm = Math.hypot(gx, gz);
    const sl = clamp((gm - 0.3) / 0.45, 0, 1) * (soft > 0.2 ? 4.5 : 2.5);
    if (gm > 1e-4) {
      t.sx -= (gx / gm) * sl * dt;
      t.sz -= (gz / gm) * sl * dt;
    }
    const damp = Math.exp(-3.2 * dt);
    t.sx *= damp;
    t.sz *= damp;
    if (t.sentry && t.tipT <= 0) fwd *= 0.0;
    t.vx = fx * fwd + t.sx;
    t.vz = fz * fwd + t.sz;
    t.x += t.vx * dt;
    t.z += t.vz * dt;
    t.speed = fwd;
    // tip-over on steep ground at speed
    if (t.tipT <= 0) {
      const g2 = Math.hypot(...terrain.grad(t.x + fx * 0.8, t.z + fz * 0.8, 0.5));
      if (g2 > 0.6 && Math.abs(fwd) > 3.4 * Math.min(1.3, t.scale)) t.tipAcc += dt * (g2 > 0.8 ? 6 : 3);
      else t.tipAcc = Math.max(0, t.tipAcc - dt);
      if (t.tipAcc > 0.35) this.tipTank(t);
    }
    this.poseTank(t);
  }

  private tipTank(t: Tank) {
    t.tipAcc = 0;
    t.tipT = t.kind === 'boss' ? 3 : 3.6;
    t.tipSide = Math.random() < 0.5 ? -1 : 1;
    t.vl = t.vr = 0;
    this.parts.burst(t.x, t.y + 0.8, t.z, 8, 0xc8c8c8, 4, 0.14, 0.6);
    this.audio.clack(true);
    if (t === this.player) {
      this.tips++;
      this.addPenalty(4, '뒤집힘!');
      this.toast(pick(RADIO.tip, this.rng), 'radio');
      this.shake = 0.6;
    }
  }

  private poseTank(t: Tank) {
    const terrain = this.level.terrain;
    const L = 1.4 * t.scale;
    const W = 0.9 * t.scale;
    const fx = Math.sin(t.yaw);
    const fz = -Math.cos(t.yaw);
    const rx = Math.cos(t.yaw);
    const rz = Math.sin(t.yaw);
    const hF = terrain.h(t.x + fx * L, t.z + fz * L);
    const hB = terrain.h(t.x - fx * L, t.z - fz * L);
    const hR = terrain.h(t.x + rx * W, t.z + rz * W);
    const hL = terrain.h(t.x - rx * W, t.z - rz * W);
    const avg = (hF + hB + hR + hL) / 4;
    t.y = avg * 0.7 + Math.max(hF, hB, hR, hL) * 0.3;
    t.pitch = Math.atan2(hF - hB, 2 * L);
    t.roll = Math.atan2(hR - hL, 2 * W);
  }

  // ------------------------------------------------------------ collisions
  private collide() {
    const { hx, hz } = this.level.cfg;
    const obs = this.level.obstacles;
    const alive = this.tanks.filter((t) => t.alive);
    for (const t of alive) {
      const off = t.kind === 'boss' ? 0.95 : 0.55;
      for (let pass = 0; pass < 2; pass++) {
        for (const o of [-off, off]) {
          let cx = t.x + Math.sin(t.yaw) * o;
          let cz = t.z - Math.cos(t.yaw) * o;
          for (const ob of obs) {
            const r = circleVsObs(cx, cz, t.radius, ob);
            if (!r) continue;
            t.x += r[0] * r[2];
            t.z += r[1] * r[2];
            cx += r[0] * r[2];
            cz += r[1] * r[2];
            const vn = t.sx * r[0] + t.sz * r[1];
            if (vn < 0) { t.sx -= vn * r[0]; t.sz -= vn * r[1]; }
          }
          const mx = hx - t.radius - 0.2;
          const mz = hz - t.radius - 0.2;
          if (cx > mx) t.x -= cx - mx;
          else if (cx < -mx) t.x -= cx + mx;
          if (cz > mz) t.z -= cz - mz;
          else if (cz < -mz) t.z -= cz + mz;
        }
      }
    }
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = (a.radius + b.radius) * 1.25;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }
  }

  // ------------------------------------------------------------ shells
  private updateShells(dt: number) {
    const sub = 3;
    const h = dt / sub;
    for (const s of this.shells) {
      for (let k = 0; k < sub && !s.dead; k++) this.stepShell(s, h);
      s.life -= dt;
      if (s.life <= 0) s.dead = true;
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      if (this.shells[i].dead) {
        this.shells[i].mesh.visible = false;
        this.shells.splice(i, 1);
      }
    }
  }

  private stepShell(s: Shell, dt: number) {
    const px = s.x;
    const py = s.y;
    const pz = s.z;
    s.vy -= G * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    s.age += dt;
    s.trail -= dt;
    if (s.trail <= 0) {
      s.trail = 0.035;
      this.parts.spawn(s.x, s.y, s.z, 0, 0, 0, s.power ? 0xffa060 : 0xffffff, 0.35, 0.1, 0);
    }
    s.mesh.position.set(s.x, s.y, s.z);
    const { hx, hz } = this.level.cfg;
    // walls: ricochet once
    for (const [ax, lim] of [['x', hx - 0.25], ['z', hz - 0.25]] as const) {
      const v = s[ax];
      if (Math.abs(v) > lim && s.y < 14) {
        if (s.ric >= 1) return this.explode(s, px, py, pz);
        s.ric++;
        s[ax] = Math.sign(v) * lim;
        if (ax === 'x') s.vx *= -0.7; else s.vz *= -0.7;
        s.vy *= 0.7;
        this.ricochetFx(s);
        return;
      }
    }
    // obstacles
    for (const o of this.level.obstacles) {
      if (s.y >= o.h || !pointInObs(s.x, s.z, o)) continue;
      if (this.cat && o === this.cat.obs) return this.hitCat(s);
      if (py >= o.h - 0.05) return this.explode(s, px, py, pz);
      // find the face we came through
      let nx = 0;
      let nz = 0;
      if (o.kind === 'cyl') {
        const d = Math.hypot(px - o.x, pz - o.z) || 1;
        nx = (px - o.x) / d;
        nz = (pz - o.z) / d;
      } else {
        const dx = px - o.x;
        const dz = pz - o.z;
        const lx = dx * o.cos + dz * o.sin;
        const lz = -dx * o.sin + dz * o.cos;
        const ex = Math.abs(lx) - o.hx;
        const ez = Math.abs(lz) - o.hz;
        let lnx = 0;
        let lnz = 0;
        if (ex > ez) lnx = Math.sign(lx) || 1; else lnz = Math.sign(lz) || 1;
        nx = lnx * o.cos - lnz * o.sin;
        nz = lnx * o.sin + lnz * o.cos;
      }
      if (s.ric >= 1) return this.explode(s, px, py, pz);
      s.ric++;
      const dn = s.vx * nx + s.vz * nz;
      s.vx = (s.vx - 2 * dn * nx) * 0.7;
      s.vz = (s.vz - 2 * dn * nz) * 0.7;
      s.vy *= 0.7;
      s.x = px;
      s.z = pz;
      this.ricochetFx(s);
      return;
    }
    // marbles
    for (const m of this.marbles) {
      if (Math.hypot(m.x - s.x, m.z - s.z) < m.r + 0.2 && s.y < 1.2) {
        m.vx += s.vx * 0.35;
        m.vz += s.vz * 0.35;
        this.audio.marble();
        return this.explode(s, px, py, pz);
      }
    }
    // tanks
    for (const t of this.tanks) {
      if (!t.alive || t.team === s.team) continue;
      if (Math.hypot(t.x - s.x, t.z - s.z) < t.hitR && s.y > t.y && s.y < t.y + 1.9 * t.scale) {
        this.hitTank(s, t);
        s.dead = true;
        return;
      }
    }
    // ground
    if (s.y <= this.level.terrain.h(s.x, s.z) + 0.02) this.explode(s, px, py, pz);
  }

  private ricochetFx(s: Shell) {
    this.parts.burst(s.x, s.y, s.z, 6, 0xffe9a0, 4, 0.1, 0.3);
    this.audio.ping();
  }

  private explode(s: Shell, x: number, y: number, z: number) {
    s.dead = true;
    const gy = Math.max(this.level.terrain.h(x, z), 0.05);
    void y;
    this.parts.burst(x, gy + 0.2, z, 8, s.power ? 0xff8a3a : 0xc9a35a, 4.5, 0.17, 0.6);
    this.parts.burst(x, gy + 0.3, z, 3, 0xfff0c0, 2, 0.28, 0.25);
    this.audio.boom(false);
    const R = s.power ? 2.6 : 1.8;
    for (const t of this.tanks) {
      if (!t.alive || t.team === s.team) continue;
      const d = Math.hypot(t.x - x, t.z - z) - t.radius * 0.5;
      if (d < R) {
        const k = 1 - Math.max(0, d) / R;
        this.damage(t, s.owner.dmg * 0.3 * k * (s.power ? 2 : 1), s, 'splash');
      }
    }
    // splash pushes marbles
    for (const m of this.marbles) {
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < 3 && d > 0.01) {
        m.vx += ((m.x - x) / d) * 5;
        m.vz += ((m.z - z) / d) * 5;
      }
    }
  }

  private hitCat(s: Shell) {
    s.dead = true;
    this.parts.burst(s.x, s.y, s.z, 6, 0xe39b4a, 3, 0.15, 0.5);
    if (s.team === 0 && this.cat) {
      this.cat.awake = true;
      this.cat.t = 1.6;
      this.cat.quiet = 0;
      if (this.catPenaltyCool <= 0) {
        this.catPenaltyCool = 5;
        this.catHits++;
        this.addPenalty(6, '고양이를 쐈다!');
        this.toast('📢 엄마: 야! 고양이 건드리지 마라!', 'radio');
      }
      this.audio.meow();
    }
  }

  /** resolves one shell hitting a tank (armor by facing) */
  private hitTank(s: Shell, t: Tank) {
    const l = Math.hypot(s.vx, s.vz) || 1;
    const dx = s.vx / l;
    const dz = s.vz / l;
    const c = dx * Math.sin(t.yaw) + dz * -Math.cos(t.yaw);
    let face: 'front' | 'side' | 'rear';
    let mult: number;
    if (c < -0.5) { face = 'front'; mult = s.power ? 0.8 : t.armorF; }
    else if (c > 0.5) { face = 'rear'; mult = 1.7; }
    else { face = 'side'; mult = t.armorS; }
    const dmg = s.owner.dmg * (s.power ? 2 : 1) * mult;
    t.sx += dx * (s.power ? 5 : 3);
    t.sz += dz * (s.power ? 5 : 3);
    this.parts.burst(s.x, s.y, s.z, face === 'front' ? 6 : 10, face === 'front' ? 0xffffff : t.team === 1 ? 0x9aa0a8 : 0x6a7a3a, 5, 0.13, 0.7);
    if (face === 'front') this.audio.ping(); else this.audio.clack(true);
    if (s.team === 0) {
      this.shotsHit++;
      const dist = Math.hypot(s.ox - t.x, s.oz - t.z);
      if (face === 'rear') {
        this.rearHits++;
        this.addBonus(2, '후방 명중!');
        if (this.rng() < 0.5) this.toast(pick(RADIO.rear, this.rng), 'radio');
      }
      if (dist > 28) {
        this.longHits++;
        this.addBonus(1.5, '원거리 명중!');
      }
      if (s.ric > 0) {
        this.ricHits++;
        this.addBonus(3, '도탄 명중!');
      }
      if (face === 'front' && t.kind !== 'boss' && this.rng() < 0.4) this.toast(pick(RADIO.front, this.rng), 'radio');
    }
    this.damage(t, dmg, s, face);
  }

  private damage(t: Tank, dmg: number, s: Shell | null, _face: string) {
    if (!t.alive || dmg <= 0) return;
    if (t === this.player && (this.state === 'won' || this.state === 'done')) return;
    t.hp -= dmg;
    t.hitFlash = 0.15;
    if (t.team === 1 && t.ai) {
      t.ai.alert = Math.max(t.ai.alert, 8);
      t.ai.lastX = this.player.x;
      t.ai.lastZ = this.player.z;
      if (t.ai.state === 'patrol') t.ai.state = 'hunt';
    }
    if (t === this.player) {
      this.noDmgSince = false;
      this.shake = Math.max(this.shake, 0.8);
      if (dmg > 3 && this.rng() < 0.5) this.toast(pick(RADIO.hurt, this.rng), 'radio');
      if (t.hp < 30 && !this.lowWarned) {
        this.lowWarned = true;
        this.toast(pick(RADIO.low, this.rng), 'radio');
      }
    }
    if (t.hp <= 0) this.destroyTank(t, s);
  }

  private destroyTank(t: Tank, s: Shell | null) {
    t.alive = false;
    t.hp = 0;
    t.cl = t.cr = 0;
    const m = t.model;
    this.parts.burst(t.x, t.y + 0.9, t.z, 22, t.team === 1 ? 0x8c939b : 0x6a7a3a, 8, 0.2, 1.1);
    this.parts.burst(t.x, t.y + 0.9, t.z, 10, 0xff9a3a, 6, 0.3, 0.5);
    this.audio.boom(true);
    this.shake = Math.max(this.shake, 1.0);
    // pop the turret off like a snapped kit part
    const wp = new THREE.Vector3();
    m.turret.getWorldPosition(wp);
    this.scene.attach(m.turret);
    this.debris.push({ o: m.turret, vx: (Math.random() - 0.5) * 6, vy: 9 + Math.random() * 3, vz: (Math.random() - 0.5) * 6, sx: (Math.random() - 0.5) * 8, sy: (Math.random() - 0.5) * 8, life: 6 });
    for (const w of [...m.wheels[0], ...m.wheels[1]].slice(0, 4)) {
      this.scene.attach(w);
      this.debris.push({ o: w, vx: (Math.random() - 0.5) * 9, vy: 5 + Math.random() * 5, vz: (Math.random() - 0.5) * 9, sx: 6, sy: 3, life: 5 });
    }
    for (const mt of m.tintable) mt.color.multiplyScalar(0.3);
    if (t === this.player) {
      this.state = 'lost';
      this.endT = 0;
      this.audio.lose();
      this.toast('📢 형: 으하하 내가 이겼다!', 'radio');
      return;
    }
    this.kills++;
    if (s && s.team === 0) {
      if (this.noDmgSince) {
        this.cleanKills++;
        this.addBonus(2, '무피해 격파!');
      }
      this.noDmgSince = true;
    }
    if (this.rng() < 0.7) this.toast(pick(RADIO.kill, this.rng), 'radio');
    if (this.enemiesLeft() === 0 && this.state === 'run') {
      this.state = 'won';
      this.endT = 0;
      this.audio.win();
    }
  }

  // ------------------------------------------------------------ enemy AI
  private los(x1: number, z1: number, x2: number, z2: number) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.ceil(d / 1.5));
    const h1 = this.level.terrain.h(x1, z1);
    const h2 = this.level.terrain.h(x2, z2);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const x = x1 + (x2 - x1) * k;
      const z = z1 + (z2 - z1) * k;
      for (const o of this.level.obstacles) if (o.tall && pointInObs(x, z, o)) return false;
      if (this.level.terrain.h(x, z) > Math.max(h1, h2) + 1.3) return false;
    }
    return true;
  }

  private blockedAt(x: number, z: number) {
    const { hx, hz } = this.level.cfg;
    if (Math.abs(x) > hx - 2 || Math.abs(z) > hz - 2) return true;
    for (const o of this.level.obstacles) if (pointInObs(x, z, o, 1.1)) return true;
    return Math.hypot(...this.level.terrain.grad(x, z)) > 0.55;
  }

  /** set track commands so that t drives toward (tx,tz). gear 0..1; rev=true reverses */
  private driveToward(t: Tank, tx: number, tz: number, gear: number, rev = false) {
    let ang = Math.atan2(tx - t.x, -(tz - t.z));
    if (rev) ang = wrap(ang + Math.PI);
    let diff = wrap(ang - t.yaw);
    // feelers
    const dirx = Math.sin(t.yaw) * (rev ? -1 : 1);
    const dirz = -Math.cos(t.yaw) * (rev ? -1 : 1);
    if (!t.sentry) {
      const f1 = this.blockedAt(t.x + dirx * 3, t.z + dirz * 3) || this.blockedAt(t.x + dirx * 5.2, t.z + dirz * 5.2);
      if (f1) {
        const a = t.yaw + (rev ? Math.PI : 0);
        const lx = t.x + Math.sin(a - 0.9) * 4;
        const lz = t.z - Math.cos(a - 0.9) * 4;
        const rx = t.x + Math.sin(a + 0.9) * 4;
        const rz = t.z - Math.cos(a + 0.9) * 4;
        const lb = this.blockedAt(lx, lz);
        const rb = this.blockedAt(rx, rz);
        diff = lb && !rb ? 1 : rb && !lb ? -1 : t.ai ? t.ai.strafe : 1;
        gear *= 0.6;
      }
    }
    const s = rev ? -1 : 1;
    if (Math.abs(diff) > 0.6) {
      t.cl = diff > 0 ? gear : -gear;
      t.cr = -t.cl;
    } else if (Math.abs(diff) > 0.12) {
      t.cl = s * gear * (diff > 0 ? 1 : 0.4);
      t.cr = s * gear * (diff > 0 ? 0.4 : 1);
    } else {
      t.cl = t.cr = s * gear;
    }
    if (t.sentry) t.cl = t.cr = 0;
  }

  /** pivot the hull in place so the thick front armor points at (tx,tz) */
  private faceHull(t: Tank, tx: number, tz: number) {
    const diff = wrap(Math.atan2(tx - t.x, -(tz - t.z)) - t.yaw);
    if (Math.abs(diff) > 0.25) {
      t.cl = diff > 0 ? 0.55 : -0.55;
      t.cr = -t.cl;
    }
  }

  private aimTurret(t: Tank, tx: number, tz: number, dt: number) {
    const diff = wrap(Math.atan2(tx - t.x, -(tz - t.z)) - t.ty);
    t.ty += clamp(diff, -t.rate * dt, t.rate * dt);
    return Math.abs(diff);
  }

  private aiThink(t: Tank, dt: number) {
    const ai = t.ai!;
    const p = this.player;
    t.cl = t.cr = 0;
    t.reload = Math.max(0, t.reload - dt);
    t.recoil = Math.max(0, t.recoil - dt * 1.5);
    ai.coverCool = Math.max(0, ai.coverCool - dt);
    ai.pause = Math.max(0, ai.pause - dt);
    ai.st += dt;
    ai.alert = Math.max(0, ai.alert - dt);
    if (t.tipT > 0 || this.state === 'intro') return;
    const cfg = this.level.cfg;
    const frozen = this.momFreeze > 0;
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const dist = Math.hypot(dx, dz);
    ai.losT -= dt;
    if (ai.losT <= 0) {
      ai.losT = 0.15;
      ai.sees = p.alive && dist < cfg.sight * (t.kind === 'boss' ? 1.25 : 1) && this.los(t.x, t.z, p.x, p.z);
    }
    if (ai.sees) {
      ai.lastX = p.x;
      ai.lastZ = p.z;
      ai.alert = Math.max(ai.alert, 5);
    }
    if (!p.alive) {
      ai.state = 'patrol';
    } else if (ai.state === 'patrol' || ai.state === 'hunt') {
      if (ai.sees) { ai.state = 'engage'; ai.st = 0; t.reload = Math.max(t.reload, 1.4 + this.rng() * 1.2); }
      else if (ai.alert > 0) ai.state = 'hunt';
      else ai.state = 'patrol';
    } else if (ai.state === 'engage') {
      if (!ai.sees && ai.alert <= 0) { ai.state = 'hunt'; ai.st = 0; }
    }
    if (ai.state !== 'cover' && t.hp < t.maxHp * 0.35 && t.kind !== 'boss' && ai.coverCool <= 0 && p.alive && !t.sentry) {
      const c = this.pickCover(t);
      if (c) { ai.state = 'cover'; ai.st = 0; ai.coverX = c[0]; ai.coverZ = c[1]; }
    }
    const patrol = (t as Tank & { patrol: [number, number][] }).patrol;
    const slow = frozen ? 0.4 : 1;
    // stuck detection
    ai.chkT += dt;
    if (ai.chkT > 1.4) {
      const moved = Math.hypot(t.x - ai.px, t.z - ai.pz);
      if (moved < 0.5 && ai.pause <= 0 && !t.sentry && ai.state !== 'cover') ai.unstick = 1.0;
      ai.px = t.x;
      ai.pz = t.z;
      ai.chkT = 0;
    }
    if (ai.unstick > 0) {
      ai.unstick -= dt;
      t.cl = -0.7;
      t.cr = -0.4 * ai.strafe;
      this.aimTurret(t, t.x + Math.sin(t.yaw) * 10, t.z - Math.cos(t.yaw) * 10, dt);
      return;
    }
    switch (ai.state) {
      case 'patrol': {
        const w = patrol[ai.wp % patrol.length];
        if (Math.hypot(w[0] - t.x, w[1] - t.z) < 2.5) {
          ai.wp++;
          ai.pause = 1 + this.rng() * 1.5;
        }
        if (ai.pause <= 0 && patrol.length > 1) this.driveToward(t, w[0], w[1], 0.55 * slow);
        const sweep = t.yaw + Math.sin(this.t * 0.7 + t.id) * 0.8;
        this.aimTurret(t, t.x + Math.sin(sweep) * 10, t.z - Math.cos(sweep) * 10, dt);
        break;
      }
      case 'hunt': {
        if (Math.hypot(ai.lastX - t.x, ai.lastZ - t.z) > 8 || t.sentry) this.driveToward(t, ai.lastX, ai.lastZ, 1 * slow);
        this.aimTurret(t, ai.lastX, ai.lastZ, dt);
        break;
      }
      case 'engage': {
        const dd = t.kind === 'boss' ? 19 : t.kind === 'tiger' ? 17 : 14;
        const err = this.aimTurret(t, p.x, p.z, dt);
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 2.5 + this.rng() * 3; }
        if (ai.pause <= 0 && !t.sentry) {
          if (dist > dd + 4) this.driveToward(t, p.x, p.z, slow);
          else if (dist < dd - 5) this.driveToward(t, t.x - dx, t.z - dz, 0.8 * slow, true);
          else if (ai.strafeT < 1.3) {
            // short sidesteps so the player cannot just sit in front of the barrel
            const k = ai.strafe;
            this.driveToward(t, t.x + -dz * k, t.z + dx * k, 0.55 * slow);
          } else this.faceHull(t, p.x, p.z);
        } else if (!t.sentry) this.faceHull(t, p.x, p.z);
        if (ai.sees && !frozen && t.reload <= 0 && err < 0.05 && dist < cfg.sight + 6 && dist > 4) this.enemyFire(t, p);
        if (ai.burst > 0) {
          ai.burstT -= dt;
          if (ai.burstT <= 0 && !frozen) { ai.burst--; ai.burstT = 0.5; this.enemyFire(t, p, true); }
        }
        break;
      }
      case 'cover': {
        const near = Math.hypot(ai.coverX - t.x, ai.coverZ - t.z) < 2;
        if (!near) this.driveToward(t, ai.coverX, ai.coverZ, 1 * slow);
        this.aimTurret(t, p.x, p.z, dt);
        if (ai.st > 9 || (near && ai.st > 4 && t.reload <= 0)) {
          ai.state = 'engage';
          ai.coverCool = 14;
          ai.st = 0;
        }
        break;
      }
    }
  }

  private pickCover(t: Tank): [number, number] | null {
    const p = this.player;
    let best: [number, number] | null = null;
    let bd = 40;
    for (const o of this.level.obstacles) {
      if (!o.tall) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d > bd) continue;
      const rad = (o.kind === 'cyl' ? o.r : Math.max(o.hx, o.hz)) + 2.4;
      const ax = o.x - p.x;
      const az = o.z - p.z;
      const al = Math.hypot(ax, az) || 1;
      const cx = o.x + (ax / al) * rad;
      const cz = o.z + (az / al) * rad;
      if (this.blockedAt(cx, cz)) continue;
      bd = d;
      best = [cx, cz];
    }
    return best;
  }

  private enemyFire(t: Tank, p: Tank, second = false) {
    const ai = t.ai!;
    const cfg = this.level.cfg;
    const dist = Math.hypot(p.x - t.x, p.z - t.z);
    const sigma = cfg.errK * (0.6 + 0.045 * dist);
    const gauss = () => (this.rng() + this.rng() + this.rng() - 1.5) * 1.15;
    const yawErr = (gauss() * sigma) / Math.max(6, dist);
    const D = Math.max(MIN_RANGE, (dist - 1.8) * (1 + gauss() * 0.045 * cfg.errK));
    this.spawnShell(t, t.ty + yawErr, D, false, p.y + 0.7);
    if (!second) {
      t.reload = t.reloadT * (0.85 + this.rng() * 0.3);
      ai.pause = 0.7;
      if (t.kind === 'boss') { ai.burst = 1; ai.burstT = 0.5; }
    }
    t.sx -= Math.sin(t.ty) * 1.0;
    t.sz += Math.cos(t.ty) * 1.0;
  }

  // ------------------------------------------------------------ marbles / cat / pickups / events
  private updateMarbles(dt: number) {
    const { hx, hz } = this.level.cfg;
    const terrain = this.level.terrain;
    for (const m of this.marbles) {
      m.hitCool = Math.max(0, m.hitCool - dt);
      const [gx, gz] = terrain.grad(m.x, m.z, 0.4);
      m.vx -= gx * 14 * dt;
      m.vz -= gz * 14 * dt;
      const drag = Math.exp(-0.45 * dt);
      m.vx *= drag;
      m.vz *= drag;
      m.x += m.vx * dt;
      m.z += m.vz * dt;
      if (Math.abs(m.x) > hx - m.r) { m.x = Math.sign(m.x) * (hx - m.r); m.vx *= -0.8; }
      if (Math.abs(m.z) > hz - m.r) { m.z = Math.sign(m.z) * (hz - m.r); m.vz *= -0.8; }
      for (const o of this.level.obstacles) {
        const r = circleVsObs(m.x, m.z, m.r, o);
        if (!r) continue;
        if (this.cat && o === this.cat.obs && Math.hypot(m.vx, m.vz) < 0.5) continue;
        m.x += r[0] * r[2];
        m.z += r[1] * r[2];
        const dn = m.vx * r[0] + m.vz * r[1];
        if (dn < 0) { m.vx -= 1.8 * dn * r[0]; m.vz -= 1.8 * dn * r[1]; if (dn < -2) this.audio.marble(); }
      }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        for (const off of [-0.55, 0.55]) {
          const cx = t.x + Math.sin(t.yaw) * off * t.scale;
          const cz = t.z - Math.cos(t.yaw) * off * t.scale;
          const dx = m.x - cx;
          const dz = m.z - cz;
          const d = Math.hypot(dx, dz);
          const rr = t.radius + m.r;
          if (d < rr && d > 1e-4) {
            const nx = dx / d;
            const nz = dz / d;
            const rel = (m.vx - t.vx) * nx + (m.vz - t.vz) * nz;
            m.x += nx * (rr - d);
            m.z += nz * (rr - d);
            if (rel < 0) {
              m.vx += -1.9 * rel * nx + t.vx * 0.6;
              m.vz += -1.9 * rel * nz + t.vz * 0.6;
              if (rel < -2) this.audio.marble();
            }
            // a fast rolling marble stings
            const sp = Math.hypot(m.vx - t.vx, m.vz - t.vz);
            if (sp > 7 && m.hitCool <= 0 && Math.hypot(m.vx, m.vz) > 6) {
              m.hitCool = 0.8;
              t.sx += nx * -2;
              t.sz += nz * -2;
              this.parts.burst(m.x, 0.8, m.z, 5, 0xc8c8c8, 3, 0.12, 0.5);
              this.audio.clack(true);
              this.damage(t, 6, null, 'marble');
              if (t === this.player) this.toast('🔵 구슬에 맞았다!', 'bad');
            }
          }
        }
      }
      m.y = terrain.h(m.x, m.z) + m.r;
      m.mesh.position.set(m.x, m.y, m.z);
      m.mesh.rotation.x += (m.vz * dt) / m.r;
      m.mesh.rotation.z -= (m.vx * dt) / m.r;
    }
  }

  private updateCat(dt: number) {
    const c = this.cat;
    if (!c) return;
    let near: Tank | null = null;
    let nd = 1e9;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      if (d < nd) { nd = d; near = t; }
    }
    if (!c.awake) {
      if (nd < 8 && near === this.player) c.grump += dt;
      else c.grump = Math.max(0, c.grump - dt);
      if (c.grump > 1.4) {
        c.awake = true;
        c.t = 0;
        c.quiet = 0;
        this.toast('🐱 고양이가 눈을 떴다!', 'bad');
        this.audio.meow();
      }
    } else {
      c.t += dt;
      c.quiet = nd < 15 ? 0 : c.quiet + dt;
      if (c.quiet > 8) c.awake = false;
      if (near && nd < 14) c.yaw += clamp(wrap(Math.atan2(near.x - c.x, -(near.z - c.z)) - c.yaw), -1.5 * dt, 1.5 * dt);
      const phase = c.t % 3.4;
      if (phase < 0.05) c.swung = false;
      if (phase > 2.75 && !c.swung) {
        c.swung = true;
        for (const t of this.tanks) {
          if (!t.alive) continue;
          const dx = t.x - c.x;
          const dz = t.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < 6.8 && Math.abs(wrap(Math.atan2(dx, -dz) - c.yaw)) < 0.9) {
            t.sx += (dx / d) * 11;
            t.sz += (dz / d) * 11;
            this.damage(t, 14, null, 'cat');
            if (t.tipT <= 0) this.tipTank(t);
            this.audio.meow();
            if (t === this.player) this.toast('🐱 고양이 냥펀치!', 'bad');
          }
        }
      }
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (const k of this.pickups) {
      if (k.got) continue;
      k.ph += dt;
      if (!p.alive || this.state !== 'run') continue;
      if (Math.hypot(k.x - p.x, k.z - p.z) < 1.9) {
        k.got = true;
        k.mesh.visible = false;
        this.audio.pick();
        if (k.kind === 'bat') {
          this.battery = Math.min(100, this.battery + 45);
          this.toast('🔋 새 건전지! 모터 팡팡', 'good');
        } else if (k.kind === 'glue') {
          p.hp = Math.min(p.maxHp, p.hp + 38);
          this.lowWarned = false;
          this.toast('🧴 본드 칠! 부품 내구도 +38', 'good');
        } else {
          this.powerShots += 1;
          this.toast('🧨 화약! 다음 한 발은 강력탄', 'good');
        }
      }
    }
  }

  private updateEvents(dt: number) {
    if (this.state !== 'run') return;
    if (!this.momDone && this.elapsed >= this.level.cfg.momAt) {
      this.momDone = true;
      this.momFreeze = 7;
      this.toast('📢 엄마: 밥 먹어라~~~!', 'radio');
      this.audio.bell();
      this.mom2 = 2.2;
    }
    if (this.mom2 > 0) {
      this.mom2 -= dt;
      if (this.mom2 <= 0) this.toast('📢 형: 잠깐만! 밥 먹고 올게! (적 전차 정지 7초)', 'radio');
    }
    if (this.momDone && this.momFreeze <= 0 && !this.momEnd) {
      this.momEnd = true;
      this.toast('📢 형: 밥 먹었다! 다시 붙자!', 'radio');
    }
    this.radioCool -= dt;
    if (this.radioCool <= 0) {
      this.radioCool = 24 + this.rng() * 12;
      this.toast(pick(RADIO.idle, this.rng), 'radio');
    }
  }
  private mom2 = 0;
  private momEnd = false;

  private updateFx(dt: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vy -= 20 * dt;
      d.o.position.x += d.vx * dt;
      d.o.position.y += d.vy * dt;
      d.o.position.z += d.vz * dt;
      d.o.rotation.x += d.sx * dt;
      d.o.rotation.z += d.sy * dt;
      const gy = this.level.terrain.h(d.o.position.x, d.o.position.z) + 0.25;
      if (d.o.position.y < gy) {
        d.o.position.y = gy;
        d.vy = Math.abs(d.vy) * 0.3;
        d.vx *= 0.6;
        d.vz *= 0.6;
        d.sx *= 0.5;
        d.sy *= 0.5;
      }
    }
    for (const t of this.tanks) {
      if (t.alive) continue;
      t.smokeT -= dt;
      if (t.smokeT <= 0) {
        t.smokeT = 0.18;
        this.parts.spawn(t.x + (Math.random() - 0.5) * 0.6, t.y + 1.0, t.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 1.6, (Math.random() - 0.5) * 0.4, 0x3a3a3a, 1.4, 0.4, -1, 0.9);
      }
    }
    // remote-control wire trail
    const p = this.player;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last[0] - p.x, last[1] - p.z) > 0.7) {
      this.trail.push([p.x, p.z]);
      if (this.trail.length > 38) this.trail.shift();
    }
  }

  private finish() {
    if (this.endCalled) return;
    this.endCalled = true;
    this.state = 'done';
    const win = this.player.alive;
    const net = this.netTime();
    const total = win ? Math.max(1, net) : Math.max(1, net + DEATH_PENALTY);
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    const detail = [
      { label: '순수 전투 시간', value: fmtTime(this.elapsed) },
      { label: '격파 / 전체', value: `${this.kills} / ${this.enemies().length}` },
      { label: '명중률', value: `${acc}% (${this.shotsHit}/${this.shotsFired})` },
      { label: '후방 · 원거리 · 도탄', value: `${this.rearHits} · ${this.longHits} · ${this.ricHits}` },
      { label: '무피해 격파', value: `${this.cleanKills}회` },
      { label: '뒤집힘 · 고양이', value: `${this.tips}회 · ${this.catHits}회` },
      { label: '페널티', value: `+${this.penalty.toFixed(0)}s${win ? '' : ` (+${DEATH_PENALTY}s 격파당함)`}` },
      { label: '보너스', value: `-${this.bonus.toFixed(1)}s` },
    ];
    const title = win
      ? this.player.hp >= 90 && this.tips === 0 ? '🏆 무결점 전차장!' : total < 100 ? '⚡ 번개 같은 모터!' : '🪖 장판 평정 완료!'
      : '💥 격파당함...';
    this.opts.onEnd({ timeMs: Math.round(total * 1000), title: win ? title : '격파당함...', detail });
  }

  // ------------------------------------------------------------ rendering sync
  private sync() {
    const dtv = 1 / 60;
    for (const t of this.tanks) {
      const m = t.model;
      m.root.position.set(t.x, t.y, t.z);
      let tipRoll = 0;
      if (t.tipT > 0) {
        const total = t.kind === 'boss' ? 3 : 3.6;
        const a = t.tipT > total - 0.35 ? (total - t.tipT) / 0.35 : t.tipT < 0.45 ? t.tipT / 0.45 : 1;
        tipRoll = t.tipSide * 1.55 * a;
      }
      m.root.rotation.set(t.pitch, -t.yaw, t.roll + tipRoll, 'YXZ');
      if (t.alive) {
        m.turret.rotation.y = -(t.ty - t.yaw);
        m.barrel.position.z = -0.55 + t.recoil * 0.35;
        const sp = (t.vl + t.vr) / 2;
        for (let s = 0; s < 2; s++) {
          const v = s === 0 ? t.vl : t.vr;
          for (const w of m.wheels[s]) w.rotation.x -= (v * dtv) / (0.26 * t.scale);
        }
        void sp;
        for (const mt of m.tintable) mt.emissive.setScalar(t.hitFlash > 0 ? 0.5 : 0);
      }
    }
    for (const k of this.pickups) {
      if (k.got) continue;
      const item = k.mesh.getObjectByName('item');
      if (item) {
        item.rotation.y = k.ph * 2;
        item.position.y = 0.95 + Math.sin(k.ph * 3) * 0.12;
      }
      k.mesh.rotation.y = 0;
    }
    const c = this.cat;
    if (c) {
      const m = c.model;
      m.root.position.set(c.x, this.level.terrain.h(c.x, c.z), c.z);
      m.root.rotation.y = Math.PI / 2 - c.yaw;
      m.eyesOpen.visible = c.awake;
      m.eyesShut.visible = !c.awake;
      m.zzz.visible = !c.awake;
      m.zzz.position.y = 3.6 + Math.sin(this.t * 2) * 0.2;
      m.tail.rotation.y = Math.sin(this.t * (c.awake ? 6 : 1.5)) * 0.5;
      const phase = c.t % 3.4;
      m.paw.visible = c.awake && phase > 2.2 && phase < 3.1;
      m.paw.rotation.y = phase < 2.5 ? -1.0 : phase < 3.0 ? -1.0 + ((phase - 2.5) / 0.5) * 2.0 : 1.0;
      m.root.scale.y = c.awake ? 1.08 : 0.92 + Math.sin(this.t * 1.6) * 0.02;
    }
    // wire
    const pos = (this.wire.geometry.getAttribute('position') as THREE.BufferAttribute);
    const p = this.player;
    const n = Math.min(this.trail.length, 38);
    const px = p.x - Math.sin(p.yaw) * 1.6;
    const pz = p.z + Math.cos(p.yaw) * 1.6;
    let i = 0;
    pos.setXYZ(i++, px, this.level.terrain.h(px, pz) + 0.55, pz);
    for (let k = n - 1; k >= 0; k--) {
      const [x, z] = this.trail[k];
      pos.setXYZ(i++, x, this.level.terrain.h(x, z) + 0.06, z);
    }
    pos.needsUpdate = true;
    this.wire.geometry.setDrawRange(0, i);
    this.wire.visible = this.camMode === 0 && p.alive;
    this.player.model.root.visible = this.camMode === 0 || !p.alive;
    this.sun.position.set(p.x + this.level.cfg.hx * 0.2 + 14, 34, p.z - 18);
    this.sun.target.position.set(p.x, 0, p.z);
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const sh = this.shake;
    const jx = (Math.random() - 0.5) * sh * 0.25;
    const jy = (Math.random() - 0.5) * sh * 0.25;
    this.camYaw += wrap(p.ty - this.camYaw) * Math.min(1, 9 * dt);
    const ty = this.camMode === 1 ? p.ty : this.camYaw;
    const dx = Math.sin(ty);
    const dz = -Math.cos(ty);
    if (this.camMode === 1) {
      cam.position.set(p.x + dx * 0.4 + jx, p.y + 1.55 + jy, p.z + dz * 0.4);
      cam.lookAt(p.x + dx * 12, p.y + 1.15 - this.aimD * 0.012, p.z + dz * 12);
      cam.fov = (this.container.clientWidth || 1) / (this.container.clientHeight || 1) < 1.2 ? 80 : 68;
    } else {
      const d = 6.4;
      const cx = p.x - dx * d;
      const cz = p.z - dz * d;
      const gy = this.level.terrain.h(cx, cz);
      cam.position.set(cx + jx, Math.max(p.y, gy) + 2.3 + jy, cz);
      cam.lookAt(p.x + dx * 10, p.y + 0.6, p.z + dz * 10);
      cam.fov = (this.container.clientWidth || 1) / (this.container.clientHeight || 1) < 1.2 ? 75 : 62;
    }
    cam.updateProjectionMatrix();
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
      const disposeMat = (m: THREE.Material) => {
        const map = (m as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        m.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(disposeMat);
      else if (mat) disposeMat(mat);
    });
    resetMats();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
