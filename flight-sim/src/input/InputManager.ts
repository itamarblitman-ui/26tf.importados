import { neutralControls, type ControlInputs } from '../physics/types';
import { GamepadInput } from './Gamepad';
import { Keyboard } from './Keyboard';

export type AppAction =
  | 'camera' | 'cameraCockpit' | 'cameraOrbit' | 'cameraTower' | 'pause' | 'reset' | 'hud' | 'help'
  | 'panel' | 'strip' | 'sound' | 'kollsmanUp' | 'kollsmanDown' | 'weather' | 'airports' | 'menu'
  | 'ap:toggle' | 'ap:hdg' | 'ap:alt' | 'ap:spd' | 'ap:hdg+' | 'ap:hdg-' | 'ap:alt+' | 'ap:alt-' | 'ap:spd+' | 'ap:spd-'
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
    const shift = k.anyDown('ShiftLeft', 'ShiftRight') || k.anyDown('ControlLeft', 'ControlRight');

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
    const ctrl = k.anyDown('ControlLeft', 'ControlRight');
    if (!ctrl && k.anyDown('F2', 'PageDown', 'Minus', 'NumpadSubtract')) c.throttle -= 0.5 * dt;
    if (!ctrl && k.anyDown('F3', 'PageUp', 'Equal', 'NumpadAdd')) c.throttle += 0.5 * dt;
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
    const lookKeys = shift && !ctrl;
    if (lookKeys && k.isDown('ArrowLeft')) look.yaw -= lookRate;
    if (lookKeys && k.isDown('ArrowRight')) look.yaw += lookRate;
    if (lookKeys && k.isDown('ArrowUp')) look.pitch += lookRate;
    if (lookKeys && k.isDown('ArrowDown')) look.pitch -= lookRate;

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
        case 'Shift+KeyM': {
          // Falla / reposición del motor derecho (práctica de vuelo asimétrico en bimotores)
          const on = c.engineOn.length ? [...c.engineOn] : [true, true];
          on[1] = !on[1];
          c.engineOn = on;
          break;
        }
        case 'KeyC': actions.push('camera'); break;
        case 'Digit1': actions.push('cameraCockpit'); break;
        case 'Digit2': actions.push('cameraOrbit'); break;
        case 'Digit3': actions.push('cameraTower'); break;
        case 'KeyP': case 'Pause': actions.push('pause'); break;
        case 'KeyR': actions.push('reset'); break;
        case 'KeyH': actions.push('hud'); break;
        case 'Shift+KeyH': actions.push('strip'); break;
        case 'KeyI': actions.push('panel'); break;
        case 'KeyT': actions.push('weather'); break;
        case 'Escape': actions.push('menu'); break;
        case 'F5': actions.push('ap:toggle'); break;
        case 'F6': actions.push('ap:hdg'); break;
        case 'F7': actions.push('ap:alt'); break;
        case 'F8': actions.push('ap:spd'); break;
        case 'Ctrl+ArrowRight': actions.push('ap:hdg+'); break;
        case 'Ctrl+ArrowLeft': actions.push('ap:hdg-'); break;
        case 'Ctrl+ArrowUp': actions.push('ap:alt+'); break;
        case 'Ctrl+ArrowDown': actions.push('ap:alt-'); break;
        case 'Ctrl+Shift+ArrowUp': actions.push('ap:spd+'); break;
        case 'Ctrl+Shift+ArrowDown': actions.push('ap:spd-'); break;
        case 'KeyA': actions.push('airports'); break;
        case 'KeyO': actions.push('sound'); break;
        case 'BracketRight': actions.push('kollsmanUp'); break;
        case 'BracketLeft': actions.push('kollsmanDown'); break;
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
