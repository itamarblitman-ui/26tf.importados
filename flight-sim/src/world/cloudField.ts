import { rng } from '../physics/Wind';

/** Cobertura de nubes en octas, al estilo METAR. */
export type CloudCover = 'clear' | 'few' | 'scattered' | 'broken' | 'overcast';

export const COVER_LABEL: Record<CloudCover, string> = {
  clear: 'Despejado', few: 'Pocas (1-2/8)', scattered: 'Dispersas (3-4/8)', broken: 'Fragmentadas (5-7/8)', overcast: 'Cubierto (8/8)',
};

const COVER_PARAMS: Record<CloudCover, { prob: number; perCell: number; size: [number, number] }> = {
  clear: { prob: 0, perCell: 0, size: [0, 0] },
  few: { prob: 0.18, perCell: 1, size: [500, 1100] },
  scattered: { prob: 0.45, perCell: 2, size: [700, 1500] },
  broken: { prob: 0.8, perCell: 3, size: [900, 1900] },
  overcast: { prob: 1, perCell: 4, size: [1300, 2400] },
};

/** Tamaño de celda de la grilla global de nubes (grados de latitud ≈ 2 km). */
export const CELL_DEG = 0.018;

export interface CloudSpec {
  lat: number;
  lon: number;
  /** m sobre la base de la capa */
  heightOffset: number;
  /** ancho y alto (m) */
  width: number;
  height: number;
  seed: number;
}

const cellLonDeg = (i: number) => CELL_DEG / Math.max(Math.cos((i + 0.5) * CELL_DEG * Math.PI / 180), 0.1);
export const cellOf = (lat: number, lon: number): [number, number] => {
  const i = Math.floor(lat / CELL_DEG);
  return [i, Math.floor(lon / cellLonDeg(i))];
};

/** Hash entero estable de una celda. */
const hash = (i: number, j: number, seed: number) => {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * Nubes de una celda. Determinista: la misma celda siempre genera las mismas nubes, así el cielo
 * no "salta" al moverse y la grilla se puede regenerar libremente alrededor del avión.
 */
export function cloudsForCell(i: number, j: number, cover: CloudCover, seed = 1): CloudSpec[] {
  const p = COVER_PARAMS[cover];
  if (p.perCell === 0) return [];
  const r = rng(hash(i, j, seed));
  const out: CloudSpec[] = [];
  const dLon = cellLonDeg(i);
  for (let k = 0; k < p.perCell; k++) {
    if (r() > p.prob) continue;
    const w = p.size[0] + r() * (p.size[1] - p.size[0]);
    out.push({
      lat: (i + r()) * CELL_DEG,
      lon: (j + r()) * dLon,
      heightOffset: r() * 250,
      width: w,
      height: w * (0.35 + r() * 0.25),
      seed: r(),
    });
  }
  return out;
}

/** Nubes de todas las celdas dentro de `radiusCells` alrededor de una posición. */
export function cloudsAround(lat: number, lon: number, cover: CloudCover, radiusCells: number, seed = 1): CloudSpec[] {
  const [ci] = cellOf(lat, lon);
  const out: CloudSpec[] = [];
  for (let di = -radiusCells; di <= radiusCells; di++) {
    const i = ci + di;
    // Recalculamos la columna en esta fila (el ancho en longitud cambia con la latitud).
    const [, cjRow] = cellOf(i * CELL_DEG + CELL_DEG / 2, lon);
    for (let dj = -radiusCells; dj <= radiusCells; dj++) {
      if (di * di + dj * dj > radiusCells * radiusCells) continue;
      out.push(...cloudsForCell(i, cjRow + dj, cover, seed));
    }
  }
  return out;
}

/** Espesor típico (m) de la capa según cobertura. */
export const layerThickness = (cover: CloudCover) =>
  cover === 'overcast' ? 600 : cover === 'broken' ? 450 : cover === 'scattered' ? 350 : 250;
