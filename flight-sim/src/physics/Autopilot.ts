import { clamp } from './math/table';

/** Modos y referencias del piloto automático (los fija el piloto desde la interfaz). */
export interface AutopilotSettings {
  /** Interruptor principal */
  engaged: boolean;
  /** Mantener rumbo (si no, mantiene alas niveladas) */
  hdgHold: boolean;
  /** Mantener altitud (si no, mantiene el cabeceo actual) */
  altHold: boolean;
  /** Mantener velocidad con el acelerador */
  spdHold: boolean;
  /** grados verdaderos */
  heading: number;
  /** m sobre el nivel del mar */
  altitude: number;
  /** IAS m/s */
  speed: number;
  /** régimen máximo de ascenso/descenso (m/s) */
  maxVs: number;
  /**
   * Número de conexión. Si la física desconecta el automático, ignora los pedidos con esta misma
   * sesión hasta que el piloto lo vuelva a conectar (evita reconexiones por mensajes en vuelo).
   */
  session: number;
}

export const defaultAutopilot = (): AutopilotSettings => ({
  engaged: false, hdgHold: false, altHold: false, spdHold: false, heading: 0, altitude: 1000, speed: 50, maxVs: 3.5, session: 0,
});

export interface AutopilotInput {
  dt: number;
  heading: number; // rad
  roll: number; // rad
  pitch: number; // rad
  p: number; // rad/s
  q: number; // rad/s
  altitude: number; // m MSL
  verticalSpeed: number; // m/s (+ arriba)
  ias: number; // m/s
  qbar: number; // Pa
  throttle: number;
}

export interface AutopilotOutput {
  elevator: number;
  aileron: number;
  throttle: number | null;
}

const D2R = Math.PI / 180;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Piloto automático de dos ejes con control de velocidad, a base de lazos PID en cascada:
 * - Alabeo: rumbo → alabeo deseado (máx. 25°) → alerón, con amortiguamiento de la tasa de alabeo.
 * - Cabeceo: altitud → velocidad vertical deseada → cabeceo deseado → elevador. El integrador del
 *   elevador hace de compensador automático.
 * - Velocidad: IAS → acelerador.
 * Las ganancias se escalan con la presión dinámica, así funciona igual lento o rápido.
 */
export class Autopilot {
  private pitchRef = 0;
  private elevInt = 0;
  private ailInt = 0;
  private thrInt = 0;
  private wasEngaged = false;
  /** Ganancia de referencia: presión dinámica a la que se ajustaron los lazos (Pa). */
  qRef = 1900;

  reset() {
    this.wasEngaged = false;
  }

  update(s: AutopilotSettings, x: AutopilotInput, elevatorTrimGuess = 0): AutopilotOutput {
    if (!this.wasEngaged) {
      // Toma suave: arranca desde la actitud y el mando actuales
      this.pitchRef = x.pitch;
      this.elevInt = elevatorTrimGuess;
      this.ailInt = 0;
      this.thrInt = x.throttle;
      this.wasEngaged = true;
    }
    const dt = x.dt;
    const gain = clamp(this.qRef / Math.max(x.qbar, 200), 0.35, 3);

    // ── Eje de alabeo
    const bankTarget = s.hdgHold ? clamp(wrapPi(s.heading * D2R - x.heading) * 1.6, -25 * D2R, 25 * D2R) : 0;
    const bankErr = bankTarget - x.roll;
    this.ailInt = clamp(this.ailInt + bankErr * 0.25 * dt, -0.2, 0.2);
    const aileron = clamp((bankErr * 1.6 - x.p * 0.9) * gain + this.ailInt, -0.6, 0.6);

    // ── Eje de cabeceo
    let pitchTarget = this.pitchRef;
    if (s.altHold) {
      const altErr = s.altitude - x.altitude;
      const vsTarget = clamp(altErr * 0.12, -s.maxVs, s.maxVs);
      const vsErr = vsTarget - x.verticalSpeed;
      // Lazo externo: el cabeceo de referencia se integra con el error de V/S, más un término proporcional
      this.pitchRef = clamp(this.pitchRef + vsErr * 0.006 * dt, -8 * D2R, 12 * D2R);
      pitchTarget = clamp(this.pitchRef + vsErr * 0.012, -8 * D2R, 12 * D2R);
    }
    // Coordinación: en viraje hace falta más cabeceo para no perder altura
    const turnComp = (1 / Math.max(Math.cos(x.roll), 0.5) - 1) * 0.06;
    const pitchErr = pitchTarget + turnComp - x.pitch;
    this.elevInt = clamp(this.elevInt + pitchErr * 0.8 * gain * dt, -0.8, 0.8);
    const elevator = clamp((pitchErr * 2.2 - x.q * 1.2) * gain + this.elevInt, -0.7, 0.7);

    // ── Velocidad
    let throttle: number | null = null;
    if (s.spdHold) {
      const err = s.speed - x.ias;
      this.thrInt = clamp(this.thrInt + err * 0.012 * dt, 0, 1);
      throttle = clamp(this.thrInt + err * 0.06, 0, 1);
    }
    return { elevator, aileron, throttle };
  }
}
