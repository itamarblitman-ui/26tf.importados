import type { Snapshot } from '../physics/snapshot';

const KT = 1.943844, FT = 3.28084, R2D = 180 / Math.PI;
const GREEN = '#46ff9a';

/**
 * HUD opcional: velocidad, altitud, rumbo, velocidad vertical y G. En la cabina además dibuja
 * horizonte, escalera de cabeceo y vector de trayectoria conformes a la vista (usa el FOV real).
 */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  visible = false;
  private dpr = 1;
  private lastDraw = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud hidden';
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  toggle(force?: boolean) {
    this.visible = force ?? !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
  }

  /**
   * @param conformal dibujar horizonte/escalera alineados con el mundo (sólo en cabina)
   * @param vfovRad campo visual vertical de la cámara
   * @param lookPitch / lookYaw desvío de la mirada respecto del eje del avión (rad)
   * @param bottomInset altura ocupada abajo por el tablero (px)
   */
  update(s: Snapshot, conformal: boolean, vfovRad: number, lookYaw: number, lookPitch: number, bottomInset: number) {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastDraw < 33) return;
    this.lastDraw = now;
    const c = this.ctx;
    const W = window.innerWidth, H = window.innerHeight - bottomInset;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    c.strokeStyle = GREEN; c.fillStyle = GREEN;
    c.lineWidth = 1.6;
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3;
    c.font = '600 15px ui-monospace, Menlo, monospace';
    c.textBaseline = 'middle';

    const cx = W / 2, cy = H / 2;
    const pxPerRad = (window.innerHeight / 2) / Math.tan(vfovRad / 2);

    if (conformal && Math.abs(lookYaw) < 0.35) {
      // Centro de la vista = eje longitudinal desplazado por la mirada
      // El centro óptico es el centro de la ventana (no el del área libre sobre el tablero).
      const boreY = window.innerHeight / 2 + lookPitch * pxPerRad;
      c.save();
      c.beginPath(); c.rect(W * 0.2, 170, W * 0.6, H - 190); c.clip();
      c.translate(cx - lookYaw * pxPerRad, boreY);
      c.rotate(-s.roll);
      // Horizonte y escalera (cada 5°)
      for (let p = -30; p <= 30; p += 5) {
        const y = (s.pitch - p * Math.PI / 180) * pxPerRad;
        if (p === 0) {
          c.beginPath(); c.moveTo(-W * 0.4, y); c.lineTo(-60, y); c.moveTo(60, y); c.lineTo(W * 0.4, y); c.stroke();
          continue;
        }
        const w = 70, gap = 30;
        c.setLineDash(p < 0 ? [8, 6] : []);
        c.beginPath();
        c.moveTo(-gap - w, y + (p > 0 ? 8 : -8)); c.lineTo(-gap - w, y); c.lineTo(-gap, y);
        c.moveTo(gap, y); c.lineTo(gap + w, y); c.lineTo(gap + w, y + (p > 0 ? 8 : -8));
        c.stroke();
        c.setLineDash([]);
        c.textAlign = 'right'; c.fillText(String(Math.abs(p)), -gap - w - 6, y);
        c.textAlign = 'left'; c.fillText(String(Math.abs(p)), gap + w + 6, y);
      }
      c.restore();

      // Vector de trayectoria (dónde va realmente el avión)
      if (s.groundSpeed > 5 || !s.onGround) {
        const fpaY = (s.pitch - Math.atan2(-s.vD, Math.max(s.groundSpeed, 1))) * pxPerRad;
        const track = Math.atan2(s.vE, s.vN);
        let dTrack = track - s.heading;
        dTrack = Math.atan2(Math.sin(dTrack), Math.cos(dTrack));
        const fx = cx - lookYaw * pxPerRad + dTrack * pxPerRad, fy = boreY + fpaY;
        c.beginPath(); c.arc(fx, fy, 7, 0, Math.PI * 2);
        c.moveTo(fx - 7, fy); c.lineTo(fx - 18, fy); c.moveTo(fx + 7, fy); c.lineTo(fx + 18, fy);
        c.moveTo(fx, fy - 7); c.lineTo(fx, fy - 14);
        c.stroke();
      }
      // Referencia del eje del avión
      const bx = cx - lookYaw * pxPerRad;
      c.beginPath(); c.moveTo(bx - 22, boreY); c.lineTo(bx - 8, boreY); c.lineTo(bx, boreY + 8); c.lineTo(bx + 8, boreY); c.lineTo(bx + 22, boreY); c.stroke();
    }

    // Cinta de velocidad (izquierda) y de altitud (derecha)
    this.tape(c, W * 0.16, cy, s.ias * KT, 10, 'kt', 'left');
    this.tape(c, W * 0.84, cy, s.altMsl * FT, 100, 'ft', 'right');
    // Rumbo (arriba)
    this.headingTape(c, cx, 136, (s.heading * R2D + 360) % 360);
    // Velocidad vertical y G
    c.textAlign = 'left';
    const vs = -s.vD * FT * 60;
    c.fillText(`VS ${vs >= 0 ? '+' : ''}${Math.round(vs / 10) * 10}`, W * 0.84 - 40, cy + 120);
    c.textAlign = 'right';
    c.fillText(`G ${s.nz.toFixed(1)}`, W * 0.16 + 40, cy + 120);
    c.textAlign = 'center';
    if (s.stalled && !s.onGround) c.fillText('STALL', cx, cy + 150);
  }

  private tape(c: CanvasRenderingContext2D, x: number, y: number, value: number, step: number, unit: string, side: 'left' | 'right') {
    const h = 220, pxPerUnit = 4 / (step / 10) * 0.9;
    const dir = side === 'left' ? -1 : 1;
    c.save();
    c.beginPath(); c.rect(x - 50, y - h / 2, 100, h); c.clip();
    c.beginPath(); c.moveTo(x, y - h / 2); c.lineTo(x, y + h / 2); c.stroke();
    const first = Math.floor((value - h / 2 / pxPerUnit) / step) * step;
    for (let v = first; v <= value + h / 2 / pxPerUnit; v += step) {
      const ty = y - (v - value) * pxPerUnit;
      const major = Math.round(v / step) % 2 === 0;
      c.beginPath(); c.moveTo(x, ty); c.lineTo(x + dir * (major ? 12 : 6), ty); c.stroke();
      if (major && v >= 0) {
        c.textAlign = side === 'left' ? 'right' : 'left';
        c.fillText(String(Math.round(v)), x + dir * 16, ty);
      }
    }
    c.restore();
    // Ventana con el valor actual
    const bw = 74;
    const bx = side === 'left' ? x - bw - 4 : x + 4;
    c.clearRect(bx, y - 13, bw, 26);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(bx, y - 13, bw, 26);
    c.fillStyle = GREEN; c.strokeRect(bx, y - 13, bw, 26);
    c.textAlign = 'center';
    c.fillText(`${Math.round(value)}`, bx + bw / 2, y);
    c.font = '500 11px ui-monospace, Menlo, monospace';
    c.fillText(unit, bx + bw / 2, y + 24);
    c.font = '600 15px ui-monospace, Menlo, monospace';
  }

  private headingTape(c: CanvasRenderingContext2D, x: number, y: number, hdg: number) {
    const w = 300, pxPerDeg = 5;
    c.save();
    c.beginPath(); c.rect(x - w / 2, y - 30, w, 40); c.clip();
    c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.stroke();
    const first = Math.floor((hdg - w / 2 / pxPerDeg) / 5) * 5;
    for (let d = first; d <= hdg + w / 2 / pxPerDeg; d += 5) {
      const tx = x + (d - hdg) * pxPerDeg;
      const major = d % 10 === 0;
      c.beginPath(); c.moveTo(tx, y); c.lineTo(tx, y - (major ? 10 : 5)); c.stroke();
      if (d % 30 === 0) {
        const n = ((d % 360) + 360) % 360;
        const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        c.textAlign = 'center';
        c.fillText(names[n] ?? String(n / 10).padStart(2, '0'), tx, y - 20);
      }
    }
    c.restore();
    c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x - 6, y + 12); c.lineTo(x + 6, y + 12); c.closePath(); c.fill();
    c.textAlign = 'center';
    c.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), x, y + 26);
  }
}
