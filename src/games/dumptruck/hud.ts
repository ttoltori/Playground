import { escapeHtml, fmtTime } from '../forklift/hud';
import type { DumpTruck } from './truck';
import type { World } from './world';

export interface DtHudData {
  time: number;
  tons: number;
  target: number;
  trips: number;
  loads: number;
  loadPct: number;
  speed: number; // km/h
  gear: 'D' | 'R';
  bedDeg: number;
  penalty: number;
  bonus: number;
  risk: number;
  guide: string;
  guideTone: 'info' | 'ok' | 'warn';
  arrowDeg: number | null;
  dist: number | null;
  camLabel: string;
  warn: string;
  beeping: boolean;
}

const CSS = `
.dt-hud{position:absolute;inset:0;pointer-events:none;font-weight:700;text-shadow:0 2px 4px #000c;overflow:hidden}
.dt-top{position:absolute;top:max(8px,env(safe-area-inset-top));left:12px;display:flex;flex-direction:column;gap:1px}
.dt-name{background:var(--pc);color:#000;text-shadow:none;padding:1px 9px;border-radius:8px;font-size:12px;align-self:flex-start;margin-bottom:2px}
.dt-time{font-family:ui-monospace,monospace;font-size:30px;color:#fff;line-height:1.05}
.dt-prog{font-size:17px}
.dt-prog small{display:block;color:#d8dde6;font-size:11px;font-weight:600}
.dt-pen{color:var(--bad);font-size:13px}
.dt-bon{color:var(--good);font-size:12px}
.dt-guide{position:absolute;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:min(52%,540px);background:#000b;border-radius:12px;padding:5px 12px;display:flex;gap:10px;align-items:center;font-size:14px;border:1px solid #fff2}
.dt-guide.ok{border-color:var(--good)}
.dt-guide.warn{border-color:var(--hot);background:#3a1608cc}
.dt-arrow{font-size:26px;line-height:1;color:var(--accent);display:inline-block;width:28px;text-align:center}
.dt-guide em{font-style:normal;color:var(--muted);font-size:12px;white-space:nowrap}
.dt-toasts{position:absolute;left:12px;top:132px;width:min(40%,370px);display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.dt-toasts .toast{text-align:left;font-size:14px}
.dt-bottom{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:flex-end}
.dt-bottom .gauge{min-width:62px}
.dt-bottom .bar.v{height:42px}
.dt-bottom .gauge.risk .bar i{background:linear-gradient(90deg,var(--good),var(--hot),var(--bad))}
.dt-gear{font-size:12px;color:var(--accent)}
.dt-gear.r{color:#ffb44d}
.dt-warn{position:absolute;top:30%;left:50%;transform:translateX(-50%);background:var(--bad);color:#fff;padding:8px 18px;border-radius:10px;font-size:18px;opacity:0;transition:opacity .12s;animation:blink .3s infinite alternate;white-space:nowrap}
.dt-rear{position:absolute;display:none;border:2px solid #fff6;border-radius:8px;box-sizing:border-box;overflow:hidden}
.dt-rear svg{position:absolute;inset:0;width:100%;height:100%}
.dt-rear b{position:absolute;left:6px;top:3px;font-size:10px;color:#fff;background:#000a;padding:0 5px;border-radius:4px;text-shadow:none}
.dt-rear.beep{border-color:#ff5a3a}
.dt-cam{position:absolute;right:12px;bottom:max(10px,env(safe-area-inset-bottom));font-size:12px;background:#000a;border-radius:10px;padding:8px 10px}
.dt-touch .stick-hint{white-space:nowrap}
.dt-touch .tb.brake{border-color:var(--bad)}
@media (max-width:700px),(max-height:500px){
 .dt-time{font-size:22px}
 .dt-prog{font-size:14px}
 .dt-guide{font-size:12px;padding:4px 9px;max-width:46%}
 .dt-arrow{font-size:20px;width:22px}
 .dt-toasts{top:106px;width:min(36%,300px)}
 .dt-toasts .toast{font-size:11px;padding:5px 9px}
 .dt-bottom{gap:5px}
 .dt-bottom .gauge{min-width:50px;padding:3px 6px}
 .dt-bottom .gauge b{font-size:15px}
 .dt-bottom .bar.v{height:30px}
 .dt-warn{font-size:14px;padding:5px 12px}
}
`;

export class DtHud {
  root: HTMLDivElement;
  private style: HTMLStyleElement;
  private el: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private miniBg: HTMLCanvasElement;
  private toastBox: HTMLDivElement;
  private lastMini = 0;
  private rear: HTMLDivElement;
  private mm = { sc: 1, ox: 0, oz: 0 };

  constructor(parent: HTMLElement, name: string, color: string, world: World, touch: boolean) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const r = document.createElement('div');
    r.className = 'dt-hud';
    r.innerHTML = `
      <div class="dt-top">
        <div class="dt-name" style="--pc:${color}">${escapeHtml(name)}</div>
        <div class="dt-time" data-k="time">0:00.0</div>
        <div class="dt-prog"><span data-k="tons">0 / 0 t</span><small data-k="trips"></small></div>
        <div class="dt-pen" data-k="pen"></div>
        <div class="dt-bon" data-k="bon"></div>
      </div>
      <div class="dt-guide" data-k="guideBox"><span class="dt-arrow" data-k="arrow">➤</span><span data-k="guide"></span><em data-k="dist"></em></div>
      <div class="dt-toasts"></div>
      <div class="dt-bottom">
        <div class="gauge"><span>속도</span><b data-k="spd">0</b><small data-k="gear" class="dt-gear">D 전진</small></div>
        <div class="gauge"><span>덤프각</span><div class="bar v"><i data-k="bedbar"></i></div><b data-k="bed">0°</b></div>
        <div class="gauge"><span>적재</span><b data-k="loadp">0%</b><div class="bar"><i data-k="loadbar"></i></div></div>
        <div class="gauge risk"><span>전복위험</span><div class="bar"><i data-k="risk"></i></div></div>
      </div>
      <div class="gauge dt-cam" data-k="cam" style="display:${touch ? 'none' : 'block'}"></div>
      <div class="dt-warn" data-k="warn"></div>
      <div class="hud-center" data-k="center"></div>
      <div class="dt-rear" data-k="rear"><b data-k="rearLabel">후방카메라</b>
        <svg viewBox="0 0 100 58" preserveAspectRatio="none">
          <polygon points="12,58 88,58 62,30 38,30" fill="rgba(255,210,58,.06)"/>
          <line x1="12" y1="58" x2="38" y2="30" stroke="#ff4b3a" stroke-width="1.4"/><line x1="88" y1="58" x2="62" y2="30" stroke="#ff4b3a" stroke-width="1.4"/>
          <line x1="19" y1="48" x2="81" y2="48" stroke="#ff4b3a" stroke-width=".8"/>
          <line x1="26" y1="40" x2="74" y2="40" stroke="#ffd23a" stroke-width=".8"/>
          <line x1="33" y1="33" x2="67" y2="33" stroke="#2ee66b" stroke-width=".8"/>
        </svg></div>
      <canvas class="minimap" width="192" height="120"></canvas>`;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.mini = r.querySelector('canvas')!;
    this.toastBox = r.querySelector('.dt-toasts')!;
    this.rear = this.el.rear as HTMLDivElement;
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = 192;
    this.miniBg.height = 120;
    this.drawStatic(world);
  }

  private drawStatic(world: World) {
    const g = this.miniBg.getContext('2d')!;
    const W = 192;
    const H = 120;
    const b = world.bounds;
    const sc = Math.min((W - 8) / (b.x1 - b.x0), (H - 8) / (b.z1 - b.z0));
    this.mm.sc = sc;
    this.mm.ox = (W - (b.x1 - b.x0) * sc) / 2 - b.x0 * sc;
    this.mm.oz = (H - (b.z1 - b.z0) * sc) / 2 - b.z0 * sc;
    const px = (x: number) => x * sc + this.mm.ox;
    const pz = (z: number) => z * sc + this.mm.oz;
    g.fillStyle = 'rgba(10,14,20,0.78)';
    g.fillRect(0, 0, W, H);
    const L = world.level;
    g.fillStyle = 'rgba(190,175,140,0.35)';
    for (const y of [L.loadYard, L.dumpYard]) g.fillRect(px(y.x - y.hw), pz(y.z - y.hd), y.hw * 2 * sc, y.hd * 2 * sc);
    g.strokeStyle = '#d8c9a0';
    g.lineWidth = Math.max(2, L.roadW * sc * 0.9);
    g.lineJoin = 'round';
    g.beginPath();
    const R = world.route;
    for (let i = 0; i < R.n; i += 2) (i === 0 ? g.moveTo : g.lineTo).call(g, px(R.x[i]), pz(R.z[i]));
    g.stroke();
    g.fillStyle = '#2ee66b';
    g.beginPath();
    g.arc(px(L.gantry.x), pz(L.gantry.z), 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffb02e';
    g.fillRect(px(world.bayC[0]) - 3, pz(world.bayC[1]) - 3, 6, 6);
  }

  setRect(x: number, y: number, w: number, h: number, label: string, beep: boolean) {
    if (w <= 0) {
      this.rear.style.display = 'none';
      return;
    }
    Object.assign(this.rear.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.el.rearLabel.textContent = label;
    this.rear.classList.toggle('beep', beep);
  }

  update(d: DtHudData) {
    this.el.time.textContent = fmtTime(d.time);
    this.el.tons.textContent = `🏗 ${d.tons.toFixed(1)} / ${d.target.toFixed(0)} t`;
    this.el.trips.textContent = `운반 ${d.trips}회 · 목표 ${d.loads}트럭분`;
    this.el.pen.textContent = d.penalty > 0 ? `페널티 +${d.penalty.toFixed(0)}s` : '';
    this.el.bon.textContent = d.bonus > 0 ? `보너스 −${d.bonus.toFixed(0)}s` : '';
    this.el.spd.textContent = String(Math.round(Math.abs(d.speed)));
    this.el.gear.textContent = d.gear === 'R' ? 'R 후진 🔊' : 'D 전진';
    this.el.gear.classList.toggle('r', d.gear === 'R');
    this.el.bed.textContent = `${Math.round(d.bedDeg)}°`;
    (this.el.bedbar as HTMLElement).style.height = `${Math.min(100, (d.bedDeg / 52) * 100)}%`;
    this.el.loadp.textContent = `${Math.round(d.loadPct)}%`;
    (this.el.loadbar as HTMLElement).style.width = `${d.loadPct}%`;
    (this.el.risk as HTMLElement).style.width = `${Math.min(100, d.risk * 100)}%`;
    this.el.guide.textContent = d.guide;
    this.el.guideBox.className = 'dt-guide ' + (d.guideTone === 'info' ? '' : d.guideTone);
    if (d.arrowDeg === null) this.el.arrow.style.visibility = 'hidden';
    else {
      this.el.arrow.style.visibility = 'visible';
      this.el.arrow.style.transform = `rotate(${d.arrowDeg - 90}deg)`;
    }
    this.el.dist.textContent = d.dist === null ? '' : `${Math.round(d.dist)}m`;
    this.el.cam.textContent = `🎥 ${d.camLabel}`;
    this.el.warn.textContent = d.warn;
    this.el.warn.style.opacity = d.warn ? '1' : '0';
  }

  center(text: string, cls = '') {
    this.el.center.textContent = text;
    this.el.center.className = 'hud-center ' + cls;
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'radio' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.toastBox.appendChild(t);
    while (this.toastBox.children.length > 4) this.toastBox.firstChild?.remove();
    setTimeout(() => t.classList.add('out'), 3400);
    setTimeout(() => t.remove(), 4000);
  }

  drawMinimap(truck: DumpTruck, target: [number, number] | null, now: number) {
    if (now - this.lastMini < 90) return;
    this.lastMini = now;
    const c = this.mini;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.miniBg, 0, 0);
    const { sc, ox, oz } = this.mm;
    if (target) {
      const blink = Math.floor(now / 350) % 2 === 0;
      g.strokeStyle = blink ? '#ffd23a' : '#ff8a1a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(target[0] * sc + ox, target[1] * sc + oz, 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.save();
    g.translate(truck.x * sc + ox, truck.z * sc + oz);
    g.rotate(-truck.yaw + Math.PI);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4, 4);
    g.lineTo(-4, 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
