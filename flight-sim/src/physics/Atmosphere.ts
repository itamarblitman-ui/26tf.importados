import type { Vec3 } from './math/vec3';

/** Constantes de la atmósfera estándar internacional (ISA). */
export const ISA = {
  T0: 288.15, // K
  P0: 101325, // Pa
  RHO0: 1.225, // kg/m³
  L: 0.0065, // K/m (troposfera)
  R: 287.05287, // J/(kg·K)
  G0: 9.80665,
  GAMMA: 1.4,
  TROPOPAUSE: 11000,
} as const;

export interface AirState {
  /** Temperatura K */
  temperature: number;
  /** Presión estática Pa */
  pressure: number;
  /** Densidad kg/m³ */
  density: number;
  /** Velocidad del sonido m/s */
  speedOfSound: number;
}

/**
 * Atmósfera ISA hasta 20 km con desvío de temperatura opcional (ISA+ΔT).
 * @param altitude altitud geopotencial sobre el nivel del mar (m)
 * @param deltaT desvío respecto de ISA (K)
 */
export function isaAtmosphere(altitude: number, deltaT = 0): AirState {
  const { T0, P0, L, R, G0, GAMMA, TROPOPAUSE } = ISA;
  const h = Math.min(Math.max(altitude, -1000), 20000);
  let tStd: number, p: number;
  if (h <= TROPOPAUSE) {
    tStd = T0 - L * h;
    p = P0 * Math.pow(tStd / T0, G0 / (L * R));
  } else {
    const t11 = T0 - L * TROPOPAUSE;
    const p11 = P0 * Math.pow(t11 / T0, G0 / (L * R));
    tStd = t11;
    p = p11 * Math.exp((-G0 * (h - TROPOPAUSE)) / (R * t11));
  }
  const temperature = tStd + deltaT;
  const density = p / (R * temperature);
  return { temperature, pressure: p, density, speedOfSound: Math.sqrt(GAMMA * R * temperature) };
}

/** Altitud de presión (m) que correspondería a una presión dada en ISA. */
export function pressureAltitude(pressure: number): number {
  const { T0, P0, L, R, G0 } = ISA;
  return (T0 / L) * (1 - Math.pow(pressure / P0, (L * R) / G0));
}

/** Configuración del viento (marco NED local, m/s). Las ráfagas se modelan en Weather. */
export interface WindSample {
  /** Viento (hacia donde sopla) en NED local, m/s. */
  velocity: Vec3;
}

export const CALM: WindSample = { velocity: [0, 0, 0] };
