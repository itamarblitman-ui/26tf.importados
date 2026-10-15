/**
 * Descarga la base de OurAirports (dominio público) y genera public/data/airports.json compacto.
 * Uso: npm run build:airports   (o pasar rutas locales: tsx scripts/build-airports.ts airports.csv runways.csv)
 *
 * Formato de salida:
 * { "fields": {...}, "airports": [[ident, nombre, tipo, lat, lon, elevFt, país, ciudad, iata, pistas[]], ...] }
 * pista: [leIdent, leLat, leLon, leElevFt, heIdent, heLat, heLon, heElevFt, largoFt, anchoFt, superficie, leDesplazFt, heDesplazFt]
 * tipo: 0 = pequeño, 1 = mediano, 2 = grande. superficie: 0 = dura, 1 = blanda, 2 = agua.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';
const OUT = resolve(import.meta.dirname, '../public/data/airports.json');

async function load(pathOrName: string | undefined, name: string): Promise<string> {
  if (pathOrName && existsSync(pathOrName)) return readFileSync(pathOrName, 'utf8');
  console.log(`Descargando ${name}…`);
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`No se pudo descargar ${name}: HTTP ${res.status}`);
  return res.text();
}

/** Parser CSV mínimo con soporte de comillas (RFC 4180). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const HARD = /^(asp|asph|asphalt|con|conc|concrete|pem|bit|tarmac|paved|pav|hard|cop|bitumen|macadam|pcc|ac)/i;
const WATER = /^(wat|water)/i;
const surfaceCode = (s: string) => (WATER.test(s) ? 2 : HARD.test(s) ? 0 : 1);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

async function main() {
  const [aCsv, rCsv] = await Promise.all([load(process.argv[2], 'airports.csv'), load(process.argv[3], 'runways.csv')]);
  const airports = parseCsv(aCsv);
  const runways = parseCsv(rCsv);
  const byAirport = new Map<string, unknown[][]>();
  for (const r of runways) {
    if (r.closed === '1') continue;
    const le = [+r.le_latitude_deg, +r.le_longitude_deg], he = [+r.he_latitude_deg, +r.he_longitude_deg];
    if (!r.le_latitude_deg || !r.he_latitude_deg || [...le, ...he].some((v) => !Number.isFinite(v))) continue;
    const list = byAirport.get(r.airport_ident) ?? [];
    list.push([
      r.le_ident, r6(le[0]), r6(le[1]), r.le_elevation_ft ? +r.le_elevation_ft : null,
      r.he_ident, r6(he[0]), r6(he[1]), r.he_elevation_ft ? +r.he_elevation_ft : null,
      +r.length_ft || 0, +r.width_ft || 0, surfaceCode(r.surface),
      +r.le_displaced_threshold_ft || 0, +r.he_displaced_threshold_ft || 0,
    ]);
    byAirport.set(r.airport_ident, list);
  }
  const typeCode: Record<string, number> = { small_airport: 0, medium_airport: 1, large_airport: 2 };
  const out: unknown[] = [];
  for (const a of airports) {
    if (!(a.type in typeCode)) continue;
    const rws = byAirport.get(a.ident);
    if (!rws?.length) continue;
    out.push([
      a.ident, a.name, typeCode[a.type], r6(+a.latitude_deg), r6(+a.longitude_deg),
      a.elevation_ft ? +a.elevation_ft : 0, a.iso_country, a.municipality, a.iata_code, rws,
    ]);
  }
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: 'OurAirports (https://ourairports.com/data/) — dominio público',
    fields: {
      airport: ['ident', 'name', 'type', 'lat', 'lon', 'elevationFt', 'country', 'municipality', 'iata', 'runways'],
      runway: ['leIdent', 'leLat', 'leLon', 'leElevFt', 'heIdent', 'heLat', 'heLon', 'heElevFt', 'lengthFt', 'widthFt', 'surface', 'leDisplacedFt', 'heDisplacedFt'],
    },
    airports: out,
  }));
  console.log(`✔ ${out.length} aeropuertos con pistas georreferenciadas → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
