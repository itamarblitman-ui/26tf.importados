import { WEATHER_PRESETS, type WeatherSettings } from '../app/weather';
import { COVER_LABEL, type CloudCover } from '../world/cloudField';

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

const fmtHour = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};
const VIS_STEPS = [0.4, 0.8, 1.5, 3, 5, 8, 10, 15, 20, 30, 60];

/** Panel lateral de hora y clima. Cada cambio se aplica en vivo. */
export class WeatherPanel {
  readonly root: HTMLElement;
  private w: WeatherSettings;
  onChange: (w: WeatherSettings, timeChanged: boolean) => void = () => {};

  constructor(parent: HTMLElement, initial: WeatherSettings) {
    this.w = { ...initial };
    const presets = Object.keys(WEATHER_PRESETS).map((p) => `<button data-preset="${p}">${p}</button>`).join('');
    const covers = (Object.keys(COVER_LABEL) as CloudCover[]).map((c) => `<option value="${c}">${COVER_LABEL[c]}</option>`).join('');
    this.root = el(`
      <div class="panel weather hidden">
        <div class="wp-head"><h2>Hora y clima</h2><button class="close" title="Cerrar (T)">✕</button></div>
        <section>
          <h3>Hora del día</h3>
          <label class="row"><input type="checkbox" name="real"> Hora real</label>
          <label class="row">Hora solar local <output name="hourOut"></output></label>
          <input type="range" name="hour" min="0" max="24" step="0.25">
          <label class="row"><input type="checkbox" name="shadows"> Sombras</label>
        </section>
        <section>
          <h3>Ajustes rápidos</h3>
          <div class="presets">${presets}</div>
        </section>
        <section>
          <h3>Viento</h3>
          <label class="row">Desde <output name="dirOut"></output></label>
          <input type="range" name="dir" min="0" max="355" step="5">
          <label class="row">Velocidad <output name="spdOut"></output></label>
          <input type="range" name="spd" min="0" max="40" step="1">
          <label class="row">Ráfagas <output name="gustOut"></output></label>
          <input type="range" name="gust" min="0" max="25" step="1">
          <label class="row">Turbulencia <output name="turbOut"></output></label>
          <input type="range" name="turb" min="0" max="1" step="0.05">
        </section>
        <section>
          <h3>Nubes y visibilidad</h3>
          <label class="row">Cobertura <select name="cover">${covers}</select></label>
          <label class="row">Base <output name="baseOut"></output></label>
          <input type="range" name="base" min="300" max="10000" step="100">
          <label class="row">Visibilidad <output name="visOut"></output></label>
          <input type="range" name="vis" min="0" max="${VIS_STEPS.length - 1}" step="1">
        </section>
        <section>
          <h3>Atmósfera</h3>
          <label class="row">Temperatura ISA <output name="isaOut"></output></label>
          <input type="range" name="isa" min="-30" max="30" step="1">
          <label class="row">QNH <output name="qnhOut"></output></label>
          <input type="range" name="qnh" min="960" max="1050" step="1">
        </section>
      </div>`);
    parent.append(this.root);
    this.root.querySelector('.close')!.addEventListener('click', () => this.toggle(false));
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('input', (e) => this.read(e.target as HTMLInputElement));
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      this.w = { ...this.w, ...WEATHER_PRESETS[b.dataset.preset!] };
      this.write();
      this.onChange(this.w, false);
    }));
    this.write();
  }

  get visible() { return !this.root.classList.contains('hidden'); }
  toggle(force?: boolean) { this.root.classList.toggle('hidden', force === undefined ? undefined : !force); }

  get settings(): WeatherSettings { return { ...this.w }; }

  /** Actualiza la hora mostrada cuando corre el reloj real. */
  showHour(h: number) {
    if (this.w.timeMode !== 'real') return;
    this.w.localHour = h;
    this.input('hour').value = String(h);
    this.out('hourOut').value = fmtHour(h);
  }

  private input(n: string) { return this.root.querySelector<HTMLInputElement>(`[name="${n}"]`)!; }
  private out(n: string) { return this.root.querySelector<HTMLOutputElement>(`output[name="${n}"]`)!; }

  private write() {
    const w = this.w;
    this.input('real').checked = w.timeMode === 'real';
    this.input('hour').value = String(w.localHour);
    this.input('shadows').checked = w.shadows;
    this.input('dir').value = String(w.windFromDeg);
    this.input('spd').value = String(w.windKt);
    this.input('gust').value = String(w.gustKt);
    this.input('turb').value = String(w.turbulence);
    (this.root.querySelector('[name="cover"]') as HTMLSelectElement).value = w.cover;
    this.input('base').value = String(w.cloudBaseFt);
    const vi = VIS_STEPS.reduce((best, v, i) => (Math.abs(v - w.visibilityKm) < Math.abs(VIS_STEPS[best] - w.visibilityKm) ? i : best), 0);
    this.input('vis').value = String(vi);
    this.input('isa').value = String(w.isaDeltaC);
    this.input('qnh').value = String(w.qnhHpa);
    this.labels();
  }

  private labels() {
    const w = this.w;
    this.out('hourOut').value = fmtHour(w.localHour) + (w.timeMode === 'real' ? ' (real)' : '');
    this.out('dirOut').value = `${String(w.windFromDeg).padStart(3, '0')}°`;
    this.out('spdOut').value = `${w.windKt} kt`;
    this.out('gustOut').value = w.gustKt ? `+${w.gustKt} kt` : 'sin ráfagas';
    this.out('turbOut').value = w.turbulence < 0.05 ? 'nula' : w.turbulence < 0.35 ? 'leve' : w.turbulence < 0.7 ? 'moderada' : 'fuerte';
    this.out('baseOut').value = `${w.cloudBaseFt} ft`;
    this.out('visOut').value = w.visibilityKm >= 50 ? 'ilimitada' : w.visibilityKm < 1 ? `${Math.round(w.visibilityKm * 1000)} m` : `${w.visibilityKm} km`;
    this.out('isaOut').value = `ISA ${w.isaDeltaC >= 0 ? '+' : ''}${w.isaDeltaC} °C`;
    this.out('qnhOut').value = `${w.qnhHpa} hPa`;
  }

  private read(t: HTMLInputElement) {
    const w = this.w;
    let timeChanged = false;
    switch (t.name) {
      case 'real': w.timeMode = t.checked ? 'real' : 'fixed'; timeChanged = true; break;
      case 'hour': w.localHour = Number(t.value); w.timeMode = 'fixed'; this.input('real').checked = false; timeChanged = true; break;
      case 'shadows': w.shadows = t.checked; break;
      case 'dir': w.windFromDeg = Number(t.value); break;
      case 'spd': w.windKt = Number(t.value); break;
      case 'gust': w.gustKt = Number(t.value); break;
      case 'turb': w.turbulence = Number(t.value); break;
      case 'cover': w.cover = (t as unknown as HTMLSelectElement).value as CloudCover; break;
      case 'base': w.cloudBaseFt = Number(t.value); break;
      case 'vis': w.visibilityKm = VIS_STEPS[Number(t.value)]; break;
      case 'isa': w.isaDeltaC = Number(t.value); break;
      case 'qnh': w.qnhHpa = Number(t.value); break;
      default: return;
    }
    this.labels();
    this.onChange({ ...w }, timeChanged);
  }
}
