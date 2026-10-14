import { neutralControls, type ControlInputs } from '../physics/types';
import { GamepadInput } from './Gamepad';
import { Keyboard } from './Keyboard';

export type AppAction =
  | 'camera' | 'cameraCockpit' | 'cameraOrbit' | 'cameraTower' | 'pause' | 'reset' | 'hud' | 'help'
  | 'lookUp' | 'lookDown' | 'lookLeft' | 'lookRight';

const approach = (v: number, target: number, rate: number, dt: number) => {
  const d = target - v, m = rate * dt;
  return Math.abs(d) <= m ? target : v + Math.sign(d) * m;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Fusiona teclado y joystick en un único ControlInputs. El teclado tiene rampas (las teclas son
 * todo-o-nada, así se evitan comandos bruscos) y vuelve al centro al soltar, como en los simuladores clásicos.
 */
export class InputManager {
  readonly keyboard = new Keyboard();
  readonly gamepad = new GamepadInput();
  private kb = { elevator: 0, aileron: 0, rudder: 0 };
  private lastThrottleAbs: number | null = null;
  controls: ControlInputs = neutralControls();
  flapDetents = 4;
  gamepadName = '';

  /** Actualiza y devuelve los mandos y las acciones de la aplicación de este frame. */
  update(dt: number): { controls: ControlInputs; actions: AppAction[]; look: { yaw: number; pitch: number } } {
    const k = this.keyboard;
    const c = this.controls;
    const actions: AppAction[] = [];
    const shift = k.anyDown('ShiftLeft', 'ShiftRight');

    // ── Ejes de teclado con rampa
    const axis = (neg: boolean, pos: boolean) => (pos && !neg ? 1 : neg && !pos ? -1 : 0);
    const up = !shift && k.isDown('ArrowUp'), down = !shift && k.isDown('ArrowDown');
    const left = !shift && k.isDown('ArrowLeft'), right = !shift && k.isDown('ArrowRight');
    const eT = axis(up, down), aT = axis(left, right), rT = axis(k.isDown('KeyQ'), k.isDown('KeyE'));
    this.kb.elevator = approach(this.kb.elevator, eT, eT ? 1.1 : 2.5, dt);
    this.kb.aileron = approach(this.kb.aileron, aT, aT ? 2.5 : 4, dt);
    this.kb.rudder = approach(this.kb.rudder, rT, rT ? 2 : 3, dt);

    // ── Joystick
    const gp = this.gamepad.read();
    this.gamepadName = gp.connected ? gp.id : '';
    c.elevator = clamp(this.kb.elevator + gp.elevator, -1, 1);
    c.aileron = clamp(this.kb.aileron + gp.aileron, -1, 1);
    c.rudder = clamp(this.kb.rudder + gp.rudder, -1, 1);

    // ── Acelerador
    if (k.anyDown('F2', 'PageDown', 'Minus', 'NumpadSubtract')) c.throttle -= 0.5 * dt;
    if (k.anyDown('F3', 'PageUp', 'Equal', 'NumpadAdd')) c.throttle += 0.5 * dt;
    c.throttle += gp.throttleRate * dt;
    if (gp.throttleAbs !== null) {
      if (this.lastThrottleAbs === null || Math.abs(gp.throttleAbs - this.lastThrottleAbs) > 0.01) {
        c.throttle = gp.throttleAbs;
        this.lastThrottleAbs = gp.throttleAbs;
      }
    }

    // ── Compensador (mantener presionado)
    if (k.anyDown('Home', 'Numpad7')) c.trim -= 0.25 * dt;
    if (k.anyDown('End', 'Numpad1')) c.trim += 0.25 * dt;

    // ── Frenos
    const allBrakes = k.isDown('KeyB') || k.isDown('Space') ? 1 : gp.brakes;
    c.brakeLeft = Math.max(allBrakes, k.isDown('Comma') ? 1 : 0);
    c.brakeRight = Math.max(allBrakes, k.isDown('Period') ? 1 : 0);

    // ── Mirar alrededor (Shift + flechas o pad direccional)
    const look = { yaw: 0, pitch: 0 };
    const lookRate = 1.6 * dt;
    if (shift && k.isDown('ArrowLeft')) look.yaw -= lookRate;
    if (shift && k.isDown('ArrowRight')) look.yaw += lookRate;
    if (shift && k.isDown('ArrowUp')) look.pitch += lookRate;
    if (shift && k.isDown('ArrowDown')) look.pitch -= lookRate;

    // ── Acciones discretas
    for (const p of k.consumePressed()) {
      switch (p) {
        case 'F1': c.throttle = 0; break;
        case 'F4': c.throttle = 1; break;
        case 'KeyZ': c.flapsIndex = Math.max(0, c.flapsIndex - 1); break;
        case 'KeyX': c.flapsIndex = Math.min(this.flapDetents - 1, c.flapsIndex + 1); break;
        case 'KeyG': c.gearDown = !c.gearDown; break;
        case 'Shift+KeyB': c.parkingBrake = !c.parkingBrake; break;
        case 'KeyM': c.engineRunning = !c.engineRunning; break;
        case 'KeyC': actions.push('camera'); break;
        case 'Digit1': actions.push('cameraCockpit'); break;
        case 'Digit2': actions.push('cameraOrbit'); break;
        case 'Digit3': actions.push('cameraTower'); break;
        case 'KeyP': case 'Pause': actions.push('pause'); break;
        case 'KeyR': actions.push('reset'); break;
        case 'KeyH': actions.push('hud'); break;
        case 'F10': case 'Slash': case 'Shift+Slash': actions.push('help'); break;
      }
    }
    for (const a of gp.actions) {
      switch (a) {
        case 'flapsDown': c.flapsIndex = Math.min(this.flapDetents - 1, c.flapsIndex + 1); break;
        case 'flapsUp': c.flapsIndex = Math.max(0, c.flapsIndex - 1); break;
        case 'gear': c.gearDown = !c.gearDown; break;
        case 'trimDown': c.trim -= 0.05; break;
        case 'trimUp': c.trim += 0.05; break;
        case 'parkingBrake': c.parkingBrake = !c.parkingBrake; break;
        case 'camera': actions.push('camera'); break;
        case 'pause': actions.push('pause'); break;
        case 'lookUpHold': look.pitch += lookRate; break;
        case 'lookDownHold': look.pitch -= lookRate; break;
        case 'lookLeftHold': look.yaw -= lookRate; break;
        case 'lookRightHold': look.yaw += lookRate; break;
      }
    }
    c.throttle = clamp(c.throttle, 0, 1);
    c.trim = clamp(c.trim, -1, 1);

    return { controls: { ...c }, actions, look };
  }

  /** Sincroniza el estado interno (por ejemplo, tras un reinicio en vuelo compensado). */
  sync(partial: Partial<ControlInputs>) {
    Object.assign(this.controls, partial);
  }
}
