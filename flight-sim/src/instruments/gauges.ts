import type { InstrumentReadings } from './InstrumentModel';

/**
 * Dibujo de los seis instrumentos básicos en Canvas 2D. Diseño propio, estilo analógico genérico.
 * Cada instrumento se dibuja en un cuadrado de lado `size` con origen en su centro.
 * Las partes estáticas (bisel, marcas, números) se pre-renderizan en un canvas aparte y se cachean.
 */
type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

export interface AirspeedArcs {
  /** kt */ white: [number, number];
  green: [number, number];
  yellow: [number, number];
  red: number;
}

const COLORS = {
  bezel: '#1b1d20',
  bezelEdge: '#3a3d42',
  face: '#0e0f11',
  ink: '#eef0f2',
  dim: '#9aa1a8',
  needle: '#f4f4f0',
  sky: '#2f7fc4',
  ground: '#7a4f2a',
  orange: '#ff9d2e',
};

const faceCache = new Map<string, HTMLCanvasElement>();

function cachedFace(key: string, size: number, dpr: number, draw: (c: Ctx, r: number) => void): HTMLCanvasElement {
  const k = `${key}:${size}:${dpr}`;
  let cv = faceCache.get(k);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(size * dpr);
    const c = cv.getContext('2d')!;
    c.scale(dpr, dpr);
    c.translate(size / 2, size / 2);
    draw(c, size / 2);
    faceCache.set(k, cv);
  }
  return cv;
}

function blitFace(c: Ctx, face: HTMLCanvasElement, size: number) {
  c.drawImage(face, -size / 2, -size / 2, size, size);
}

function bezel(c: Ctx, r: number) {
  const g = c.createRadialGradient(0, -r * 0.3, r * 0.2, 0, 0, r);
  g.addColorStop(0, COLORS.bezelEdge);
  g.addColorStop(1, COLORS.bezel);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  // Tornillos de montaje
  c.fillStyle = '#2a2c30';
  for (const a of [45, 135, 225, 315]) {
    c.beginPath();
    c.arc(Math.cos(a * D2R) * r * 0.93, Math.sin(a * D2R) * r * 0.93, r * 0.035, 0, TAU);
    c.fill();
  }
  c.fillStyle = COLORS.face;
  c.beginPath(); c.arc(0, 0, r * 0.86, 0, TAU); c.fill();
}

function glass(c: Ctx, r: number) {
  const g = c.createLinearGradient(-r, -r, r * 0.4, r * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r * 0.86, 0, TAU); c.fill();
}

function ticks(c: Ctx, r: number, from: number, to: number, count: number, len: number, width: number, color = COLORS.ink) {
  c.strokeStyle = color;
  c.lineWidth = width;
  for (let i = 0; i <= count; i++) {
    const a = (from + ((to - from) * i) / count) * D2R;
    c.beginPath();
    c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    c.lineTo(Math.cos(a) * (r - len), Math.sin(a) * (r - len));
    c.stroke();
  }
}

function label(c: Ctx, text: string, x: number, y: number, px: number, color = COLORS.ink, weight = 600) {
  c.fillStyle = color;
  c.font = `${weight} ${px}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

function needle(c: Ctx, angleDeg: number, length: number, width: number, tail = 0.18, color = COLORS.needle) {
  c.save();
  c.rotate(angleDeg * D2R);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(-length * tail, -width);
  c.lineTo(length * 0.92, -width * 0.45);
  c.lineTo(length, 0);
  c.lineTo(length * 0.92, width * 0.45);
  c.lineTo(-length * tail, width);
  c.closePath();
  c.fill();
  c.restore();
}

function hub(c: Ctx, r: number) {
  c.fillStyle = '#2b2e33';
  c.beginPath(); c.arc(0, 0, r * 0.07, 0, TAU); c.fill();
}

// ───────────────────────── Anemómetro ─────────────────────────

const ASI_MIN = 30, ASI_MAX = 200;
const asiAngle = (kt: number) => -75 + ((Math.min(Math.max(kt, ASI_MIN - 6), ASI_MAX) - ASI_MIN) / (ASI_MAX - ASI_MIN)) * 320;

export function drawAirspeed(c: Ctx, size: number, dpr: number, r: InstrumentReadings, arcs: AirspeedArcs) {
  const key = `asi${arcs.white}${arcs.green}${arcs.yellow}${arcs.red}`;
  blitFace(c, cachedFace(key, size, dpr, (f, R) => {
    bezel(f, R);
    const arc = (a: number, b: number, rad: number, w: number, color: string) => {
      f.strokeStyle = color; f.lineWidth = w;
      f.beginPath(); f.arc(0, 0, rad, (asiAngle(a) - 90) * D2R, (asiAngle(b) - 90) * D2R); f.stroke();
    };
    arc(arcs.white[0], arcs.white[1], R * 0.66, R * 0.05, '#f2f2f2');
    arc(arcs.green[0], arcs.green[1], R * 0.75, R * 0.06, '#2fbf4a');
    arc(arcs.yellow[0], arcs.yellow[1], R * 0.75, R * 0.06, '#f2c230');
    f.save(); f.rotate((asiAngle(arcs.red) - 90) * D2R);
    f.strokeStyle = '#e8352b'; f.lineWidth = R * 0.03;
    f.beginPath(); f.moveTo(R * 0.62, 0); f.lineTo(R * 0.82, 0); f.stroke(); f.restore();
    for (let kt = ASI_MIN; kt <= ASI_MAX; kt += 10) {
      const a = (asiAngle(kt) - 90) * D2R, major = kt % 20 === 0;
      f.strokeStyle = COLORS.ink; f.lineWidth = major ? R * 0.025 : R * 0.015;
      f.beginPath();
      f.moveTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
      f.lineTo(Math.cos(a) * R * (major ? 0.72 : 0.77), Math.sin(a) * R * (major ? 0.72 : 0.77));
      f.stroke();
      if (major) label(f, String(kt), Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, R * 0.14);
    }
    label(f, 'AIRSPEED', 0, -R * 0.2, R * 0.085, COLORS.dim, 500);
    label(f, 'KNOTS', 0, R * 0.25, R * 0.085, COLORS.dim, 500);
  }), size);
  const R = size / 2;
  needle(c, asiAngle(r.airspeed) - 90, R * 0.8, R * 0.045);
  hub(c, R);
  glass(c, R);
}

// ───────────────────────── Horizonte artificial ─────────────────────────

export function drawAttitude(c: Ctx, size: number, dpr: number, r: InstrumentReadings) {
  const R = size / 2;
  const inner = R * 0.86;
  const pxPerDeg = (inner * 0.9) / 30;
  c.save();
  c.beginPath(); c.arc(0, 0, inner, 0, TAU); c.clip();
  c.rotate(-r.roll * Math.PI / 180);
  const y0 = r.pitch * pxPerDeg;
  c.fillStyle = COLORS.sky; c.fillRect(-R * 2, -R * 4 + y0, R * 4, R * 4);
  c.fillStyle = COLORS.ground; c.fillRect(-R * 2, y0, R * 4, R * 4);
  c.strokeStyle = '#fff'; c.lineWidth = R * 0.02;
  c.beginPath(); c.moveTo(-R * 2, y0); c.lineTo(R * 2, y0); c.stroke();
  // Escalera de cabeceo
  c.lineWidth = R * 0.012;
  for (let p = -30; p <= 30; p += 5) {
    if (p === 0) continue;
    const y = y0 - p * pxPerDeg, w = p % 10 === 0 ? R * 0.28 : R * 0.13;
    c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke();
    if (p % 10 === 0) {
      label(c, String(Math.abs(p)), -w - R * 0.1, y, R * 0.08, '#fff');
      label(c, String(Math.abs(p)), w + R * 0.1, y, R * 0.08, '#fff');
    }
  }
  // Escala de alabeo (gira con el horizonte) y su índice
  c.strokeStyle = '#fff'; c.lineWidth = R * 0.02;
  for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const a = (b - 90) * D2R, l = Math.abs(b) % 30 === 0 ? 0.12 : 0.07;
    c.beginPath();
    c.moveTo(Math.cos(a) * inner * 0.97, Math.sin(a) * inner * 0.97);
    c.lineTo(Math.cos(a) * inner * (0.97 - l), Math.sin(a) * inner * (0.97 - l));
    c.stroke();
  }
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(0, -inner * 0.97); c.lineTo(-R * 0.05, -inner * 0.85); c.lineTo(R * 0.05, -inner * 0.85); c.closePath(); c.fill();
  c.restore();

  // Indicador fijo del avión
  c.strokeStyle = COLORS.orange; c.fillStyle = COLORS.orange; c.lineWidth = R * 0.045; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-R * 0.48, 0); c.lineTo(-R * 0.16, 0); c.lineTo(-R * 0.08, R * 0.08); c.stroke();
  c.beginPath(); c.moveTo(R * 0.48, 0); c.lineTo(R * 0.16, 0); c.lineTo(R * 0.08, R * 0.08); c.stroke();
  c.beginPath(); c.arc(0, 0, R * 0.035, 0, TAU); c.fill();
  // Índice fijo de alabeo
  c.beginPath(); c.moveTo(0, -inner * 0.84); c.lineTo(-R * 0.05, -inner * 0.72); c.lineTo(R * 0.05, -inner * 0.72); c.closePath(); c.fill();
  c.lineCap = 'butt';

  // Bisel encima (anillo)
  blitFace(c, cachedFace('ai-ring', size, dpr, (f, RR) => {
    f.fillStyle = COLORS.bezel;
    f.beginPath(); f.arc(0, 0, RR, 0, TAU); f.arc(0, 0, RR * 0.86, 0, TAU, true); f.fill('evenodd');
    f.strokeStyle = COLORS.bezelEdge; f.lineWidth = RR * 0.02;
    f.beginPath(); f.arc(0, 0, RR * 0.86, 0, TAU); f.stroke();
  }), size);
  if (r.gyroHealth < 0.5) {
    c.fillStyle = '#d4342c';
    c.fillRect(-R * 0.22, R * 0.55, R * 0.44, R * 0.14);
    label(c, 'GYRO', 0, R * 0.62, R * 0.09, '#fff', 700);
  }
  glass(c, R);
}

// ───────────────────────── Altímetro ─────────────────────────

export function drawAltimeter(c: Ctx, size: number, dpr: number, r: InstrumentReadings) {
  blitFace(c, cachedFace('alt', size, dpr, (f, R) => {
    bezel(f, R);
    ticks(f, R * 0.84, -90, 270, 50, R * 0.06, R * 0.012);
    ticks(f, R * 0.84, -90, 270, 10, R * 0.12, R * 0.025);
    for (let i = 0; i < 10; i++) {
      const a = (i * 36 - 90) * D2R;
      label(f, String(i), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.17);
    }
    label(f, 'ALT', 0, -R * 0.3, R * 0.085, COLORS.dim, 500);
    label(f, '100 FEET', 0, -R * 0.19, R * 0.065, COLORS.dim, 500);
    // Ventanilla de Kollsman
    f.fillStyle = '#000';
    f.fillRect(R * 0.22, -R * 0.09, R * 0.42, R * 0.18);
    f.strokeStyle = '#444'; f.lineWidth = 1; f.strokeRect(R * 0.22, -R * 0.09, R * 0.42, R * 0.18);
  }), size);
  const R = size / 2;
  label(c, r.kollsman.toFixed(0), R * 0.43, 0, R * 0.12, COLORS.ink, 600);
  const alt = r.altitude;
  // Indicador de altitud baja (franja rayada) por debajo de 10 000 ft
  if (alt < 10000) {
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(-R * 0.12, R * 0.3, R * 0.24, R * 0.12 * (1 - Math.max(0, alt) / 10000));
  }
  needle(c, (alt / 100000) * 360 - 90, R * 0.78, R * 0.02, 0.05, '#cfd3d6');
  needle(c, ((alt % 10000) / 10000) * 360 - 90, R * 0.45, R * 0.07, 0.12);
  needle(c, ((alt % 1000) / 1000) * 360 - 90, R * 0.76, R * 0.045);
  hub(c, R);
  glass(c, R);
}

// ───────────────────────── Coordinador de virajes ─────────────────────────

export function drawTurnCoordinator(c: Ctx, size: number, dpr: number, r: InstrumentReadings) {
  blitFace(c, cachedFace('tc', size, dpr, (f, R) => {
    bezel(f, R);
    f.strokeStyle = COLORS.ink; f.lineWidth = R * 0.03;
    // Marcas de régimen estándar (3°/s = 20° de inclinación del símbolo) y de vuelo nivelado
    for (const a of [-20, 0, 20]) {
      for (const side of [-1, 1]) {
        const ang = (side < 0 ? 180 : 0) + a * side;
        const rad = ang * D2R;
        if (a === 0 && side > 0) continue;
        f.beginPath();
        f.moveTo(Math.cos(rad) * R * 0.82, Math.sin(rad) * R * 0.82);
        f.lineTo(Math.cos(rad) * R * 0.66, Math.sin(rad) * R * 0.66);
        f.stroke();
      }
    }
    f.beginPath(); f.moveTo(R * 0.82, 0); f.lineTo(R * 0.66, 0); f.stroke();
    label(f, 'L', -R * 0.6, R * 0.38, R * 0.13);
    label(f, 'R', R * 0.6, R * 0.38, R * 0.13);
    label(f, 'TURN COORDINATOR', 0, -R * 0.42, R * 0.075, COLORS.dim, 500);
    label(f, '2 MIN', 0, R * 0.7, R * 0.07, COLORS.dim, 500);
    // Tubo del inclinómetro
    f.strokeStyle = '#555'; f.lineWidth = R * 0.16; f.lineCap = 'round';
    f.beginPath(); f.arc(0, -R * 0.95, R * 1.45, (90 - 14) * D2R, (90 + 14) * D2R); f.stroke();
    f.strokeStyle = '#d8d0b8'; f.lineWidth = R * 0.13;
    f.beginPath(); f.arc(0, -R * 0.95, R * 1.45, (90 - 14) * D2R, (90 + 14) * D2R); f.stroke();
    f.lineCap = 'butt';
    f.strokeStyle = '#222'; f.lineWidth = R * 0.015;
    for (const dx of [-0.085, 0.085]) {
      f.beginPath(); f.moveTo(R * dx, R * 0.42); f.lineTo(R * dx, R * 0.58); f.stroke();
    }
  }), size);
  const R = size / 2;
  // Bola
  const ang = (90 - r.slip * 12) * D2R;
  c.fillStyle = '#0b0b0b';
  c.beginPath(); c.arc(Math.cos(ang) * R * 1.45, -R * 0.95 + Math.sin(ang) * R * 1.45, R * 0.06, 0, TAU); c.fill();
  // Avioncito: 3°/s ↔ 20°
  const bank = Math.max(-35, Math.min(35, (r.turnRate / 3) * 20));
  c.save(); c.rotate(bank * D2R);
  c.strokeStyle = COLORS.ink; c.fillStyle = COLORS.ink; c.lineWidth = R * 0.05; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-R * 0.62, 0); c.lineTo(R * 0.62, 0); c.stroke();
  c.beginPath(); c.arc(0, 0, R * 0.09, 0, TAU); c.fill();
  c.lineWidth = R * 0.035;
  c.beginPath(); c.moveTo(0, -R * 0.09); c.lineTo(0, -R * 0.2); c.stroke();
  c.beginPath(); c.moveTo(-R * 0.16, R * 0.11); c.lineTo(R * 0.16, R * 0.11); c.stroke();
  c.lineCap = 'butt';
  c.restore();
  glass(c, R);
}

// ───────────────────────── Indicador de rumbo ─────────────────────────

export function drawHeading(c: Ctx, size: number, dpr: number, r: InstrumentReadings, bug: number | null = null) {
  const R = size / 2;
  blitFace(c, cachedFace('hi-bezel', size, dpr, (f, RR) => bezel(f, RR)), size);
  const card = cachedFace('hi-card', size, dpr, (f, RR) => {
    ticks(f, RR * 0.84, 0, 360, 72, RR * 0.06, RR * 0.012);
    ticks(f, RR * 0.84, 0, 360, 36, RR * 0.11, RR * 0.022);
    const names: Record<number, string> = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
    for (let i = 0; i < 36; i += 3) {
      const a = (i * 10 - 90) * D2R;
      f.save();
      f.translate(Math.cos(a) * RR * 0.6, Math.sin(a) * RR * 0.6);
      f.rotate(a + Math.PI / 2);
      label(f, names[i] ?? String(i), 0, 0, RR * (names[i] ? 0.17 : 0.14), names[i] ? COLORS.orange : COLORS.ink);
      f.restore();
    }
  });
  c.save(); c.rotate(-r.heading * D2R); blitFace(c, card, size);
  if (bug !== null) {
    c.rotate(bug * D2R);
    c.fillStyle = COLORS.orange;
    c.fillRect(-R * 0.07, -R * 0.86, R * 0.14, R * 0.07);
  }
  c.restore();
  // Línea de fe y avión fijo
  c.fillStyle = COLORS.orange;
  c.beginPath(); c.moveTo(0, -R * 0.7); c.lineTo(-R * 0.05, -R * 0.84); c.lineTo(R * 0.05, -R * 0.84); c.closePath(); c.fill();
  c.strokeStyle = COLORS.orange; c.lineWidth = R * 0.04; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, -R * 0.3); c.lineTo(0, R * 0.3); c.stroke();
  c.beginPath(); c.moveTo(-R * 0.3, -R * 0.05); c.lineTo(R * 0.3, -R * 0.05); c.stroke();
  c.beginPath(); c.moveTo(-R * 0.12, R * 0.24); c.lineTo(R * 0.12, R * 0.24); c.stroke();
  c.lineCap = 'butt';
  for (const a of [45, 135, 225, 315]) {
    const rad = (a - 90) * D2R;
    c.strokeStyle = COLORS.ink; c.lineWidth = R * 0.02;
    c.beginPath(); c.moveTo(Math.cos(rad) * R * 0.86, Math.sin(rad) * R * 0.86); c.lineTo(Math.cos(rad) * R * 0.95, Math.sin(rad) * R * 0.95); c.stroke();
  }
  glass(c, R);
}

// ───────────────────────── Variómetro ─────────────────────────

const VSI_MAX = 2000;
const vsiAngle = (fpm: number) => 180 + (Math.max(-VSI_MAX * 1.04, Math.min(VSI_MAX * 1.04, fpm)) / VSI_MAX) * 168;

export function drawVsi(c: Ctx, size: number, dpr: number, r: InstrumentReadings) {
  blitFace(c, cachedFace('vsi', size, dpr, (f, R) => {
    bezel(f, R);
    for (let v = -VSI_MAX; v <= VSI_MAX; v += 100) {
      const a = vsiAngle(v) * D2R, major = v % 500 === 0;
      f.strokeStyle = COLORS.ink; f.lineWidth = major ? R * 0.025 : R * 0.012;
      f.beginPath();
      f.moveTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
      f.lineTo(Math.cos(a) * R * (major ? 0.72 : 0.78), Math.sin(a) * R * (major ? 0.72 : 0.78));
      f.stroke();
      if (major && v !== 0) label(f, String(Math.abs(v) / 100), Math.cos(a) * R * 0.58, Math.sin(a) * R * 0.58, R * 0.15);
    }
    label(f, '0', -R * 0.58, 0, R * 0.15);
    label(f, 'UP', -R * 0.25, -R * 0.28, R * 0.09, COLORS.dim, 500);
    label(f, 'DOWN', -R * 0.25, R * 0.28, R * 0.09, COLORS.dim, 500);
    label(f, 'VERTICAL SPEED', R * 0.12, -R * 0.06, R * 0.065, COLORS.dim, 500);
    label(f, '100 FT/MIN', R * 0.12, R * 0.06, R * 0.065, COLORS.dim, 500);
  }), size);
  const R = size / 2;
  needle(c, vsiAngle(r.verticalSpeed), R * 0.8, R * 0.045);
  hub(c, R);
  glass(c, R);
}

// ───────────────────────── Tacómetro (extra) ─────────────────────────

const RPM_MAX = 3500;
const tachAngle = (rpm: number) => -120 + (Math.max(0, Math.min(rpm, RPM_MAX)) / RPM_MAX) * 240;

export function drawTachometer(c: Ctx, size: number, dpr: number, rpm: number, greenFrom: number, redline: number, engines = 1, rpm2 = 0) {
  blitFace(c, cachedFace(`tach${greenFrom}${redline}`, size, dpr, (f, R) => {
    bezel(f, R);
    f.strokeStyle = '#2fbf4a'; f.lineWidth = R * 0.07;
    f.beginPath(); f.arc(0, 0, R * 0.76, (tachAngle(greenFrom) - 90) * D2R, (tachAngle(redline) - 90) * D2R); f.stroke();
    f.save(); f.rotate((tachAngle(redline) - 90) * D2R);
    f.strokeStyle = '#e8352b'; f.lineWidth = R * 0.04;
    f.beginPath(); f.moveTo(R * 0.62, 0); f.lineTo(R * 0.84, 0); f.stroke(); f.restore();
    for (let v = 0; v <= RPM_MAX; v += 100) {
      const a = (tachAngle(v) - 90) * D2R, major = v % 500 === 0;
      f.strokeStyle = COLORS.ink; f.lineWidth = major ? R * 0.025 : R * 0.012;
      f.beginPath();
      f.moveTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
      f.lineTo(Math.cos(a) * R * (major ? 0.7 : 0.77), Math.sin(a) * R * (major ? 0.7 : 0.77));
      f.stroke();
      if (major) label(f, String(v / 100), Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, R * 0.14);
    }
    label(f, 'RPM', 0, R * 0.3, R * 0.1, COLORS.dim, 500);
    label(f, 'x100', 0, R * 0.45, R * 0.08, COLORS.dim, 500);
  }), size);
  const R = size / 2;
  if (engines > 1) needle(c, tachAngle(rpm2) - 90, R * 0.72, R * 0.04, 0.15, '#ffb547');
  needle(c, tachAngle(rpm) - 90, R * 0.8, R * 0.045);
  hub(c, R);
  glass(c, R);
}
