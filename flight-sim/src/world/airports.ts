import { bearing, deg2rad, distanceMeters, rad2deg } from '../physics/geodesy';

export const FT = 0.3048;

export interface RunwayEnd {
  ident: string;
  lat: number;
  lon: number;
  /** Elevación MSL (m), puede faltar */
  elevation: number | null;
  /** Umbral desplazado (m) */
  displaced: number;
  /** Rumbo verdadero de despegue desde este extremo (grados) */
  heading: number;
}

export interface Runway {
  le: RunwayEnd;
  he: RunwayEnd;
  /** m */
  length: number;
  width: number;
  surface: 'hard' | 'soft' | 'water';
}

export interface Airport {
  ident: string;
  name: string;
  type: 'small' | 'medium' | 'large';
  lat: number;
  lon: number;
  /** m MSL */
  elevation: number;
  country: string;
  municipality: string;
  iata: string;
  runways: Runway[];
}

type RawRunway = [string, number, number, number | null, string, number, number, number | null, number, number, number, number, number];
type RawAirport = [string, string, number, number, number, number, string, string, string, RawRunway[]];

let cache: Promise<Airport[]> | null = null;

/** Carga (una sola vez) la base de aeropuertos generada desde OurAirports. */
export function loadAirports(): Promise<Airport[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/airports.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar la base de aeropuertos (HTTP ${r.status})`);
      return r.json() as Promise<{ airports: RawAirport[] }>;
    })
    .then((d) => d.airports.map(parseAirport));
  return cache;
}

function parseAirport(a: RawAirport): Airport {
  return {
    ident: a[0], name: a[1], type: (['small', 'medium', 'large'] as const)[a[2]] ?? 'small',
    lat: a[3], lon: a[4], elevation: a[5] * FT, country: a[6], municipality: a[7], iata: a[8],
    runways: a[9].map(parseRunway),
  };
}

function parseRunway(r: RawRunway): Runway {
  const [leI, leLat, leLon, leEl, heI, heLat, heLon, heEl, lenFt, widFt, surf, leD, heD] = r;
  const hdgLe = (rad2deg(bearing(deg2rad(leLat), deg2rad(leLon), deg2rad(heLat), deg2rad(heLon))) + 360) % 360;
  const geomLength = distanceMeters(deg2rad(leLat), deg2rad(leLon), deg2rad(heLat), deg2rad(heLon));
  return {
    le: { ident: leI, lat: leLat, lon: leLon, elevation: leEl === null ? null : leEl * FT, displaced: leD * FT, heading: hdgLe },
    he: { ident: heI, lat: heLat, lon: heLon, elevation: heEl === null ? null : heEl * FT, displaced: heD * FT, heading: (hdgLe + 180) % 360 },
    length: geomLength > 0 ? geomLength : lenFt * FT,
    width: Math.max(widFt * FT, 10) || 30,
    surface: surf === 0 ? 'hard' : surf === 2 ? 'water' : 'soft',
  };
}

export function findAirport(list: Airport[], ident: string): Airport | undefined {
  const q = ident.trim().toUpperCase();
  return list.find((a) => a.ident === q || a.iata === q);
}

/** Aeropuertos dentro de un radio (m), ordenados por distancia. */
export function airportsNear(list: Airport[], lat: number, lon: number, radius: number): Airport[] {
  const dLat = radius / 111_000;
  const dLon = dLat / Math.max(Math.cos(deg2rad(lat)), 0.05);
  return list
    .filter((a) => Math.abs(a.lat - lat) < dLat && Math.abs(a.lon - lon) < dLon)
    .map((a) => ({ a, d: distanceMeters(deg2rad(lat), deg2rad(lon), deg2rad(a.lat), deg2rad(a.lon)) }))
    .filter((x) => x.d <= radius)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.a);
}

/** Punto de alineación en una cabecera: sobre el eje, pasando el umbral desplazado. */
export function lineUpPoint(rw: Runway, end: 'le' | 'he', offset = 25) {
  const from = rw[end], to = end === 'le' ? rw.he : rw.le;
  const along = from.displaced + offset;
  const k = Math.min(along / rw.length, 0.5);
  return {
    lat: from.lat + (to.lat - from.lat) * k,
    lon: from.lon + (to.lon - from.lon) * k,
    heading: from.heading,
  };
}

/** Pista más larga con superficie dura (o la más larga si no hay) del aeropuerto. */
export function mainRunway(a: Airport): Runway {
  return [...a.runways].sort((x, y) => (x.surface === 'hard' ? 0 : 1) - (y.surface === 'hard' ? 0 : 1) || y.length - x.length)[0];
}
