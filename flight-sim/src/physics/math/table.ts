/** Tabla 1D [x, y][] con interpolación lineal y extremos saturados. x debe ser creciente. */
export type Table1D = ReadonlyArray<readonly [number, number]>;

export function lookup(table: Table1D, x: number): number {
  const n = table.length;
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[n - 1][0]) return table[n - 1][1];
  // Búsqueda binaria: las tablas son chicas pero esto se llama muchas veces por paso.
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][0] <= x) lo = mid; else hi = mid;
  }
  const [x0, y0] = table[lo], [x1, y1] = table[hi];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Mueve `current` hacia `target` a velocidad máxima `rate` (unidades/s). */
export const approach = (current: number, target: number, rate: number, dt: number): number => {
  const d = target - current, m = rate * dt;
  return d > m ? current + m : d < -m ? current - m : target;
};
export const DEG = Math.PI / 180;
