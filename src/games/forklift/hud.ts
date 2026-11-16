import { MAP, type World } from './world';
import type { Forklift } from './forklift';

export interface HudData {
  time: number;
  delivered: number;
  total: number;
  speed: number;
  forkH: number;
  turbo: number;
  style: number;
  penalty: number;
  tip: number;
  carrying: boolean;
  fragile: boolean;
  camLabel: string;
  opponent?: { name: string; delivered: number };
}

export class Hud {
  root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private toastBox: HTMLDivElement;
  private lastMini = 0;

  constructor(parent: HTMLElement, public name: string, public color: string, compact: boolean) {
    const r = document.createElement('div');
    r.className = 'hud' + (compact ? ' compact' : '');
    r.innerHTML = `
      <div class="hud-top">
        <div class="hud-name" style="--pc:${color}">${escapeHtml(name)}</div>
        <div class="hud-time" data-k="time">0:00.0</div>
        <div class="hud-del" data-k="del">📦 0/0</div>
        <div class="hud-opp" data-k="opp"></div>
      </div>
      <div class="hud-left">
        <div class="hud-style" data-k="style">STYLE 0</div>
        <div class="hud-pen" data-k="pen"></div>
      </div>
      <div class="hud-bottom">
        <div class="gauge"><span>속도</span><b data-k="spd">0</b><small>km/h</small></div>
        <div class="gauge fork"><span>포크</span><div class="bar v"><i data-k="fork"></i></div><b data-k="forkv">0.0m</b></div>
        <div class="gauge"><span>터보</span><div class="bar"><i data-k="turbo"></i></div></div>
        <div class="gauge cam" data-k="cam"></div>
      </div>
      <div class="hud-tip" data-k="tip">⚠ 전복 위험! 포크 내려!</div>
      <div class="hud-center" data-k="center"></div>
      <canvas class="minimap" width="192" height="120"></canvas>
      <div class="toasts"></div>`;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.mini = r.querySelector('canvas')!;
    this.toastBox = r.querySelector('.toasts')!;
  }

  setRect(x: number, y: number, w: number, h: number) {
    Object.assign(this.root.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  update(d: HudData) {
    this.el.time.textContent = fmtTime(d.time);
    this.el.del.textContent = `📦 ${d.delivered}/${d.total}`;
    this.el.spd.textContent = String(Math.round(Math.abs(d.speed) * 3.6));
    (this.el.fork as HTMLElement).style.height = `${(d.forkH / 3.2) * 100}%`;
    this.el.forkv.textContent = `${d.forkH.toFixed(1)}m`;
    (this.el.turbo as HTMLElement).style.width = `${d.turbo * 100}%`;
    this.el.style.textContent = `STYLE ${Math.round(d.style)}`;
    this.el.pen.textContent = d.penalty > 0 ? `페널티 +${d.penalty.toFixed(0)}s` : '';
    this.el.tip.style.opacity = d.tip > 0.7 ? '1' : '0';
    this.el.cam.textContent = `🎥 ${d.camLabel}`;
    this.el.opp.textContent = d.opponent ? `VS ${d.opponent.name} 📦${d.opponent.delivered}` : '';
    this.root.classList.toggle('fragile', d.carrying && d.fragile);
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
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  drawMinimap(world: World, forklifts: { f: Forklift; color: string }[], self: Forklift, now: number) {
    if (now - this.lastMini < 80) return;
    this.lastMini = now;
    const c = this.mini;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const sx = W / (MAP.x1 - MAP.x0);
    const sz = H / (MAP.z1 - MAP.z0);
    const px = (x: number) => (x - MAP.x0) * sx;
    const pz = (z: number) => (z - MAP.z0) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,14,20,0.75)';
    g.fillRect(0, 0, W, H);
    for (const r of world.mapRects) {
      g.fillStyle = r.color;
      g.fillRect(px(r.x - r.hw), pz(r.z - r.hd), Math.max(1, r.hw * 2 * sx), Math.max(1, r.hd * 2 * sz));
    }
    for (const o of world.oils) {
      g.fillStyle = 'rgba(0,0,0,0.8)';
      g.beginPath();
      g.arc(px(o.x), pz(o.z), o.r * sx, 0, Math.PI * 2);
      g.fill();
    }
    for (const z of world.zones) {
      g.strokeStyle = z.filled ? '#335' : z.truck ? '#ff4fd8' : '#2ee66b';
      g.lineWidth = 2;
      g.strokeRect(px(z.x - 1), pz(z.z - 1), 2 * sx, 2 * sz);
    }
    const blink = Math.floor(now / 300) % 2 === 0;
    for (const p of world.pallets) {
      if (p.delivered) continue;
      const carriedBySelf = p.carriedBy !== -1;
      g.fillStyle = p.fragile ? '#ff3b3b' : '#ffb347';
      if (!carriedBySelf || blink) g.fillRect(px(p.x) - 2.5, pz(p.z) - 2.5, 5, 5);
    }
    for (const a of world.agvs) {
      g.fillStyle = '#ff8800';
      g.fillRect(px(a.x) - 1.5, pz(a.z) - 1.5, 3, 3);
    }
    for (const { f, color } of forklifts) {
      g.save();
      g.translate(px(f.x), pz(f.z));
      g.rotate(-f.yaw + Math.PI);
      g.fillStyle = color;
      g.strokeStyle = f === self ? '#fff' : '#000';
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
  }

  dispose() {
    this.root.remove();
  }
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
