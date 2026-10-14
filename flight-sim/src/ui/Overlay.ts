import type { Snapshot } from '../physics/snapshot';
import { crashReasonText } from '../physics/types';
import { CAMERA_LABEL, type CameraMode } from '../world/Cameras';

const KT = 1.943844;
const FT = 3.28084;

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export const HELP_HTML = `
<h2>Controles</h2>
<table>
<tr><th colspan="2">Vuelo</th></tr>
<tr><td>↑ / ↓</td><td>Picar / encabritar (elevador)</td></tr>
<tr><td>← / →</td><td>Alabeo (alerones)</td></tr>
<tr><td>Q / E</td><td>Timón izq. / der. (y rueda de nariz en tierra)</td></tr>
<tr><td>F1 · F2 · F3 · F4</td><td>Corte · reducir · aumentar · pleno acelerador</td></tr>
<tr><td>RePág / AvPág, + / −</td><td>Aumentar / reducir acelerador (alternativa)</td></tr>
<tr><td>Inicio / Fin</td><td>Compensador picar / encabritar</td></tr>
<tr><td>Z / X</td><td>Subir / bajar flaps</td></tr>
<tr><td>B o Espacio</td><td>Frenos (mantener) · <kbd>,</kbd> / <kbd>.</kbd> freno izq. / der.</td></tr>
<tr><td>Shift + B</td><td>Freno de estacionamiento</td></tr>
<tr><td>G</td><td>Tren de aterrizaje (aviones retráctiles)</td></tr>
<tr><td>M</td><td>Arrancar / detener motor</td></tr>
<tr><th colspan="2">Vista y simulación</th></tr>
<tr><td>C · 1 · 2 · 3</td><td>Cambiar cámara · cabina · externa · torre</td></tr>
<tr><td>Mouse</td><td>Arrastrar: mirar / orbitar · rueda: zoom · doble clic: centrar</td></tr>
<tr><td>Shift + flechas</td><td>Mirar alrededor</td></tr>
<tr><td>P</td><td>Pausa</td></tr>
<tr><td>R</td><td>Reiniciar en la cabecera</td></tr>
<tr><td>I</td><td>Tablero de instrumentos (on/off)</td></tr>
<tr><td>H · Shift+H</td><td>HUD · barra de datos superior</td></tr>
<tr><td>[ / ]</td><td>Ajuste del altímetro (hPa)</td></tr>
<tr><td>O</td><td>Sonido on/off</td></tr>
<tr><td>T</td><td>Hora y clima</td></tr>
<tr><td>A</td><td>Elegir aeropuerto en el mapa</td></tr>
<tr><td>F10 o ?</td><td>Esta ayuda</td></tr>
<tr><th colspan="2">Joystick / gamepad</th></tr>
<tr><td>Stick izq.</td><td>Alabeo y cabeceo</td></tr>
<tr><td>Gatillos</td><td>Timón · stick der. vertical: acelerador</td></tr>
<tr><td>A / ✕</td><td>Frenos · B/X flaps · Y tren · LB/RB compensador</td></tr>
</table>
<p class="hint">Despegue: soltá frenos, F4 (pleno), mantené el eje con Q/E y a ~55 nudos tirá suave (↓).</p>`;

/** Interfaz superpuesta: barra de datos, avisos, pausa, ayuda, accidente y pantalla de carga. */
export class Overlay {
  readonly root: HTMLElement;
  private strip: HTMLElement;
  private warn: HTMLElement;
  private loading: HTMLElement;
  private crash: HTMLElement;
  private pause: HTMLElement;
  private help: HTMLElement;
  private toast: HTMLElement;
  private toastTimer = 0;
  stripVisible = true;

  constructor(parent: HTMLElement) {
    this.root = el(`<div class="overlay"></div>`);
    this.strip = el(`<div class="strip"></div>`);
    this.warn = el(`<div class="warn"></div>`);
    this.loading = el(`<div class="screen loading"><div class="spinner"></div><div class="msg">Cargando…</div></div>`);
    this.crash = el(`<div class="screen crash hidden"><h1>Accidente</h1><p class="reason"></p><p class="details"></p>
      <div class="buttons"><button class="restart">Reiniciar en la pista (R)</button><button class="pick secondary">Elegir otro aeropuerto (A)</button></div></div>`);
    this.pause = el(`<div class="banner hidden">PAUSA — P para continuar</div>`);
    this.help = el(`<div class="panel help hidden">${HELP_HTML}<button class="close">Cerrar</button></div>`);
    this.toast = el(`<div class="toast hidden"></div>`);
    this.root.append(this.strip, this.warn, this.pause, this.toast, this.help, this.crash, this.loading);
    parent.append(this.root);
    this.help.querySelector('.close')!.addEventListener('click', () => this.toggleHelp(false));
  }

  onRestart(cb: () => void) {
    this.crash.querySelector('.restart')!.addEventListener('click', cb);
  }

  onPickAirport(cb: () => void) {
    this.crash.querySelector('.pick')!.addEventListener('click', cb);
  }

  setLoading(msg: string | null) {
    this.loading.classList.toggle('hidden', msg === null);
    if (msg) this.loading.querySelector('.msg')!.textContent = msg;
  }

  showCrash(reason: number | null, impact?: { ias: number; vs: number; nz: number }) {
    this.crash.classList.toggle('hidden', reason === null);
    if (reason === null) return;
    this.crash.querySelector('.reason')!.textContent = crashReasonText[reason] ?? 'Accidente';
    this.crash.querySelector('.details')!.textContent = impact
      ? `Velocidad ${Math.round(impact.ias * KT)} kt · vertical ${Math.round(impact.vs * FT * 60)} ft/min · ${impact.nz.toFixed(1)} G`
      : '';
  }

  setPaused(p: boolean) { this.pause.classList.toggle('hidden', !p); }

  toggleHelp(force?: boolean) { this.help.classList.toggle('hidden', force === undefined ? undefined : !force); }

  notify(msg: string, ms = 2500) {
    this.toast.textContent = msg;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), ms);
  }

  toggleStrip() {
    this.stripVisible = !this.stripVisible;
    this.strip.classList.toggle('hidden', !this.stripVisible);
  }

  update(s: Snapshot, camera: CameraMode, detents: number[], wind = '') {
    if (this.stripVisible) {
      const hdg = ((s.heading * 180) / Math.PI + 360) % 360;
      const item = (k: string, v: string, cls = '') => `<div class="item ${cls}"><span>${k}</span><b>${v}</b></div>`;
      const flap = detents[Math.round(s.flapsIndex)] ?? 0;
      this.strip.innerHTML = [
        item('IAS', `${Math.round(s.ias * KT)} kt`),
        item('ALT', `${Math.round(s.altMsl * FT)} ft`),
        item('AGL', `${Math.round(s.agl * FT)} ft`),
        item('RUMBO', `${String(Math.round(hdg) % 360).padStart(3, '0')}°`),
        item('V/S', `${Math.round(-s.vD * FT * 60)} fpm`),
        item('RPM', `${Math.round(s.rpm0)}`),
        item('ACEL', `${Math.round(s.throttle * 100)}%`),
        item('FLAPS', `${Math.round(s.flapDeg)}°${Math.abs(s.flapDeg - flap) > 0.5 ? `→${flap}°` : ''}`),
        item('COMP', `${s.trim >= 0 ? '+' : ''}${(s.trim * 100).toFixed(0)}`),
        item('G', s.nz.toFixed(1)),
        item('VIENTO', wind || '—'),
        item('FRENOS', s.parkingBrake ? 'ESTAC.' : s.brakeLeft > 0 || s.brakeRight > 0 ? 'SÍ' : '—', s.parkingBrake ? 'amber' : ''),
        item('CÁM', CAMERA_LABEL[camera]),
      ].join('');
    }
    const warnings: string[] = [];
    if (s.stalled && !s.onGround) warnings.push('PÉRDIDA');
    if (s.rpm0 < 100 && s.crashed === 0) warnings.push('MOTOR DETENIDO');
    this.warn.textContent = warnings.join(' · ');
    this.warn.classList.toggle('hidden', warnings.length === 0);
  }
}
