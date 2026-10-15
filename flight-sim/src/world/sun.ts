/**
 * Posición del sol (aproximación de la NOAA, error < 0,1° para uso visual), sin depender de Cesium.
 */
const D2R = Math.PI / 180;

/** Elevación del sol sobre el horizonte (grados) para una fecha y posición (grados). */
export function solarElevation(date: Date, latDeg: number, lonDeg: number): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  // Tiempo sidéreo de Greenwich (grados)
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const ha = (gmst + lonDeg) * D2R - ra;
  const lat = latDeg * D2R;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / D2R;
}

/** Fecha (UTC) correspondiente a una hora solar local en una longitud, para el día de `base`. */
export function dateForLocalSolarHour(hour: number, lonDeg: number, base = new Date()): Date {
  const midnightUtc = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  return new Date(midnightUtc + (hour - lonDeg / 15) * 3600_000);
}

/** Hora solar local (0-24) de una fecha en una longitud. */
export function localSolarHour(date: Date, lonDeg: number): number {
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + lonDeg / 15;
  return ((h % 24) + 24) % 24;
}
