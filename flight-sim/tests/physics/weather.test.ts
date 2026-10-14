import { describe, expect, it } from 'vitest';
import { defaultEnvironment } from '../../src/physics/types';
import { WindModel } from '../../src/physics/Wind';
import { airborne, onRunway, run, trainer } from './helpers';

describe('viento y clima', () => {
  it('el viento medio sopla desde la dirección indicada', () => {
    const w = new WindModel(1);
    const env = { ...defaultEnvironment(), windFromDeg: 90, windSpeed: 10 };
    const v = w.sample(env, 10, 50, 0.01);
    // Desde el este ⇒ sopla hacia el oeste (E negativo)
    expect(v[1]).toBeCloseTo(-10, 1);
    expect(Math.abs(v[0])).toBeLessThan(0.1);
  });

  it('el viento es menor cerca del suelo (capa límite)', () => {
    const env = { ...defaultEnvironment(), windFromDeg: 0, windSpeed: 10 };
    const low = new WindModel(1).sample(env, 1, 50, 0.01);
    const high = new WindModel(1).sample(env, 300, 50, 0.01);
    expect(Math.abs(low[0])).toBeLessThan(Math.abs(high[0]));
  });

  it('ráfagas y turbulencia generan variación con la media correcta', () => {
    const w = new WindModel(3);
    const env = { ...defaultEnvironment(), windFromDeg: 180, windSpeed: 8, gustIntensity: 5, turbulence: 0.5 };
    const xs: number[] = [];
    for (let i = 0; i < 120 * 300; i++) xs.push(w.sample(env, 300, 50, 1 / 120)[0]);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    // Desde el sur ⇒ hacia el norte (+). A 300 m el perfil da 1,6× el viento de superficie (12,8 m/s),
    // y las ráfagas suman un poco más en promedio.
    expect(mean).toBeGreaterThan(12);
    expect(mean).toBeLessThan(17);
    expect(sd).toBeGreaterThan(0.8);
  });

  it('el viento cruzado desvía la trayectoria respecto del rumbo', () => {
    const sim = airborne(trainer(), 50, 1500);
    sim.windOverride = [-10, 0, 0]; // viento del norte (hacia el sur) con rumbo este
    run(sim, 60);
    const s = sim.snapshot();
    const track = Math.atan2(s.vE, s.vN);
    // Deriva hacia el sur: la trayectoria es mayor que 90°
    expect(track).toBeGreaterThan(Math.PI / 2 + 0.1);
    expect(s.crashed).toBe(0);
  });

  it('el aire caliente alarga la carrera de despegue', () => {
    const roll = (deltaT: number) => {
      const sim = onRunway(trainer(), 90);
      sim.setEnvironment({ isaDeltaT: deltaT });
      sim.setControls({ throttle: 1 });
      let t = 0;
      run(sim, 60, (time) => { if (sim.snapshot().ias > 28) { t = time; return false; } });
      return t;
    };
    expect(roll(30)).toBeGreaterThan(roll(0) * 1.05);
  });

  it('tocar agua es un accidente (amerizaje)', () => {
    const sim = airborne(trainer(), 35, 20);
    sim.setGround({ lat: -34.55, lon: -58.42, height: 0, normalEnu: [0, 0, 1], kind: 'water' });
    sim.setControls({ throttle: 0 });
    run(sim, 60, () => sim.snapshot().crashed === 0);
    expect(sim.snapshot().crashed).toBe(1);
    expect(sim.snapshot().crashReason).toBe(3);
  });
});
