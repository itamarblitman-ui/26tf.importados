import type { Mat3, Vec3 } from './math/vec3';

/** Elipsoide WGS84. */
const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const B = A * (1 - F);
const EP2 = (A * A - B * B) / (B * B);

export interface Geodetic {
  /** Latitud en radianes. */
  lat: number;
  /** Longitud en radianes. */
  lon: number;
  /** Altura elipsoidal en metros. */
  h: number;
}

export function geodeticToEcef(g: Geodetic): Vec3 {
  const sl = Math.sin(g.lat), cl = Math.cos(g.lat);
  const n = A / Math.sqrt(1 - E2 * sl * sl);
  return [(n + g.h) * cl * Math.cos(g.lon), (n + g.h) * cl * Math.sin(g.lon), (n * (1 - E2) + g.h) * sl];
}

/** Conversión ECEF → geodésica (método de Bowring, precisión sub-milimétrica en altitudes aeronáuticas). */
export function ecefToGeodetic(p: Vec3): Geodetic {
  const [x, y, z] = p;
  const r = Math.hypot(x, y);
  const th = Math.atan2(z * A, r * B);
  const st = Math.sin(th), ct = Math.cos(th);
  const lat = Math.atan2(z + EP2 * B * st * st * st, r - E2 * A * ct * ct * ct);
  const lon = Math.atan2(y, x);
  const sl = Math.sin(lat);
  const n = A / Math.sqrt(1 - E2 * sl * sl);
  const h = Math.abs(Math.cos(lat)) > 1e-9 ? r / Math.cos(lat) - n : Math.abs(z) - B;
  return { lat, lon, h };
}

/**
 * Matriz de rotación NED→ECEF en un punto (fila-mayor). Sus columnas son
 * los vectores norte, este y abajo expresados en ECEF.
 */
export function nedToEcefMatrix(lat: number, lon: number): Mat3 {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return [
    -sl * co, -so, -cl * co,
    -sl * so, co, -cl * so,
    cl, 0, -sl,
  ];
}

/**
 * Marco cartesiano local "NED de origen": ejes norte/este/abajo tangentes en un punto fijo.
 * La física integra en este marco (no hay distorsión: es una rotación + traslación de ECEF).
 * La gravedad se calcula con la vertical local real, así que la curvatura terrestre se respeta.
 */
export class LocalFrame {
  readonly origin: Geodetic;
  readonly originEcef: Vec3;
  /** NED(origen) → ECEF */
  readonly rot: Mat3;

  constructor(origin: Geodetic) {
    this.origin = { ...origin };
    this.originEcef = geodeticToEcef(origin);
    this.rot = nedToEcefMatrix(origin.lat, origin.lon);
  }

  toEcef(p: Vec3): Vec3 {
    const m = this.rot;
    return [
      this.originEcef[0] + m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
      this.originEcef[1] + m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
      this.originEcef[2] + m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
    ];
  }

  fromEcef(e: Vec3): Vec3 {
    const m = this.rot;
    const d: Vec3 = [e[0] - this.originEcef[0], e[1] - this.originEcef[1], e[2] - this.originEcef[2]];
    return [
      m[0] * d[0] + m[3] * d[1] + m[6] * d[2],
      m[1] * d[0] + m[4] * d[1] + m[7] * d[2],
      m[2] * d[0] + m[5] * d[1] + m[8] * d[2],
    ];
  }

  /** Vector ECEF (dirección) → marco local. */
  dirFromEcef(v: Vec3): Vec3 {
    const m = this.rot;
    return [
      m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
      m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
      m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ];
  }

  dirToEcef(v: Vec3): Vec3 {
    const m = this.rot;
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }

  toGeodetic(p: Vec3): Geodetic {
    return ecefToGeodetic(this.toEcef(p));
  }

  fromGeodetic(g: Geodetic): Vec3 {
    return this.fromEcef(geodeticToEcef(g));
  }

  /**
   * Rotación (fila-mayor) que lleva vectores del marco de origen al NED local
   * en la posición geodésica dada.
   */
  originToLocalNed(lat: number, lon: number): Mat3 {
    const l = nedToEcefMatrix(lat, lon);
    const o = this.rot;
    // R = L^T * O
    const r = new Array(9).fill(0) as Mat3;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) r[i * 3 + j] = l[i] * o[j] + l[3 + i] * o[3 + j] + l[6 + i] * o[6 + j];
    return r;
  }
}

/** Gravedad normal (fórmula de Somigliana con corrección por altura), m/s². */
export function gravity(lat: number, h: number): number {
  const s2 = Math.sin(lat) ** 2;
  const g0 = (9.7803253359 * (1 + 0.00193185265241 * s2)) / Math.sqrt(1 - 0.00669437999013 * s2);
  return g0 * (1 - (2 * h) / A);
}

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

/** Distancia ortodrómica aproximada (haversine, esfera media) en metros. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const dLat = lat2 - lat1, dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rumbo inicial verdadero de 1 a 2 (radianes, 0 = norte). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return Math.atan2(y, x);
}
