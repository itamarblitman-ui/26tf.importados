import type { SessionOptions } from '../app/FlightSession';
import { WEATHER_PRESETS } from '../app/weather';
import { findAirport, loadAirports, mainRunway, type Airport } from '../world/airports';
import { readKeys, type SceneryMode } from '../world/Globe';
import { AirportPicker } from './AirportPicker';

interface AircraftEntry { id: string; name: string; kind: string; description: string }

const STORAGE_KEY = 'cielo-abierto:menu';
const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};
const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

interface MenuState {
  aircraft: string;
  airport: string;
  runwayEnd: string;
  realTime: boolean;
  hour: number;
  weather: string;
  scenery: SceneryMode;
  camera: 'orbit' | 'cockpit' | 'tower';
}

const defaults = (): MenuState => ({
  aircraft: 'hornero-h160', airport: 'SABE', runwayEnd: '13', realTime: true, hour: 11, weather: 'Buen tiempo',
  scenery: 'standard', camera: 'orbit',
});

function loadState(): MenuState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch { return defaults(); }
}
function saveState(s: MenuState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}

/** Menú inicial. Resuelve con las opciones de la sesión de vuelo cuando el usuario toca "Volar". */
export async function showMainMenu(parent: HTMLElement): Promise<SessionOptions> {
  const state = loadState();
  const [aircraft, airports] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}aircraft/index.json`).then((r) => r.json() as Promise<AircraftEntry[]>),
    loadAirports(),
  ]);
  const hasToken = !!readKeys().ionToken;
  if (!hasToken) state.scenery = 'offline';

  const root = el(`
    <div class="menu">
      <div class="menu-box">
        <header>
          <h1>Cielo Abierto</h1>
          <p>Simulador de vuelo con el planeta real</p>
        </header>
        <section>
          <h3>Aeronave</h3>
          <div class="ac-list">${aircraft.map((a) => `
            <button class="ac" data-id="${a.id}"><b>${a.name}</b><span>${a.kind}</span><small>${a.description}</small></button>`).join('')}
          </div>
        </section>
        <section>
          <h3>Punto de partida</h3>
          <div class="start-row"><div class="start"></div><button class="secondary pick">Elegir en el mapa…</button></div>
        </section>
        <section class="grid2">
          <div>
            <h3>Hora</h3>
            <label class="row"><input type="checkbox" name="real"> Hora real del lugar</label>
            <label class="row">Hora solar local <output name="hourOut"></output></label>
            <input type="range" name="hour" min="0" max="24" step="0.25">
          </div>
          <div>
            <h3>Clima</h3>
            <select name="weather">${Object.keys(WEATHER_PRESETS).map((p) => `<option>${p}</option>`).join('')}</select>
            <p class="muted small">Se puede ajustar en vuelo con la tecla T.</p>
          </div>
        </section>
        <section class="grid2">
          <div>
            <h3>Escenario</h3>
            <select name="scenery">
              <option value="standard" ${hasToken ? '' : 'disabled'}>Terreno + satélite + edificios</option>
              <option value="photoreal" ${hasToken ? '' : 'disabled'}>Fotorrealista 3D (más pesado)</option>
              <option value="offline">Sin conexión (sin relieve)</option>
            </select>
            ${hasToken ? '' : '<p class="warn-text small">Falta CESIUM_ION_TOKEN en .env: sólo está disponible el modo sin conexión. Ver README.</p>'}
          </div>
          <div>
            <h3>Cámara inicial</h3>
            <select name="camera">
              <option value="orbit">Externa</option><option value="cockpit">Cabina</option><option value="tower">Torre</option>
            </select>
          </div>
        </section>
        <footer><button class="fly">Volar</button></footer>
      </div>
    </div>`);
  parent.append(root);
  const picker = new AirportPicker(parent);
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;

  const renderAircraft = () => root.querySelectorAll<HTMLButtonElement>('.ac').forEach((b) => b.classList.toggle('selected', b.dataset.id === state.aircraft));
  const renderStart = () => {
    const a = findAirport(airports, state.airport);
    q('.start').innerHTML = a
      ? `<b>${a.ident}</b> ${a.name}<br><span class="muted">${a.municipality || ''} ${a.country} · pista ${state.runwayEnd || mainRunway(a).le.ident}</span>`
      : '<span class="muted">Elegí un aeropuerto</span>';
  };
  const renderTime = () => {
    q<HTMLInputElement>('[name=real]').checked = state.realTime;
    q<HTMLInputElement>('[name=hour]').value = String(state.hour);
    q<HTMLInputElement>('[name=hour]').disabled = state.realTime;
    q<HTMLOutputElement>('[name=hourOut]').value = state.realTime ? 'real' : fmtHour(state.hour);
  };
  renderAircraft(); renderStart(); renderTime();
  q<HTMLSelectElement>('[name=weather]').value = state.weather;
  q<HTMLSelectElement>('[name=scenery]').value = state.scenery;
  q<HTMLSelectElement>('[name=camera]').value = state.camera;

  root.querySelectorAll<HTMLButtonElement>('.ac').forEach((b) => b.addEventListener('click', () => { state.aircraft = b.dataset.id!; renderAircraft(); }));
  q('[name=real]').addEventListener('change', (e) => { state.realTime = (e.target as HTMLInputElement).checked; renderTime(); });
  q('[name=hour]').addEventListener('input', (e) => { state.hour = Number((e.target as HTMLInputElement).value); renderTime(); });
  q('[name=weather]').addEventListener('change', (e) => { state.weather = (e.target as HTMLSelectElement).value; });
  q('[name=scenery]').addEventListener('change', (e) => { state.scenery = (e.target as HTMLSelectElement).value as SceneryMode; });
  q('[name=camera]').addEventListener('change', (e) => { state.camera = (e.target as HTMLSelectElement).value as MenuState['camera']; });
  q('.pick').addEventListener('click', async () => {
    const cur: Airport | undefined = findAirport(airports, state.airport);
    const r = await picker.open(airports, cur?.lat ?? -34.56, cur?.lon ?? -58.42);
    if (r) { state.airport = r.airport.ident; state.runwayEnd = r.runwayEnd; renderStart(); }
  });

  return new Promise((resolve) => {
    q('.fly').addEventListener('click', () => {
      saveState(state);
      root.remove();
      picker.root.remove();
      resolve({
        airport: state.airport,
        runwayEnd: state.runwayEnd || undefined,
        aircraft: state.aircraft,
        scenery: state.scenery,
        camera: state.camera,
        localHour: state.realTime ? undefined : state.hour,
        weather: WEATHER_PRESETS[state.weather],
      });
    });
  });
}
