import './style.css';
import { FlightSession, type SessionOptions } from './app/FlightSession';
import { WEATHER_PRESETS } from './app/weather';
import { showMainMenu } from './ui/MainMenu';
import type { SceneryMode } from './world/Globe';

/**
 * Punto de entrada: muestra el menú inicial, salvo que la URL ya traiga el aeropuerto, por ejemplo
 * ?airport=SABE&runway=13&aircraft=hornero-h160&scenery=standard|photoreal|offline&hora=15:30&clima=Nublado
 */
const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;

function parseHour(v: string): number | undefined {
  const [h, m = '0'] = v.split(':');
  const n = Number(h) + Number(m) / 60;
  return Number.isFinite(n) ? n : undefined;
}

function optionsFromUrl(): SessionOptions {
  return {
    airport: params.get('airport')!,
    runwayEnd: params.get('runway') ?? undefined,
    aircraft: params.get('aircraft') ?? 'hornero-h160',
    scenery: (params.get('scenery') as SceneryMode) ?? 'standard',
    camera: (params.get('camera') as SessionOptions['camera']) ?? 'orbit',
    localHour: params.has('hora') ? parseHour(params.get('hora')!) : undefined,
    weather: params.has('clima') ? WEATHER_PRESETS[params.get('clima')!] : undefined,
  };
}

async function main() {
  const opts = params.has('airport') ? optionsFromUrl() : await showMainMenu(app);
  const session = new FlightSession(app, opts);
  // Volver al menú: recargar sin parámetros libera Cesium, el worker y el audio de forma limpia.
  session.onExitToMenu = () => { location.href = location.pathname; };
  try {
    await session.start();
  } catch (e) {
    console.error(e);
    session.overlay.setLoading(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

void main();
