// Анимированная приборная панель в стиле Optitron Corolla E150 (дорестайлинг):
// тахометр с ЖК-шкалами топлива и температуры, спидометр 0–240 с дисплеем,
// розовые стрелки, янтарная подсветка, прогон стрелок и проверка ламп при включении зажигания.
import { sim } from '../sim/engine';

const W = 1000, H = 330;
const AMBER = '#ffa424';
const AMBER_DIM = '#6b4410';
const NEEDLE = '#ff2d6f';
const RED = '#ff3b3b';
const START = (150 * Math.PI) / 180;
const SWEEP = (240 * Math.PI) / 180;

type LampKey = 'mil' | 'batt' | 'oil' | 'abs' | 'airbag' | 'brake' | 'eps' | 'belt' | 'master' | 'hot';

export class Cluster {
  private ctx: CanvasRenderingContext2D;
  private backlight = 0;     // 0..1 подсветка шкал
  private tach = 0;          // положение стрелки, об/мин
  private speed = 0;
  private sweepT = -1;       // время с начала прогона стрелок, -1 — нет
  private lampCheckT = -1;   // время с включения зажигания
  private prevIgn = false;
  private last = performance.now();
  private odo = 185340;
  private trip = 12.4;
  private blink = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private draw(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.blink += dt;
    const c = this.ctx;
    const sx = this.canvas.width / W, sy = this.canvas.height / H;
    const s = Math.min(sx, sy);
    c.setTransform(s, 0, 0, s, (this.canvas.width - W * s) / 2, (this.canvas.height - H * s) / 2);
    c.clearRect(-10, -10, W + 20, H + 20);

    // --- Питание приборки ---
    const n = sim.net;
    const ign = n.igOn;
    const supply = n.bplus;
    // Яркость падает при просадке напряжения (стартер, плохая клемма)
    let bright = ign ? Math.max(0, Math.min(1, (supply - 5) / 6)) : 0;
    if (ign && sim.ign === 'start' && supply < 9) bright *= 0.55 + Math.random() * 0.25;
    if (ign && !this.prevIgn) { this.sweepT = 0; this.lampCheckT = 0; }
    if (!ign) { this.sweepT = -1; this.lampCheckT = -1; }
    this.prevIgn = ign;
    this.backlight += (bright - this.backlight) * Math.min(1, dt * 5);
    if (this.lampCheckT >= 0) this.lampCheckT += dt;

    // --- Цели стрелок ---
    let tachTarget = sim.rpmOut;
    let speedTarget = 0;
    if (this.sweepT >= 0) {
      this.sweepT += dt;
      const t = this.sweepT;
      if (t < 0.8) { tachTarget = 8000; speedTarget = 240; }
      else if (t < 1.7) { tachTarget = 0; speedTarget = 0; }
      else this.sweepT = -1;
    }
    if (!ign) { tachTarget = 0; speedTarget = 0; }
    const step = (cur: number, target: number, rate: number) => {
      const d = target - cur;
      const m = rate * dt;
      return cur + Math.max(-m, Math.min(m, d * Math.min(1, dt * 14) + Math.sign(d) * Math.min(Math.abs(d), m * 0.15)));
    };
    this.tach = step(this.tach, tachTarget, 14000);
    this.speed = step(this.speed, speedTarget, 420);
    if (sim.running) this.trip += 0;

    this.drawHousing();
    this.drawDial(330, 178, 'tach');
    this.drawDial(670, 178, 'speed');
    this.drawLamps();
  }

  private drawHousing(): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.moveTo(40, 300);
    c.bezierCurveTo(10, 220, 40, 120, 120, 96);
    c.bezierCurveTo(170, 30, 470, 10, 500, 70);
    c.bezierCurveTo(530, 10, 830, 30, 880, 96);
    c.bezierCurveTo(960, 120, 990, 220, 960, 300);
    c.bezierCurveTo(700, 324, 300, 324, 40, 300);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16181c');
    g.addColorStop(1, '#070809');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#2b2e34';
    c.stroke();
    // блик стекла
    c.clip();
    const gl = c.createLinearGradient(0, 0, W, H);
    gl.addColorStop(0, 'rgba(255,255,255,0.06)');
    gl.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    c.fillStyle = gl;
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  private glow(color: string, blur: number): void {
    const c = this.ctx;
    c.shadowColor = color;
    c.shadowBlur = blur * this.backlight;
  }

  private drawDial(cx: number, cy: number, kind: 'tach' | 'speed'): void {
    const c = this.ctx;
    const R = 142;
    const bl = this.backlight;
    const max = kind === 'tach' ? 8000 : 240;
    const ang = (v: number) => START + (v / max) * SWEEP;

    // Тёмное основание
    c.save();
    c.beginPath();
    c.arc(cx, cy, R + 6, 0, Math.PI * 2);
    c.fillStyle = '#050506';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#3a3d44';
    c.stroke();
    c.restore();

    const col = bl > 0.05 ? AMBER : '#2a2a2a';
    c.save();
    c.globalAlpha = 0.25 + 0.75 * bl;
    // Светящееся кольцо
    this.glow(AMBER, 18);
    c.beginPath();
    c.arc(cx, cy, R - 52, START, START + SWEEP);
    c.lineWidth = 4;
    c.strokeStyle = bl > 0.05 ? AMBER : AMBER_DIM;
    c.stroke();
    // Красная зона тахометра
    if (kind === 'tach') {
      this.glow(RED, 10);
      c.beginPath();
      c.arc(cx, cy, R - 6, ang(6200), ang(8000));
      c.lineWidth = 10;
      c.strokeStyle = bl > 0.05 ? RED : '#3a1414';
      c.stroke();
    }
    // Риски
    const minor = kind === 'tach' ? 250 : 5;
    const major = kind === 'tach' ? 1000 : 20;
    for (let v = 0; v <= max + 0.01; v += minor) {
      const a = ang(v);
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const isMid = !isMajor && (kind === 'tach' ? v % 500 === 0 : v % 10 === 0);
      const r1 = R - 4, r2 = R - (isMajor ? 22 : isMid ? 15 : 10);
      this.glow(AMBER, isMajor ? 8 : 4);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      c.lineWidth = isMajor ? 4 : isMid ? 2.4 : 1.6;
      c.strokeStyle = kind === 'tach' && v >= 6200 ? (bl > 0.05 ? '#ff6060' : '#3a1414') : col;
      c.stroke();
    }
    // Цифры
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= max + 0.01; v += major) {
      const a = ang(v);
      const rr = R - 38;
      this.glow(AMBER, 10);
      c.font = `bold ${kind === 'tach' ? 24 : 17}px "Arial Narrow", Arial, sans-serif`;
      c.save();
      c.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      if (kind === 'speed') c.rotate(a + Math.PI / 2);
      c.fillText(kind === 'tach' ? String(v / 1000) : String(v), 0, 0);
      c.restore();
    }
    c.shadowBlur = 0;
    c.font = '13px Arial, sans-serif';
    c.fillStyle = col;
    if (kind === 'tach') { c.fillText('x1000', cx - 70, cy + 92); c.fillText('r/min', cx - 70, cy + 106); }
    else c.fillText('km/h', cx - 74, cy + 100);
    c.restore();

    // Внутренний ЖК-дисплей
    this.drawLcd(cx, cy, kind);

    // Стрелка
    const value = kind === 'tach' ? this.tach : this.speed;
    const a = ang(Math.max(0, Math.min(max, value)));
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.shadowColor = NEEDLE;
    c.shadowBlur = 14 * Math.max(0.25, bl);
    c.globalAlpha = 0.45 + 0.55 * Math.max(bl, 0.2);
    // Стрелка «плавающая» — видна по краю шкалы, центр закрыт дисплеем
    c.beginPath();
    c.moveTo(R - 60, -3.5);
    c.lineTo(R - 2, -1.2);
    c.lineTo(R - 2, 1.2);
    c.lineTo(R - 60, 3.5);
    c.closePath();
    c.fillStyle = NEEDLE;
    c.fill();
    c.restore();
  }

  private drawLcd(cx: number, cy: number, kind: 'tach' | 'speed'): void {
    const c = this.ctx;
    const r = 70;
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = '#0a0806';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#1e1b17';
    c.stroke();
    c.restore();
    const on = this.backlight > 0.05;
    if (!on) return;
    c.save();
    c.globalAlpha = this.backlight;
    const seg = (x: number, y: number, w: number, h: number, lit: boolean, color = AMBER) => {
      c.fillStyle = lit ? color : 'rgba(255,164,36,0.07)';
      c.shadowColor = color;
      c.shadowBlur = lit ? 6 : 0;
      c.fillRect(x, y, w, h);
    };
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (kind === 'tach') {
      // Топливо — слева, температура — справа (вертикальные столбики)
      const fuelBars = 6;
      const ect = sim.net.ecuOn ? sim.ectRead : -100;
      const tbars = ect < -60 ? 0 : ect < 40 ? 1 : ect < 60 ? 2 : ect < 72 ? 3 : ect < 82 ? 4 : ect < 104 ? 5 : ect < 110 ? 6 : ect < 114 ? 7 : 8;
      const hotBlink = tbars >= 8 && Math.floor(this.blink * 3) % 2 === 0;
      for (let i = 0; i < 8; i++) {
        const y = cy + 36 - i * 9;
        seg(cx - 34, y, 22, 6, i < fuelBars);
        seg(cx + 12, y, 22, 6, i < tbars && !(tbars >= 8 && hotBlink), i >= 6 ? RED : AMBER);
      }
      c.shadowBlur = 0;
      c.fillStyle = AMBER;
      c.font = 'bold 11px Arial';
      c.fillText('F', cx - 44, cy - 28);
      c.fillText('E', cx - 44, cy + 39);
      c.fillText('H', cx + 44, cy - 28);
      c.fillText('C', cx + 44, cy + 39);
      // значок топлива
      c.strokeStyle = AMBER;
      c.lineWidth = 1.6;
      c.strokeRect(cx - 28, cy - 54, 9, 11);
      c.beginPath(); c.moveTo(cx - 19, cy - 50); c.lineTo(cx - 15, cy - 47); c.lineTo(cx - 15, cy - 40); c.stroke();
      // значок температуры
      c.beginPath(); c.moveTo(cx + 22, cy - 56); c.lineTo(cx + 22, cy - 44); c.stroke();
      c.beginPath(); c.arc(cx + 22, cy - 42, 3, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx + 16, cy - 46); c.quadraticCurveTo(cx + 22, cy - 49, cx + 28, cy - 46); c.stroke();
    } else {
      c.fillStyle = AMBER;
      c.shadowColor = AMBER;
      c.shadowBlur = 5;
      let msg = '';
      if (sim.net.bplus < 11.2 && sim.net.igOn && !sim.cranking) msg = 'НИЗКОЕ\nНАПРЯЖ.';
      else if (sim.coolant > 112) msg = 'ПЕРЕГРЕВ\nДВИГАТЕЛЯ';
      c.font = 'bold 13px "Courier New", monospace';
      if (msg) {
        msg.split('\n').forEach((ln, i) => c.fillText(ln, cx, cy - 26 + i * 15));
      } else {
        c.font = 'bold 12px "Courier New", monospace';
        c.fillText(sim.running ? 'D  ' + Math.round(this.speed) : 'P', cx, cy - 22);
      }
      c.font = '10px Arial';
      c.textAlign = 'left';
      c.fillText('ODO', cx - 44, cy + 14);
      c.fillText('TRIP A', cx - 44, cy + 34);
      c.textAlign = 'right';
      c.font = 'bold 15px "Courier New", monospace';
      c.fillText(String(this.odo), cx + 34, cy + 14);
      c.fillText(this.trip.toFixed(1), cx + 34, cy + 34);
      c.font = '10px Arial';
      c.fillText('km', cx + 52, cy + 14);
      c.fillText('km', cx + 52, cy + 34);
    }
    c.restore();
  }

  private lampState(): Record<LampKey, boolean> {
    const L = sim.lamps;
    const ign = sim.net.igOn;
    const t = this.lampCheckT;
    const check = ign && t >= 0 && t < 3;
    const milOn = L.mil && (!L.milBlink || Math.floor(this.blink * 2) % 2 === 0);
    return {
      mil: milOn,
      batt: L.batt,
      oil: L.oil,
      abs: ign && (check || false),
      airbag: ign && t >= 0 && t < 6,
      brake: ign, // стояночный тормоз затянут
      eps: ign && (!sim.running || check),
      belt: ign && t >= 0 && t < 6,
      master: ign && (check || L.batt && sim.running || L.hot),
      hot: L.hot || (ign && check),
    };
  }

  private drawLamps(): void {
    const st = this.lampState();
    const dim = Math.max(0.15, this.backlight || 0);
    const c = this.ctx;
    const draw = (key: LampKey, x: number, y: number, color: string) => {
      const on = st[key];
      c.save();
      c.translate(x, y);
      c.globalAlpha = on ? Math.max(0.35, dim) : 1;
      const col = on ? color : '#1d1f23';
      c.strokeStyle = col;
      c.fillStyle = col;
      c.shadowColor = color;
      c.shadowBlur = on ? 12 : 0;
      c.lineWidth = 2.4;
      ICONS[key](c);
      c.restore();
    };
    // Слева от тахометра
    draw('eps', 120, 190, RED);
    draw('brake', 160, 190, RED);
    draw('batt', 120, 232, RED);
    draw('oil', 164, 232, RED);
    draw('belt', 140, 150, RED);
    // Центр
    draw('master', 500, 190, AMBER);
    draw('hot', 500, 236, RED);
    // Справа от спидометра
    draw('abs', 878, 190, AMBER);
    draw('airbag', 840, 232, RED);
    draw('mil', 882, 232, AMBER);
    // SHIFT
    c.save();
    c.globalAlpha = 0.35 + 0.65 * this.backlight;
    c.fillStyle = this.backlight > 0.05 ? '#b8bcc2' : '#2a2c30';
    c.font = 'bold 11px Arial';
    c.textAlign = 'center';
    c.fillText('SHIFT', 500, 262);
    c.restore();
  }
}

// ---------- Пиктограммы контрольных ламп ----------
const ICONS: Record<LampKey, (c: CanvasRenderingContext2D) => void> = {
  mil: (c) => {
    c.beginPath();
    c.moveTo(-14, -6); c.lineTo(-8, -6); c.lineTo(-8, -10); c.lineTo(4, -10); c.lineTo(4, -6); c.lineTo(10, -6);
    c.lineTo(10, -2); c.lineTo(14, -2); c.lineTo(14, 6); c.lineTo(10, 6); c.lineTo(10, 9); c.lineTo(-6, 9); c.lineTo(-10, 5); c.lineTo(-14, 5); c.closePath();
    c.stroke();
    c.beginPath(); c.moveTo(-18, -4); c.lineTo(-18, 4); c.stroke();
  },
  batt: (c) => {
    c.strokeRect(-13, -7, 26, 16);
    c.fillRect(-9, -11, 5, 4); c.fillRect(4, -11, 5, 4);
    c.font = 'bold 11px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('−', -6, 1); c.fillText('+', 6, 1);
  },
  oil: (c) => {
    c.beginPath();
    c.moveTo(-14, 4); c.lineTo(-14, -2); c.lineTo(-6, -2); c.lineTo(-4, -6); c.lineTo(2, -6); c.lineTo(4, -2); c.lineTo(12, -6); c.lineTo(8, 4); c.closePath();
    c.stroke();
    c.beginPath(); c.arc(15, 6, 2.2, 0, Math.PI * 2); c.fill();
  },
  abs: (c) => {
    c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0, 0, 16, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(0, 0, 16, Math.PI - 0.9, Math.PI + 0.9); c.stroke();
    c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ABS', 0, 0.5);
  },
  airbag: (c) => {
    c.beginPath(); c.arc(-4, -9, 3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-6, -4); c.lineTo(-6, 6); c.lineTo(2, 6); c.lineTo(4, 11); c.stroke();
    c.beginPath(); c.arc(8, -2, 6, 0, Math.PI * 2); c.fill();
  },
  brake: (c) => {
    c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0, 0, 15, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(0, 0, 15, Math.PI - 0.9, Math.PI + 0.9); c.stroke();
    c.font = 'bold 14px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', 0, 1);
  },
  eps: (c) => {
    c.font = 'bold 13px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P/S', 0, 1);
  },
  belt: (c) => {
    c.beginPath(); c.arc(0, -10, 3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-4, -5); c.lineTo(-4, 8); c.lineTo(6, 8); c.stroke();
    c.beginPath(); c.moveTo(4, -6); c.lineTo(-7, 6); c.stroke();
  },
  master: (c) => {
    c.beginPath(); c.moveTo(0, -12); c.lineTo(12, 9); c.lineTo(-12, 9); c.closePath(); c.stroke();
    c.font = 'bold 12px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', 0, 2);
  },
  hot: (c) => {
    c.beginPath(); c.moveTo(0, -11); c.lineTo(0, 4); c.stroke();
    c.beginPath(); c.arc(0, 6, 3.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5, -8); c.moveTo(0, -4); c.lineTo(5, -4); c.stroke();
    c.beginPath(); c.moveTo(-10, 11); c.quadraticCurveTo(-5, 8, 0, 11); c.quadraticCurveTo(5, 14, 10, 11); c.stroke();
  },
};
