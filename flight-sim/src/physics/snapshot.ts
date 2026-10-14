/**
 * Estado que la física publica en cada tick. Se transfiere al hilo de render como Float64Array
 * (sin copias de objetos ni JSON). El orden de FIELDS define el layout binario.
 */
export const FIELDS = [
  'time',
  // Posición
  'lat', 'lon', 'height', 'altMsl', 'agl',
  // Actitud respecto del NED local (rad) y cuaternión cuerpo→NED local
  'heading', 'pitch', 'roll', 'qw', 'qx', 'qy', 'qz',
  // Velocidades
  'vN', 'vE', 'vD', 'p', 'q', 'r', 'turnRate',
  'ias', 'tas', 'groundSpeed', 'mach', 'alpha', 'beta',
  // Aceleraciones específicas en cuerpo (G)
  'nx', 'ny', 'nz',
  // Motor(es)
  'rpm0', 'rpm1', 'thrust', 'power',
  // Mandos y superficies
  'throttle', 'elevator', 'aileron', 'rudder', 'trim', 'flapDeg', 'flapsIndex', 'gearExtension',
  'brakeLeft', 'brakeRight', 'parkingBrake',
  // Estado
  'onGround', 'stalled', 'stallFraction', 'crashed', 'crashReason',
  'gearContact0', 'gearContact1', 'gearContact2', 'gearContact3',
  // Ambiente
  'windN', 'windE', 'windD', 'staticPressure', 'oat', 'density', 'qnh',
  'cl', 'qbar',
  // Piloto automático
  'apEngaged', 'apHdg', 'apAlt', 'apSpd', 'apHeading', 'apAltitude', 'apSpeed', 'apDisconnects',
] as const;

export type SnapshotField = (typeof FIELDS)[number];
export type Snapshot = Record<SnapshotField, number>;

export const SNAPSHOT_SIZE = FIELDS.length;
export const IDX = Object.fromEntries(FIELDS.map((f, i) => [f, i])) as Record<SnapshotField, number>;

export function packSnapshot(s: Snapshot, out: Float64Array<ArrayBuffer> = new Float64Array(SNAPSHOT_SIZE)): Float64Array<ArrayBuffer> {
  for (let i = 0; i < SNAPSHOT_SIZE; i++) out[i] = s[FIELDS[i]];
  return out;
}

export function unpackSnapshot(buf: Float64Array): Snapshot {
  const s = {} as Snapshot;
  for (let i = 0; i < SNAPSHOT_SIZE; i++) s[FIELDS[i]] = buf[i];
  return s;
}

export function emptySnapshot(): Snapshot {
  const s = {} as Snapshot;
  for (const f of FIELDS) s[f] = 0;
  s.qw = 1;
  return s;
}
