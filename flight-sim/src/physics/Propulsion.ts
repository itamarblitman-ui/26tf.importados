import type { EngineConfig } from './AircraftConfig';
import { ISA } from './Atmosphere';
import { clamp, lookup } from './math/table';
import { cross, type Vec3 } from './math/vec3';

export interface EngineState {
  /** Velocidad angular del eje (rad/s). */
  omega: number;
  running: boolean;
}

export interface EngineOutput {
  thrust: number;
  /** Torque absorbido por la hélice (N·m). */
  propTorque: number;
  /** Torque entregado por el motor (N·m). */
  engineTorque: number;
  /** Potencia al eje (W). */
  shaftPower: number;
  rpm: number;
  /** Incremento de presión dinámica en el tubo de corriente de la hélice (Pa). */
  slipstreamQ: number;
  advanceRatio: number;
}

const TWO_PI = 2 * Math.PI;

/** Factor de potencia por altitud (Gagg-Ferrar) para motores a pistón aspirados. */
export function altitudePowerFactor(rho: number): number {
  const sigma = rho / ISA.RHO0;
  return Math.max(0, sigma - (1 - sigma) / 7.55);
}

/** Torque del motor (sin la fricción) para un acelerador y densidad dados. */
export function engineTorque(cfg: EngineConfig, throttle: number, rho: number, running: boolean): number {
  if (!running) return 0;
  const qMax = cfg.maxPowerW / ((cfg.maxRpm / 60) * TWO_PI);
  const t = clamp(throttle, 0, 1);
  return qMax * altitudePowerFactor(rho) * (cfg.idleTorqueFraction + (1 - cfg.idleTorqueFraction) * t);
}

/** Empuje y torque de hélice de paso fijo para una velocidad axial y RPM dadas. */
export function propellerLoads(cfg: EngineConfig, omega: number, axialSpeed: number, rho: number) {
  const D = cfg.propeller.diameter;
  const n = omega / TWO_PI;
  if (n < 0.5) return { thrust: 0, torque: 0, J: 0 };
  const J = Math.max(0, axialSpeed) / (n * D);
  const ct = lookup(cfg.propeller.ct, J);
  const cp = lookup(cfg.propeller.cp, J);
  const thrust = ct * rho * n * n * D ** 4;
  const torque = (cp * rho * n * n * D ** 5) / TWO_PI;
  return { thrust, torque, J };
}

export function frictionTorque(cfg: EngineConfig, omega: number): number {
  return omega > 0.1 ? cfg.frictionC0 + cfg.frictionC1 * omega : 0;
}

/** Avanza la dinámica del eje un paso y devuelve las cargas resultantes. */
export function stepEngine(
  cfg: EngineConfig, state: EngineState, throttle: number, axialSpeed: number, rho: number, dt: number,
): EngineOutput {
  const qe = engineTorque(cfg, throttle, rho, state.running);
  const prop = propellerLoads(cfg, state.omega, axialSpeed, rho);
  const qf = frictionTorque(cfg, state.omega);
  const domega = (qe - prop.torque - qf) / cfg.inertia;
  state.omega = Math.max(0, state.omega + domega * dt);
  const diskArea = (Math.PI * cfg.propeller.diameter ** 2) / 4;
  return {
    thrust: prop.thrust,
    propTorque: prop.torque,
    engineTorque: qe,
    shaftPower: qe * state.omega,
    rpm: (state.omega * 60) / TWO_PI,
    slipstreamQ: Math.max(0, prop.thrust) / diskArea,
    advanceRatio: prop.J,
  };
}

/** RPM de equilibrio (bisección) para un acelerador, velocidad axial y densidad. Útil para trimado e inicialización. */
export function steadyOmega(cfg: EngineConfig, throttle: number, axialSpeed: number, rho: number, running = true): number {
  const net = (w: number) =>
    engineTorque(cfg, throttle, rho, running) - propellerLoads(cfg, w, axialSpeed, rho).torque - frictionTorque(cfg, w);
  let lo = 1, hi = ((cfg.maxRpm * 1.6) / 60) * TWO_PI;
  if (net(lo) <= 0) return 0;
  if (net(hi) > 0) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (net(mid) > 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Fuerza y momento (cuerpo) producidos por un motor. */
export function engineForceMoment(cfg: EngineConfig, out: EngineOutput, omegaBody: Vec3, shaftOmega: number) {
  const force: Vec3 = [out.thrust, 0, 0];
  const m = cross(cfg.position, force);
  // Reacción al torque de la hélice: horario visto desde cabina ⇒ alabeo a la izquierda.
  m[0] -= cfg.rotation * out.propTorque * (cfg.torqueFactor ?? 1);
  // Precesión giroscópica: M = -ω × H, con H = I·Ω a lo largo de x.
  const H: Vec3 = [cfg.rotation * cfg.inertia * shaftOmega * 0.35, 0, 0];
  const g = cross(omegaBody, H);
  return { force, moment: [m[0] - g[0], m[1] - g[1], m[2] - g[2]] as Vec3 };
}
