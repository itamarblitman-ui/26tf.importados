import './style.css';
import { FlightSession, type SessionOptions } from './app/FlightSession';
import type { SceneryMode } from './world/Globe';
import { WEATHER_PRESETS } from './app/weather';

/**
 * Punto de entrada. En la fase 4 se agrega el menú inicial; por ahora los parámetros
 * se pueden pasar por URL: ?airport=SABE&runway=13&aircraft=hornero-h160&scenery=standard|photoreal|offline&hora=15:30&clima=Nublado
 */
const params = new URLSearchParams(location.search);
const opts: SessionOptions = {
  airport: params.get('airport') ?? 'SABE',
  runwayEnd: params.get('runway') ?? (params.get('airport') ? undefined : '13'),
  aircraft: params.get('aircraft') ?? 'hornero-h160',
  scenery: (params.get('scenery') as SceneryMode) ?? 'standard',
  camera: (params.get('camera') as SessionOptions['camera']) ?? 'orbit',
  localHour: params.has('hora') ? parseHour(params.get('hora')!) : undefined,
  weather: params.has('clima') ? WEATHER_PRESETS[params.get('clima')!] : undefined,
};

function parseHour(v: string): number | undefined {
  const [h, m = '0'] = v.split(':');
  const n = Number(h) + Number(m) / 60;
  return Number.isFinite(n) ? n : undefined;
}

const app = document.getElementById('app')!;
const session = new FlightSession(app, opts);
session.start().catch((e) => {
  console.error(e);
  session.overlay.setLoading(`Error: ${e instanceof Error ? e.message : String(e)}`);
});
