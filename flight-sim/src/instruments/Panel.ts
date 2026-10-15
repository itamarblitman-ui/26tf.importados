import type { AircraftConfig } from '../physics/AircraftConfig';
import type { Snapshot } from '../physics/snapshot';
import {
  drawAirspeed, drawAltimeter, drawAttitude, drawHeading, drawTachometer, drawTurnCoordinator, drawVsi, type AirspeedArcs,
} from './gauges';
import { InstrumentModel, KT } from './InstrumentModel';

export type PanelLayout = 'cockpit' | 'compact' | 'hidden';

/**
 * Tablero de instrumentos dibujado en un canvas superpuesto. Se redibuja a ~30 Hz (no a 60):
 * las agujas no necesitan más y así el hilo de render queda libre para Cesium.
 */
export class Panel {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly model = new InstrumentModel();
  layout: PanelLayout = 'hidden';
  private lastDraw = 0;
  private dpr = 1;
  private arcs: AirspeedArcs;
  private engines: number;
  private redline: number;
  private flapMax: number;
  /** Rumbo seleccionado (para el piloto automático), o null. */
  headingBug: number | null = null;
  /** Altura (px CSS) que ocupa el tablero en la vista de cabina. */
  cockpitHeight = 0;

  constructor(parent: HTMLElement, cfg: AircraftConfig) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'instrument-panel';
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const L = cfg.limits;
    const vs0 = Math.round(L.vs * 0.9 * KT), vs1 = Math.round(L.vs * KT);
    const vno = Math.round((L.vno ?? L.vne * 0.79) * KT), vne = Math.round(L.vne * KT);
    this.arcs = { white: [vs0, Math.round(cfg.flaps.vfe * KT)], green: [vs1, vno], yellow: [vno, vne], red: vne };
    this.engines = cfg.engines.length;
    this.redline = cfg.engines[0].maxRpm;
    this.flapMax = Math.max(cfg.flaps.maxDeg, 1);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.lastDraw = 0;
  }

  setLayout(l: PanelLayout) {
    this.layout = l;
    this.canvas.classList.toggle('hidden', l === 'hidden');
    this.lastDraw = 0;
  }

  update(s: Snapshot, dt: number) {
    const readings = this.model.update(s, dt);
    if (this.layout === 'hidden') return;
    const now = performance.now();
    if (now - this.lastDraw < 33) return;
    this.lastDraw = now;

    const c = this.ctx;
    const W = window.innerWidth, H = window.innerHeight;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    let D: number, gap: number, x0: number, y0: number;
    if (this.layout === 'cockpit') {
      const panelH = Math.min(H * 0.36, W * 0.3);
      this.cockpitHeight = panelH;
      D = Math.min((panelH - 24) / 2.08, W / 8.2);
      gap = D * 0.08;
      this.drawDashboard(c, W, H, panelH);
      x0 = W * 0.44 - (3 * D + 2 * gap) / 2;
      y0 = H - panelH + (panelH - (2 * D + gap)) * 0.62;
    } else {
      D = Math.min(H * 0.14, W * 0.1, 130);
      gap = D * 0.06;
      x0 = 12;
      y0 = H - (2 * D + gap) - 12;
      c.fillStyle = 'rgba(8,10,12,0.55)';
      roundRect(c, x0 - 8, y0 - 8, 4 * D + 3 * gap + 16, 2 * D + gap + 16, 12);
      c.fill();
    }

    const at = (col: number, row: number, draw: (size: number) => void) => {
      c.save();
      c.translate(x0 + col * (D + gap) + D / 2, y0 + row * (D + gap) + D / 2);
      draw(D);
      c.restore();
    };
    const dpr = this.dpr;
    at(0, 0, (d) => drawAirspeed(c, d, dpr, readings, this.arcs));
    at(1, 0, (d) => drawAttitude(c, d, dpr, readings));
    at(2, 0, (d) => drawAltimeter(c, d, dpr, readings));
    at(0, 1, (d) => drawTurnCoordinator(c, d, dpr, readings));
    at(1, 1, (d) => drawHeading(c, d, dpr, readings, this.headingBug));
    at(2, 1, (d) => drawVsi(c, d, dpr, readings));
    at(3, 0, (d) => drawTachometer(c, d, dpr, s.rpm0, Math.round(this.redline * 0.78), this.redline, this.engines, s.rpm1));
    at(3, 1, (d) => this.drawStatus(c, d, s));
  }

  private drawDashboard(c: CanvasRenderingContext2D, W: number, H: number, panelH: number) {
    const top = H - panelH;
    // Visera antirreflejo con borde curvo
    const g = c.createLinearGradient(0, top - 30, 0, H);
    g.addColorStop(0, '#1d2024');
    g.addColorStop(0.08, '#2a2e33');
    g.addColorStop(1, '#16181b');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, top + 20);
    c.quadraticCurveTo(W * 0.5, top - 28, W, top + 20);
    c.lineTo(W, H); c.lineTo(0, H); c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, top + 20); c.quadraticCurveTo(W * 0.5, top - 28, W, top + 20); c.stroke();
  }

  /** Recuadro de estado: acelerador, flaps, compensador, frenos. */
  private drawStatus(c: CanvasRenderingContext2D, d: number, s: Snapshot) {
    const r = d / 2;
    c.fillStyle = '#0e0f11';
    roundRect(c, -r * 0.92, -r * 0.92, r * 1.84, r * 1.84, r * 0.12);
    c.fill();
    c.strokeStyle = '#3a3d42'; c.lineWidth = 2; c.stroke();
    const bar = (y: number, label: string, frac: number, color: string, text: string, signed = false) => {
      c.fillStyle = '#9aa1a8';
      c.font = `500 ${r * 0.13}px system-ui, sans-serif`;
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(label, -r * 0.8, y - r * 0.12);
      c.textAlign = 'right';
      c.fillStyle = '#eef0f2';
      c.fillText(text, r * 0.8, y - r * 0.12);
      c.fillStyle = '#25282c';
      c.fillRect(-r * 0.8, y, r * 1.6, r * 0.1);
      c.fillStyle = color;
      if (signed) {
        const w = Math.max(-1, Math.min(1, frac)) * r * 0.8;
        c.fillRect(Math.min(0, w), y, Math.abs(w), r * 0.1);
        c.fillStyle = '#eef0f2'; c.fillRect(-1, y - 2, 2, r * 0.1 + 4);
      } else c.fillRect(-r * 0.8, y, r * 1.6 * Math.max(0, Math.min(1, frac)), r * 0.1);
    };
    bar(-r * 0.5, 'ACELERADOR', s.throttle, '#5fb4e8', `${Math.round(s.throttle * 100)}%`);
    bar(-r * 0.05, 'FLAPS', s.flapDeg / this.flapMax, '#eef0f2', `${Math.round(s.flapDeg)}°`);
    bar(r * 0.4, 'COMPENSADOR', s.trim, '#ffb547', s.trim > 0.02 ? 'ARRIBA' : s.trim < -0.02 ? 'ABAJO' : 'NEUTRO', true);
    c.textAlign = 'center';
    c.font = `700 ${r * 0.13}px system-ui, sans-serif`;
    const brake = s.parkingBrake ? 'FRENO ESTAC.' : s.brakeLeft > 0 || s.brakeRight > 0 ? 'FRENOS' : '';
    c.fillStyle = s.parkingBrake ? '#ffb547' : '#ff5a4f';
    c.fillText(brake, 0, r * 0.74);
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
