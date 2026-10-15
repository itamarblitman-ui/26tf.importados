/**
 * Lectura de joystick/gamepad con la Gamepad API.
 * - Mando "standard" (Xbox/PlayStation): stick izq = alabeo/cabeceo, gatillos = timón,
 *   stick der vertical = acelerador incremental.
 * - Joystick de vuelo (mapping no estándar): eje 0 alabeo, 1 cabeceo, 2 acelerador absoluto,
 *   3 o 5 timón (twist). Las heurísticas cubren los HOTAS más comunes.
 */
export interface GamepadAxes {
  connected: boolean;
  id: string;
  aileron: number;
  elevator: number;
  rudder: number;
  /** Acelerador absoluto 0..1 (joystick con palanca) o null */
  throttleAbs: number | null;
  /** Variación de acelerador por segundo (mando estándar) */
  throttleRate: number;
  /** Frenos 0..1 */
  brakes: number;
  /** Botones con flanco: acciones discretas */
  actions: string[];
}

const deadzone = (v: number, dz = 0.08) => (Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz));
/** Curva de respuesta (más fina cerca del centro). */
const curve = (v: number, expo = 0.35) => (1 - expo) * v + expo * v * v * v;

export class GamepadInput {
  private prevButtons: boolean[] = [];
  private lastIndex: number | null = null;

  constructor() {
    window.addEventListener('gamepadconnected', (e) => { this.lastIndex = (e as GamepadEvent).gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.lastIndex = null; });
  }

  private pick(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.lastIndex !== null && pads[this.lastIndex]) return pads[this.lastIndex];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  read(): GamepadAxes {
    const gp = this.pick();
    const out: GamepadAxes = {
      connected: false, id: '', aileron: 0, elevator: 0, rudder: 0, throttleAbs: null, throttleRate: 0, brakes: 0, actions: [],
    };
    if (!gp) return out;
    out.connected = true;
    out.id = gp.id;
    const ax = (i: number) => gp.axes[i] ?? 0;
    const btn = (i: number) => gp.buttons[i]?.pressed ?? false;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;

    if (gp.mapping === 'standard') {
      out.aileron = curve(deadzone(ax(0)));
      out.elevator = curve(deadzone(ax(1))); // stick hacia atrás (+) = tirar
      out.rudder = curve(deadzone(val(7) - val(6), 0.05));
      out.throttleRate = -deadzone(ax(3), 0.15) * 0.6;
      out.brakes = btn(0) ? 1 : 0; // A / ✕
      const map: Record<number, string> = {
        1: 'flapsDown', 2: 'flapsUp', 3: 'gear', 4: 'trimDown', 5: 'trimUp', 8: 'camera', 9: 'pause', 10: 'parkingBrake',
        12: 'lookUp', 13: 'lookDown', 14: 'lookLeft', 15: 'lookRight',
      };
      this.edges(gp, map, out.actions);
    } else {
      out.aileron = curve(deadzone(ax(0), 0.04), 0.25);
      out.elevator = curve(deadzone(ax(1), 0.04), 0.25);
      if (gp.axes.length >= 3) out.throttleAbs = (1 - ax(2)) / 2;
      const rudderAxis = gp.axes.length >= 6 ? 5 : gp.axes.length >= 4 ? 3 : -1;
      if (rudderAxis >= 0) out.rudder = curve(deadzone(ax(rudderAxis), 0.08), 0.3);
      out.brakes = btn(0) ? 1 : 0; // gatillo
      const map: Record<number, string> = { 1: 'camera', 2: 'flapsUp', 3: 'flapsDown', 4: 'trimDown', 5: 'trimUp', 6: 'gear' };
      this.edges(gp, map, out.actions);
    }
    return out;
  }

  private edges(gp: Gamepad, map: Record<number, string>, actions: string[]) {
    gp.buttons.forEach((b, i) => {
      if (b.pressed && !this.prevButtons[i] && map[i]) actions.push(map[i]);
      this.prevButtons[i] = b.pressed;
    });
    // Los botones del pad direccional se repiten mientras se mantienen (mirar alrededor)
    for (const i of [12, 13, 14, 15]) if (gp.buttons[i]?.pressed && map[i]?.startsWith('look')) actions.push(`${map[i]}Hold`);
  }
}
