import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAircraftConfig, type AircraftConfig } from '../../src/physics/AircraftConfig';
import { Simulation, PHYSICS_DT } from '../../src/physics/Simulation';

export function loadAircraft(id: string): AircraftConfig {
  const path = resolve(__dirname, '../../public/aircraft', `${id}.json`);
  return validateAircraftConfig(JSON.parse(readFileSync(path, 'utf8')));
}

export const trainer = () => loadAircraft('hornero-h160');

/** Corre la simulación `seconds` segundos, llamando a `each` en cada paso. */
export function run(sim: Simulation, seconds: number, each?: (t: number) => void | boolean): void {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    if (each && each(sim.time) === false) break;
    sim.step();
  }
}

/** Simulación en el aire, sin viento, compensada a una velocidad dada. */
export function airborne(cfg: AircraftConfig, airspeed: number, height = 1500) {
  const sim = new Simulation(cfg);
  sim.windOverride = [0, 0, 0];
  sim.reset({ lat: -34.55, lon: -58.42, height, headingDeg: 90, onGround: false, airspeed });
  return sim;
}

/** Simulación detenida sobre una pista plana a nivel del mar. */
export function onRunway(cfg: AircraftConfig, headingDeg = 90) {
  const sim = new Simulation(cfg);
  sim.windOverride = [0, 0, 0];
  sim.reset({ lat: -34.55, lon: -58.42, height: 10, headingDeg, onGround: true });
  return sim;
}
