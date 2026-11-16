import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml, fmtTime } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { mulberry32 } from '../forklift/rng';
import { ShipAudio } from './audio';
import { Fx } from './fx';
import { KeyboardControls, TouchControls, type ControlSource, type Ctl } from './input';
import { BRONZE, buildLevel, Water, type EnemySpawn, type LevelCfg, type PourEvent, type ShipKind } from './level';
import {
  lampName, buildDuck, buildFoamPatch, buildPickup, buildRoom, buildShip, buildSoap, buildTorpedo, buildTowel, type Room, type ShipModel,
} from './models';

export const STEP = 1 / 60;
const G = 14; // shell gravity
const ELEV = 0.55; // shell launch elevation (rad)
const SIN2E = Math.sin(2 * ELEV);
const ARC = 0.62; // broadside arc half-width around the beam (rad)
const KL = 0.16; // linear water drag
const KQ = 0.06; // quadratic water drag
const DEATH_PENALTY = 120;
const BONUS_CAP = 30;
const ROLL_GAIN = 1.6; // roll angle -> range error ratio
const ROLL_OK = 0.045; // |roll| below this counts as "level"
const PLAYER_TORP_DMG = 40;
const ENEMY_TORP_DMG = 22;
const ENEMY_TORP_SPEED = 3.8;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const hex6 = (c: number) => '#' + c.toString(16).padStart(6, '0');

const RADIO = {
  start: ['📢 형: 대야에 물 받아놨다! 한판 붙자!', '📢 동생: 형 배는 내가 침몰시킨다~', '📢 형: 태엽 팍팍 감아라, 시작이다!'],
  kill: ['📢 형: 야 그거 내 배 아니야, 본드 마르기 전이었어!', '📢 동생: 우와 가라앉는다 가라앉아!', '📢 형: 반칙이야, 다시 해!'],
  hurt: ['📢 동생: 형 물 샌다! 펌프 펌프!', '📢 형: 조립 설명서 다시 봐라~'],
  low: ['📢 동생: 태엽 풀렸다! R 눌러서 감아!', '📢 형: 고무줄 다 풀렸네 ㅋㅋ'],
  torp: ['📢 형: 어뢰 발사!!', '📢 동생: 성냥개비 어뢰다~!'],
  cross: ['📢 형: 어? T자 긋기냐?!', '📢 동생: 형 T자 당했다 ㅋㅋ'],
  mom: ['📢 엄마: 물 그만 튀겨!', '📢 엄마: 욕실 바닥 다 젖는다~!'],
  mompour: ['📢 엄마: 머리 감자~ 비켜!', '📢 엄마: 바가지 간다, 조심해~'],
  dad: ['📢 아빠: 등 밀어라~', '📢 아빠: 아들, 거기 등 좀 밀어봐라~'],
  plug: ['📢 아빠: 다 놀았으면 물 빼라~!', '📢 아빠: 마개 뽑는다~?'],
};
const pick = <T,>(a: T[], r: () => number) => a[Math.floor(r() * a.length)];

interface Spec {
  cap: number; vmax: number; turn: number; hl: number; hb: number; range: number; reload: number; n: number; dmg: number; pref: number; torp: boolean; name: string;
}
const SPEC: Record<ShipKind, Spec> = {
  player: { cap: 100, vmax: 5.2, turn: 0.42, hl: 2.6, hb: 0.8, range: 40, reload: 3.3, n: 3, dmg: 7.5, pref: 0, torp: true, name: '내 배' },
  destroyer: { cap: 44, vmax: 4.0, turn: 0.5, hl: 2.4, hb: 0.75, range: 30, reload: 4.4, n: 2, dmg: 4, pref: 19, torp: true, name: '구축함' },
  battleship: { cap: 125, vmax: 2.6, turn: 0.27, hl: 3.5, hb: 1.05, range: 46, reload: 6.4, n: 3, dmg: 7, pref: 28, torp: false, name: '전함' },
  gunboat: { cap: 26, vmax: 4.6, turn: 0.7, hl: 1.6, hb: 0.55, range: 22, reload: 2.8, n: 1, dmg: 3, pref: 11, torp: false, name: '경비정' },
  sub: { cap: 140, vmax: 2.8, turn: 0.36, hl: 2.6, hb: 0.7, range: 28, reload: 4.6, n: 2, dmg: 4, pref: 24, torp: true, name: '잠수함' },
};

interface Ai {
  orbit: 1 | -1; orbitT: number; react: [number, number]; torpCd: number; phase: 'dived' | 'rising' | 'up' | 'diving'; phaseT: number; avoid: number;
}

export interface Ship {
  id: number; team: 0 | 1; kind: ShipKind; boss: boolean; skill: number;
  x: number; z: number; h: number; vx: number; vz: number; yawRate: number;
  thr: number; thrCmd: number; rudCmd: number;
  roll: number; rollV: number; pitch: number; pitchV: number; listSide: number;
  flood: number; leak: number; cap: number; alive: boolean; sinkT: number; peakFlood: number;
  hl: number; hb: number; vmax: number; turn: number; accel: number;
  range: number; reloadT: number; nShells: number; shellDmg: number;
  reload: [number, number]; bias: [number, number]; corr: [number, number]; sinceFire: [number, number];
  torps: number; torpCd: number;
  dive: number; ai?: Ai;
  model: ShipModel; hitFlash: number; lastHitBy: '' | 'shell' | 'torp' | 'ram' | 'drain';
  smokeT: number; wakeT: number; bowT: number; floorY: number;
}

interface Salvo { n: number; landed: number; hits: number; sumErr: number; owner: Ship; side: 0 | 1; aimDist: number; rollEff: number; first: boolean; done: boolean }
interface Shell {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; owner: Ship; team: 0 | 1; dmg: number; salvo: Salvo;
  ox: number; oz: number; dead: boolean; mesh: THREE.Mesh; tr: number;
}
interface Torp { x: number; z: number; vx: number; vz: number; owner: Ship; team: 0 | 1; dmg: number; life: number; dead: boolean; mesh: THREE.Group; tr: number }
interface Body { kind: 'duck' | 'soap'; x: number; z: number; vx: number; vz: number; r: number; mesh: THREE.Object3D; foam?: THREE.Mesh; ph: number }
interface Pickup { kind: 'wind' | 'glue' | 'torp'; x: number; z: number; got: boolean; mesh: THREE.Group; ph: number }
interface Column { mesh: THREE.Mesh; life: number; max: number; h: number }

const CSS = `
.sh-hud .hud-top{right:150px}
.sh-en{font-size:20px;color:#ffd0c8}
.sh-left{position:absolute;top:56px;left:12px;display:flex;flex-direction:column;gap:5px;width:176px}
.sh-bar{background:#000a;border-radius:8px;padding:3px 8px;font-size:12px;line-height:1.3}
.sh-bar .tr{height:7px;border-radius:4px;background:#fff2;margin-top:2px;overflow:hidden}
.sh-bar i{display:block;height:100%;width:0;background:var(--good);transition:width .08s}
.sh-bar.fl i{background:linear-gradient(90deg,#4aa8ff,#ff4a4a)}
.sh-bar.wd i{background:var(--accent)}
.sh-bar.low i{background:var(--bad)}
.sh-rl{display:flex;gap:5px}
.sh-rl .sh-bar{flex:1;padding:3px 6px}
.sh-rl .sh-bar.ld i{background:#7ab8ff}
.sh-rl .sh-bar.ld.ready i{background:var(--good)}
.sh-tp{font-size:12px;letter-spacing:1px}
canvas.sh-mini{position:absolute;top:50px;right:8px;width:150px;height:105px;border-radius:8px;border:1px solid #fff3;background:#0007}
.sh-roll{position:absolute;left:50%;bottom:calc(max(10px,env(safe-area-inset-bottom)) + 4px);transform:translateX(-50%);width:210px;text-align:center;font-size:11px;background:#000a;border-radius:10px;padding:4px 10px 6px}
.sh-roll .trk{position:relative;height:12px;margin-top:3px;border-radius:6px;background:#fff2;overflow:hidden}
.sh-roll .zone{position:absolute;left:41.5%;width:17%;top:0;bottom:0;background:#2ee66b55}
.sh-roll .nd{position:absolute;top:-1px;width:6px;height:14px;margin-left:-3px;border-radius:3px;background:#fff;left:50%}
.sh-roll.lvl{outline:2px solid var(--good)}
.sh-roll.lvl .nd{background:var(--good)}
.sh-tele{font-family:ui-monospace,monospace;font-size:12px}
.sh-st{position:absolute;left:50%;top:20%;transform:translateX(-50%);font-size:14px;color:#ffe9a8;background:#0008;padding:4px 12px;border-radius:12px;opacity:0;transition:opacity .25s;white-space:nowrap}
.sh-st.on{opacity:1}
.sh-tgt{position:absolute;left:0;top:0;display:none;pointer-events:none;transform:translate(-50%,-50%)}
.sh-tgt i{display:block;width:34px;height:34px;border:2px solid #ffe14a;border-radius:50%;box-shadow:0 0 5px #000;margin:0 auto}
.sh-tgt b{display:block;font-size:11px;color:#ffe14a;text-shadow:0 1px 3px #000;text-align:center;white-space:nowrap}
.sh-tgt.ok i{border-color:#2ee66b}.sh-tgt.ok b{color:#2ee66b}
.sh-hint{position:absolute;bottom:10px;left:12px;font-size:11px;color:#fff9;background:#0006;padding:3px 10px;border-radius:10px;max-width:42%}
.sh-hud .hud-center{font-size:60px}
.sh-touch{position:absolute;inset:0;pointer-events:none;z-index:10}
.sh-zone{position:absolute;left:0;bottom:0;width:38%;height:68%;pointer-events:auto;touch-action:none}
.sh-lbl{position:absolute;bottom:128px;left:16px;color:#fff7;font-size:11px;text-shadow:0 1px 3px #000;line-height:1.35}
.sh-base{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;background:#fff1;border:2px solid #fff3;left:78px;top:calc(100% - 78px)}
.sh-base.active{background:#fff2}
.sh-knob{position:absolute;left:31px;top:31px;width:50px;height:50px;border-radius:50%;background:#ffffffaa;box-shadow:0 2px 10px #0008}
.sh-btns{position:absolute;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:auto}
.sh-row{display:flex;gap:6px;align-items:flex-end}
.sh-btns .tb{width:52px;height:46px;font-size:18px;border-radius:14px;padding:0}
.sh-btns .tb small{font-size:9px;margin-top:2px}
.sh-btns .tb.gun{width:68px;height:68px;border-radius:50%;font-size:26px;border-color:var(--hot);background:#5a1a0acc}
.sh-btns .tb.gun.on{background:var(--accent)}
.sh-btns .tb.torp{width:62px;height:62px;border-radius:50%;font-size:24px;border-color:#7ab8ff;background:#10325acc}
@media (hover:none){.sh-left{width:136px;top:46px}.sh-bar{font-size:11px;padding:2px 6px}canvas.sh-mini{width:112px;height:79px;top:44px}.sh-hud .hud-center{font-size:38px}.sh-hud .toasts{top:62px}.sh-hud .toast{font-size:12px;padding:5px 10px}.sh-roll{width:170px;bottom:10px;transform:translateX(-62%)}.sh-hud .hud-time{font-size:22px}.sh-en{font-size:16px}.sh-st{top:30%;font-size:12px}}
`;

export class ShipGame implements MiniGame {
  // ----- three
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private room: Room;
  private fx: Fx;
  private styleEl: HTMLStyleElement;
  private hud: HTMLDivElement;
  private hudEl: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private toasts: { el: HTMLElement; t: number }[] = [];
  private resizeObs: ResizeObserver;
  private shellPool: THREE.Mesh[] = [];
  private columns: Column[] = [];
  private audio = new ShipAudio();
  private touch = false;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private disposed = false;
  paused = false;
  private lastHud = 0;
  private lastMini = 0;
  private colIdx = 0;
  private torpTemplate: [THREE.Group, THREE.Group];

  // ----- sim
  level: LevelCfg;
  water: Water;
  src: ControlSource;
  ships: Ship[] = [];
  player!: Ship;
  bodies: Body[] = [];
  pickups: Pickup[] = [];
  shells: Shell[] = [];
  torps: Torp[] = [];
  towelMeshes: THREE.Mesh[] = [];
  state: 'intro' | 'run' | 'won' | 'lost' | 'done' = 'intro';
  introT = 2.4;
  endT = 0;
  t = 0;
  elapsed = 0;
  bonus = 0;
  penalty = 0;
  wind = 100;
  winding = false;
  pumping = false;
  camMode = 0;
  shotsFired = 0;
  shotsHit = 0;
  salvos = 0;
  fullSalvos = 0;
  torpKills = 0;
  tCross = 0;
  sunk = 0;
  duckHits = 0;
  endCalled = false;
  statusText = '';
  statusT = 0;
  holdWait = [0, 0];
  private rng: () => number;
  private pourDone = -1;
  private pourWarned = -1;
  private dadDone = false;
  private plugDone = false;
  private coreWarn = 0;
  private radioCool = 14;
  private lowWarned = false;
  private salvoCount = 0;
  private crossed = new Set<number>();
  private goUntil = 0;
  private camYaw = 0;
  private camOff = 0;
  private shake = 0;
  private tmpC = { x: 0, z: 0 };
  private tgtEl: HTMLElement;
  private projV = new THREE.Vector3();
  lastCtl: Ctl | null = null;

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    this.level = buildLevel(opts.level);
    const cfg = this.level;
    this.water = new Water(cfg);
    this.rng = mulberry32(cfg.seed * 7 + 3);
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.touch = isTouchDevice();
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = false; // water-level scene: no shadow maps (also keeps phones fast)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(cfg.dim ? 0x2a2630 : 0xcfe7ea);
    this.scene.fog = new THREE.Fog(cfg.dim ? 0x2a2630 : 0xcfe7ea, 70, 190);
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 260);
    this.scene.add(new THREE.HemisphereLight(cfg.dim ? 0xb09a8a : 0xfff6e0, cfg.dim ? 0x2a2a3a : 0x7aa0a8, cfg.dim ? 1.0 : 1.5));
    const sun = new THREE.DirectionalLight(cfg.dim ? 0xffa860 : 0xfff3d0, cfg.dim ? 1.0 : 1.7);
    sun.position.set(18, 40, -12);
    this.scene.add(sun);

    this.room = buildRoom(cfg);
    this.scene.add(this.room.group);
    this.fx = new Fx(this.scene, mobile);

    // towels (reef zones)
    for (const w of cfg.towels) {
      const m = buildTowel(w.w, w.d);
      m.position.set(w.x, 0.05, w.z);
      m.rotation.y = w.rot;
      this.scene.add(m);
      this.towelMeshes.push(m);
    }
    for (const d of cfg.ducks) {
      const mesh = buildDuck();
      this.scene.add(mesh);
      this.bodies.push({ kind: 'duck', x: d.x, z: d.z, vx: 0, vz: 0, r: 1.5, mesh, ph: this.rng() * 6 });
    }
    for (const s of cfg.soaps) {
      const mesh = buildSoap();
      this.scene.add(mesh);
      const foam = buildFoamPatch(4.2);
      this.scene.add(foam);
      this.bodies.push({ kind: 'soap', x: s.x, z: s.z, vx: 0, vz: 0, r: 1.2, mesh, foam, ph: this.rng() * 6 });
    }
    for (const p of cfg.pickups) {
      const mesh = buildPickup(p.kind);
      this.scene.add(mesh);
      this.pickups.push({ kind: p.kind, x: p.x, z: p.z, got: false, mesh, ph: this.rng() * 6 });
    }
    this.torpTemplate = [buildTorpedo(false), buildTorpedo(true)];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
      m.visible = false;
      this.scene.add(m);
      this.shellPool.push(m);
    }
    const colMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    const colGeo = new THREE.ConeGeometry(0.28, 1, 8);
    colGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(colGeo, colMat.clone());
      m.visible = false;
      this.scene.add(m);
      this.columns.push({ mesh: m, life: 0, max: 1, h: 1 });
    }

    // ships
    this.player = this.spawnShip('player', cfg.start.x, cfg.start.z, cfg.start.h, 0, 1, false);
    this.player.torps = cfg.torpedoes;
    for (const e of cfg.enemies) this.spawnShip(e.kind, e.x, e.z, e.h, 1, e.skill, !!e.boss, e);
    this.camYaw = this.player.h;

    // HUD
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    const h = (this.hud = document.createElement('div'));
    h.className = 'hud sh-hud';
    h.style.cssText = 'left:0;top:0;width:100%;height:100%';
    h.innerHTML = `
      <div class="hud-top">
        <div class="hud-name" style="--pc:${hex6(opts.color)}">${escapeHtml(opts.nickname)}</div>
        <div class="hud-time" data-k="time">0:00.0</div>
        <div class="sh-en" data-k="en"></div>
      </div>
      <div class="sh-left">
        <div class="sh-bar fl"><span data-k="flt"></span><div class="tr"><i data-k="flb"></i></div></div>
        <div class="sh-bar wd"><span data-k="wdt"></span><div class="tr"><i data-k="wdb"></i></div></div>
        <div class="sh-rl">
          <div class="sh-bar ld"><span data-k="lt">◀ 좌현</span><div class="tr"><i data-k="lb"></i></div></div>
          <div class="sh-bar ld"><span data-k="rt">우현 ▶</span><div class="tr"><i data-k="rb"></i></div></div>
        </div>
        <div class="sh-bar"><span class="sh-tp" data-k="tp"></span> <span class="sh-tele" data-k="tele"></span></div>
      </div>
      <canvas class="sh-mini" width="300" height="210"></canvas>
      <div class="sh-roll" data-k="roll"><span data-k="rolt">파도 · 수평일 때 쏴라</span><div class="trk"><div class="zone"></div><div class="nd" data-k="nd"></div></div></div>
      <div class="sh-st" data-k="st"></div>
      <div class="sh-tgt" data-k="tgt"><i></i><b data-k="tgtt"></b></div>
      <div class="hud-center" data-k="center"></div>
      <div class="toasts"></div>
      ${this.touch ? '' : '<div class="sh-hint">W/S 엔진 · A/D 방향타 · Q/E 좌/우현 포격 · Space 어뢰 · R 태엽 · F 펌프 · C 시점 · X 정지</div>'}`;
    container.appendChild(h);
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.hudEl[e.dataset.k!] = e));
    this.mini = h.querySelector('canvas')!;
    this.tgtEl = this.hudEl.tgt;

    this.src = this.touch ? new TouchControls(container) : new KeyboardControls();
    this.audio.init();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.toast(pick(RADIO.start, this.rng), 'radio');
    this.sync(0);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ construction
  private spawnShip(kind: ShipKind, x: number, z: number, h: number, team: 0 | 1, skill: number, boss: boolean, _e?: EnemySpawn): Ship {
    const sp = SPEC[kind];
    const enemy = team === 1;
    const model = buildShip(kind, {
      hull: enemy ? (kind === 'sub' ? 0x35404a : kind === 'battleship' ? 0x626a74 : 0x7a828c) : 0xbcc4cc,
      deck: enemy ? 0x4e545c : 0x80888f,
      accent: enemy ? (kind === 'battleship' ? 0xe0b020 : 0xc03a3a) : this.opts.color,
      boss, player: !enemy,
    });
    this.scene.add(model.root);
    const sk = enemy ? skill : 1;
    const vmax = sp.vmax * (enemy ? 0.7 + 0.3 * sk : 1);
    const bscale = boss ? 1.4 : 1;
    const ship: Ship = {
      id: this.ships.length, team, kind, boss, skill: sk, x, z, h, vx: 0, vz: 0, yawRate: 0, thr: 0, thrCmd: 0, rudCmd: 0,
      roll: 0, rollV: 0, pitch: 0, pitchV: 0, listSide: this.rng() < 0.5 ? -1 : 1,
      flood: 0, leak: 0, cap: sp.cap * (boss ? 1.0 : 1), alive: true, sinkT: -1, peakFlood: 0,
      hl: sp.hl * (boss ? 1.4 : 1), hb: sp.hb * bscale, vmax, turn: sp.turn * (enemy ? 0.8 + 0.2 * sk : 1), accel: (KL + KQ * vmax) * vmax,
      range: sp.range, reloadT: sp.reload * (enemy ? 1.6 - 0.8 * sk : 1), nShells: sp.n, shellDmg: sp.dmg,
      reload: [enemy ? 2 + this.rng() * 3 : 0, enemy ? 2.5 + this.rng() * 3 : 0], sinceFire: [9, 9],
      bias: [(this.rng() * 2 - 1) * (enemy ? 0.3 - 0.22 * sk : 0.11), (this.rng() * 2 - 1) * (enemy ? 0.3 - 0.22 * sk : 0.11)],
      corr: [0, 0], torps: enemy && sp.torp ? 99 : 0, torpCd: 6 + this.rng() * 6, dive: kind === 'sub' ? (boss ? 1 : 0) : 0,
      model, hitFlash: 0, lastHitBy: '', smokeT: 0, wakeT: 0, bowT: 0, floorY: 0,
    };
    if (enemy) {
      ship.ai = {
        orbit: this.rng() < 0.5 ? 1 : -1, orbitT: 8 + this.rng() * 10, react: [0.8, 0.8], torpCd: 7 + this.rng() * 8,
        phase: kind === 'sub' ? (boss ? 'dived' : 'up') : 'up', phaseT: boss ? 5 : 8, avoid: 0,
      };
    }
    this.ships.push(ship);
    this.poseShip(ship, 0);
    return ship;
  }

  // ------------------------------------------------------------ public helpers
  setSource(s: ControlSource) {
    this.src.dispose();
    this.src = s;
  }
  enemies() { return this.ships.filter((s) => s.team === 1); }
  enemiesLeft() { return this.ships.filter((s) => s.team === 1 && s.alive).length; }
  bonusEff() { return Math.min(this.bonus, BONUS_CAP, this.elapsed * 0.3); }
  netTime() { return this.elapsed + this.penalty - this.bonusEff(); }
  floodPct(s: Ship) { return clamp(s.flood / s.cap, 0, 1); }
  snapshot() {
    const p = this.player;
    return {
      state: this.state, t: this.t, elapsed: this.elapsed, net: this.netTime(), bonus: this.bonus, penalty: this.penalty,
      player: { x: p.x, z: p.z, h: p.h, u: this.fwdSpeed(p), speed: Math.hypot(p.vx, p.vz), yawRate: p.yawRate, thr: p.thr, roll: p.roll, flood: p.flood, pct: this.floodPct(p), alive: p.alive, torps: p.torps, reload: [...p.reload] },
      wind: this.wind, left: this.enemiesLeft(), shotsFired: this.shotsFired, shotsHit: this.shotsHit, salvos: this.salvos,
      enemies: this.enemies().map((e) => ({ kind: e.kind, x: e.x, z: e.z, h: e.h, alive: e.alive, pct: this.floodPct(e), speed: Math.hypot(e.vx, e.vz), dive: e.dive, reload: [...e.reload] })),
    };
  }
  fwdSpeed(s: Ship) { return s.vx * Math.sin(s.h) + s.vz * Math.cos(s.h); }

  // ------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n++ < 6) {
        this.step(STEP);
        this.acc -= STEP;
      }
      if (n >= 6) this.acc = 0;
    }
    this.render(dt, now);
  };

  render(dt: number, now = performance.now()) {
    this.sync(dt);
    this.updateCamera(dt);
    if (now - this.lastHud > 80) {
      this.updateHud();
      this.lastHud = now;
    }
    if (now - this.lastMini > 120) {
      this.drawMini();
      this.lastMini = now;
    }
    this.updateTarget();
    this.fx.flush();
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.lastFrame = performance.now();
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  // ------------------------------------------------------------ simulation
  step(dt: number) {
    this.t += dt;
    this.updateToasts(dt);
    this.statusT = Math.max(0, this.statusT - dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.state === 'intro') {
      this.introT -= dt;
      if (this.introT <= 0) this.state = 'run';
    }
    if (this.state === 'run') this.elapsed += dt;
    const live = this.state === 'run';
    const c = this.src.read();
    this.lastCtl = c;
    if (c.cam) this.camMode = (this.camMode + 1) % 3;
    this.hazards();
    if (live || this.state === 'intro') this.playerControl(c, dt, live);
    else {
      this.player.rudCmd = 0;
    }
    for (const s of this.ships) {
      if (s.ai && s.alive && live) this.aiThink(s, dt);
      else if (s.ai && s.alive) { s.thrCmd = 0; s.rudCmd = 0; }
    }
    for (const s of this.ships) this.moveShip(s, dt);
    this.collide(dt);
    this.updateShells(dt);
    this.updateTorps(dt);
    this.updateBodies(dt);
    this.updatePickups(dt);
    this.updateFlooding(dt);
    this.updateColumns(dt);
    this.fx.update(dt, this.t, this.water);
    this.effects(dt);
    this.styleEvents(dt);
    this.checkEnd(dt);
    this.audio.update(
      clamp(Math.hypot(this.player.vx, this.player.vz) / 5.2, 0, 1), this.wind / 100,
      this.water.drainStrength(this.t), this.winding,
    );
  }

  // ---------- player control
  private playerControl(c: Ctl, dt: number, live: boolean) {
    const p = this.player;
    if (!p.alive) { p.thrCmd = 0; p.rudCmd = 0; return; }
    if (c.stop) p.thrCmd = 0;
    if (c.thrSet !== null) p.thrCmd = c.thrSet;
    else if (c.thrDelta) p.thrCmd = clamp(p.thrCmd + c.thrDelta * 0.8 * dt, -0.5, 1);
    p.rudCmd = clamp(c.rudder, -1, 1);
    this.winding = live && c.wind;
    this.pumping = live && c.pump && !this.winding && this.wind > 0;
    if (this.winding) {
      if (this.wind < 100) {
        const before = Math.floor(this.wind / 5);
        this.wind = Math.min(100, this.wind + 20 * dt);
        if (Math.floor(this.wind / 5) !== before) this.audio.ratchet();
      }
    }
    if (this.pumping) {
      this.wind = Math.max(0, this.wind - 2.6 * dt);
      p.flood = Math.max(0, p.flood - 3.2 * dt);
      p.leak = Math.max(0, p.leak - 0.2 * dt);
      if (Math.floor(this.t * 5) !== Math.floor((this.t - dt) * 5)) {
        this.audio.pump();
        this.fx.drop(p.x + (Math.random() - 0.5), 0.5, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2, 0.16, 0.9);
      }
    }
    if (!live) return;
    // guns: tap/hold. keyboard fires on demand; touch waits briefly for a level roll
    for (const side of [0, 1] as const) {
      const want = side === 0 ? c.port : c.stbd;
      if (!want || this.winding) { this.holdWait[side] = 0; continue; }
      if (p.reload[side] > 0) continue;
      if (c.assist && Math.abs(p.roll) > ROLL_OK && this.holdWait[side] < 0.7) {
        this.holdWait[side] += dt;
        continue;
      }
      this.holdWait[side] = 0;
      this.fire(p, side);
    }
    if (c.torp && !this.winding) this.fireTorpPlayer(c.assist);
  }

  // ---------- weapons
  private pickTarget(s: Ship, side: 0 | 1): Ship | null {
    const beam = s.h + (side === 0 ? Math.PI / 2 : -Math.PI / 2);
    let best: Ship | null = null;
    let bd = 1e9;
    for (const q of this.ships) {
      if (q.team === s.team || !q.alive) continue;
      if (q.kind === 'sub' && q.dive > 0.45) continue;
      const dx = q.x - s.x;
      const dz = q.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.range || d < 3) continue;
      if (Math.abs(wrap(Math.atan2(dx, dz) - beam)) > ARC) continue;
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  private gauss() {
    return (this.rng() + this.rng() + this.rng() - 1.5) * 2;
  }

  fire(s: Ship, side: 0 | 1): boolean {
    if (!s.alive || s.reload[side] > 0) return false;
    if (s.kind === 'sub' && s.dive > 0.25) return false;
    const beam = s.h + (side === 0 ? Math.PI / 2 : -Math.PI / 2);
    const mx = s.x + Math.sin(beam) * s.hb * 0.5;
    const mz = s.z + Math.cos(beam) * s.hb * 0.5;
    const tgt = this.pickTarget(s, side);
    let ang = beam;
    let R = s.range * 0.55;
    if (tgt) {
      let px = tgt.x;
      let pz = tgt.z;
      R = Math.hypot(px - mx, pz - mz);
      for (let i = 0; i < 3; i++) {
        const T = 2 * Math.sin(ELEV) * Math.sqrt(R / (G * SIN2E));
        px = tgt.x + tgt.vx * T;
        pz = tgt.z + tgt.vz * T;
        R = Math.hypot(px - mx, pz - mz);
      }
      ang = Math.atan2(px - mx, pz - mz);
    }
    R = clamp(R - 0.5, 4, s.range * 1.05);
    const sgn = side === 0 ? 1 : -1; // roll>0 = starboard down: port guns up (long), starboard guns down (short)
    const rollEff = ROLL_GAIN * s.roll * sgn;
    const salvo: Salvo = { n: s.nShells, landed: 0, hits: 0, sumErr: 0, owner: s, side, aimDist: R, rollEff, first: true, done: false };
    for (let i = 0; i < s.nShells; i++) {
      const ratio = clamp(1 + s.bias[side] + s.corr[side] + rollEff + this.gauss() * (s.team === 0 ? 0.025 : 0.05 - 0.015 * s.skill), 0.4, 1.7);
      const a = ang + this.gauss() * 0.012 + (i - (s.nShells - 1) / 2) * 0.014 + s.pitch * 0.45 * sgn;
      const v = Math.sqrt((R * ratio * G) / SIN2E);
      const mesh = this.shellPool.find((m) => !m.visible);
      if (!mesh) break;
      mesh.visible = true;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(s.team === 0 ? 0xfff0a0 : 0xff9a7a);
      this.shells.push({
        x: mx, y: 0.35, z: mz, vx: Math.sin(a) * v * Math.cos(ELEV) + s.vx * 0.6, vy: v * Math.sin(ELEV), vz: Math.cos(a) * v * Math.cos(ELEV) + s.vz * 0.6,
        owner: s, team: s.team, dmg: s.shellDmg, salvo, ox: mx, oz: mz, dead: false, mesh, tr: 0,
      });
      this.fx.smoke(mx + (Math.random() - 0.5) * 0.3, 0.7, mz + (Math.random() - 0.5) * 0.3, 0.3, 0.9, 0xcccccc);
    }
    s.reload[side] = s.reloadT;
    s.sinceFire[side] = 0;
    if (s.team === 0) {
      this.shotsFired += s.nShells;
      this.salvos++;
      this.salvoCount++;
      this.audio.gun(false, 0);
      this.shake = Math.min(1, this.shake + 0.35);
      s.pitchV += 0.8;
      if (this.salvoCount % 9 === 0 && this.radioCool < 0) {
        this.toast(pick(RADIO.mom, this.rng), 'radio');
        this.radioCool = 12;
      }
    } else {
      const d = Math.hypot(s.x - this.player.x, s.z - this.player.z);
      this.audio.gun(s.kind === 'battleship', d);
    }
    // recoil: push the ship sideways a little
    s.vx -= Math.sin(beam) * 0.15;
    s.vz -= Math.cos(beam) * 0.15;
    return true;
  }

  private launchTorp(s: Ship, ang: number, speed: number, dmg: number) {
    const mesh = this.torpTemplate[s.team === 0 ? 0 : 1].clone();
    this.scene.add(mesh);
    const x = s.x + Math.sin(ang) * (s.hl + 0.4);
    const z = s.z + Math.cos(ang) * (s.hl + 0.4);
    mesh.position.set(x, 0.02, z);
    mesh.rotation.y = ang;
    this.torps.push({ x, z, vx: Math.sin(ang) * speed, vz: Math.cos(ang) * speed, owner: s, team: s.team, dmg, life: 16, dead: false, mesh, tr: 0 });
    this.fx.ripple(x, z, 0.6, 3, 1.2);
    this.audio.torp();
  }

  fireTorpPlayer(assist: boolean) {
    const p = this.player;
    if (!p.alive || p.torps <= 0 || p.torpCd > 0) {
      if (p.alive && p.torps <= 0) { this.audio.empty(); this.toast('🚀 어뢰가 없다! 성냥곽을 주워라', 'bad'); }
      return false;
    }
    let ang = p.h;
    if (assist) {
      let best = 1e9;
      for (const q of this.ships) {
        if (q.team === 0 || !q.alive) continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 6 || d > 46) continue;
        let px = q.x;
        let pz = q.z;
        for (let i = 0; i < 3; i++) {
          const T = Math.hypot(px - p.x, pz - p.z) / 4.8;
          px = q.x + q.vx * T;
          pz = q.z + q.vz * T;
        }
        const a = Math.atan2(px - p.x, pz - p.z);
        const diff = Math.abs(wrap(a - p.h));
        if (diff < 0.35 && diff < best) { best = diff; ang = a; }
      }
    }
    p.torps--;
    p.torpCd = 2.6;
    this.launchTorp(p, ang, 4.8, PLAYER_TORP_DMG);
    this.toast(pick(RADIO.torp, this.rng), 'radio');
    return true;
  }

  private damage(target: Ship, amount: number, by: Ship['lastHitBy'], x: number, z: number, src: Ship | null) {
    if (!target.alive) return;
    target.flood += amount;
    target.leak = Math.min(target.cap * 0.015, target.leak + amount * (by === 'torp' ? 0.05 : 0.035));
    target.hitFlash = 1;
    target.lastHitBy = by;
    target.peakFlood = Math.max(target.peakFlood, this.floodPct(target) * 100);
    this.fx.bits(x, 0.8, z, by === 'torp' ? 9 : 4, target.team === 0 ? 0xbcc4cc : 0x7a828c, by === 'torp' ? 6 : 4);
    this.fx.splash(x, z, by === 'torp' ? 2 : 1);
    if (target.team === 0) {
      this.shake = Math.min(1, this.shake + (by === 'torp' ? 1 : 0.5));
      this.audio.hit(by === 'torp');
      if (this.radioCool < 0 && this.floodPct(target) > 0.2) {
        this.toast(pick(RADIO.hurt, this.rng), 'radio');
        this.radioCool = 16;
      }
    } else {
      this.audio.hit(by === 'torp');
    }
    if (target.flood >= target.cap) this.sinkShip(target, src);
  }

  private sinkShip(s: Ship, src: Ship | null) {
    s.alive = false;
    s.sinkT = 0;
    s.flood = s.cap;
    this.audio.sink();
    if (s.team === 1) {
      this.sunk++;
      this.toast(`⚓ ${SPEC[s.kind].name}${s.boss ? ' (대장)' : ''} 침몰!`, 'good');
      if (this.radioCool < 6) this.toast(pick(RADIO.kill, this.rng), 'radio');
      if (s.lastHitBy === 'torp' && src === this.player) {
        this.torpKills++;
        this.addBonus(3, '어뢰 격침');
      }
      if (this.fx) this.fx.ripple(s.x, s.z, 1, 8, 2.4);
    } else {
      this.toast('💦 침몰한다...!', 'bad');
    }
  }

  private addBonus(sec: number, label: string) {
    const room = Math.max(0, BONUS_CAP - this.bonus);
    const g = Math.min(sec, room);
    this.bonus += g;
    if (g > 0) this.toast(`⭐ ${label} −${g.toFixed(0)}초`, 'good');
  }

  private updateShells(dt: number) {
    for (const sh of this.shells) {
      if (sh.dead) continue;
      sh.vy -= G * dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.z += sh.vz * dt;
      sh.mesh.position.set(sh.x, sh.y, sh.z);
      sh.tr += dt;
      if (sh.tr > 0.07) {
        sh.tr = 0;
        this.fx.smoke(sh.x, sh.y, sh.z, 0.12, 0.5, 0xeeeeee);
      }
      // rubber duck blocks shells
      if (sh.y < 2.4) {
        for (const b of this.bodies) {
          if (b.kind !== 'duck') continue;
          if (Math.hypot(sh.x - b.x, sh.z - b.z) < b.r * 0.9) {
            this.killShell(sh, false);
            this.audio.duck();
            this.fx.bits(b.x, 1, b.z, 3, 0xffd21f, 3);
            if (sh.team === 0 && this.duckHits < 3) {
              this.duckHits++;
              this.penalty += 1.5;
              this.toast('🦆 삑! 오리를 맞혔다 +1.5초', 'bad');
            }
            this.recordLanding(sh, sh.x, sh.z, true, true);
            break;
          }
        }
        if (sh.dead) continue;
      }
      // ship hits
      if (sh.y < 1.5 && sh.y > -0.2) {
        for (const q of this.ships) {
          if (q.team === sh.team || !q.alive) continue;
          if (q.kind === 'sub' && q.dive > 0.45) continue;
          if (!this.inHull(q, sh.x, sh.z, 1.2, 1.12)) continue;
          sh.salvo.hits++;
          const low = this.rng() < 0.6;
          this.damage(q, sh.dmg * (low ? 1 : 0.45), 'shell', sh.x, sh.z, sh.owner);
          if (sh.team === 0) {
            this.shotsHit++;
            this.checkCrossT(q);
          }
          this.killShell(sh, false);
          this.recordLanding(sh, sh.x, sh.z, true, false);
          break;
        }
        if (sh.dead) continue;
      }
      if (sh.y <= 0) {
        const near = this.splashNear(sh);
        this.fx.splash(sh.x, sh.z, sh.team === 0 ? 1.3 : 1);
        if (sh.team === 0 || near) this.audio.splash(Math.hypot(sh.x - this.player.x, sh.z - this.player.z));
        this.killShell(sh, true);
        this.recordLanding(sh, sh.x, sh.z, false, false);
      }
    }
    this.shells = this.shells.filter((s) => !s.dead);
  }

  private splashNear(sh: Shell) {
    return Math.hypot(sh.x - this.player.x, sh.z - this.player.z) < 6;
  }

  private killShell(sh: Shell, column: boolean) {
    sh.dead = true;
    sh.mesh.visible = false;
    if (column) {
      const c = this.columns[this.colIdx++ % this.columns.length];
      c.mesh.visible = true;
      c.mesh.position.set(sh.x, 0, sh.z);
      c.max = c.life = 1.5;
      c.h = sh.team === 0 ? (sh.salvo.first ? 4.2 : 2.8) : 2.2;
      (c.mesh.material as THREE.MeshBasicMaterial).color.setHex(sh.team === 0 ? 0xffffff : 0xffc4b0);
    }
  }

  private updateColumns(dt: number) {
    for (const c of this.columns) {
      if (!c.mesh.visible) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      const k = c.life / c.max;
      const rise = Math.min(1, (1 - k) * 6);
      c.mesh.scale.set(1 + (1 - k) * 0.7, c.h * rise * (0.5 + 0.5 * k), 1 + (1 - k) * 0.7);
      (c.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * k;
    }
  }

  /** a shell finished (hit or landed): salvo bookkeeping, ranging feedback and range correction */
  private recordLanding(sh: Shell, x: number, z: number, hit: boolean, blocked: boolean) {
    const s = sh.salvo;
    s.landed++;
    let err = 0;
    if (!hit) {
      const d = Math.hypot(x - sh.ox, z - sh.oz);
      err = d / s.aimDist - 1 - s.rollEff;
      s.sumErr += err;
    }
    if (s.owner.team === 0 && s.first) {
      s.first = false;
      if (hit && !blocked) this.setStatus('🎯 명중!');
      else if (!hit) {
        const dm = Math.hypot(x - sh.ox, z - sh.oz) - s.aimDist;
        if (Math.abs(dm) < 2) this.setStatus('💦 근접탄! (거의 맞았다)');
        else this.setStatus(dm < 0 ? `💦 탄착 근탄 (${Math.abs(dm).toFixed(0)}m 짧음)` : `💦 탄착 원탄 (${dm.toFixed(0)}m 멀음)`);
      }
    }
    if (s.landed >= s.n && !s.done) {
      s.done = true;
      if (s.sumErr !== 0 || s.hits < s.n) {
        const missN = s.n - s.hits;
        if (missN > 0) s.owner.corr[s.side] -= 0.85 * (s.sumErr / missN);
      }
      if (s.owner.team === 0 && s.hits === s.n && s.n > 1) {
        this.fullSalvos++;
        this.addBonus(2, '전탄 명중!');
      }
    }
  }

  private setStatus(t: string) {
    this.statusText = t;
    this.statusT = 2.2;
  }

  /** ellipse hull test; kl/kb inflate the hit area */
  private inHull(q: Ship, x: number, z: number, kl: number, kb: number) {
    const dx = x - q.x;
    const dz = z - q.z;
    const along = dx * Math.sin(q.h) + dz * Math.cos(q.h);
    const lat = dx * -Math.cos(q.h) + dz * Math.sin(q.h);
    return (along / (q.hl * kl)) ** 2 + (lat / (q.hb * kb)) ** 2 < 1;
  }

  private checkCrossT(q: Ship) {
    if (this.crossed.has(q.id) || !q.alive) return;
    const p = this.player;
    const toP = Math.atan2(p.x - q.x, p.z - q.z);
    const bowOff = Math.abs(wrap(toP - q.h));
    const perp = Math.abs(Math.sin(p.h - q.h));
    if (bowOff < 0.5 && perp > 0.7) {
      this.crossed.add(q.id);
      this.tCross++;
      this.addBonus(2.5, 'T자 횡단!');
      this.toast(pick(RADIO.cross, this.rng), 'radio');
    }
  }

  private updateTorps(dt: number) {
    for (const tp of this.torps) {
      if (tp.dead) continue;
      tp.life -= dt;
      tp.x += tp.vx * dt;
      tp.z += tp.vz * dt;
      tp.mesh.position.set(tp.x, 0.02, tp.z);
      tp.tr += dt;
      if (tp.tr > 0.06) {
        tp.tr = 0;
        this.fx.bubble(tp.x - tp.vx * 0.12, 0.05, tp.z - tp.vz * 0.12, 0.17, 1.6);
        this.fx.foam(tp.x, tp.z, 0.5, 1.0);
      }
      const { rx, rz } = this.level;
      let hit = false;
      for (const q of this.ships) {
        if (q.team === tp.team || !q.alive) continue;
        if (!this.inHull(q, tp.x, tp.z, 1.0, 1.1)) continue;
        this.damage(q, tp.dmg, 'torp', tp.x, tp.z, tp.owner);
        this.fx.ripple(tp.x, tp.z, 1, 9, 1.8);
        this.fx.bits(tp.x, 0.8, tp.z, 8, 0xd9b36b, 6);
        if (q.team === 0) this.toast('💥 어뢰 명중당했다!!', 'bad');
        else if (tp.team === 0) this.toast('💥 어뢰 명중!', 'good');
        hit = true;
        break;
      }
      if (hit || tp.life <= 0 || (tp.x / rx) ** 2 + (tp.z / rz) ** 2 > 1) {
        tp.dead = true;
        this.scene.remove(tp.mesh);
        if (!hit) this.fx.splash(tp.x, tp.z, 0.6);
      }
    }
    this.torps = this.torps.filter((t) => !t.dead);
  }

  // ---------- ship physics
  private cureAt(x: number, z: number) {
    this.water.cur(x, z, this.t, this.tmpC);
    return this.tmpC;
  }

  private inFoam(x: number, z: number) {
    for (const b of this.bodies) if (b.kind === 'soap' && Math.hypot(x - b.x, z - b.z) < 4.2) return true;
    return false;
  }

  private inTowel(x: number, z: number) {
    for (const w of this.level.towels) {
      const dx = x - w.x;
      const dz = z - w.z;
      const c = Math.cos(w.rot);
      const s = Math.sin(w.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < w.w / 2 + 0.5 && Math.abs(lz) < w.d / 2 + 0.5) return true;
    }
    return false;
  }

  moveShip(s: Ship, dt: number) {
    const pct = this.floodPct(s);
    // engine
    const slew = s.thrCmd > s.thr ? (s.thr < 0 ? 0.5 : 0.55) : 0.7; // heavy: engine spools slowly
    const target = s.alive ? s.thrCmd : 0;
    s.thr += clamp(target - s.thr, -slew * dt, slew * dt);
    let thrust = s.thr * s.accel * (s.thr < 0 ? 0.55 : 1) * (1 - 0.55 * Math.pow(pct, 1.2));
    if (s === this.player) {
      const ok = this.wind > 0 && !this.winding;
      if (!ok) thrust = 0;
      else if (this.state === 'run' || this.state === 'intro') {
        this.wind = Math.max(0, this.wind - Math.abs(s.thr) * 2.1 * dt);
        if (this.wind <= 0 && !this.lowWarned) { this.lowWarned = true; this.toast('🔄 태엽이 다 풀렸다! R로 감아라', 'bad'); }
        if (this.wind > 30) this.lowWarned = false;
      }
      if (this.pumping) thrust *= 0.5;
    }
    if (s.kind === 'sub' && s.dive > 0.5) thrust *= 0.9;
    const cur = this.cureAt(s.x, s.z);
    const cx = cur.x;
    const cz = cur.z;
    const fx = Math.sin(s.h);
    const fz = Math.cos(s.h);
    const rx = -Math.cos(s.h);
    const rz = Math.sin(s.h);
    const rvx = s.vx - cx;
    const rvz = s.vz - cz;
    let u = rvx * fx + rvz * fz;
    let w = rvx * rx + rvz * rz;
    const foam = this.inFoam(s.x, s.z);
    const towel = this.inTowel(s.x, s.z);
    const dragK = (KL + KQ * Math.abs(u)) * (1 + 0.5 * pct + (towel ? 2.2 : 0));
    u += (thrust - dragK * u) * dt;
    w *= Math.exp(-(foam ? 0.45 : 2.0) * dt);
    if (towel && Math.abs(u) > 1.5 && s.alive && Math.floor(this.t * 6) !== Math.floor((this.t - dt) * 6)) {
      s.flood += 0.15;
      if (s === this.player) this.audio.ratchet();
    }
    s.vx = fx * u + rx * w + cx;
    s.vz = fz * u + rz * w + cz;
    // rudder authority grows with way on
    const auth = Math.pow(clamp(Math.abs(u) / 3.5, 0, 1), 1.5) * (foam ? 0.5 : 1) * (1 - 0.3 * pct);
    const want = s.alive ? -s.rudCmd * s.turn * auth * (u < -0.05 ? -1 : 1) : 0;
    s.yawRate += (want - s.yawRate) * (1 - Math.exp(-dt / 0.8));
    s.h += s.yawRate * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    if (!s.alive) {
      s.vx *= 1 - 0.5 * dt;
      s.vz *= 1 - 0.5 * dt;
    }
    // waves: roll / pitch springs
    const hs = this.water.h(s.x + rx * 0.9, s.z + rz * 0.9, this.t);
    const hp = this.water.h(s.x - rx * 0.9, s.z - rz * 0.9, this.t);
    const hb = this.water.h(s.x + fx * 1.4, s.z + fz * 1.4, this.t);
    const ha = this.water.h(s.x - fx * 1.4, s.z - fz * 1.4, this.t);
    const rollT = -Math.atan(1.7 * (hs - hp) / 1.8) + s.listSide * pct * 0.38;
    const pitchT = Math.atan(1.1 * (hb - ha) / 2.8);
    s.rollV += ((rollT - s.roll) * 16 - s.rollV * 2.6) * dt;
    s.roll += s.rollV * dt;
    s.pitchV += ((pitchT - s.pitch) * 14 - s.pitchV * 2.8) * dt;
    s.pitch += s.pitchV * dt;
    s.floorY = this.water.h(s.x, s.z, this.t);
    for (let i = 0; i < 2; i++) {
      s.reload[i] = Math.max(0, s.reload[i] - dt);
      s.sinceFire[i] += dt;
    }
    s.torpCd = Math.max(0, s.torpCd - dt);
    s.hitFlash = Math.max(0, s.hitFlash - dt * 3);
    if (s.sinkT >= 0) s.sinkT = Math.min(1, s.sinkT + dt / 4.5);
  }

  private collide(dt: number) {
    const { rx, rz } = this.level;
    for (const s of this.ships) {
      if (s.sinkT >= 1) continue;
      const hiddenSub = s.kind === 'sub' && s.dive > 0.5;
      // basin wall: three circles along the hull
      for (const off of [-0.55, 0, 0.55]) {
        const cx = s.x + Math.sin(s.h) * s.hl * off;
        const cz = s.z + Math.cos(s.h) * s.hl * off;
        const e = (cx / (rx - s.hb)) ** 2 + (cz / (rz - s.hb)) ** 2;
        if (e > 1) {
          const nx = cx / ((rx - s.hb) ** 2);
          const nz = cz / ((rz - s.hb) ** 2);
          const nl = Math.hypot(nx, nz);
          const ux = nx / nl;
          const uz = nz / nl;
          const push = (Math.sqrt(e) - 1) * Math.min(rx, rz) * 0.5 + 0.02;
          s.x -= ux * push;
          s.z -= uz * push;
          const vn = s.vx * ux + s.vz * uz;
          if (vn > 0) {
            s.vx -= (1 + 0.35) * vn * ux;
            s.vz -= (1 + 0.35) * vn * uz;
            if (vn > 1.2 && s.alive) {
              this.fx.splash(cx, cz, 0.7);
              s.flood += vn * 0.5;
              s.lastHitBy = 'ram';
              if (s === this.player) {
                this.shake = Math.min(1, this.shake + 0.4);
                this.audio.hit(false);
                if (this.radioCool < 0) { this.toast('🧱 대야 벽에 쾅! 부딪혔다', 'bad'); this.radioCool = 6; }
              }
            }
          }
        }
      }
      // ship vs ship
      if (hiddenSub) continue;
      for (const q of this.ships) {
        if (q.id <= s.id || q.sinkT >= 1 || (q.kind === 'sub' && q.dive > 0.5)) continue;
        for (const a of [-0.55, 0, 0.55]) {
          for (const b of [-0.55, 0, 0.55]) {
            const ax = s.x + Math.sin(s.h) * s.hl * a;
            const az = s.z + Math.cos(s.h) * s.hl * a;
            const bx = q.x + Math.sin(q.h) * q.hl * b;
            const bz = q.z + Math.cos(q.h) * q.hl * b;
            const dx = bx - ax;
            const dz = bz - az;
            const d = Math.hypot(dx, dz);
            const m = s.hb * 1.05 + q.hb * 1.05;
            if (d < m && d > 0.001) {
              const ux = dx / d;
              const uz = dz / d;
              const pen = (m - d) * 0.5;
              s.x -= ux * pen * 0.5;
              s.z -= uz * pen * 0.5;
              q.x += ux * pen * 0.5;
              q.z += uz * pen * 0.5;
              const rv = (q.vx - s.vx) * ux + (q.vz - s.vz) * uz;
              if (rv < 0) {
                const j = -rv * 0.6;
                s.vx -= ux * j;
                s.vz -= uz * j;
                q.vx += ux * j;
                q.vz += uz * j;
                if (-rv > 1.6 && s.alive && q.alive && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) {
                  this.fx.bits((ax + bx) / 2, 0.6, (az + bz) / 2, 3, 0xbcc4cc, 3);
                  this.damage(s, -rv * 0.9, 'ram', (ax + bx) / 2, (az + bz) / 2, q);
                  this.damage(q, -rv * 0.9, 'ram', (ax + bx) / 2, (az + bz) / 2, s);
                }
              }
            }
          }
        }
      }
      // ship vs duck / soap
      for (const bd of this.bodies) {
        for (const off of [-0.5, 0, 0.5]) {
          const cx = s.x + Math.sin(s.h) * s.hl * off;
          const cz = s.z + Math.cos(s.h) * s.hl * off;
          const dx = bd.x - cx;
          const dz = bd.z - cz;
          const d = Math.hypot(dx, dz);
          const m = bd.r + s.hb * 0.9;
          if (d < m && d > 0.001) {
            const ux = dx / d;
            const uz = dz / d;
            bd.x += ux * (m - d) * 0.8;
            bd.z += uz * (m - d) * 0.8;
            s.x -= ux * (m - d) * 0.2;
            s.z -= uz * (m - d) * 0.2;
            const rv = (bd.vx - s.vx) * ux + (bd.vz - s.vz) * uz;
            if (rv < 0) {
              bd.vx += ux * -rv * 1.3;
              bd.vz += uz * -rv * 1.3;
              s.vx += ux * rv * 0.15;
              s.vz += uz * rv * 0.15;
              if (bd.kind === 'duck' && -rv > 1.2 && s === this.player) this.audio.duck();
            }
          }
        }
      }
    }
  }

  private updateBodies(dt: number) {
    const { rx, rz } = this.level;
    for (const b of this.bodies) {
      const cur = this.cureAt(b.x, b.z);
      b.vx += (cur.x * 0.9 - b.vx) * 0.5 * dt + Math.sin(this.t * 0.37 + b.ph) * 0.05 * dt;
      b.vz += (cur.z * 0.9 - b.vz) * 0.5 * dt + Math.cos(this.t * 0.31 + b.ph) * 0.05 * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const e = (b.x / (rx - b.r)) ** 2 + (b.z / (rz - b.r)) ** 2;
      if (e > 1) {
        const nl = Math.hypot(b.x / (rx - b.r) ** 2, b.z / (rz - b.r) ** 2);
        const ux = b.x / (rx - b.r) ** 2 / nl;
        const uz = b.z / (rz - b.r) ** 2 / nl;
        const sc = 1 / Math.sqrt(e);
        b.x *= sc;
        b.z *= sc;
        const vn = b.vx * ux + b.vz * uz;
        if (vn > 0) {
          b.vx -= 1.6 * vn * ux;
          b.vz -= 1.6 * vn * uz;
        }
      }
      // whirlpool swallows nothing, just swirls
      const y = this.water.h(b.x, b.z, this.t);
      const bob = Math.sin(this.t * 2.1 + b.ph) * 0.05;
      b.mesh.position.set(b.x, y + (b.kind === 'duck' ? 0.1 : 0.12) + bob, b.z);
      b.mesh.rotation.y = Math.sin(this.t * 0.5 + b.ph) * 0.6 + b.ph;
      b.mesh.rotation.z = Math.sin(this.t * 1.6 + b.ph) * 0.07;
      b.mesh.rotation.x = Math.cos(this.t * 1.3 + b.ph) * 0.06;
      if (b.foam) b.foam.position.set(b.x, y + 0.1, b.z);
    }
  }

  private updatePickups(dt: number) {
    void dt;
    const p = this.player;
    for (const pk of this.pickups) {
      if (pk.got) continue;
      const y = this.water.h(pk.x, pk.z, this.t);
      pk.mesh.position.set(pk.x, y + 0.7 + Math.sin(this.t * 2 + pk.ph) * 0.12, pk.z);
      pk.mesh.rotation.y = this.t * 1.3 + pk.ph;
      if (!p.alive) continue;
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 2.6 + p.hb) {
        pk.got = true;
        pk.mesh.visible = false;
        this.audio.pick();
        this.fx.ripple(pk.x, pk.z, 0.8, 6, 1.2, 0xffe14a);
        if (pk.kind === 'wind') {
          this.wind = Math.min(100, this.wind + 45);
          this.toast('🔩 태엽 보충! +45%', 'good');
        } else if (pk.kind === 'glue') {
          p.flood = Math.max(0, p.flood - 28);
          p.leak = 0;
          this.toast('🧴 본드로 틈새 땜빵! 침수 −28', 'good');
        } else {
          p.torps = Math.min(9, p.torps + 2);
          this.toast('🚀 성냥곽 어뢰 +2', 'good');
        }
      }
    }
  }

  private updateFlooding(dt: number) {
    const dr = this.level.drain;
    const ds = this.water.drainStrength(this.t);
    for (const s of this.ships) {
      if (s.alive) {
        s.flood += s.leak * dt;
        if (dr && ds > 0.4 && Math.hypot(s.x - dr.x, s.z - dr.z) < 2.6 && !(s.kind === 'sub' && s.dive > 0.5)) {
          s.flood += 7 * ds * dt;
          s.lastHitBy = 'drain';
          if (s === this.player && this.coreWarn <= 0) { this.toast('🌀 배수구에 빨려든다! 벗어나!', 'bad'); this.coreWarn = 6; }
        }
        s.peakFlood = Math.max(s.peakFlood, this.floodPct(s) * 100);
        if (s.flood >= s.cap) this.sinkShip(s, null);
        if (s.kind === 'sub') {
          // submarine dive depth follows its phase
          const a = s.ai;
          const goal = !a ? 0 : a.phase === 'dived' || a.phase === 'diving' ? 1 : 0;
          s.dive += clamp(goal - s.dive, -dt / 2.4, dt / 2.4);
        }
      }
    }
    this.coreWarn = Math.max(0, this.coreWarn - dt);
  }

  // ---------- hazards & events
  private hazards() {
    const cfg = this.level;
    const t = this.t;
    const pour = cfg.pour;
    if (pour) {
      const ap = this.water.activePour(t);
      if (ap) {
        if (this.pourWarned !== ap.ev.k && ap.warn > 0 && ap.since < 0) {
          this.pourWarned = ap.ev.k;
          this.toast(pick(RADIO.mompour, this.rng), 'radio');
          this.audio.bell();
        }
        if (this.pourDone < ap.ev.k && ap.since >= 0) {
          this.pourDone = ap.ev.k;
          this.applyPour(ap.ev, pour.rad);
        }
      }
    }
    if (!this.dadDone && this.elapsed >= cfg.dad && this.state === 'run') {
      this.dadDone = true;
      this.toast(pick(RADIO.dad, this.rng), 'radio');
      this.toast('🌊 아빠가 욕조를 밀어 파도가 거세진다!', 'bad');
    }
    const dr = cfg.drain;
    if (dr && isFinite(dr.tPlug) && !this.plugDone && t >= dr.tPlug) {
      this.plugDone = true;
      this.toast(pick(RADIO.plug, this.rng), 'radio');
      this.toast('🌀 마개가 뽑혔다! 소용돌이가 커진다!', 'bad');
      this.audio.pour();
    }
  }

  private applyPour(ev: PourEvent, rad: number) {
    this.audio.pour();
    this.shake = Math.min(1, this.shake + 0.5);
    this.fx.ripple(ev.x, ev.z, 1, rad * 1.3, 2.4);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.28;
      this.fx.drop(ev.x, 0.5, ev.z, Math.cos(a) * 4 * Math.random(), 6 + Math.random() * 6, Math.sin(a) * 4 * Math.random(), 0.25, 1.3);
    }
    const hit = (x: number, z: number, add: (vx: number, vz: number) => void) => {
      const dx = x - ev.x;
      const dz = z - ev.z;
      const r = Math.hypot(dx, dz);
      if (r < rad && r > 0.01) {
        const k = 1 - r / rad;
        add((dx / r) * (2.2 + 5.5 * k), (dz / r) * (2.2 + 5.5 * k));
      }
    };
    for (const s of this.ships) {
      if (s.sinkT >= 0) continue;
      hit(s.x, s.z, (vx, vz) => {
        s.vx += vx;
        s.vz += vz;
        s.rollV += (this.rng() < 0.5 ? -1 : 1) * (1 + Math.hypot(vx, vz) * 0.25);
      });
    }
    for (const b of this.bodies) hit(b.x, b.z, (vx, vz) => { b.vx += vx; b.vz += vz; });
    const p = this.player;
    if (Math.hypot(p.x - ev.x, p.z - ev.z) < rad) this.toast('🪣 바가지 물벼락!', 'bad');
  }

  /** deterministic style bonuses evaluated at the end + periodic chatter */
  private styleEvents(dt: number) {
    this.radioCool -= dt;
    if (this.state !== 'run') return;
    if (this.radioCool < 0 && this.wind < 18 && this.wind > 0 && Math.random() < 0.02) {
      this.toast(pick(RADIO.low, this.rng), 'radio');
      this.radioCool = 12;
    }
  }

  // ---------- AI
  private aiThink(s: Ship, dt: number) {
    const ai = s.ai!;
    const p = this.player;
    const sp = SPEC[s.kind];
    if (!p.alive) { s.thrCmd = 0.2; s.rudCmd = 0; return; }
    const { rx, rz } = this.level;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const d = Math.hypot(dx, dz);
    const brg = Math.atan2(dx, dz);
    ai.orbitT -= dt;
    if (ai.orbitT <= 0) {
      ai.orbit = this.rng() < 0.5 ? 1 : -1;
      ai.orbitT = 10 + this.rng() * 14;
    }
    const pref = sp.pref * (1 + (1 - s.skill) * 0.3);
    let want: number;
    if (d > pref * 1.2) want = brg;
    else want = brg + ai.orbit * (Math.PI / 2 - clamp((d - pref) / pref, -0.6, 0.6) * 0.9);
    // sub phases
    if (s.kind === 'sub') {
      ai.phaseT -= dt;
      if (ai.phaseT <= 0) {
        if (ai.phase === 'dived') { ai.phase = 'rising'; ai.phaseT = 2.6; }
        else if (ai.phase === 'rising') { ai.phase = 'up'; ai.phaseT = s.boss ? 7.5 : 8; this.toast('🔱 잠수함이 부상한다!', 'info'); }
        else if (ai.phase === 'up') { ai.phase = 'diving'; ai.phaseT = 2.6; }
        else { ai.phase = 'dived'; ai.phaseT = (s.boss ? 11 : 9) + this.rng() * 4; }
      }
      if (ai.phase === 'dived' || ai.phase === 'diving') {
        // run in, keep aimed at the player to launch torpedoes
        if (d > pref * 0.8) want = brg + ai.orbit * 0.25;
      }
    }
    // avoid the wall
    const cx = s.x + Math.sin(s.h) * (5 + Math.hypot(s.vx, s.vz) * 1.6);
    const cz = s.z + Math.cos(s.h) * (5 + Math.hypot(s.vx, s.vz) * 1.6);
    if ((cx / (rx * 0.9)) ** 2 + (cz / (rz * 0.9)) ** 2 > 1) want = Math.atan2(-s.x, -s.z);
    // avoid the whirlpool
    const dr = this.level.drain;
    if (dr && this.water.drainStrength(this.t) > 0.05) {
      const ddx = s.x - dr.x;
      const ddz = s.z - dr.z;
      if (Math.hypot(ddx, ddz) < dr.rad * 0.85) want = Math.atan2(ddx, ddz);
    }
    // avoid toys
    for (const b of this.bodies) {
      const bx = b.x - cx;
      const bz = b.z - cz;
      if (Math.hypot(bx, bz) < b.r + 3.5) { want = Math.atan2(-bx, -bz); break; }
    }
    // dodge incoming torpedoes
    for (const tp of this.torps) {
      if (tp.team === s.team || tp.dead || this.rng() > s.skill + 0.2) continue;
      const tx = s.x - tp.x;
      const tz = s.z - tp.z;
      const td = Math.hypot(tx, tz);
      if (td > 18) continue;
      const tv = Math.hypot(tp.vx, tp.vz);
      const closing = (tx * tp.vx + tz * tp.vz) / (td * tv);
      if (closing > 0.9) { want = Math.atan2(tp.vx, tp.vz) + (this.rng() < 0.5 ? 1.5 : -1.5); break; }
    }
    const dh = wrap(want - s.h);
    s.rudCmd = clamp(-dh * 2.2, -1, 1);
    const slowTurn = Math.abs(dh) > 1.2 ? 0.55 : 1;
    s.thrCmd = (d > pref ? 0.95 : 0.65) * slowTurn * (this.state === 'run' ? 1 : 0);
    // gunnery
    for (const side of [0, 1] as const) {
      if (s.reload[side] > 0) { ai.react[side] = 0.5 + this.rng() * 1.1 * (1.2 - s.skill); continue; }
      if (s.kind === 'sub' && s.dive > 0.2) continue;
      const tgt = this.pickTarget(s, side);
      if (tgt) {
        ai.react[side] -= dt;
        if (ai.react[side] <= 0) this.fire(s, side);
      } else ai.react[side] = 0.4 + this.rng() * 0.8;
    }
    // torpedoes: only when the bow points at the player
    ai.torpCd -= dt;
    if (sp.torp && s.skill >= 0.6 && ai.torpCd <= 0 && d > 14 && d < 44 && (s.kind !== 'sub' || s.dive > 0.3 || ai.phase === 'dived')) {
      let px = p.x;
      let pz = p.z;
      for (let i = 0; i < 3; i++) {
        const T = Math.hypot(px - s.x, pz - s.z) / ENEMY_TORP_SPEED;
        px = p.x + p.vx * T;
        pz = p.z + p.vz * T;
      }
      const a = Math.atan2(px - s.x, pz - s.z);
      if (Math.abs(wrap(a - s.h)) < 0.16) {
        ai.torpCd = s.kind === 'sub' ? 8.5 : 26 + this.rng() * 8;
        const fan = s.kind === 'sub' ? [-0.07, 0.07] : [0];
        for (const f of fan) this.launchTorp(s, a + f + this.gauss() * 0.03 * (1.3 - s.skill), ENEMY_TORP_SPEED, ENEMY_TORP_DMG);
        if (d < 60) this.toast('⚠ 적 어뢰 접근! 방향을 꺾어라', 'bad');
      }
    }
  }

  // ---------- ending
  private checkEnd(dt: number) {
    if (this.state === 'run') {
      if (!this.player.alive) {
        this.state = 'lost';
        this.endT = 2.8;
        this.audio.lose();
        this.setCenter('침몰...', '');
      } else if (this.enemiesLeft() === 0) {
        this.state = 'won';
        this.endT = 2.4;
        this.audio.win();
        this.setCenter('적 함대 격침!', 'go');
        if (this.player.peakFlood <= 30) this.addBonus(6, '침수 30% 이하 완승');
      }
    } else if (this.state === 'won' || this.state === 'lost') {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
    }
  }

  finish() {
    if (this.endCalled) return;
    this.endCalled = true;
    this.state = 'done';
    const win = this.player.alive;
    const net = Math.max(5, this.netTime());
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    const detail = [
      { label: '전투 시간', value: fmtTime(this.elapsed) },
      { label: '격침', value: `${this.sunk}/${this.enemies().length}` },
      { label: '명중률', value: `${acc}% (${this.shotsHit}/${this.shotsFired}발)` },
      { label: '최대 침수', value: `${Math.round(this.player.peakFlood)}%` },
      { label: '전탄 명중 일제사격', value: `${this.fullSalvos}회` },
      { label: '어뢰 격침', value: `${this.torpKills}척` },
      { label: 'T자 횡단', value: `${this.tCross}회` },
      { label: '보너스', value: `−${this.bonusEff().toFixed(0)}초` },
      { label: '페널티', value: `+${this.penalty.toFixed(1)}초` },
    ];
    if (!win) {
      this.opts.onEnd({ timeMs: Math.round(Math.max(this.elapsed + DEATH_PENALTY, BRONZE[this.level.id - 1] + 30) * 1000), title: '침몰...', detail });
      return;
    }
    this.opts.onEnd({ timeMs: Math.round(net * 1000), title: this.player.peakFlood <= 30 ? '무피해 완승!' : '적 함대 전멸!', detail });
  }

  // ------------------------------------------------------------ effects (wake, smoke, bubbles)
  private effects(dt: number) {
    for (const s of this.ships) {
      if (s.sinkT >= 1) continue;
      const sp = Math.hypot(s.vx, s.vz);
      const hidden = s.kind === 'sub' && s.dive > 0.7;
      s.wakeT -= dt;
      if (s.alive && sp > 0.8 && s.wakeT <= 0 && !(hidden && sp < 1.5)) {
        s.wakeT = Math.max(0.05, 0.16 - sp * 0.02);
        const fx = Math.sin(s.h);
        const fz = Math.cos(s.h);
        const rx = -Math.cos(s.h);
        const rz = Math.sin(s.h);
        const sx = s.x - fx * s.hl * 0.95;
        const sz = s.z - fz * s.hl * 0.95;
        this.fx.foam(sx + (Math.random() - 0.5) * 0.3, sz + (Math.random() - 0.5) * 0.3, 0.5 + sp * 0.18, 2.4 + sp * 0.2);
        // bow wave "V" foam
        if (!hidden) {
          const bxp = s.x + fx * s.hl * 0.75;
          const bzp = s.z + fz * s.hl * 0.75;
          this.fx.foam(bxp + rx * s.hb * 0.7, bzp + rz * s.hb * 0.7, 0.35 + sp * 0.07, 1.1, 0xffffff, rx * 0.5, rz * 0.5);
          this.fx.foam(bxp - rx * s.hb * 0.7, bzp - rz * s.hb * 0.7, 0.35 + sp * 0.07, 1.1, 0xffffff, -rx * 0.5, -rz * 0.5);
        }
        if (Math.random() < 0.5) this.fx.bubble(sx, 0.05, sz, 0.12, 1.2);
      }
      s.smokeT -= dt;
      if (s.smokeT <= 0 && s.alive && !hidden) {
        const pct = this.floodPct(s);
        if (pct > 0.45 || s === this.player) {
          s.smokeT = pct > 0.45 ? 0.16 : 0.5;
          const m = s.model;
          const fxv = Math.sin(s.h);
          const fzv = Math.cos(s.h);
          this.fx.smoke(s.x + fxv * m.funnel.z, s.floorY + m.funnel.y + 0.2, s.z + fzv * m.funnel.z, pct > 0.45 ? 0.45 : 0.22, 1.6, pct > 0.45 ? 0x2a2a2a : 0xd8d8d8);
        } else s.smokeT = 0.4;
      }
      if (!s.alive) {
        s.bowT -= dt;
        if (s.bowT <= 0) {
          s.bowT = 0.07;
          this.fx.bubble(s.x + (Math.random() - 0.5) * s.hl, 0.1, s.z + (Math.random() - 0.5) * s.hl, 0.18, 1.8);
          if (Math.random() < 0.3) this.fx.foam(s.x + (Math.random() - 0.5) * 2, s.z + (Math.random() - 0.5) * 2, 0.8, 2);
        }
      }
    }
    // faucet drips
    const f = this.level.faucet!;
    const per = 1.7;
    if (Math.floor(this.t / per) !== Math.floor((this.t - dt) / per)) {
      this.fx.ripple(f.x, f.z, 0.3, 4, 1.6);
      this.fx.drop(f.x, 0.2, f.z, 0, 2.4, 0, 0.1, 0.8);
      if (this.player.alive && Math.hypot(f.x - this.player.x, f.z - this.player.z) < 14) this.audio.drip();
    }
    if (f.force > 0 && Math.random() < 0.5) {
      this.fx.foam(f.x + (Math.random() - 0.5) * 1.2, f.z + (Math.random() - 0.5) * 1.2, 0.9, 1.4, 0xffffff, f.dx * f.force * 0.7, f.dz * f.force * 0.7);
    }
    const dr = this.level.drain;
    const ds = this.water.drainStrength(this.t);
    if (dr && ds > 0.05 && Math.random() < 0.6) {
      const a = Math.random() * 6.28;
      const r = (0.3 + Math.random() * 0.7) * dr.rad * (0.4 + 0.6 * ds);
      this.fx.foam(dr.x + Math.cos(a) * r, dr.z + Math.sin(a) * r, 0.7, 1.4, 0xffffff, -Math.sin(a) * 3 * ds, Math.cos(a) * 3 * ds);
    }
  }

  // ------------------------------------------------------------ rendering
  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private poseShip(s: Ship, _dt: number) {
    const m = s.model;
    const sinking = s.sinkT >= 0 ? s.sinkT : 0;
    const pct = this.floodPct(s);
    const y = s.floorY - pct * 0.28 - sinking * sinking * 3.4;
    m.root.position.set(s.x, y, s.z);
    m.root.rotation.y = s.h;
    m.body.rotation.set(-(s.pitch + sinking * 1.0 - pct * 0.08), 0, s.roll);
    if (s.kind === 'sub') {
      m.body.position.y = -s.dive * 1.15;
      if (m.up) m.up.position.y = s.dive * 0.95 - 0.0; // keep the periscope above the surface while diving
    }
    m.root.visible = s.sinkT < 1;
    // turrets swing to the side that just fired
    for (const t of m.turrets) {
      const f0 = s.sinceFire[0] < 1.6 ? 1 : 0;
      const f1 = s.sinceFire[1] < 1.6 ? 1 : 0;
      const goal = f0 ? Math.PI / 2 : f1 ? -Math.PI / 2 : 0;
      t.rotation.y += (goal - t.rotation.y) * 0.12;
    }
    const fl = s.hitFlash;
    for (const mt of m.mats) mt.emissive.setRGB(fl * 0.9, fl * 0.25, fl * 0.1);
    if (m.flag) m.flag.rotation.z = Math.sin(this.t * 9 + s.id) * 0.25;
  }

  private sync(dt: number) {
    void dt;
    const t = this.t;
    for (const s of this.ships) this.poseShip(s, dt);
    for (const tp of this.torps) tp.mesh.position.y = this.water.h(tp.x, tp.z, t) + 0.02;
    // water surface
    const pos = this.room.waterGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.water.h(pos.getX(i), pos.getZ(i), t));
    pos.needsUpdate = true;
    this.room.waterGeo.computeVertexNormals();
    this.room.caustic.offset.set((t * 0.02) % 1, (t * 0.013) % 1);
    if (this.room.streamTex) this.room.streamTex.offset.y = -(t * 2.6) % 1;
    // whirlpool + plug
    const dr = this.level.drain;
    const ds = this.water.drainStrength(t);
    if (dr) {
      const sp = this.room.spiral;
      (sp.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, ds * 1.2);
      sp.visible = ds > 0.01;
      sp.rotation.z = -t * (1 + 3 * ds);
      const scale = 0.4 + 0.6 * ds;
      sp.scale.set(scale, scale, 1);
      const pull = isFinite(dr.tPlug) ? clamp((t - dr.tPlug) / 1.5, 0, 1) : 0;
      this.room.plug.position.set(dr.x + pull * 3, -4.1 + pull * 4 + Math.sin(pull * 3) * pull, dr.z);
      this.room.plug.visible = pull < 1 || ds < 0.2 ? true : false;
      if (pull >= 1) this.room.plug.visible = false;
    }
    // 바가지 pour visuals
    const ap = this.water.activePour(t);
    const sc = this.room.scoop;
    const warn = this.room.warn;
    if (ap && this.level.pour && ap.since < 2.2) {
      const pr = this.level.pour;
      warn.visible = ap.since < 0.4;
      if (warn.visible) {
        const k = clamp(ap.warn, 0, 1);
        warn.position.set(ap.ev.x, 0.3, ap.ev.z);
        warn.scale.setScalar(Math.max(0.5, pr.rad * (0.35 + 0.65 * k)));
        (warn.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(t * 14);
      }
      sc.visible = true;
      const k = clamp((ap.since + 1.4) / 1.8, 0, 1); // approach & tilt
      const tilt = k < 0.7 ? 0 : (k - 0.7) / 0.3;
      const out = ap.since > 0.8 ? clamp((ap.since - 0.8) / 1.4, 0, 1) : 0;
      sc.position.set(ap.ev.x, 10 + (1 - clamp(k * 1.4, 0, 1)) * 14 + out * 16, ap.ev.z + 3);
      sc.rotation.x = -tilt * 1.15;
      const pouring = ap.since > -0.25 && ap.since < 0.9;
      this.room.scoopStream.visible = pouring;
      if (pouring) {
        const hgt = Math.max(1, sc.position.y);
        this.room.scoopStream.scale.set(1.3, hgt, 1.3);
        this.room.scoopStream.position.set(ap.ev.x, hgt / 2, ap.ev.z + 0.5);
      }
    } else {
      sc.visible = false;
      warn.visible = false;
      this.room.scoopStream.visible = false;
    }
    void this.statusText;
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const { rx, rz } = this.level;
    // focus: nearest visible enemy
    let foc: Ship | null = null;
    let fd = 1e9;
    for (const e of this.ships) {
      if (e.team === 0 || !e.alive || (e.kind === 'sub' && e.dive > 0.6)) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < fd) { fd = d; foc = e; }
    }
    let offGoal = 0;
    if (foc) {
      const rel = wrap(Math.atan2(foc.x - p.x, foc.z - p.z) - p.h);
      offGoal = clamp(rel, -1.45, 1.45) * 0.72;
    }
    this.camOff += (offGoal - this.camOff) * (1 - Math.exp(-dt * 2.4));
    const goal = p.h + this.camOff;
    this.camYaw += wrap(goal - this.camYaw) * (1 - Math.exp(-dt * 6));
    const sh = this.shake * 0.12;
    const top = this.camMode === 2;
    for (const o of this.room.group.children) if (o.name === lampName) o.visible = !top;
    if (top) {
      const aspect = cam.aspect;
      const hgt = Math.max((rz + 4) / 0.55, (rx + 4) / (0.55 * aspect));
      cam.up.set(0, 0, -1);
      cam.position.set(0, hgt, 0.001);
      cam.lookAt(0, 0, 0);
      return;
    }
    cam.up.set(0, 1, 0);
    const ps = p.model.root.position;
    if (this.camMode === 1) {
      // bridge / gun view
      const fx = Math.sin(p.h);
      const fz = Math.cos(p.h);
      const bz = p.hl * 0.1;
      cam.position.set(p.x + fx * bz, ps.y + 1.25, p.z + fz * bz);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(-0.05 - p.pitch * 0.6, this.camYaw + Math.PI, p.roll * 0.7);
      cam.position.x += (Math.random() - 0.5) * sh;
      cam.position.y += (Math.random() - 0.5) * sh;
      return;
    }
    const dx = Math.sin(this.camYaw);
    const dz = Math.cos(this.camYaw);
    let dist = 9.5;
    let cx = p.x - dx * dist;
    let cz = p.z - dz * dist;
    // keep the camera inside the basin
    let guard = 0;
    while ((cx / (rx * 0.97)) ** 2 + (cz / (rz * 0.97)) ** 2 > 1 && guard++ < 24 && dist > 2) {
      dist -= 0.4;
      cx = p.x - dx * dist;
      cz = p.z - dz * dist;
    }
    const camY = 2.1 + (9.5 - dist) * 0.05;
    cam.position.set(cx + (Math.random() - 0.5) * sh, camY + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
    cam.lookAt(p.x + dx * 6, 0.55 + p.roll * 0, p.z + dz * 6);
    cam.rotation.z += p.roll * 0.15;
  }

  // ------------------------------------------------------------ HUD
  private setCenter(text: string, cls: string) {
    const c = this.hudEl.center;
    c.textContent = text;
    c.className = 'hud-center ' + cls;
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'radio' = 'info') {
    const box = this.hud?.querySelector('.toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    this.toasts.push({ el, t: 3.2 });
    while (box.children.length > 4) box.firstChild?.remove();
    if (kind === 'radio') this.audio.radio();
  }

  private updateToasts(dt: number) {
    for (const t of this.toasts) {
      t.t -= dt;
      if (t.t < 0.5) t.el.classList.add('out');
      if (t.t < 0) t.el.remove();
    }
    this.toasts = this.toasts.filter((t) => t.t >= 0);
  }

  private updateHud() {
    const e = this.hudEl;
    const p = this.player;
    e.time.textContent = fmtTime(this.netTime() < 0 ? 0 : this.elapsed);
    e.en.textContent = `🚢 적 ${this.enemiesLeft()}/${this.enemies().length}${this.penalty > 0 ? `  ⏱+${this.penalty.toFixed(1)}` : ''}${this.bonus > 0 ? `  ⭐−${this.bonusEff().toFixed(0)}` : ''}`;
    const pct = this.floodPct(p) * 100;
    e.flt.textContent = `💧 침수 ${pct.toFixed(0)}%${p.leak > 0.05 ? ' · 새는 중' : ''}`;
    (e.flb as HTMLElement).style.width = `${pct}%`;
    e.flb.parentElement!.parentElement!.classList.toggle('low', pct > 60);
    e.wdt.textContent = `🔄 태엽 ${this.wind.toFixed(0)}%${this.winding ? ' 감는 중...' : this.pumping ? ' · 펌프' : ''}`;
    (e.wdb as HTMLElement).style.width = `${this.wind}%`;
    e.wdb.parentElement!.parentElement!.classList.toggle('low', this.wind < 20);
    for (const [k, b, side] of [['lb', 'lt', 0], ['rb', 'rt', 1]] as const) {
      const left = p.reload[side];
      (e[k] as HTMLElement).style.width = `${(1 - left / p.reloadT) * 100}%`;
      e[k].parentElement!.parentElement!.classList.toggle('ready', left <= 0);
      void b;
    }
    e.tp.textContent = `🚀${'●'.repeat(Math.min(p.torps, 9))}${p.torps === 0 ? '없음' : ''}`;
    const th = p.thrCmd;
    const lvl = Math.round(Math.abs(th) * 4);
    e.tele.textContent = (th < -0.03 ? '후진 ' : th > 0.03 ? '전진 ' : '정지 ') + '▮'.repeat(lvl) + '▯'.repeat(4 - lvl);
    const roll = clamp(p.roll / 0.3, -1, 1);
    (e.nd as HTMLElement).style.left = `${50 + roll * 48}%`;
    const lvlOk = Math.abs(p.roll) < ROLL_OK;
    e.roll.classList.toggle('lvl', lvlOk);
    e.rolt.textContent = lvlOk ? '수평! 지금 쏴라' : '파도 · 수평일 때 쏴라';
    e.st.textContent = this.statusText;
    e.st.classList.toggle('on', this.statusT > 0);
    if (this.state === 'intro') this.setCenter(this.introT > 1.6 ? '3' : this.introT > 0.8 ? '2' : '1', 'count');
    else if (this.state === 'run') {
      if (e.center.className.includes('count')) {
        this.setCenter('출항!', 'go');
        this.goUntil = this.t + 1.0;
      } else if (this.goUntil > 0 && this.t > this.goUntil) {
        this.goUntil = 0;
        this.setCenter('', '');
      }
    }
  }

  /** target marker: nearest enemy in a broadside arc (shows range + whether it can be fired on) */
  private updateTarget() {
    const el = this.tgtEl;
    const p = this.player;
    let best: Ship | null = null;
    let bd = 1e9;
    let inArc = false;
    for (const q of this.ships) {
      if (q.team === 0 || !q.alive || (q.kind === 'sub' && q.dive > 0.5)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best || this.camMode === 2) { el.style.display = 'none'; return; }
    const rel = wrap(Math.atan2(best.x - p.x, best.z - p.z) - p.h);
    const off = Math.min(Math.abs(wrap(rel - Math.PI / 2)), Math.abs(wrap(rel + Math.PI / 2)));
    inArc = off < ARC && bd < p.range;
    this.projV.set(best.x, best.model.root.position.y + 1.6, best.z).project(this.camera);
    if (this.projV.z > 1 || Math.abs(this.projV.x) > 1.05 || Math.abs(this.projV.y) > 1.05) { el.style.display = 'none'; return; }
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    el.style.display = 'block';
    el.style.left = `${(this.projV.x * 0.5 + 0.5) * w}px`;
    el.style.top = `${(-this.projV.y * 0.5 + 0.5) * h}px`;
    el.classList.toggle('ok', inArc);
    this.hudEl.tgtt.textContent = `${SPEC[best.kind].name} ${bd.toFixed(0)}m ${inArc ? (rel > 0 ? '· 좌현 사격!' : '· 우현 사격!') : bd > p.range ? '· 사거리 밖' : '· 포각 밖'}`;
  }

  private drawMini() {
    const c = this.mini;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const { rx, rz } = this.level;
    const sx = (W - 14) / (rx * 2);
    const sz = (H - 14) / (rz * 2);
    const px = (x: number) => W / 2 + x * sx;
    const py = (z: number) => H / 2 + z * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,30,44,0.8)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = this.level.dim ? '#1c4a5c' : '#2a8aa8';
    g.strokeStyle = '#d23a2e';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(W / 2, H / 2, rx * sx, rz * sz, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // faucet current
    const f = this.level.faucet!;
    if (f.force > 0) {
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = f.w * 2 * sx * 0.6;
      g.beginPath();
      g.moveTo(px(f.x), py(f.z));
      g.lineTo(px(f.x + f.dx * f.len), py(f.z + f.dz * f.len));
      g.stroke();
    }
    const dr = this.level.drain;
    const ds = this.water.drainStrength(this.t);
    if (dr) {
      g.fillStyle = ds > 0.01 ? `rgba(0,10,30,${0.3 + 0.5 * ds})` : 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.arc(px(dr.x), py(dr.z), ds > 0.01 ? dr.rad * sx * (0.4 + 0.6 * ds) : 4, 0, 7);
      g.fill();
    }
    for (const w of this.level.towels) {
      g.save();
      g.translate(px(w.x), py(w.z));
      g.rotate(-w.rot);
      g.fillStyle = '#3f9a4d';
      g.fillRect((-w.w / 2) * sx, (-w.d / 2) * sz, w.w * sx, w.d * sz);
      g.restore();
    }
    for (const b of this.bodies) {
      g.fillStyle = b.kind === 'duck' ? '#ffd21f' : '#f2a6b8';
      g.beginPath();
      g.arc(px(b.x), py(b.z), 5, 0, 7);
      g.fill();
    }
    const ap = this.water.activePour(this.t);
    if (ap && ap.since < 0.4) {
      g.strokeStyle = '#ff3a2a';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(px(ap.ev.x), py(ap.ev.z), (this.level.pour?.rad ?? 10) * sx, 0, 7);
      g.stroke();
    }
    for (const pk of this.pickups) {
      if (pk.got) continue;
      g.fillStyle = pk.kind === 'wind' ? '#ffc928' : pk.kind === 'glue' ? '#6aa0ff' : '#ff8a5a';
      g.fillRect(px(pk.x) - 3, py(pk.z) - 3, 6, 6);
    }
    // player firing arcs
    const p = this.player;
    if (p.alive) {
      for (const side of [0, 1] as const) {
        const beam = p.h + (side === 0 ? Math.PI / 2 : -Math.PI / 2);
        g.fillStyle = p.reload[side] <= 0 ? 'rgba(46,230,107,0.22)' : 'rgba(255,255,255,0.08)';
        g.beginPath();
        g.moveTo(px(p.x), py(p.z));
        const a0 = Math.atan2(Math.cos(beam - ARC), Math.sin(beam - ARC));
        const a1 = Math.atan2(Math.cos(beam + ARC), Math.sin(beam + ARC));
        void a0; void a1;
        for (let k = 0; k <= 8; k++) {
          const a = beam - ARC + (ARC * 2 * k) / 8;
          g.lineTo(px(p.x + Math.sin(a) * p.range), py(p.z + Math.cos(a) * p.range));
        }
        g.closePath();
        g.fill();
      }
    }
    for (const tp of this.torps) {
      g.strokeStyle = tp.team === 0 ? '#9fd0ff' : '#ff9a6a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px(tp.x), py(tp.z));
      g.lineTo(px(tp.x - tp.vx * 0.7), py(tp.z - tp.vz * 0.7));
      g.stroke();
    }
    for (const s of this.ships) {
      if (!s.alive) continue;
      const hidden = s.kind === 'sub' && s.dive > 0.5;
      g.save();
      g.translate(px(s.x), py(s.z));
      g.rotate(-s.h + Math.PI);
      const k = s.kind === 'battleship' ? 9 : s.kind === 'gunboat' ? 5 : 7;
      g.fillStyle = s.team === 0 ? hex6(this.opts.color) : hidden ? 'rgba(255,90,90,0.35)' : '#ff5a5a';
      g.strokeStyle = s.team === 0 ? '#fff' : '#400';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -k);
      g.lineTo(k * 0.6, k * 0.8);
      g.lineTo(-k * 0.6, k * 0.8);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }

  // ------------------------------------------------------------ cleanup
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.src.dispose();
    this.audio.dispose();
    this.fx.dispose();
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
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
