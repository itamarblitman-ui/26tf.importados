import type { AircraftConfig } from './AircraftConfig';
import { clamp, DEG, lookup } from './math/table';
import type { Vec3 } from './math/vec3';

export interface AeroInput {
  /** Velocidad aerodinámica en ejes cuerpo (avión respecto del aire), m/s. */
  vAir: Vec3;
  /** Velocidad angular en ejes cuerpo [p, q, r], rad/s. */
  omega: Vec3;
  /** Densidad kg/m³ */
  rho: number;
  /** Superficies (posición real, no comando), -1..1 */
  elevator: number;
  aileron: number;
  rudder: number;
  trim: number;
  /** Deflexión de flaps (grados) */
  flapDeg: number;
  /** 0 = arriba, 1 = abajo (sólo importa si el tren es retráctil) */
  gearDown: number;
  /** Incremento de presión dinámica sobre la cola por la hélice, Pa */
  propwashQ: number;
  /** Altura de las alas sobre el suelo (m) para efecto suelo. Infinity si no aplica. */
  heightAboveGround: number;
  /** dα/dt (rad/s) */
  alphaDot: number;
}

export interface AeroOutput {
  force: Vec3;
  moment: Vec3;
  alpha: number;
  beta: number;
  airspeed: number;
  qbar: number;
  cl: number;
  cd: number;
  stalled: boolean;
  /** 0..1, qué tan adentro de la pérdida está el ala */
  stallFraction: number;
}

const FLAT_PLATE_CL = 1.1;
const FLAT_PLATE_CD = 1.28;

/** Coeficiente de sustentación (ala completa) para un α dado (rad) y flaps. */
export function liftCoefficient(cfg: AircraftConfig, alpha: number, flapFraction: number): number {
  const a = alpha / DEG;
  const t = cfg.aero.clAlpha;
  const lo = t[0][0], hi = t[t.length - 1][0];
  let cl: number;
  if (a >= lo && a <= hi) cl = lookup(t, a);
  else cl = FLAT_PLATE_CL * Math.sin(2 * alpha);
  // Los flaps suman sustentación mientras el flujo está adherido; se desvanece en pérdida profunda.
  const fade = clamp(1 - (Math.abs(a) - cfg.aero.stallAlphaDeg) / 10, 0, 1);
  return cl + cfg.flaps.deltaCl * flapFraction * (a > -10 ? fade : 0);
}

/** Coeficiente de resistencia total. */
export function dragCoefficient(
  cfg: AircraftConfig, alpha: number, cl: number, flapFraction: number, gearDown: number, inducedFactor = 1,
): number {
  const a = Math.abs(alpha / DEG);
  const t = cfg.aero.cdSeparation;
  const ar = (cfg.geometry.span * cfg.geometry.span) / cfg.geometry.wingArea;
  const k = 1 / (Math.PI * cfg.geometry.oswald * ar);
  const extras = cfg.flaps.deltaCd * flapFraction + (cfg.gear.retractable ? cfg.gear.deltaCd * gearDown : 0);
  if (a <= t[t.length - 1][0]) {
    return cfg.aero.cd0 + extras + k * cl * cl * inducedFactor + lookup(t, a);
  }
  const s = Math.sin(alpha);
  return cfg.aero.cd0 + extras + FLAT_PLATE_CD * s * s;
}

/** Calcula fuerzas y momentos aerodinámicos en ejes cuerpo (respecto del CG). */
export function computeAero(cfg: AircraftConfig, input: AeroInput): AeroOutput {
  const [u, v, w] = input.vAir;
  const V = Math.hypot(u, v, w);
  const { wingArea: S, span: b, chord: c } = cfg.geometry;
  const A = cfg.aero;
  const zero: AeroOutput = {
    force: [0, 0, 0], moment: [0, 0, 0], alpha: 0, beta: 0, airspeed: V, qbar: 0, cl: 0, cd: 0,
    stalled: false, stallFraction: 0,
  };
  const qbar = 0.5 * input.rho * V * V;

  // Aun sin viento relativo, el soplado de la hélice actúa sobre la cola (permite rotar y doblar en tierra).
  const tailQ = input.propwashQ;

  if (V < 0.5) {
    const m: Vec3 = [
      0,
      tailQ * S * c * (A.cmElevator * input.elevator + A.cmTrim * input.trim),
      tailQ * S * b * A.cnRudder * input.rudder,
    ];
    return { ...zero, moment: m };
  }

  const alpha = Math.atan2(w, u);
  const beta = Math.asin(clamp(v / V, -1, 1));
  const flapFraction = cfg.flaps.maxDeg > 0 ? clamp(input.flapDeg / cfg.flaps.maxDeg, 0, 1) : 0;

  const stallDeg = A.stallAlphaDeg;
  const aDeg = Math.abs(alpha / DEG);
  const stallFraction = clamp((aDeg - stallDeg) / 6, 0, 1);
  const stalled = aDeg > stallDeg && aDeg < 165;

  // Velocidad mínima para los términos de amortiguamiento (evita singularidades a baja velocidad).
  const Vd = Math.max(V, 5);
  const [p, q, r] = input.omega;
  const pHat = (p * b) / (2 * Vd), qHat = (q * c) / (2 * Vd), rHat = (r * b) / (2 * Vd);
  const aDotHat = (input.alphaDot * c) / (2 * Vd);

  // Efecto suelo (McCormick): reduce la resistencia inducida cerca del suelo.
  const hb = (16 * Math.max(input.heightAboveGround, 0)) / b;
  const groundFactor = Number.isFinite(hb) ? (hb * hb) / (1 + hb * hb) : 1;

  // Relación entre la presión dinámica total en la cola y la libre: amplifica controles de cola.
  const tailRatio = (qbar + tailQ) / Math.max(qbar, 1e-3);

  let cl = liftCoefficient(cfg, alpha, flapFraction);
  cl += A.clQ * qHat + A.clElevator * input.elevator;
  const cd = dragCoefficient(cfg, alpha, cl, flapFraction, input.gearDown, groundFactor);
  const cy = A.cyBeta * beta + A.cyRudder * input.rudder * Math.min(tailRatio, 4);

  // Momentos. α saturado para el término lineal de estabilidad estática.
  const aSat = clamp(alpha, -45 * DEG, 45 * DEG);
  const cm =
    A.cm0 + A.cmAlpha * aSat + A.cmQ * qHat + A.cmAlphaDot * aDotHat + A.cmFlaps * flapFraction -
    (A.cmStallBreak ?? 0.12) * stallFraction * Math.sign(alpha) +
    (A.cmElevator * input.elevator + A.cmTrim * input.trim) * tailRatio;

  // En pérdida el amortiguamiento de alabeo se degrada (autorrotación) y cae el ala más lenta.
  const clp = A.clP * (1 - 0.8 * stallFraction);
  const wingDrop = 0.02 * stallFraction * Math.tanh(r * 4);
  const cRoll = (A.cl0 ?? 0) + A.clBeta * beta + clp * pHat + A.clR * rHat + A.clAileron * input.aileron * (1 - 0.5 * stallFraction) +
    A.clRudder * input.rudder + wingDrop;
  const cn = (A.cn0 ?? 0) + A.cnBeta * beta + A.cnP * pHat + A.cnR * rHat + A.cnAileron * input.aileron +
    A.cnRudder * input.rudder * tailRatio;

  // Fuerzas: sustentación ⟂ al viento relativo en el plano x-z; resistencia opuesta al viento relativo.
  const L = qbar * S * cl, D = qbar * S * cd, Y = qbar * S * cy;
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const inv = 1 / V;
  const force: Vec3 = [
    -D * u * inv + L * sa,
    -D * v * inv + Y,
    -D * w * inv - L * ca,
  ];
  const moment: Vec3 = [qbar * S * b * cRoll, qbar * S * c * cm, qbar * S * b * cn];

  return { force, moment, alpha, beta, airspeed: V, qbar, cl, cd, stalled, stallFraction };
}
