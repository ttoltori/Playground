import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { Particles } from '../forklift/particles';
import { PAudio } from './audio';
import { KeyboardControls, TouchControls, type Controls, type Inp } from './input';
import { LEVELS, MEDALS, mulberry, rollEnv, type LevelCfg, type ThrowEnv } from './levels';
import { Flight, PLANES, hazardsAt, thermalW, type PlaneSpec } from './physics';
import { SchoolWorld, buildPlane, type PlaneModel } from './scene';

const STEP = 1 / 60;
const ATTEMPTS = 3;
const HOLD = new THREE.Vector3(0, 1.5, 0);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const DEG = Math.PI / 180;
const fmtM = (cm: number) => (cm / 100).toFixed(1) + 'm';

type Phase = 'wind' | 'aim' | 'fly' | 'land' | 'snap' | 'done';

export interface Attempt { cm: number; kind: string; turns: number; alt: number; t: number; plane: string; wind: string; pitch: number }

const SAY = {
  start: ['📢 짝꿍: 야 빨리 날려봐, 내 차례 기다린다', '📢 선생님: 고무줄 너무 감으면 끊어진다~', '📢 짝꿍: 이거 어제 문방구에서 500원에 샀지?', '📢 반장: 쉿! 과학의 날 대회 진행 중이다'],
  stall: ['📢 짝꿍: 야 떨어진다 떨어진다!!', '📢 짝꿍: 너무 위로 던졌잖아!', '📢 반장: 실속이다 실속!'],
  thermal: ['📢 짝꿍: 오! 상승기류 탔다!', '📢 선생님: 솔개가 도는 데가 상승기류란다', '📢 짝꿍: 떠오른다 떠오른다~'],
  down: ['📢 짝꿍: 으악 하강기류!', '📢 선생님: 저기 바람이 아래로 꺾인다'],
  short: ['📢 짝꿍: 그게 날은 거냐... 걸어가면 되겠다', '📢 선생님: 고무줄을 더 감아야지', '📢 짝꿍: 야 그건 던진 거지 날린 게 아니다'],
  mid: ['📢 선생님: 음, 평균은 하는구나', '📢 짝꿍: 오 괜찮은데?', '📢 반장: 기록원! 적어라!'],
  far: ['📢 짝꿍: 와 개멀리 간다!', '📢 선생님: 줄자 모자라겠다!', '📢 반장: 우와 이거 대회 신기록 아니냐?'],
  epic: ['📢 문방구 아저씨: 그거 500원짜리야... 돌려줘라', '📢 선생님: 줄 넘어갔다, 다시! ...는 농담이고 인정', '📢 짝꿍: 담 넘어갔다!! 가서 주워와!'],
  tree: ['📢 짝꿍: 나무에 걸렸다 ㅋㅋㅋ', '📢 선생님: 올라가지 마라, 위험하다!', '📢 반장: 플라타너스가 먹었다'],
  hit: ['📢 짝꿍: 야 부딪혔다!', '📢 선생님: 철봉은 고무줄 비행기 공항이 아니란다'],
  snap: ['📢 짝꿍: 뚝! ㅋㅋㅋㅋ 내 고무줄도 그렇게 끊어졌어', '📢 선생님: 욕심이 과했구나...', '📢 짝꿍: 아깝다 그거 새 고무줄인데'],
  ball: ['📢 짝꿍: 공 맞았다!! 누구야 공 찬 놈!', '📢 선생님: 운동장에서 공 차지 마라!'],
  pigeon: ['📢 짝꿍: 비둘기가 쳤다 ㅋㅋㅋ', '📢 선생님: 비둘기도 비행 대회 참가했나보네'],
};

const CSS = `
.pl-hud .pl-panel{position:absolute;top:56px;left:12px;width:178px;display:flex;flex-direction:column;gap:5px}
.pl-card{background:#000a;border-radius:10px;padding:6px 10px;font-size:12px;line-height:1.35}
.pl-row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.pl-row span{color:#fffb;font-weight:400}
.pl-row b,.pl-row span{white-space:nowrap}
.pl-row b{font-family:ui-monospace,monospace;font-size:15px}
.pl-num{font-family:ui-monospace,monospace;font-size:32px;line-height:1.1}
.pl-num small{font-size:13px;color:#fffb;margin-left:4px;font-weight:400}
.pl-bar{height:11px;border-radius:6px;background:#fff2;margin-top:4px;position:relative;overflow:visible}
.pl-bar i{display:block;height:100%;border-radius:6px;width:0;background:var(--good)}
.pl-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#fff;text-decoration:none}
.pl-tens{background:linear-gradient(90deg,#2ee66b 0%,#f2c200 60%,#ff7043 80%,#ff4757 100%);opacity:.9}
.pl-tens i{background:transparent;border-right:3px solid #fff;box-shadow:0 0 6px #000}
.pl-tens.hot{animation:plshake .12s infinite}
.pl-tens.hot i{border-right-color:#ff4757}
@keyframes plshake{0%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-1px)}100%{transform:translate(1px,1px)}}
.pl-pw{height:16px;border-radius:8px;background:#fff2;position:relative;margin-top:4px;overflow:hidden}
.pl-pw u{position:absolute;top:0;bottom:0;background:#2ee66b88}
.pl-pw i{position:absolute;top:0;bottom:0;width:5px;margin-left:-2px;background:#fff;box-shadow:0 0 6px #fff}
.pl-wind{position:absolute;top:56px;right:10px;text-align:center;font-size:11px;background:#000a;border-radius:10px;padding:5px 8px;min-width:64px}
.pl-wind .ar{display:block;font-size:24px;line-height:1;transition:transform .2s}
.pl-planes{position:absolute;left:12px;bottom:max(12px,env(safe-area-inset-bottom));display:flex;gap:6px;pointer-events:auto}
.pl-planes button{background:#000b;border:2px solid #fff3;border-radius:10px;color:#fff;padding:5px 9px;font-size:12px;line-height:1.25;text-align:left;font-family:inherit}
.pl-planes button b{display:block;font-size:13px}
.pl-planes button small{display:block;color:#fffa;font-weight:400;font-size:10px}
.pl-planes button.on{border-color:var(--accent);background:#2a2208}
.pl-planes button:disabled{opacity:.45}
.pl-tip{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);background:#000b;padding:6px 14px;border-radius:20px;font-size:14px;white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis}
.pl-tip:empty{display:none}
.pl-hud[data-ph=wind] .pl-tip{bottom:84px}
.pl-tip.warn{color:#ffb0b0;outline:2px solid var(--bad)}
.pl-beat{position:absolute;left:50%;top:132px;width:58px;height:58px;margin-left:-29px;border-radius:50%;border:3px solid #fff6;display:none}
.pl-beat i{position:absolute;inset:14px;border-radius:50%;background:#fff;opacity:.85}
.pl-beat.ok{border-color:var(--good)}
.pl-beat.ok i{background:var(--good)}
.pl-hud[data-ph=wind] .pl-beat{display:block}
.pl-hud .hud-center{font-size:50px;white-space:nowrap}
.pl-hud:not([data-ph=wind]) .pl-planes{display:none}
.pl-touch{z-index:10}
.pl-zone{position:absolute;inset:0;pointer-events:auto;touch-action:none}
.pl-hint{display:none}
.pl-ring{display:none;position:absolute;left:50%;top:55%;width:190px;height:190px;margin:-95px 0 0 -95px;border:3px dashed #fff5;border-radius:50%}
.pl-touch[data-ph=wind] .pl-ring{display:block}
.pl-stick{display:none;position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;background:#fff1;border:2px solid #fff3}
.pl-stick.active{display:block}
.pl-stick i{position:absolute;left:31px;top:31px;width:50px;height:50px;border-radius:50%;background:#ffffffaa;box-shadow:0 2px 10px #0008}
.pl-tb{position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:flex-end;pointer-events:none}
.pl-tb>*{pointer-events:auto;display:none}
.pl-tb .tb{width:60px;height:54px;font-size:20px}
.pl-tb .tb.small{height:44px;width:48px}
.pl-big{width:92px;height:92px;border-radius:50%;border:3px solid #fff6;background:#e65100cc;color:#fff;font-size:34px;line-height:1;touch-action:none;font-family:inherit}
.pl-big small{display:block;font-size:12px;margin-top:2px}
.pl-big.on{background:var(--accent);color:#000}
.pl-throw{background:#1e88e5cc}
.pl-touch[data-ph=wind] .pl-cam,.pl-touch[data-ph=wind] .pl-done,.pl-touch[data-ph=wind] .pl-windb{display:block}
.pl-touch[data-ph=aim] .pl-cam,.pl-touch[data-ph=aim] .pl-throw{display:block}
.pl-touch[data-ph=fly] .pl-cam{display:block}
.pl-touch[data-ph=land] .pl-next,.pl-touch[data-ph=snap] .pl-next{display:block}
@media (hover:none){
  .pl-hud .toasts{top:auto;bottom:74px;left:50%}
  .pl-hud[data-ph=wind] .pl-tip{bottom:auto}
  .pl-hud .pl-panel{width:150px;top:48px}
  .pl-num{font-size:26px}
  .pl-tip{bottom:auto;top:8px;font-size:12px;padding:4px 10px;max-width:46%;white-space:normal;text-align:center}
  .pl-hud .hud-center{font-size:34px}
  .pl-planes{bottom:10px;left:8px}
  .pl-planes button small{display:none}
  .pl-planes button{padding:4px 8px}
  .pl-wind{top:50px;right:8px}
  .pl-beat{top:96px;width:44px;height:44px;margin-left:-22px}
  .pl-beat i{inset:10px}
}
`;

export class PlaneGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly audio = new PAudio();
  readonly cfg: LevelCfg;
  readonly world: SchoolWorld;
  readonly parts: Particles;
  readonly ctl: Controls;
  readonly inp: Inp;
  private touch: TouchControls | null = null;
  private model!: PlaneModel;
  private models: PlaneModel[] = [];
  private aimArrow: THREE.ArrowHelper;
  private styleEl: HTMLStyleElement;
  private hud: HTMLDivElement;
  private hudEl: Record<string, HTMLElement> = {};
  private hudCache: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private disposed = false;
  private ended = false;
  paused = false;

  rng = mulberry((Date.now() ^ 0x9e3779b9) >>> 0);
  phase: Phase = 'wind';
  phaseT = 0;
  clock = 0;
  attempt = 0; // 0-based
  attempts: Attempt[] = [];
  env!: ThrowEnv;
  planeIdx = 0;
  turns = 0;
  snapAt = 0;
  snapWarned = false;
  perfects = 0;
  pitch = 15 * DEG;
  yaw = 0;
  pwT = 0;
  power = 0;
  flight: Flight | null = null;
  cmdBank = 0;
  cmdPitch = 0;
  private beatT = 0;
  private slow = 0;
  private timeScale = 1;
  private camMode = 0;
  private camPos = new THREE.Vector3(0, 1.6, 1);
  private camLook = new THREE.Vector3(0, 1.5, 0);
  private camFov = 62;
  private glide = { x: 0, z: 0, v: 0, y: 0 };
  private shake = 0;
  private thermalFlag = 0;
  private downFlag = 0;
  private stallWarn = false;
  private nextMilestone = 0;
  bestCm = 0;
  private lastEnd: { x: number; y: number; z: number; kind: string } | null = null;
  windText = '';

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    const lvl = clamp(opts.level, 1, LEVELS.length);
    this.cfg = LEVELS[lvl - 1]!;
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = false; // blob shadow only (no real shadows, keeps phones smooth)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';

    this.scene.background = new THREE.Color(this.cfg.sky);
    this.scene.fog = new THREE.Fog(this.cfg.fog, this.cfg.fogNear, this.cfg.fogFar);
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
    this.world = new SchoolWorld(this.cfg, mobile);
    this.scene.add(this.world.group);
    this.parts = new Particles(this.scene, mobile ? 90 : 180);
    for (const sp of PLANES) {
      const m = buildPlane(opts.color, sp);
      m.root.visible = false;
      this.scene.add(m.root);
      this.models.push(m);
      // hand holding the plane
      const skin = new THREE.MeshLambertMaterial({ color: 0xf1c7a0 });
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), skin);
      fist.position.set(0, -0.1, 0.02);
      fist.name = 'hand';
      m.root.add(fist);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.7), new THREE.MeshLambertMaterial({ color: 0x9fc3e8 }));
      sleeve.position.set(0.03, -0.2, 0.42);
      sleeve.rotation.x = 0.35;
      sleeve.name = 'hand';
      m.root.add(sleeve);
    }
    this.aimArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), HOLD.clone(), 5, 0xffeb3b, 0.5, 0.3);
    this.aimArrow.visible = false;
    this.scene.add(this.aimArrow);

    // HUD
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    const h = (this.hud = document.createElement('div'));
    h.className = 'hud pl-hud';
    h.style.cssText = 'left:0;top:0;width:100%;height:100%';
    h.innerHTML = `
      <div class="hud-top">
        <div class="hud-name" style="--pc:#${opts.color.toString(16).padStart(6, '0')}">${escapeHtml(opts.nickname)}</div>
        <div class="hud-del" data-k="att">🛩️ 1/${ATTEMPTS}</div>
        <div class="hud-opp" data-k="best">최고 --</div>
      </div>
      <div class="pl-panel" data-k="panel"></div>
      <div class="pl-wind"><span class="ar" data-k="warrow">▲</span><span data-k="wtxt">무풍</span></div>
      <div class="pl-beat" data-k="beat"><i></i></div>
      <div class="pl-planes">${PLANES.map((p, i) => `<button data-p="${i}"><b>${i + 1} ${p.emoji} ${p.name}</b><small>${p.desc}</small></button>`).join('')}</div>
      <div class="pl-tip" data-k="tip"></div>
      <div class="hud-center" data-k="center"></div>
      <div class="toasts"></div>`;
    container.appendChild(h);
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.hudEl[e.dataset.k!] = e));
    h.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.setPlane(Number(b.dataset.p));
      });
    });

    if (isTouchDevice()) {
      this.touch = new TouchControls(container, () => this.phase);
      this.ctl = this.touch;
    } else this.ctl = new KeyboardControls();
    this.inp = this.ctl.inp;

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.beginAttempt();
    this.toast(pick(SAY.start), 'radio');
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ helpers
  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
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
  private set(k: string, v: string) {
    if (this.hudCache[k] === v) return;
    this.hudCache[k] = v;
    const e = this.hudEl[k];
    if (e) e.textContent = v;
  }
  private center(text: string) {
    this.set('center', text);
  }
  private tip(text: string, warn = false) {
    const e = this.hudEl.tip!;
    if (this.hudCache.tip !== text + warn) {
      this.hudCache.tip = text + warn;
      e.textContent = text;
      e.classList.toggle('warn', warn);
    }
  }

  get spec(): PlaneSpec {
    return PLANES[this.planeIdx]!;
  }
  get tension() {
    return this.turns / this.spec.limit;
  }

  setPlane(i: number) {
    if (this.phase !== 'wind' || this.turns > 0.5) {
      if (this.phase === 'wind') this.toast('이미 감기 시작했다! 새로 시작하려면 고무줄을 다 푸는 수밖에...', 'info');
      return;
    }
    this.planeIdx = clamp(i, 0, PLANES.length - 1);
    this.showModel();
    this.hud.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === this.planeIdx));
    this.audio.beep();
  }
  private showModel() {
    this.models.forEach((m, i) => (m.root.visible = i === this.planeIdx));
    this.model = this.models[this.planeIdx]!;
  }
  private holdHand(on: boolean) {
    this.model.root.children.forEach((c) => {
      if (c.name === 'hand') c.visible = on;
    });
  }

  private rollSnap() {
    const [lo, hi] = this.cfg.snap;
    this.snapAt = this.spec.limit * (lo + this.rng() * (hi - lo));
  }

  // ------------------------------------------------------------ phases
  private beginAttempt() {
    this.world.hideMeasure();
    this.env = rollEnv(this.cfg, this.rng);
    this.world.setEnv(this.env);
    this.world.setHazards([], 0);
    this.turns = 0;
    this.perfects = 0;
    this.snapWarned = false;
    this.flight = null;
    this.pitch = 15 * DEG;
    this.yaw = 0;
    this.cmdBank = this.cmdPitch = 0;
    this.showModel();
    this.hud.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.p) === this.planeIdx);
      b.disabled = false;
    });
    this.rollSnap();
    this.setPhase('wind');
    const wx = this.env.wind.x;
    const wz = this.env.wind.z;
    const sp = Math.hypot(wx, wz);
    const along = -wz;
    this.windText = sp < 0.3 ? '무풍' : Math.abs(along) > Math.abs(wx) ? (along > 0 ? '뒷바람' : '맞바람') : wx > 0 ? '오른바람' : '왼바람';
    if (this.attempt > 0) this.toast(`🛩️ ${this.attempt + 1}번째 던지기 — ${this.windText} ${sp.toFixed(1)}m/s`, 'info');
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    this.touch?.setPhase(p);
    this.hud.dataset.ph = p;
    this.hudCache = { ...this.hudCache, panel: '' };
    const panel = this.hudEl.panel!;
    if (p === 'wind') {
      panel.innerHTML = `
        <div class="pl-card"><div class="pl-num"><span data-k="turns">0</span><small>회 감음</small></div>
          <div class="pl-bar pl-tens" data-k="tens"><i data-k="tbar"></i></div>
          <div class="pl-row" style="margin-top:4px"><span>🪢 고무줄</span><b data-k="tstate">느슨</b></div></div>
        <div class="pl-card"><div class="pl-row"><span>✈</span><b data-k="pname"></b></div></div>`;
      this.model.root.visible = true;
      this.holdHand(true);
      this.aimArrow.visible = false;
      this.world.setShadow(0, 0, 0, false);
      this.tip(this.touch ? '🌀 화면에 원을 그리거나 🌀버튼을 눌러 감기 · 다 감으면 ✋' : '스페이스 연타(비트에 맞추면 더 많이!) 또는 꾹 · Enter = 다 감았다 · 1/2/3 기체 선택');
      this.center('');
    } else if (p === 'aim') {
      panel.innerHTML = `
        <div class="pl-card"><div class="pl-row"><span>↕ 각도</span><b data-k="pitch">15°</b></div>
          <div class="pl-row"><span>↔ 방향</span><b data-k="yaw">0°</b></div>
          <div class="pl-row"><span>🌀 감은 횟수</span><b data-k="turns2">0</b></div></div>
        <div class="pl-card"><div class="pl-row"><span>💪 던지는 힘</span><b data-k="pw">0%</b></div>
          <div class="pl-pw"><u data-k="sweet"></u><i data-k="pwc"></i></div></div>`;
      this.pwT = 0;
      this.hudCache.sweet = '';
      this.aimArrow.visible = true;
      this.tip(this.touch ? '↕↔ 화면을 드래그해 각도 조절 · 힘이 초록 구간일 때 🚀' : '↑↓ 각도 · ←→ 방향 · 힘이 초록 구간일 때 스페이스!');
    } else if (p === 'fly') {
      panel.innerHTML = `
        <div class="pl-card"><div class="pl-num"><span data-k="dist">0.0</span><small>m</small></div>
          <div class="pl-row"><span>⬆ 고도</span><b data-k="alt">0.0m</b></div>
          <div class="pl-row"><span>💨 대기속도</span><b data-k="spd">0.0</b></div></div>
        <div class="pl-card"><div class="pl-row"><span>🪢 고무줄 남음</span><b data-k="rub">100%</b></div>
          <div class="pl-bar"><i data-k="rbar"></i></div></div>`;
      this.aimArrow.visible = false;
      this.holdHand(false);
      this.tip(this.touch ? '손가락을 대고 살짝 밀어 방향·고도 조종 (C 아님: 🎥)' : '←→ 좌우 · ↑↓ 살짝 고도 조종 · C 시점 전환');
    } else if (p === 'land' || p === 'snap') {
      panel.innerHTML = '';
      this.aimArrow.visible = false;
      this.tip(this.touch ? '화면을 탭하면 다음으로' : '스페이스 / Enter = 계속');
    }
    panel.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => {
      this.hudEl[e.dataset.k!] = e;
      delete this.hudCache[e.dataset.k!];
    });
  }

  private doneWinding() {
    if (this.turns < 5) {
      this.toast('조금은 감아야 날지!', 'bad');
      return;
    }
    this.audio.beep();
    this.setPhase('aim');
  }

  private snapBand() {
    this.audio.snap();
    this.shake = 1;
    this.record({ cm: 0, kind: 'snap', turns: this.turns, alt: 0, t: 0, plane: this.spec.name, wind: this.windText, pitch: 0 });
    this.center('뚝!!');
    this.toast('💥 뚝! 고무줄이 끊어졌다 — 이번 던지기는 날아가 버렸다', 'bad');
    this.toast(pick(SAY.snap), 'radio');
    this.world.cheer(1.2);
    this.setPhase('snap');
    this.lastEnd = null;
    this.parts.burst(HOLD.x, HOLD.y, HOLD.z - 0.3, 14, 0xd8a23a, 3, 0.05, 0.9);
  }

  private throwPlane() {
    const sp = this.spec;
    const p = this.power;
    const speed = 3.4 + 4.8 * p;
    const wobble = p > 0.9 ? (p - 0.9) * 10 * (this.rng() < 0.5 ? -1 : 1) : 0;
    this.flight = new Flight(sp, this.env, this.cfg.gust, this.world.solids, this.world.trees, this.turns);
    this.flight.x = 0;
    this.flight.y = HOLD.y + 0.1;
    this.flight.z = 0;
    this.flight.launch(this.pitch, this.yaw + wobble * 0.08, speed, 0, wobble);
    this.glide = { x: 0, z: 0, v: 0, y: 0 };
    this.nextMilestone = 0;
    this.thermalFlag = this.downFlag = 0;
    this.stallWarn = false;
    this.timeScale = 1;
    this.slow = 0;
    this.audio.launch();
    this.holdHand(false);
    this.aimArrow.visible = false;
    this.setPhase('fly');
    if (p < 0.3) this.toast('📢 짝꿍: 힘 좀 줘라, 그건 놓은 거다', 'radio');
    else if (wobble) this.toast('💪 너무 세게 던졌다! 손목이 흔들렸다', 'bad');
    else if (p >= SWEET[0] && p <= SWEET[1]) this.toast('👍 나이스 스로우!', 'good');
  }

  private record(a: Attempt) {
    this.attempts.push(a);
    if (a.cm > this.bestCm) {
      this.bestCm = a.cm;
    }
  }

  private endFlight() {
    const f = this.flight!;
    const e = f.end!;
    const cm = Math.round(f.dist * 100);
    const wind = `${this.windText} ${Math.hypot(this.env.wind.x, this.env.wind.z).toFixed(1)}m/s`;
    const prevBest = this.bestCm;
    this.record({ cm, kind: e.kind, turns: this.turns, alt: f.maxAlt, t: f.t, plane: this.spec.name, wind, pitch: this.pitch / DEG });
    this.lastEnd = { x: e.x, y: e.y, z: e.z, kind: e.kind };
    this.audio.thud();
    this.shake = 0.5;
    this.slow = 1.3;
    this.timeScale = 0.25;
    this.glide = { x: f.vx, z: f.vz, v: Math.hypot(f.vx, f.vz), y: e.y };
    this.world.showMeasure(e.x, e.z, fmtM(cm));
    this.world.cheer(2.6);
    this.audio.cheer();
    this.parts.burst(e.x, Math.max(0.1, e.y), e.z, 10, 0xd2b484, 3, 0.12, 0.8);
    this.center(fmtM(cm));
    const what: Record<string, string> = { tree: '🌳 나무에 걸림!', solid: '💥 부딪혔다!', roof: '🏠 지붕 위 착륙!', ground: '🛬 착지!', timeout: '⏱ 체공 끝', knock: '💥 맞았다!' };
    this.toast(`${what[e.kind] ?? '착지'} ${fmtM(cm)}${e.kind === 'tree' ? ' (걸린 지점 기록)' : ''}`, e.kind === 'ground' || e.kind === 'roof' ? 'good' : 'bad');
    if (e.kind === 'tree') this.toast(pick(SAY.tree), 'radio');
    else if (e.kind === 'solid') this.toast(pick(SAY.hit), 'radio');
    else if (e.z < this.cfg.treeZ - 7) this.toast(pick(SAY.epic), 'radio');
    else if (cm >= 5500) this.toast(pick(SAY.far), 'radio');
    else if (cm >= 2000) this.toast(pick(SAY.mid), 'radio');
    else this.toast(pick(SAY.short), 'radio');
    if (cm > prevBest && cm > 0 && this.attempts.length > 1) this.toast('🏆 최고 기록 갱신!', 'good');
    if (cm >= 2000) this.audio.good();
    this.setPhase('land');
  }

  private nextOrFinish() {
    if (this.attempt + 1 < ATTEMPTS) {
      this.attempt++;
      this.beginAttempt();
    } else this.finish();
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.setPhase('done');
    const best = this.attempts.reduce<Attempt | null>((b, a) => (!b || a.cm > b.cm ? a : b), null);
    const cm = best ? best.cm : 0;
    const m = MEDALS[clamp(this.opts.level, 1, 3) - 1]!;
    const title = cm <= 0 ? '💥 고무줄 3연속 뚝!' : cm >= m[0] ? '🏆 과학의 날 신기록!' : cm >= m[1] ? '🥈 운동장이 좁다!' : cm >= m[2] ? '📏 줄자 인증 완료!' : '🛩️ 종이비행기도 이것보단...';
    this.opts.onEnd({
      timeMs: cm,
      title,
      detail: [
        { label: '최고 비거리', value: fmtM(cm) },
        { label: '던진 기록', value: this.attempts.map((a) => (a.kind === 'snap' ? '뚝!' : fmtM(a.cm))).join(' · ') },
        { label: '기체', value: best ? best.plane : '-' },
        { label: '감은 횟수', value: best ? `${Math.round(best.turns)}회` : '-' },
        { label: '체공 시간', value: best && best.t > 0 ? `${best.t.toFixed(1)}초` : '-' },
        { label: '최고 고도', value: best && best.alt > 0 ? `${best.alt.toFixed(1)}m` : '-' },
        { label: '바람', value: best ? best.wind : '-' },
      ],
    });
  }

  // ------------------------------------------------------------ simulation
  step(dt: number) {
    if (this.disposed) return;
    this.clock += dt;
    this.phaseT += dt;
    const I = this.inp;
    const ready = this.phaseT > 0.35;
    if (I.cam) {
      this.camMode = 1 - this.camMode;
      this.toast(this.camMode ? '🎥 옆에서 보기' : '🎥 따라가며 보기', 'info');
    }
    if (I.plane >= 0 && this.phase === 'wind') this.setPlane(I.plane);

    switch (this.phase) {
      case 'wind': this.stepWind(dt, ready); break;
      case 'aim': this.stepAim(dt, ready); break;
      case 'fly': this.stepFly(dt); break;
      case 'land':
        if (this.slow > 0) {
          this.slow -= dt;
          if (this.slow <= 0) this.timeScale = 1;
        }
        this.glideStep(dt);
        if ((I.cont && this.phaseT > 1.4) || this.phaseT > 5) this.nextOrFinish();
        break;
      case 'snap':
        if ((I.cont && this.phaseT > 0.9) || this.phaseT > 2.6) this.nextOrFinish();
        break;
      default:
    }
    // clear edges
    I.cam = I.done = I.fire = I.cont = false;
    I.plane = -1;
    I.taps = 0;
    I.spin = 0;
    I.dragX = I.dragY = 0;

    const sdt = dt * this.timeScale;
    this.beatT += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.world.update(sdt, this.clock, this.env.wind, this.focus());
    this.parts.update(sdt);
    this.syncModel(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  private focus() {
    return this.flight && this.phase !== 'wind' && this.phase !== 'aim' ? new THREE.Vector3(this.flight.x, this.flight.y, this.flight.z) : new THREE.Vector3(0, 1, -8);
  }

  private stepWind(dt: number, ready: boolean) {
    const I = this.inp;
    const before = this.turns;
    // rhythm: tapping on the beat gives more turns
    const beat = (this.beatT * 2.2) % 1;
    const onBeat = beat < 0.17 || beat > 0.83;
    for (let i = 0; i < I.taps; i++) {
      if (!ready && this.phaseT < 0.15) continue;
      if (onBeat) {
        this.turns += 13;
        this.perfects++;
        this.audio.perfect();
      } else {
        this.turns += 6;
        this.audio.click(this.tension * 6);
      }
    }
    if (I.windHold) {
      I.holdT += dt;
      if (I.holdT > 0.25) {
        const r = 24 * dt;
        this.turns += r;
        if (Math.floor(this.turns / 4) > Math.floor((this.turns - r) / 4)) this.audio.click(this.tension * 6);
      }
    }
    if (I.spin > 0) {
      this.turns += I.spin;
      if (Math.floor(this.turns / 4) > Math.floor((this.turns - I.spin) / 4)) this.audio.click(this.tension * 6);
    }
    if (this.turns > before) this.model.prop.rotation.z += (this.turns - before) * Math.PI * 2;
    if (this.tension > 0.86 && !this.snapWarned) {
      this.snapWarned = true;
      this.toast('😬 고무줄이 삐걱삐걱... 더 감으면 터진다!', 'bad');
    }
    if (this.tension < 0.8) this.snapWarned = false;
    this.audio.loops(0, 0, this.turns > before ? this.tension : 0);
    if (this.turns >= this.snapAt) {
      this.snapBand();
      return;
    }
    if (I.done && ready) this.doneWinding();
  }

  private stepAim(dt: number, ready: boolean) {
    const I = this.inp;
    this.pitch = clamp(this.pitch + (I.ky * 38 * dt - I.dragY * 0.28) * DEG, -10 * DEG, 70 * DEG);
    this.yaw = clamp(this.yaw + (I.kx * 16 * dt + I.dragX * 0.1) * DEG, -15 * DEG, 15 * DEG);
    this.pwT += dt;
    const tri = Math.abs(((this.pwT / 1.15) % 2) - 1);
    this.power = tri;
    this.audio.loops(0, 0, 0);
    if (I.fire && ready) this.throwPlane();
  }

  private stepFly(dt: number) {
    const f = this.flight!;
    const I = this.inp;
    const tx = clamp(I.kx + I.sx, -1, 1);
    const ty = clamp(I.ky + I.sy, -1, 1);
    this.cmdBank += (tx - this.cmdBank) * Math.min(1, dt * 5);
    this.cmdPitch += (ty - this.cmdPitch) * Math.min(1, dt * 5);
    f.cmd.bank = this.cmdBank;
    f.cmd.pitch = this.cmdPitch;
    const sdt = dt;
    f.step(sdt);
    // hazards
    for (const h of hazardsAt(this.env, f.t)) {
      if (Math.hypot(h.x - f.x, h.y - f.y, h.z - f.z) < h.r + 0.5 && !f.hitIds.has(h.id)) {
        f.knock(h);
        const ev = f.events[f.events.length - 1];
        if (ev === 'ball') {
          this.toast('⚽ 축구공에 맞았다!', 'bad');
          this.toast(pick(SAY.ball), 'radio');
          this.audio.bonk();
        } else {
          this.toast('🐦 비둘기와 충돌!', 'bad');
          this.toast(pick(SAY.pigeon), 'radio');
          this.audio.coo();
        }
        this.parts.burst(f.x, f.y, f.z, 8, ev === 'ball' ? 0xffffff : 0xcfd3da, 2.5, 0.06, 0.8);
        this.shake = 0.4;
      }
    }
    this.world.setHazards(hazardsAt(this.env, f.t), f.t);
    // events for flavour
    let up = 0;
    for (const t of this.env.thermals) up = Math.max(up, thermalW(t, f.x, f.y, f.z));
    let dn = 0;
    for (const t of this.env.downs) dn = Math.min(dn, thermalW(t, f.x, f.y, f.z));
    if (up > 0.5 && !this.thermalFlag) {
      this.thermalFlag = 1;
      this.toast('🔥 상승기류! 둥실 떠오른다', 'good');
      this.toast(pick(SAY.thermal), 'radio');
    }
    if (up < 0.1) this.thermalFlag = 0;
    if (dn < -0.8 && !this.downFlag) {
      this.downFlag = 1;
      this.toast('⬇ 하강기류!', 'bad');
      this.toast(pick(SAY.down), 'radio');
    }
    if (dn > -0.2) this.downFlag = 0;
    if (f.stalled > 0.5 && !this.stallWarn) {
      this.stallWarn = true;
      this.toast('⚠ 실속! 기수가 떨어진다', 'bad');
      this.toast(pick(SAY.stall), 'radio');
    }
    if (f.stalled < 0.1) this.stallWarn = false;
    const d = f.dist;
    if (d > this.nextMilestone + 20 && f.y > 0.2) {
      this.nextMilestone = Math.floor(d / 20) * 20;
      if (this.nextMilestone >= 40) this.world.cheer(1.5);
    }
    this.audio.loops(f.airspeed, f.thrust / f.spec.tmax, 0);
    if (f.end) this.endFlight();
  }

  /** visual slide after touching down */
  private glideStep(dt: number) {
    const f = this.flight;
    if (!f || !f.end || f.end.kind !== 'ground') return;
    if (this.glide.v > 0.1) {
      const sdt = dt * this.timeScale;
      f.end.x += this.glide.x * sdt * 0.5;
      f.end.z += this.glide.z * sdt * 0.5;
      this.glide.x *= 1 - 3 * sdt;
      this.glide.z *= 1 - 3 * sdt;
      this.glide.v = Math.hypot(this.glide.x, this.glide.z);
    }
  }

  // ------------------------------------------------------------ visuals
  private syncModel(dt: number) {
    const m = this.model;
    const f = this.flight;
    if (this.phase === 'wind') {
      const tension = this.tension;
      m.root.position.set(HOLD.x, HOLD.y + (tension > 0.82 ? Math.sin(this.clock * 60) * 0.004 : 0), HOLD.z);
      m.root.rotation.set(0, 0, 0);
      const band = m.bandMesh;
      band.scale.set(1 + tension * 1.4, 1 + tension * 1.4, 1);
      (band.material as THREE.MeshLambertMaterial).color.setHex(tension > 0.85 ? 0xff5030 : 0xd8a23a);
    } else if (this.phase === 'aim') {
      m.root.position.copy(HOLD);
      m.root.rotation.set(this.pitch, -this.yaw, 0);
      const d = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      this.aimArrow.position.copy(HOLD);
      this.aimArrow.setDirection(d);
      this.aimArrow.setLength(3 + this.power * 5, 0.5, 0.3);
    } else if (f && (this.phase === 'fly' || this.phase === 'land')) {
      const e = f.end;
      if (e && this.phase === 'land') {
        m.root.position.set(e.x, e.kind === 'ground' ? 0.12 : e.y, e.z);
        if (e.kind === 'ground') m.root.rotation.set(0.05, -f.psi, -f.phi * 0.3);
      } else {
        m.root.position.set(f.x, f.y, f.z);
        m.root.rotation.set(f.theta, -f.psi, -f.phi);
      }
      const spin = f.n > 0 ? 30 : 0;
      m.prop.rotation.z += spin * dt * this.timeScale * 1.0;
      this.world.setShadow(m.root.position.x, m.root.position.y, m.root.position.z, true);
      if (this.phase === 'fly' && Math.random() < 0.4) this.parts.spawn(f.x, f.y, f.z, (Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4, 0xffffff, 0.5, 0.05, 0);
    } else if (this.phase === 'snap') {
      m.root.position.set(HOLD.x, HOLD.y - Math.min(1.4, this.phaseT * 2), HOLD.z);
      m.root.rotation.set(this.phaseT, 0, this.phaseT * 2);
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    const f = this.flight;
    let tp: THREE.Vector3;
    let tl: THREE.Vector3;
    let fov = 62;
    let k = 6;
    if (this.phase === 'wind' || this.phase === 'snap') {
      tp = new THREE.Vector3(-1.5, 1.85, -2.1);
      tl = new THREE.Vector3(0, 1.48, 0.1);
      fov = 55;
      if (this.phase === 'wind' && this.tension > 0.82) tp.x += Math.sin(this.clock * 70) * 0.012;
    } else if (this.phase === 'aim') {
      tp = new THREE.Vector3(0.4, 2.25, 4.0);
      tl = new THREE.Vector3(0, 1.75, -14);
      fov = 62;
      k = 4;
    } else if (f && this.phase === 'fly') {
      const P = new THREE.Vector3(f.x, f.y, f.z);
      const h = new THREE.Vector3(Math.sin(f.psi), 0, -Math.cos(f.psi));
      if (this.camMode === 0) {
        tp = P.clone().addScaledVector(h, -4.6).add(new THREE.Vector3(0, 1.3, 0));
        tp.y = Math.max(0.7, tp.y);
        tl = P.clone().addScaledVector(h, 5);
        tl.y = P.y * 0.8 + 0.4;
        k = 5;
      } else {
        tp = new THREE.Vector3(P.x + 7, Math.max(1.4, P.y + 1.0), P.z + 1);
        tl = P.clone().add(new THREE.Vector3(0, 0, -2));
        k = 4;
      }
      fov = 62 + Math.min(10, f.airspeed);
    } else if (f && this.phase === 'land' && this.lastEnd) {
      const e = this.lastEnd;
      const P = new THREE.Vector3(e.x, Math.max(0.3, e.y), e.z);
      const t = Math.min(1, this.phaseT / 2.5);
      tp = new THREE.Vector3(P.x + 7 - t * 2, P.y + 2.4 + (1 - t) * 1, P.z + 6 - t * 1.5);
      tl = P.clone().add(new THREE.Vector3(0, 0.6, 0));
      fov = 62 - 24 * Math.min(1, this.phaseT / 1.2);
      k = 3;
    } else {
      tp = this.camPos;
      tl = this.camLook;
    }
    const a = 1 - Math.exp(-k * dt);
    if (this.phaseT < 0.001 || (this.phase === 'wind' && this.phaseT < dt * 1.5)) {
      this.camPos.copy(tp);
      this.camLook.copy(tl);
      this.camFov = fov;
    } else {
      this.camPos.lerp(tp, a);
      this.camLook.lerp(tl, a);
      this.camFov += (fov - this.camFov) * a;
    }
    cam.position.copy(this.camPos);
    if (this.shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25, 0));
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - this.camFov) > 0.05) {
      cam.fov = this.camFov;
      cam.updateProjectionMatrix();
    }
  }

  private updateHud() {
    const f = this.flight;
    this.set('att', `🛩️ ${Math.min(this.attempt + 1, ATTEMPTS)}/${ATTEMPTS}`);
    this.set('best', this.bestCm > 0 ? `최고 ${fmtM(this.bestCm)}` : '최고 --');
    const wsp = this.env ? Math.hypot(this.env.wind.x, this.env.wind.z) : 0;
    this.set('wtxt', wsp < 0.3 ? '무풍' : `${this.windText} ${wsp.toFixed(1)}`);
    if (this.env) {
      const ang = Math.atan2(this.env.wind.x, -this.env.wind.z) / DEG;
      this.hudEl.warrow!.style.transform = `rotate(${ang.toFixed(0)}deg)`;
      this.hudEl.warrow!.style.opacity = wsp < 0.3 ? '0.3' : '1';
    }
    const ph = this.phase;
    if (ph === 'wind') {
      this.set('turns', String(Math.floor(this.turns)));
      const t = this.tension;
      this.hudEl.tbar!.style.width = `${clamp(t, 0, 1.0) * 100}%`;
      this.hudEl.tens!.classList.toggle('hot', t > 0.82);
      this.set('tstate', t < 0.45 ? '느슨' : t < 0.75 ? '팽팽' : t < 0.9 ? '위험!' : '터지기 직전!!');
      this.set('pname', `${this.spec.emoji} ${this.spec.name}`);
      const beat = (this.beatT * 2.2) % 1;
      const on = beat < 0.17 || beat > 0.83;
      const be = this.hudEl.beat!;
      be.classList.toggle('ok', on);
      const s = 1 - Math.min(beat, 1 - beat) * 0.9;
      (be.firstElementChild as HTMLElement).style.transform = `scale(${s.toFixed(2)})`;
    } else if (ph === 'aim') {
      this.set('pitch', `${(this.pitch / DEG).toFixed(0)}°`);
      this.set('yaw', `${(this.yaw / DEG).toFixed(0)}°`);
      this.set('turns2', String(Math.round(this.turns)));
      this.set('pw', `${Math.round(this.power * 100)}%`);
      this.hudEl.pwc!.style.left = `${this.power * 100}%`;
      if (!this.hudCache.sweet) {
        this.hudCache.sweet = '1';
        this.hudEl.sweet!.style.left = `${SWEET[0] * 100}%`;
        this.hudEl.sweet!.style.width = `${(SWEET[1] - SWEET[0]) * 100}%`;
      }
    } else if ((ph === 'fly' || ph === 'land') && f) {
      this.set('dist', (f.dist).toFixed(1));
      this.set('alt', `${Math.max(0, f.y).toFixed(1)}m`);
      this.set('spd', `${f.airspeed.toFixed(1)}m/s`);
      const r = f.n0 > 0 ? f.n / f.n0 : 0;
      this.set('rub', `${Math.round(r * 100)}%`);
      if (this.hudEl.rbar) this.hudEl.rbar.style.width = `${r * 100}%`;
      if (ph === 'fly') {
        if (f.stalled > 0.4) this.tip('⚠ 실속! 기수가 들렸다 — 속도를 되찾을 때까지 기다려라', true);
        else this.tip(this.touch ? '손가락을 대고 살짝 밀어 방향·고도 조종' : '←→ 좌우 · ↑↓ 살짝 고도 조종 · C 시점 전환');
      }
    }
    if (ph === 'fly') this.set('center', '');
    if (ph === 'snap') this.set('center', '뚝!!');
    if (ph === 'wind' || ph === 'aim') this.set('center', '');
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
    this.renderer.render(this.scene, this.camera);
  };

  // ------------------------------------------------------------ test helpers (also used by dev tools)
  /** headless flight with the real physics + this level's world; returns the numbers a test needs */
  quickFlight(o: { plane?: number; turns: number; pitchDeg: number; power?: number; yawDeg?: number; wind?: { x: number; z: number }; thermals?: boolean }) {
    const sp = PLANES[o.plane ?? this.planeIdx]!;
    const env: ThrowEnv = { wind: o.wind ?? { x: 0, z: 0 }, gustPhase: 0, thermals: o.thermals ? this.env.thermals : [], downs: [], balls: [], pigeons: [] };
    const f = new Flight(sp, env, 0, this.world.solids, this.world.trees, o.turns);
    f.launch(o.pitchDeg * DEG, (o.yawDeg ?? 0) * DEG, 3.4 + 4.8 * (o.power ?? 0.7));
    for (let i = 0; i < 60 * 70 && !f.end; i++) f.step(STEP);
    return { cm: Math.round(f.dist * 100), kind: f.end!.kind, t: f.t, alt: f.maxAlt, stall: f.maxStall };
  }
  forceEnv(wind: { x: number; z: number }) {
    this.env.wind = wind;
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
    this.ctl.dispose();
    this.audio.dispose();
    this.hud.remove();
    this.styleEl.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const kill = (m: THREE.Material) => {
        const mm = m as THREE.MeshBasicMaterial;
        mm.map?.dispose();
        m.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(kill);
      else if (mat) kill(mat);
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/** power-meter sweet zone (fraction of the bar) */
export const SWEET: [number, number] = [0.6, 0.88];
