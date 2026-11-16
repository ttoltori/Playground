import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { Particles } from '../forklift/particles';
import { RAudio } from './audio';
import { LEVELS, MEDALS, SHOTS, type LevelCfg, mulberry, rollBurst } from './levels';
import { BOTTLE, CALM, DEG, Flight, type ShotScore, type WindCfg, clamp, scoreShot, simulate, targetPos, windAt } from './physics';
import { RocketWorld, VS } from './scene';

const STEP = 1 / 60;
const WATER = 0xa6dcff;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const fmtPts = (v: number) => v.toLocaleString() + '점';
const signed = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString();

export type Phase = 'setup' | 'flight' | 'land' | 'burst' | 'readout' | 'done';

export interface ShotRec {
  n: number;
  label: string;
  points: number;
  burst: boolean;
  psi: number;
  water: number;
  pitch: number;
  yaw: number;
  along: number;
  lat: number;
  dist: number;
  apex: number;
  t: number;
  speed: number;
  chute: string;
  direct: boolean;
  bonus: { label: string; pts: number }[];
  hazard: string | null;
  rx: number;
  rz: number;
}

const SAY = {
  start: ['📢 짝꿍: 야 빨리 쏴봐, 내 차례 기다린다', '📢 선생님: 물 너무 많이 넣지 마라~', '📢 반장: 쉿! 과학의 날 대회 진행 중이다', '📢 짝꿍: 이거 콜라병이냐 사이다병이냐'],
  bull: ['📢 짝꿍: 와 과녁 정중앙!!', '📢 선생님: 어허, 이건 인정이다', '📢 반장: 기록원! 만점이다!'],
  near: ['📢 짝꿍: 오 가깝다 가깝다!', '📢 선생님: 거의 다 왔구나', '📢 반장: 아슬아슬!'],
  far: ['📢 짝꿍: 아깝다~ 조금만 더!', '📢 선생님: 바람도 계산해야지', '📢 짝꿍: 야 그건 옆 반 과녁이다'],
  zero: ['📢 선생님: 그건 어디 가는 로켓이냐', '📢 짝꿍: 야 걸어가서 던지는 게 빠르겠다', '📢 반장: 0점...'],
  burst: ['📢 짝꿍: 으악 터졌다! 다 젖었잖아!!', '📢 선생님: 압력을 너무 넣었구나...', '📢 짝꿍: 펑 소리 대박 ㅋㅋㅋ'],
  much: ['📢 선생님: 물 너무 많이 넣었다!', '📢 짝꿍: 야 그건 로켓이 아니라 물풍선이다'],
  little: ['📢 짝꿍: 물이 없는데? 공기 로켓이냐', '📢 선생님: 물이 있어야 밀고 나간단다'],
  basin: ['📢 짝꿍: 풍덩!! 물벼락이다!!', '📢 선생님: 대야에 쏙 들어갔네!'],
  kid: ['📢 짝꿍: 아야!! 야 나 맞았잖아!!', '📢 짝꿍: 으악 내 머리!! 선생님 쟤가요!'],
  teacher: ['📢 선생님: 어이쿠!! 이 녀석들이!', '📢 선생님: 점수 깎는다... 선생님 맞췄잖아!'],
  pony: ['📢 교감 선생님: 내 차!!!', '📢 교감 선생님: 포니가... 포니가...!'],
  chute: ['📢 짝꿍: 와 낙하산 폈다! 둥실둥실~', '📢 선생님: 낙하산은 바람에 흘러간단다'],
  torn: ['📢 짝꿍: 낙하산 찢어졌다!! 너무 빨랐어', '📢 선생님: 정점 지나고 천천히 펴야지'],
};

const CSS = `
.rk-hud .rk-target,.rk-hud .rk-fl{position:absolute;left:max(12px,env(safe-area-inset-left));top:54px;background:#000a;border-radius:10px;padding:5px 10px;font-size:12px;line-height:1.45}
.rk-hud .rk-fl{display:none;min-width:130px}
.rk-hud .rk-fl div,.rk-hud .rk-target div{display:flex;justify-content:space-between;gap:10px}
.rk-hud .rk-fl b,.rk-hud .rk-target b{font-family:ui-monospace,monospace;font-size:14px}
.rk-hud[data-ph=flight] .rk-fl,.rk-hud[data-ph=land] .rk-fl{display:block}
.rk-hud[data-ph=flight] .rk-target,.rk-hud[data-ph=land] .rk-target{display:none}
.rk-wind{position:absolute;top:54px;right:max(8px,env(safe-area-inset-right));text-align:center;font-size:11px;background:#000a;border-radius:10px;padding:4px 8px;min-width:76px;line-height:1.25}
.rk-wind .ar{display:block;font-size:24px;line-height:1;transition:transform .15s}
.rk-wind b{font-family:ui-monospace,monospace;font-size:14px}
.rk-camb{position:absolute;top:54px;right:calc(max(8px,env(safe-area-inset-right)) + 88px);width:48px;height:48px;font-size:20px;pointer-events:auto}
.rk-tip{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:#000b;padding:5px 12px;border-radius:16px;font-size:13px;max-width:44vw;text-align:center;line-height:1.3}
.rk-tip:empty{display:none}
.rk-tip.warn{color:#ffb0b0;outline:2px solid var(--bad)}
.rk-hud .toasts{top:96px;width:min(58vw,460px)}
.rk-hud[data-ph=readout] .toasts{display:none}
.rk-hud .hud-center{font-size:46px;white-space:nowrap;top:36%}
.rk-panel{position:absolute;left:max(12px,env(safe-area-inset-left));bottom:max(10px,env(safe-area-inset-bottom));width:min(340px,50vw);display:flex;flex-direction:column;gap:5px}
.rk-row{display:flex;align-items:center;gap:5px;background:#000b;border-radius:12px;padding:2px 8px;height:44px;pointer-events:auto}
.rk-lab{width:46px;font-size:12px;line-height:1.1}
.rk-step{width:38px;height:36px;border-radius:10px;border:2px solid #fff4;background:#fff1;color:#fff;font-size:20px;line-height:1;touch-action:none;font-family:inherit;padding:0}
.rk-step:active{background:var(--accent);color:#000}
.rk-sl{flex:1;height:36px;position:relative;touch-action:none;min-width:70px;cursor:pointer}
.rk-sl::before{content:'';position:absolute;left:0;right:0;top:15px;height:7px;border-radius:4px;background:#fff3}
.rk-sl i{position:absolute;left:0;top:15px;height:7px;border-radius:4px;background:var(--accent)}
.rk-sl b{position:absolute;top:4px;width:28px;height:28px;margin-left:-14px;border-radius:50%;background:#fff;box-shadow:0 1px 6px #000a}
.rk-sl[data-s=water] i{background:#42a5f5}
.rk-val{width:56px;text-align:right;font-family:ui-monospace,monospace;font-size:15px}
.rk-right{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.rk-gauge{width:260px;background:#000b;border-radius:12px;padding:5px 10px 6px;font-size:12px}
.rk-gbar{height:16px;border-radius:8px;background:#fff2;position:relative;overflow:hidden;margin-top:4px}
.rk-gbar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#2ee66b,#f2c200 75%,#ff7043);border-radius:8px}
.rk-gbar u{position:absolute;top:0;bottom:0;right:0;background:repeating-linear-gradient(45deg,#ff4757aa 0 6px,#7a1018aa 6px 12px);text-decoration:none}
.rk-gbar em{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:#fff;box-shadow:0 0 6px #fff}
.rk-gauge.hot{animation:rkshake .1s infinite}
.rk-gauge.hot b{color:#ff6b6b}
@keyframes rkshake{0%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-1px)}100%{transform:translate(1px,1px)}}
.rk-gauge .gt{display:flex;justify-content:space-between;align-items:baseline}
.rk-gauge b{font-family:ui-monospace,monospace;font-size:16px}
.rk-btns{display:flex;gap:9px;align-items:flex-end;pointer-events:none}
.rk-btns button{pointer-events:auto;border:3px solid #fff6;color:#fff;font-family:inherit;touch-action:none;line-height:1.05}
.rk-big{width:84px;height:84px;border-radius:50%;font-size:30px}
.rk-big small{display:block;font-size:12px;margin-top:2px}
.rk-pump{background:#1e88e5cc}
.rk-pump.on{background:var(--accent);color:#000}
.rk-fire{background:#e53935cc}
.rk-valve{width:58px;height:48px;border-radius:14px;background:#455a64cc;font-size:13px}
.rk-valve.on{background:var(--accent);color:#000}
.rk-chute{background:#ef6c00cc;display:none}
.rk-chute:disabled{opacity:.45}
.rk-hud[data-ph=setup] .rk-panel,.rk-hud[data-ph=setup] .rk-gauge{display:flex}
.rk-hud:not([data-ph=setup]) .rk-panel,.rk-hud:not([data-ph=setup]) .rk-pump,.rk-hud:not([data-ph=setup]) .rk-fire,.rk-hud:not([data-ph=setup]) .rk-valve,.rk-hud:not([data-ph=setup]) .rk-gauge{display:none}
.rk-hud[data-ph=flight] .rk-chute{display:block}
.rk-hud[data-ph=setup] .rk-gauge{display:block}
.rk-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);background:#0b1220ee;border:2px solid var(--accent);border-radius:14px;padding:10px 14px;pointer-events:auto;font-weight:400;display:none;text-shadow:none}
.rk-hud[data-ph=readout] .rk-card{display:block}
.rk-card .hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:#fffb}
.rk-card .pts{font-family:'Black Han Sans',sans-serif;font-size:34px;color:var(--accent);line-height:1.1}
.rk-card .pts.neg{color:var(--bad)}
.rk-card .main{font-size:17px;font-weight:700;margin:2px 0 4px}
.rk-card .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:12px;color:#fffc}
.rk-card .grid b{display:block;font-size:15px;color:#fff;font-family:ui-monospace,monospace}
.rk-card .set{font-size:12px;color:#9fd0ff;margin-top:5px}
.rk-card .bn{font-size:12px;color:var(--good);margin-top:3px}
.rk-card .say{font-size:12px;color:#ffe9a8;font-style:italic;margin-top:4px}
.rk-card .prev{font-size:11px;color:#fff9;margin-top:4px}
.rk-card .go{margin-top:8px;width:100%;height:44px;border-radius:12px;border:0;background:var(--accent);color:#000;font-size:17px;font-weight:700;font-family:inherit}
.rk-splash{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 55%,#4fc3f7cc 0,#1e88e5aa 55%,#0d47a1aa 100%);transition:opacity 1.2s}
.rk-splash.show{opacity:1;transition:none}
@media (max-height:480px),(hover:none){
  .rk-gauge{width:236px;padding:3px 8px 4px}
  .rk-big{width:76px;height:76px;font-size:26px}
  .rk-hud .hud-center{font-size:34px}
  .rk-card .pts{font-size:28px}
  .rk-card .main{font-size:15px}
  .rk-card{padding:8px 12px}
  .rk-card .go{height:42px;margin-top:6px}
  .rk-hud .toasts{top:48px}
}
`;

export class RocketGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly audio = new RAudio();
  readonly cfg: LevelCfg;
  readonly world: RocketWorld;
  readonly parts: Particles;
  private styleEl: HTMLStyleElement;
  private hud: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private disposed = false;
  private ended = false;
  paused = false;
  private mobile: boolean;

  // run state
  phase: Phase = 'setup';
  phaseT = 0;
  clock = 0;
  shot = 0;
  total = 0;
  results: ShotRec[] = [];
  readonly seed: number;
  wind: WindCfg = CALM;
  burstAt = 100;
  // parameters
  water = 0.3;
  psi = 0;
  pitchDeg = 45;
  yawDeg = 0;
  flight: Flight | null = null;
  lastScore: ShotScore | null = null;
  private scoreRng: () => number;
  // inputs
  private held = { water: 0, pitch: 0, aim: 0, pump: false, valve: false, fine: false };
  private pumpT = 0;
  private pumpPhase = 0;
  private pumpTick = 0;
  private arcDirty = true;
  private arcPred = '';
  predicted: number | null = null;
  private camSetup = 0;
  private camFlight = 0;
  private camPos = new THREE.Vector3(0, 3, 6);
  private camLook = new THREE.Vector3(0, 1, -10);
  private shake = 0;
  private landT = 0;
  private landFrom = new THREE.Vector3();
  private landTo = new THREE.Vector3();
  private fillShown = 0.3;
  private dustT = 0;
  private trailT = 0;
  private slow = 1;
  private cleanup: (() => void)[] = [];
  private dirSmooth = new THREE.Vector3(0, 0, -1);
  private hazardHop: { m: THREE.Object3D; t: number } | null = null;

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    const lvl = clamp(opts.level, 1, LEVELS.length);
    this.cfg = LEVELS[lvl - 1]!;
    const sp = new URLSearchParams(location.search).get('seed');
    this.seed = sp ? Number(sp) >>> 0 : (Math.random() * 2 ** 31) >>> 0;
    this.scoreRng = mulberry(this.seed ^ 0x51f15e);
    const mobile = (this.mobile = isTouchDevice() || window.innerWidth < 800);
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = false; // no real shadows (phones); the rocket is bright and small anyway
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';

    this.scene.background = new THREE.Color(this.cfg.sky);
    this.scene.fog = new THREE.Fog(this.cfg.fog, this.cfg.fogNear, this.cfg.fogFar);
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 900);
    this.world = new RocketWorld(this.cfg, mobile, opts.color);
    this.scene.add(this.world.group);
    this.parts = new Particles(this.scene, mobile ? 160 : 320);
    this.cfg.shots.forEach((s, i) => this.world.ensureTarget(i, s.target, s.hazards));

    // HUD ---------------------------------------------------------------
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    const h = (this.hud = document.createElement('div'));
    h.className = 'hud rk-hud';
    h.style.cssText = 'left:0;top:0;width:100%;height:100%';
    h.innerHTML = `
      <div class="hud-top">
        <div class="hud-name" style="--pc:#${opts.color.toString(16).padStart(6, '0')}">${escapeHtml(opts.nickname)}</div>
        <div class="hud-del" data-k="shot">🚀 1/${SHOTS}</div>
        <div class="hud-opp" data-k="total">0점</div>
      </div>
      <div class="rk-tip" data-k="tip"></div>
      <div class="rk-target" data-k="tgt"></div>
      <div class="rk-fl" data-k="fl"></div>
      <button class="tb rk-camb" data-b="cam">🎥</button>
      <div class="rk-wind"><span class="ar" data-k="warrow">▲</span><b data-k="wspd">0.0</b> m/s<br><span data-k="wtxt">무풍</span></div>
      <div class="rk-panel">
        <div class="rk-row"><span class="rk-lab">💧 물</span><button class="rk-step" data-h="water-">−</button><div class="rk-sl" data-s="water"><i></i><b></b></div><button class="rk-step" data-h="water+">＋</button><span class="rk-val" data-k="vwater">30%</span></div>
        <div class="rk-row"><span class="rk-lab">📐 각도</span><button class="rk-step" data-h="pitch-">−</button><div class="rk-sl" data-s="pitch"><i></i><b></b></div><button class="rk-step" data-h="pitch+">＋</button><span class="rk-val" data-k="vpitch">45.0°</span></div>
        <div class="rk-row"><span class="rk-lab">↔ 조준</span><button class="rk-step" data-h="aim-">◀</button><div class="rk-sl" data-s="aim"><i></i><b></b></div><button class="rk-step" data-h="aim+">▶</button><span class="rk-val" data-k="vaim">0.0°</span></div>
      </div>
      <div class="rk-right">
        <div class="rk-gauge" data-k="gauge"><div class="gt"><span>🔧 압력</span><span><b data-k="psi">0</b> psi · <span data-k="atm">0.0</span>기압</span></div><div class="rk-gbar"><i data-k="gfill"></i><u data-k="gred"></u><em data-k="gmark"></em></div></div>
        <div class="rk-btns">
          <button class="rk-valve" data-b="valve">빼기<br>V</button>
          <button class="rk-big rk-pump" data-b="pump">💨<small>펌프</small></button>
          <button class="rk-big rk-fire" data-b="fire">✂️<small>발사</small></button>
          <button class="rk-big rk-chute" data-b="chute">🪂<small>낙하산</small></button>
        </div>
      </div>
      <div class="rk-card" data-k="card"></div>
      <div class="rk-splash" data-k="splash"></div>
      <div class="hud-center" data-k="center"></div>
      <div class="toasts"></div>`;
    container.appendChild(h);
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.bindControls();

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.beginShot();
    this.toast(pick(SAY.start), 'radio');
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ helpers
  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.3 ? 72 : 62;
    this.camera.updateProjectionMatrix();
  }
  toast(text: string, kind: 'good' | 'bad' | 'info' | 'radio' = 'info') {
    const box = this.hud.querySelector('.toasts')!;
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 2) box.firstChild?.remove();
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3400);
  }
  private set(k: string, v: string, html = false) {
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    const e = this.el[k];
    if (e) (html ? (e.innerHTML = v) : (e.textContent = v));
  }
  private tip(text: string, warn = false) {
    const e = this.el.tip!;
    const key = text + warn;
    if (this.cache.tip === key) return;
    this.cache.tip = key;
    e.textContent = text;
    e.classList.toggle('warn', warn);
  }
  private center(text: string) {
    this.set('center', text);
  }
  get shotDef() {
    return this.cfg.shots[this.shot]!;
  }
  get windNow(): [number, number] {
    return windAt(this.wind, this.clock, 6);
  }
  get yaw() {
    return this.yawDeg * DEG;
  }

  // ------------------------------------------------------------ controls
  private bindControls() {
    const h = this.hud;
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, f as EventListener);
      this.cleanup.push(() => window.removeEventListener(t, f as EventListener));
    };
    // hold buttons (+/- steppers)
    h.querySelectorAll<HTMLButtonElement>('[data-h]').forEach((b) => {
      const [name, sg] = [b.dataset.h!.slice(0, -1), b.dataset.h!.endsWith('+') ? 1 : -1];
      const key = name === 'water' ? 'water' : name === 'pitch' ? 'pitch' : 'aim';
      const stop = () => {
        this.held[key] = 0;
        this.held.fine = false;
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.held[key] = sg;
        this.held.fine = false;
        this.nudge(key, sg, true);
        this.audio.tick();
      });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('lostpointercapture', stop);
    });
    // sliders
    h.querySelectorAll<HTMLElement>('[data-s]').forEach((s) => {
      const key = s.dataset.s as 'water' | 'pitch' | 'aim';
      const apply = (e: PointerEvent) => {
        const r = s.getBoundingClientRect();
        const f = clamp((e.clientX - r.left - 14) / Math.max(1, r.width - 28), 0, 1);
        this.setParam(key, key === 'water' ? 5 + f * 75 : key === 'pitch' ? 15 + f * 65 : -20 + f * 40);
      };
      s.addEventListener('pointerdown', (e) => {
        if (this.phase !== 'setup') return;
        e.preventDefault();
        s.setPointerCapture(e.pointerId);
        apply(e);
      });
      s.addEventListener('pointermove', (e) => {
        if (s.hasPointerCapture(e.pointerId)) apply(e);
      });
    });
    const hold = (b: HTMLElement, down: () => void, up: () => void) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        down();
      });
      const u = () => up();
      b.addEventListener('pointerup', u);
      b.addEventListener('pointercancel', u);
      b.addEventListener('lostpointercapture', u);
    };
    const q = (s: string) => h.querySelector<HTMLElement>(s)!;
    hold(q('[data-b=pump]'), () => this.pumpDown(), () => this.pumpUp());
    hold(q('[data-b=valve]'), () => (this.held.valve = true), () => (this.held.valve = false));
    q('[data-b=fire]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.fire();
    });
    q('[data-b=chute]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.parachute();
    });
    q('[data-b=cam]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.cycleCam();
    });

    const keyMap = (e: KeyboardEvent, down: boolean) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const c = e.code;
      if (c === 'Space' || c.startsWith('Arrow') || c === 'Enter') e.preventDefault();
      const rep = e.repeat;
      if (this.paused) return;
      if (c === 'ArrowUp' || c === 'KeyW') this.held.pitch = down ? 1 : this.held.pitch === 1 ? 0 : this.held.pitch;
      else if (c === 'ArrowDown' || c === 'KeyS') this.held.pitch = down ? -1 : this.held.pitch === -1 ? 0 : this.held.pitch;
      else if (c === 'ArrowLeft' || c === 'KeyA') this.held.aim = down ? -1 : this.held.aim === -1 ? 0 : this.held.aim;
      else if (c === 'ArrowRight' || c === 'KeyD') this.held.aim = down ? 1 : this.held.aim === 1 ? 0 : this.held.aim;
      else if (c === 'KeyQ') this.held.water = down ? -1 : this.held.water === -1 ? 0 : this.held.water;
      else if (c === 'KeyE') this.held.water = down ? 1 : this.held.water === 1 ? 0 : this.held.water;
      else if (c === 'ShiftLeft' || c === 'ShiftRight') this.held.fine = down;
      else if (c === 'KeyV' || c === 'Backspace') this.held.valve = down;
      else if (c === 'Space') {
        if (down && rep) return;
        if (this.phase === 'setup') (down ? this.pumpDown() : this.pumpUp());
        else if (down && this.phase === 'flight') this.parachute();
        else if (down && this.phase === 'readout') this.next();
      } else if (down && !rep) {
        if (c === 'Enter' || c === 'KeyF') {
          if (this.phase === 'setup') this.fire();
          else if (this.phase === 'readout') this.next();
          else if (this.phase === 'flight') this.parachute();
        } else if (c === 'KeyP') this.parachute();
        else if (c === 'KeyC') this.cycleCam();
      }
    };
    on('keydown', (e) => keyMap(e, true));
    on('keyup', (e) => keyMap(e, false));
    on('blur', () => {
      this.held = { water: 0, pitch: 0, aim: 0, pump: false, valve: false, fine: false };
      this.pumpUp();
    });
  }

  pumpDown() {
    if (this.phase !== 'setup') return;
    this.held.pump = true;
    this.pumpT = 0;
    this.addPsi(2);
    this.audio.pump(this.psi);
    this.hud.querySelector('.rk-pump')!.classList.add('on');
  }
  pumpUp() {
    this.held.pump = false;
    this.hud.querySelector('.rk-pump')?.classList.remove('on');
  }
  private nudge(key: 'water' | 'pitch' | 'aim', sg: number, tap = false) {
    const f = this.held.fine ? 0.25 : 1;
    if (key === 'water') this.setParam('water', this.water * 100 + sg * (tap ? 1 : 0.5) * f);
    else if (key === 'pitch') this.setParam('pitch', this.pitchDeg + sg * (tap ? 0.5 : 0.25) * f);
    else this.setParam('aim', this.yawDeg + sg * (tap ? 0.1 : 0.05) * f);
  }
  /** water in %, pitch / aim in degrees */
  setParam(key: 'water' | 'pitch' | 'aim', v: number) {
    if (this.phase !== 'setup') return;
    if (key === 'water') this.water = clamp(Math.round(v * 2) / 200, 0.05, 0.8);
    else if (key === 'pitch') this.pitchDeg = clamp(Math.round(v * 20) / 20, 15, 80);
    else this.yawDeg = clamp(Math.round(v * 20) / 20, -20, 20);
    this.arcDirty = true;
  }
  /** test / bot hook: set everything at once */
  setParams(p: { water?: number; psi?: number; pitchDeg?: number; yawDeg?: number }) {
    if (p.water !== undefined) this.water = clamp(p.water, 0, 0.9);
    if (p.psi !== undefined) this.psi = Math.max(0, p.psi);
    if (p.pitchDeg !== undefined) this.pitchDeg = p.pitchDeg;
    if (p.yawDeg !== undefined) this.yawDeg = p.yawDeg;
    this.arcDirty = true;
  }
  private addPsi(d: number) {
    if (this.phase !== 'setup') return;
    this.psi = clamp(this.psi + d, 0, this.cfg.gaugeMax);
    this.arcDirty = true;
    if (this.psi >= this.burstAt) this.burst();
  }
  cycleCam() {
    this.audio.tick();
    if (this.phase === 'setup' || this.phase === 'burst') this.camSetup = (this.camSetup + 1) % 2;
    else this.camFlight = (this.camFlight + 1) % 3;
    this.toast(this.phase === 'setup' ? ['🎥 발사대 시점', '🎥 운동장 전체 시점'][this.camSetup]! : ['🎥 뒤따라가기', '🎥 옆에서 보기', '🎥 위에서 보기'][this.camFlight]!, 'info');
  }

  // ------------------------------------------------------------ phases
  private beginShot() {
    this.phase = 'setup';
    this.phaseT = 0;
    this.hud.dataset.ph = 'setup';
    this.psi = 0;
    this.flight = null;
    this.lastScore = null;
    this.wind = this.cfg.windFor(mulberry((this.seed + this.shot * 7919) >>> 0));
    this.burstAt = rollBurst(this.cfg, this.scoreRng);
    const sd = this.shotDef;
    this.world.setCurrent(this.shot, sd.target);
    this.world.showBeacon(true);
    this.world.showAim(true);
    this.world.clearTrail();
    this.world.setChute(false, 0, 0, 0, 0);
    this.world.pull(0);
    this.world.setAim(this.yaw, this.pitchDeg * DEG);
    this.world.restRocketOnPad();
    this.world.rocket.root.visible = true;
    this.world.crowdRest();
    this.arcDirty = true;
    this.slow = 1;
    this.center('');
    this.set('shot', `🚀 ${this.shot + 1}/${SHOTS}`);
    if (this.shot > 0) this.toast(sd.intro, 'radio');
    this.cache.card = '';
    this.tipBase = this.cfg.aid === 'calm' ? '점선 = 무풍 예상 궤적 (바람이 불면 달라져요!)' : '궤적 힌트 없음 — 눈과 감으로!';
  }
  private tipBase = '';

  fire() {
    if (this.phase !== 'setup') return;
    if (this.psi < 6) {
      this.toast('압력이 거의 없다! 💨 펌프를 먼저 눌러라', 'bad');
      this.audio.warn();
      return;
    }
    if (this.water > 0.6) this.toast(pick(SAY.much), 'radio');
    else if (this.water < 0.12) this.toast(pick(SAY.little), 'radio');
    const sd = this.shotDef;
    this.flight = new Flight({ water: this.water, psi: this.psi, pitch: this.pitchDeg * DEG, yaw: this.yaw }, this.wind, this.clock, sd.target, this.world.water);
    this.phase = 'flight';
    this.phaseT = 0;
    this.hud.dataset.ph = 'flight';
    this.pumpUp();
    this.held.valve = false;
    this.world.rocketOnPad = false;
    this.world.showAim(false);
    this.world.setArc(null, null);
    this.world.clearTrail();
    this.world.pull(1);
    this.audio.launch();
    this.shake = 0.5;
    this.camFlightReset();
    // 펑! of spray at the pad
    const d = this.world.aimDir;
    for (let i = 0; i < (this.mobile ? 30 : 60); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3.5;
      this.parts.spawn(0, 0.5, 0, -d.x * r * 2 + Math.cos(a) * r, 1 + Math.random() * 3, -d.z * r * 2 + Math.sin(a) * r, WATER, 0.8 + Math.random() * 0.6, 0.12 + Math.random() * 0.1, 14);
    }
    this.tipBase = this.mobile ? '정점을 지나면 🪂 낙하산! (너무 빠르면 찢어져요)' : '정점을 지나면 P / Space = 낙하산 · C 시점';
  }

  private camFlightReset() {
    this.dirSmooth.set(this.world.aimDir.x, 0, this.world.aimDir.z).normalize();
  }

  parachute(): string {
    const f = this.flight;
    if (this.phase !== 'flight' || !f) return 'no';
    if (f.chute.state !== 'none') return 'no';
    if (!f.canChute()) {
      this.toast('아직! 정점을 지나 내려올 때 펼 수 있다 🪂', 'bad');
      this.audio.warn();
      return 'no';
    }
    const r = f.deployChute();
    if (r === 'torn') {
      this.audio.rip();
      this.toast(pick(SAY.torn), 'bad');
      this.parts.burst(f.x, f.y, f.z, 14, 0xff7043, 5, 0.12, 0.9);
    } else if (r === 'open') {
      this.audio.chute();
      this.toast(pick(SAY.chute), 'good');
    }
    return r;
  }

  private burst() {
    this.phase = 'burst';
    this.phaseT = 0;
    this.hud.dataset.ph = 'burst';
    this.pumpUp();
    this.held.valve = false;
    this.audio.pop();
    this.shake = 1;
    this.center('펑!!');
    const x = 0;
    const y = 1.1;
    for (let i = 0; i < (this.mobile ? 50 : 100); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 9;
      this.parts.spawn(x, y, 0, Math.cos(a) * s, 2 + Math.random() * 8, Math.sin(a) * s, WATER, 0.9 + Math.random() * 0.7, 0.12 + Math.random() * 0.12, 14);
    }
    this.parts.burst(x, y, 0, 18, 0xe0f2ff, 7, 0.1, 1.4);
    this.world.rocket.root.visible = false;
    const sp = this.el.splash!;
    sp.classList.add('show');
    setTimeout(() => sp.classList.remove('show'), 90);
    this.toast(pick(SAY.burst), 'bad');
    this.world.crowdHop(this.clock);
    const rec: ShotRec = {
      n: this.shot + 1,
      label: this.shotDef.target.label,
      points: 0,
      burst: true,
      psi: this.psi,
      water: this.water,
      pitch: this.pitchDeg,
      yaw: this.yawDeg,
      along: 0,
      lat: 0,
      dist: 0,
      apex: 0,
      t: 0,
      speed: 0,
      chute: '-',
      direct: false,
      bonus: [],
      hazard: null,
      rx: 0,
      rz: 0,
    };
    this.results.push(rec);
    this.world.addFlag(this.shot + 1, 0, 3, 0, true);
    this.world.clearTrail();
  }

  private onLanded() {
    const f = this.flight!;
    const e = f.end!;
    const sd = this.shotDef;
    const sc = scoreShot(e, f.tAbs, sd.target, sd.hazards, f.chute);
    this.lastScore = sc;
    this.phase = 'land';
    this.phaseT = 0;
    this.hud.dataset.ph = 'land';
    const hit = sc.hazard;
    const total = Math.max(0, this.total + sc.points);
    this.total = total;
    // ground effects
    const px = e.kind === 'target' || e.kind === 'water' ? e.x : e.x;
    const pz = e.kind === 'target' || e.kind === 'water' ? e.z : e.z;
    this.landFrom.set(px, e.y, pz);
    this.landTo.set(e.kind === 'target' || e.kind === 'water' ? px : e.rx, e.y, e.kind === 'target' || e.kind === 'water' ? pz : e.rz);
    this.landT = 0;
    if (e.kind === 'water' || (e.kind === 'target' && sd.target.kind === 'basin')) {
      this.audio.splash();
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1 + Math.random() * 4;
        this.parts.spawn(px, 0.2, pz, Math.cos(a) * s, 4 + Math.random() * 6, Math.sin(a) * s, 0xbfe8ff, 1 + Math.random() * 0.6, 0.18, 14);
      }
    } else {
      this.audio.thud();
      this.parts.burst(px, 0.2, pz, 14, 0xb59a6a, 5, 0.14, 0.8);
    }
    this.world.setChute(false, 0, 0, 0, 0);
    this.world.showBeacon(false);
    // settle the model nose-down in the ground
    const w = f.chute.state === 'open' ? 0.2 : 1;
    const dx = f.vx * 0.1 * w;
    const dz = f.vz * 0.1 * w;
    this.world.rocket.orient(dx, -Math.max(0.3, Math.abs(f.vy)), dz);
    this.world.rocket.root.position.set(px, e.y + 0.25 * VS, pz);
    this.world.rocket.root.visible = true;
    const flag = this.world.addFlag(this.shot + 1, this.landTo.x + 0.6, this.landTo.z, e.y);
    flag.visible = true;
    // comedy
    let say: string;
    if (hit) {
      if (hit.kind === 'pony') {
        this.audio.bonk();
        this.parts.burst(hit.x, 1, hit.z, 20, 0xffe082, 8, 0.15, 1);
        say = pick(SAY.pony);
      } else {
        this.audio.bonk();
        say = pick(hit.kind === 'kid' ? SAY.kid : SAY.teacher);
      }
      const k = sd.hazards.indexOf(hit);
      const m = this.world.hazardMesh(this.shot, k);
      if (m) this.hazardHop = { m, t: 0 };
      this.center(hit.kind === 'pony' ? '쾅!!' : '아야!');
    } else if (sc.direct && (sd.target.kind === 'basin')) {
      say = pick(SAY.basin);
      this.center('풍덩!');
      this.audio.good();
    } else if (sc.base >= 1000 || sc.direct) {
      say = pick(SAY.bull);
      this.audio.good();
      this.audio.cheer();
      this.center(sc.direct ? '명중!' : '정중앙!');
      this.parts.burst(px, 1, pz, 24, 0xffd54f, 7, 0.14, 1.2);
    } else if (sc.points >= 400) say = pick(SAY.near);
    else if (sc.points > 0) say = pick(SAY.far);
    else say = pick(SAY.zero);
    this.toast(say, 'radio');
    this.sayLast = say;
    const rec: ShotRec = {
      n: this.shot + 1,
      label: sd.target.label,
      points: sc.points,
      burst: false,
      psi: f.p.psi,
      water: f.p.water,
      pitch: this.pitchDeg,
      yaw: this.yawDeg,
      along: sc.along,
      lat: sc.lat,
      dist: sc.dist,
      apex: f.maxY,
      t: e.t,
      speed: e.speed,
      chute: f.chute.state === 'open' ? (e.soft ? '소프트 착지' : '사용') : f.chute.state === 'torn' ? '찢어짐' : '미사용',
      direct: sc.direct,
      bonus: sc.bonus,
      hazard: hit ? hit.kind : null,
      rx: e.rx,
      rz: e.rz,
    };
    this.results.push(rec);
    this.set('total', fmtPts(this.total));
  }
  sayLast = '';

  private showReadout() {
    this.phase = 'readout';
    this.phaseT = 0;
    this.hud.dataset.ph = 'readout';
    this.center('');
    const r = this.results[this.results.length - 1]!;
    const last = this.shot >= SHOTS - 1;
    const prev = this.results.slice(0, -1).map((p) => (p.burst ? `${p.n}번 펑` : `${p.n}번 ${p.psi.toFixed(0)}psi→${p.along >= 0 ? '+' : '−'}${Math.abs(p.along).toFixed(1)}m`)).join(' · ');
    const pts = r.points < 0 ? `${signed(r.points)}점` : r.points === 0 ? '0점' : `+${r.points.toLocaleString()}점`;
    let main: string;
    if (r.burst) main = `💥 펑! 병이 터졌다 (${r.psi.toFixed(0)} psi) — 이번 발사는 날아갔다`;
    else if (r.hazard) main = `😱 ${r.hazard === 'pony' ? '교감 선생님의 포니' : r.hazard === 'teacher' ? '선생님' : '구경하던 친구'}에게 떨어졌다! 감점`;
    else if (r.direct) main = `🎯 ${r.label} 명중! 과녁 중심에서 ${r.dist.toFixed(1)}m`;
    else main = `🎯 과녁에서 ${r.dist.toFixed(1)}m — ${Math.abs(r.along) < 0.05 ? '' : `${Math.abs(r.along).toFixed(1)}m ${r.along < 0 ? '짧음' : '길음'}`}${Math.abs(r.lat) >= 0.05 ? `, ${r.lat < 0 ? '좌' : '우'} ${Math.abs(r.lat).toFixed(1)}m` : ''}`;
    const stats = r.burst
      ? ''
      : `<div class="grid"><span>최고 높이<b>${r.apex.toFixed(1)}m</b></span><span>비행 시간<b>${r.t.toFixed(1)}초</b></span><span>착지 속도<b>${r.speed.toFixed(0)}m/s</b></span><span>낙하산<b style="font-size:12px">${r.chute}</b></span></div>`;
    const set = `💧 ${(r.water * 100).toFixed(0)}% · 🔧 ${r.psi.toFixed(0)}psi · 📐 ${r.pitch.toFixed(1)}° · ↔ ${r.yaw >= 0.05 ? '우 ' : r.yaw <= -0.05 ? '좌 ' : ''}${Math.abs(r.yaw).toFixed(1)}°`;
    const bonus = r.bonus.filter((b) => b.pts > 0 || b.label).map((b) => `✨ ${b.label}${b.pts ? ` +${b.pts}` : ''}`).join('  ');
    this.set(
      'card',
      `<div class="hd"><span>🚀 ${r.n}/${SHOTS} · ${r.label}</span><span>누계 ${fmtPts(this.total)}</span></div>
       <div class="pts ${r.points < 0 ? 'neg' : ''}">${pts}</div>
       <div class="main">${main}</div>${stats}
       <div class="set">${set}${r.burst ? '' : ` · 바람 ${this.wind.speed.toFixed(1)}m/s`}</div>
       ${bonus ? `<div class="bn">${bonus}</div>` : ''}
       <div class="say">${escapeHtml(this.sayLast)}</div>
       ${prev ? `<div class="prev">기록: ${escapeHtml(prev)}</div>` : ''}
       <button class="go" data-b="next">${last ? '결과 보기 ▶' : '다음 발사 ▶'}</button>`,
      true,
    );
    this.el.card!.querySelector('[data-b=next]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.next();
    });
  }

  next() {
    if (this.phase !== 'readout') return;
    if (this.shot >= SHOTS - 1) return this.finish();
    this.shot++;
    this.beginShot();
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'done';
    this.hud.dataset.ph = 'done';
    const best = this.results.reduce((a, r) => (r.points > a.points ? r : a), this.results[0]!);
    const bursts = this.results.filter((r) => r.burst).length;
    const m = MEDALS[this.cfg.id - 1]!;
    const title = this.total >= m[0] ? '과학의 날 명사수!' : this.total >= m[1] ? '물로켓 에이스' : this.total >= m[2] ? '무사히 완주!' : '다음엔 물 조절부터...';
    this.opts.onEnd({
      timeMs: Math.max(0, Math.round(this.total)),
      title,
      detail: [
        ...this.results.map((r) => ({ label: `${r.n}발 · ${r.label}`, value: r.burst ? '펑! 0점' : `${signed(r.points)}점${r.direct ? ' 🎯' : ''}${r.hazard ? ' 😱' : ''}` })),
        { label: '최고의 한 발', value: `${best.n}발 ${best.points.toLocaleString()}점` },
        { label: '터진 병', value: `${bursts}개` },
      ],
    });
  }

  // ------------------------------------------------------------ simulation step
  /** one fixed 1/60 s step (public so tests can drive it headless) */
  step(dt: number) {
    this.clock += dt;
    this.phaseT += dt;
    this.parts.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const wnd = this.windNow;
    this.world.setWind(wnd[0], wnd[1]);
    this.world.updateTargets(this.clock);

    if (this.hazardHop) {
      this.hazardHop.t += dt;
      const h = this.hazardHop;
      h.m.position.y = Math.max(0, Math.sin(h.t * 10) * 0.6) * Math.max(0, 1 - h.t / 1.6);
      h.m.rotation.z = Math.sin(h.t * 14) * 0.25 * Math.max(0, 1 - h.t / 1.6);
      if (h.t > 1.6) {
        h.m.position.y = 0;
        h.m.rotation.z = 0;
        this.hazardHop = null;
      }
    }

    // drifting dust shows the wind direction near the launcher
    this.dustT -= dt;
    const ws = Math.hypot(wnd[0], wnd[1]);
    if (this.dustT <= 0 && ws > 0.4 && (this.phase === 'setup' || this.phase === 'readout')) {
      this.dustT = 0.1;
      this.parts.spawn((Math.random() - 0.5) * 14 - 6 * Math.sign(wnd[0] || 1) * 0.5, 0.6 + Math.random() * 2.2, 3 - (Math.random() - 0.5) * 14 - 6 * Math.sign(wnd[1] || 1) * 0.5, wnd[0] * 1.2, 0, wnd[1] * 1.2, 0xffffff, 3, 0.07, 0);
    }

    if (this.phase === 'setup') this.stepSetup(dt);
    else if (this.phase === 'flight') this.stepFlight(dt);
    else if (this.phase === 'land') {
      this.landT += dt;
      const k = clamp(this.landT / 0.35, 0, 1);
      const r = this.world.rocket.root.position;
      r.x = this.landFrom.x + (this.landTo.x - this.landFrom.x) * k;
      r.z = this.landFrom.z + (this.landTo.z - this.landFrom.z) * k;
      if (this.lastScore && this.lastScore.points >= 600) this.world.crowdHop(this.clock);
      if (this.phaseT > 1.7) this.showReadout();
    } else if (this.phase === 'burst') {
      if (this.phaseT > 1.9) {
        this.showReadout();
      }
    }
    this.updateHud(dt);
    this.audio.loops(this.flight && this.phase === 'flight' ? this.flight.speed : 0, this.held.valve ? 0.8 : 0);
  }

  private stepSetup(dt: number) {
    const h = this.held;
    const fine = h.fine ? 0.25 : 1;
    if (h.water) this.setParamRaw('water', this.water * 100 + h.water * 14 * fine * dt);
    if (h.pitch) this.setParamRaw('pitch', this.pitchDeg + h.pitch * (h.fine ? 2 : 14) * dt);
    if (h.aim) this.setParamRaw('aim', this.yawDeg + h.aim * (h.fine ? 0.6 : 5) * dt);
    // pump: first stroke on press, then continuous pumping while held
    if (h.pump) {
      this.pumpT += dt;
      this.pumpPhase += dt * 14;
      if (this.pumpT > 0.2) this.addPsi(16 * dt);
      this.pumpTick -= dt;
      if (this.pumpTick <= 0) {
        this.pumpTick = 0.17;
        this.audio.pump(this.psi);
        this.parts.spawn(1.15, 0.2, 0.9, (Math.random() - 0.5) * 1.2, 0.4, (Math.random() - 0.5) * 1.2, 0xffffff, 0.4, 0.05, 0);
      }
    }
    if (h.valve && this.psi > 0) {
      this.psi = Math.max(0, this.psi - 9 * dt);
      this.arcDirty = true;
      this.parts.spawn(0, 0.5, 0, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0xffffff, 0.5, 0.06, 0);
    }
    this.world.setPump(this.pumpPhase);
    this.world.setAim(this.yaw, this.pitchDeg * DEG);
    // bottle fill animation
    this.fillShown += (this.water - this.fillShown) * Math.min(1, dt * 10);
    this.world.rocket.setFill(this.fillShown);
    const hot = this.psi >= this.cfg.red - 3;
    if (hot && this.phase === 'setup' && Math.floor(this.clock * 8) !== Math.floor((this.clock - dt) * 8)) this.audio.warn();
    if (this.arcDirty) this.refreshArc();
  }
  private setParamRaw(key: 'water' | 'pitch' | 'aim', v: number) {
    if (key === 'water') this.water = clamp(v / 100, 0.05, 0.8);
    else if (key === 'pitch') this.pitchDeg = clamp(v, 15, 80);
    else this.yawDeg = clamp(v, -20, 20);
    this.arcDirty = true;
  }

  private refreshArc() {
    this.arcDirty = false;
    if (this.cfg.aid !== 'calm' || this.psi < 5) {
      this.world.setArc(null, null);
      this.predicted = null;
      return;
    }
    const key = [this.water, this.psi.toFixed(1), this.pitchDeg, this.yawDeg].join();
    if (key === this.arcPred) return;
    this.arcPred = key;
    const r = simulate({ water: this.water, psi: this.psi, pitch: this.pitchDeg * DEG, yaw: this.yaw }, CALM, 0, { sample: 0.05, isWater: this.world.water });
    this.world.setArc(r.path, [r.end.rx, r.end.rz]);
    this.predicted = Math.hypot(r.end.rx, r.end.rz);
  }

  private stepFlight(dt: number) {
    const f = this.flight!;
    this.slow = f.t < 0.3 ? 0.3 : 1; // slow-motion for the spray
    f.step(dt * this.slow);
    const root = this.world.rocket.root;
    root.position.set(f.x, f.y, f.z);
    this.world.rocket.orient(f.dx, f.dy, f.dz);
    this.world.rocket.setFill(f.vw / BOTTLE.vol);
    this.world.pull(Math.max(0, 1 - f.t * 2));
    // spray out of the nozzle
    if (f.thrust > 1) {
      const n = this.mobile ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const s = 4 + Math.random() * 7;
        this.parts.spawn(
          f.x - f.dx * 0.5 * VS * 0.5,
          f.y - f.dy * 0.5 * VS * 0.5,
          f.z - f.dz * 0.5 * VS * 0.5,
          -f.dx * s + (Math.random() - 0.5) * 3,
          -f.dy * s + (Math.random() - 0.5) * 3,
          -f.dz * s + (Math.random() - 0.5) * 3,
          WATER,
          0.5 + Math.random() * 0.5,
          0.14 + Math.random() * 0.1,
          14,
        );
      }
    } else if (f.t < 1.4 && Math.random() < 0.5) {
      this.parts.spawn(f.x, f.y, f.z, (Math.random() - 0.5) * 1.5, -0.5, (Math.random() - 0.5) * 1.5, 0xe8f6ff, 0.6, 0.07, 6);
    }
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.04;
      this.world.pushTrail(f.x, f.y, f.z);
    }
    const ch = f.chute;
    if (ch.state === 'open') this.world.setChute(true, ch.open, f.x, f.y, f.z);
    else if (ch.state === 'torn') this.world.setChute(false, 0, 0, 0, 0);
    if (f.end) this.onLanded();
  }

  // ------------------------------------------------------------ HUD
  private updateHud(dt: number) {
    const [wx, wz] = this.windNow;
    const sp = Math.hypot(wx, wz);
    this.el.warrow!.style.transform = `rotate(${(Math.atan2(wx, -wz) / DEG).toFixed(0)}deg)`;
    this.set('wspd', sp.toFixed(1));
    const along = -wz;
    const kind = sp < 0.3 ? '무풍' : Math.abs(along) > Math.abs(wx) ? (along > 0 ? '뒷바람' : '맞바람') : wx > 0 ? '→ 오른바람' : '왼바람 ←';
    const gust = this.wind.gust > 0 && sp > this.wind.speed + this.wind.gust * 0.55 ? ' 💨돌풍' : '';
    this.set('wtxt', kind + gust);
    const sd = this.shotDef;
    const [tx, tz] = targetPos(sd.target, this.clock);
    if (this.phase === 'setup' || this.phase === 'burst' || this.phase === 'readout') {
      const d = Math.hypot(tx, tz);
      const b = (Math.atan2(tx, -tz) / DEG);
      this.set(
        'tgt',
        `<div><span>🎯 ${sd.target.label}</span><b>${d.toFixed(0)}m</b></div><div><span>방향</span><b>${Math.abs(b) < 0.05 ? '정면' : (b > 0 ? '우 ' : '좌 ') + Math.abs(b).toFixed(1) + '°'}</b></div>${this.predicted !== null ? `<div><span>예상(무풍)</span><b>${this.predicted.toFixed(1)}m</b></div>` : ''}${sd.target.mov ? '<div><span>↔ 좌우로 움직임!</span></div>' : ''}${sd.target.top > 2 ? `<div><span>높이</span><b>${sd.target.top.toFixed(0)}m</b></div>` : ''}`,
        true,
      );
    }
    // parameter widgets
    const wP = (this.water - 0.05) / 0.75;
    const pP = (this.pitchDeg - 15) / 65;
    const aP = (this.yawDeg + 20) / 40;
    this.setSl('water', wP);
    this.setSl('pitch', pP);
    this.setSl('aim', aP);
    this.set('vwater', `${(this.water * 100).toFixed(0)}%`);
    this.set('vpitch', `${this.pitchDeg.toFixed(1)}°`);
    this.set('vaim', `${this.yawDeg >= 0.05 ? '우' : this.yawDeg <= -0.05 ? '좌' : ''}${Math.abs(this.yawDeg).toFixed(1)}°`);
    const cfg = this.cfg;
    const pf = this.phase === 'flight' && this.flight ? this.flight.p.psi : this.psi;
    this.set('psi', pf.toFixed(0));
    this.set('atm', (pf / 14.696).toFixed(1));
    const gf = this.el.gfill!;
    const w = clamp(pf / cfg.gaugeMax, 0, 1) * 100;
    gf.style.width = `${w}%`;
    this.el.gmark!.style.left = `${w}%`;
    const redP = (cfg.red / cfg.gaugeMax) * 100;
    this.el.gred!.style.width = `${100 - redP}%`;
    const hot = this.phase === 'setup' && this.psi >= cfg.red - 3;
    this.el.gauge!.classList.toggle('hot', hot);
    if (this.phase === 'setup') this.tip(hot ? '⚠️ 빨간 구간! 언제 터질지 몰라요 — 빼기(V) 또는 발사!' : this.tipBase, hot);
    else if (this.phase === 'flight') this.tip(this.tipBase);
    else this.tip('');
    // flight
    if (this.phase === 'flight' && this.flight) {
      const f = this.flight;
      const dt2 = Math.hypot(f.x - tx, f.z - tz);
      this.set(
        'fl',
        `<div><span>⬆ 고도</span><b>${Math.max(0, f.y).toFixed(1)}m</b></div><div><span>➡ 거리</span><b>${f.dist.toFixed(1)}m</b></div><div><span>💨 속도</span><b>${f.speed.toFixed(0)}m/s</b></div><div><span>🎯 과녁까지</span><b>${dt2.toFixed(1)}m</b></div>`,
        true,
      );
      const btn = this.hud.querySelector<HTMLButtonElement>('.rk-chute')!;
      btn.disabled = !f.canChute();
    }
    void dt;
  }
  private slx: Record<string, number> = {};
  private setSl(name: string, f: number) {
    const s = this.hud.querySelector<HTMLElement>(`[data-s=${name}]`)!;
    const x = Math.round(14 + clamp(f, 0, 1) * Math.max(0, s.clientWidth - 28));
    if (this.slx[name] === x) return;
    this.slx[name] = x;
    (s.querySelector('b') as HTMLElement).style.left = `${x}px`;
    (s.querySelector('i') as HTMLElement).style.width = `${x}px`;
  }

  // ------------------------------------------------------------ camera
  private updateCamera(dt: number) {
    const cam = this.camera;
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    let k = 1 - Math.exp(-dt * 5);
    const aim = this.world.aimDir;
    if (this.phase === 'setup' || this.phase === 'burst') {
      const yaw = this.yaw;
      if (this.camSetup === 0) {
        const fx = Math.sin(yaw);
        const fz = -Math.cos(yaw);
        want.set(-fx * 3.6 + Math.cos(yaw) * 1.0, 1.85, -fz * 3.6 + Math.sin(yaw) * 1.0);
        look.set(fx * 22, 1.6, fz * 22);
      } else {
        const [tx, tz] = targetPos(this.shotDef.target, this.clock);
        want.set(0, 15, 17);
        look.set(tx * 0.45, 0, tz * 0.55);
        k = 1 - Math.exp(-dt * 3);
      }
    } else if (this.phase === 'flight' && this.flight) {
      const f = this.flight;
      const p = new THREE.Vector3(f.x, f.y, f.z);
      const hv = new THREE.Vector3(f.vx, 0, f.vz);
      if (hv.lengthSq() > 4) this.dirSmooth.lerp(hv.normalize(), 1 - Math.exp(-dt * 3)).normalize();
      if (this.camFlight === 0) {
        want.copy(p).addScaledVector(this.dirSmooth, -8).add(new THREE.Vector3(0, 2.2 + Math.max(0, 3 - f.y * 0.2), 0));
        want.y = Math.max(want.y, 1.2);
        look.copy(p).addScaledVector(this.dirSmooth, 4);
        look.y = p.y * 0.9;
        k = 1 - Math.exp(-dt * 6);
      } else if (this.camFlight === 1) {
        const side = new THREE.Vector3(-this.dirSmooth.z, 0, this.dirSmooth.x).multiplyScalar(-1);
        want.copy(p).addScaledVector(side, 30);
        want.y = Math.max(2.5, p.y * 0.6 + 2);
        look.copy(p);
        k = 1 - Math.exp(-dt * 4);
      } else {
        want.set(p.x, Math.max(35, p.y + 30), p.z + 5);
        look.copy(p);
        k = 1 - Math.exp(-dt * 4);
      }
    } else if (this.phase === 'land' || this.phase === 'readout') {
      const r = this.world.rocket.root.position;
      const [tx, tz] = targetPos(this.shotDef.target, this.clock);
      const mx = (r.x * 0.6 + tx * 0.4);
      const mz = (r.z * 0.6 + tz * 0.4);
      const span = Math.hypot(r.x - tx, r.z - tz);
      want.set(mx, 17 + span * 0.8, mz + 9 + span * 0.15);
      look.set(mx, 0, mz);
      k = 1 - Math.exp(-dt * 3);
    }
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, Math.min(1, k * 1.4));
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    cam.lookAt(this.camLook);
    void aim;
  }

  // ------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n++ < 5) {
        this.step(STEP);
        this.acc -= STEP;
      }
      this.updateCamera(dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** render one frame immediately (tests / screenshots while paused) */
  renderNow(camSteps = 90) {
    for (let i = 0; i < camSteps; i++) this.updateCamera(1 / 30);
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.pumpUp();
      this.held = { water: 0, pitch: 0, aim: 0, pump: false, valve: false, fine: false };
    } else this.last = performance.now();
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.resizeObs.disconnect();
    this.audio.dispose();
    this.hud.remove();
    this.styleEl.remove();
    this.world.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
