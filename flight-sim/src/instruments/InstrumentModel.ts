import { ISA } from '../physics/Atmosphere';
import type { Snapshot } from '../physics/snapshot';

export const KT = 1.943844;
export const FT = 3.28084;
const RAD = 180 / Math.PI;

/**
 * Lo que "ve" cada instrumento, derivado del estado de la física con sus propias imperfecciones:
 * retardos (VSI, anemómetro), altímetro barométrico con ventanilla de Kollsman, giróscopos
 * de vacío que pierden rigidez si el motor está detenido. Lógica pura, testeable sin DOM.
 */
export interface InstrumentReadings {
  /** kt */
  airspeed: number;
  /** grados (+ nariz arriba) */
  pitch: number;
  /** grados (+ ala derecha abajo) */
  roll: number;
  /** ft indicados */
  altitude: number;
  /** hPa */
  kollsman: number;
  /** °/s (+ derecha) */
  turnRate: number;
  /** -1..1, desplazamiento de la bola (+ derecha) */
  slip: number;
  /** grados 0..360 */
  heading: number;
  /** fpm */
  verticalSpeed: number;
  /** 0..1 rigidez de los giróscopos de vacío */
  gyroHealth: number;
}

/** Altitud indicada (ft) por un altímetro barométrico con la ventanilla en `kollsmanPa`. */
export function indicatedAltitude(staticPressure: number, kollsmanPa: number): number {
  const { T0, L, R, G0 } = ISA;
  return (T0 / L) * (1 - Math.pow(staticPressure / kollsmanPa, (L * R) / G0)) * FT;
}

/** Filtro de primer orden: devuelve el nuevo valor filtrado. */
export const lag = (current: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : current + (target - current) * (1 - Math.exp(-dt / tau));

/** Ángulo con envolvente (grados) filtrado por el camino más corto. */
const lagAngle = (current: number, target: number, tau: number, dt: number) => {
  let d = target - current;
  d = ((d + 540) % 360) - 180;
  return (current + d * (1 - Math.exp(-dt / tau)) + 360) % 360;
};

export class InstrumentModel {
  r: InstrumentReadings = {
    airspeed: 0, pitch: 0, roll: 0, altitude: 0, kollsman: 1013.25, turnRate: 0, slip: 0, heading: 0,
    verticalSpeed: 0, gyroHealth: 1,
  };
  /** La ventanilla de Kollsman sigue al QNH hasta que el piloto la toca. */
  kollsmanManual = false;
  private initialized = false;

  adjustKollsman(deltaHpa: number) {
    this.kollsmanManual = true;
    this.r.kollsman = Math.round((this.r.kollsman + deltaHpa) * 100) / 100;
  }

  update(s: Snapshot, dt: number): InstrumentReadings {
    const r = this.r;
    if (!this.kollsmanManual) r.kollsman = s.qnh / 100;
    const target = {
      airspeed: Math.max(0, s.ias * KT),
      pitch: s.pitch * RAD,
      roll: s.roll * RAD,
      altitude: indicatedAltitude(s.staticPressure, r.kollsman * 100),
      // El coordinador de virajes (giróscopo inclinado) responde al régimen de viraje y algo al alabeo.
      turnRate: s.turnRate * RAD + 0.25 * s.p * RAD,
      slip: Math.max(-1, Math.min(1, Math.atan2(s.ny, Math.max(s.nz, 0.2)) / 0.25)),
      heading: ((s.heading * RAD) % 360 + 360) % 360,
      verticalSpeed: -s.vD * FT * 60,
    };
    if (!this.initialized) {
      Object.assign(r, target);
      this.initialized = true;
      return r;
    }
    if (dt <= 0) return r;
    // Giróscopos de vacío: la bomba depende del motor. Sin RPM pierden rigidez en ~2 minutos.
    const pumpOk = s.rpm0 > 400 || s.rpm1 > 400;
    r.gyroHealth = Math.max(0, Math.min(1, r.gyroHealth + (pumpOk ? 0.2 : -1 / 120) * dt));
    const gyroTau = 0.08 + (1 - r.gyroHealth) * 6;

    r.airspeed = lag(r.airspeed, target.airspeed, 0.25, dt);
    r.pitch = lag(r.pitch, target.pitch, gyroTau, dt);
    r.roll = lag(r.roll, target.roll, gyroTau, dt);
    r.altitude = lag(r.altitude, target.altitude, 0.3, dt);
    r.turnRate = lag(r.turnRate, target.turnRate, 0.4, dt);
    r.slip = lag(r.slip, target.slip, 0.35, dt);
    r.heading = lagAngle(r.heading, target.heading, gyroTau, dt);
    r.verticalSpeed = lag(r.verticalSpeed, target.verticalSpeed, 1.6, dt);
    return r;
  }
}
