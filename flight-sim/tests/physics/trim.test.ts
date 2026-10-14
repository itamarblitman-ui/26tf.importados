import { describe, expect, it } from 'vitest';
import { trimLevelFlight } from '../../src/physics/Simulation';
import { airborne, run, trainer } from './helpers';

describe('vuelo nivelado compensado', () => {
  const cfg = trainer();

  it('el solucionador de trimado converge con mandos dentro de rango', () => {
    for (const V of [32, 40, 50, 58]) {
      const t = trimLevelFlight(cfg, V, 1500);
      expect(t.converged, `V=${V}`).toBe(true);
      expect(t.throttle).toBeGreaterThan(0);
      expect(t.throttle).toBeLessThanOrEqual(1);
      expect(Math.abs(t.trim)).toBeLessThanOrEqual(1);
    }
  });

  it('a 55 m/s la altitud se mantiene estable durante 60 s sin tocar los mandos', () => {
    const sim = airborne(cfg, 55, 1500);
    const h0 = sim.geodetic().h;
    let maxDev = 0;
    run(sim, 60, () => { maxDev = Math.max(maxDev, Math.abs(sim.geodetic().h - h0)); });
    expect(maxDev).toBeLessThan(5);
    const s = sim.snapshot();
    expect(s.tas).toBeGreaterThan(54);
    expect(s.tas).toBeLessThan(56);
    expect(Math.abs(s.roll)).toBeLessThan(0.05);
    expect(s.crashed).toBe(0);
  });

  it('una perturbación de cabeceo se amortigua (dinámica longitudinal estable)', () => {
    const sim = airborne(cfg, 50, 1500);
    const h0 = sim.geodetic().h;
    sim.omega = [0, 0.15, 0]; // golpe de cabeceo
    let maxDev = 0, maxQLate = 0;
    run(sim, 120, (t) => {
      maxDev = Math.max(maxDev, Math.abs(sim.geodetic().h - h0));
      if (t > 60) maxQLate = Math.max(maxQLate, Math.abs(sim.omega[1]));
    });
    expect(maxDev).toBeLessThan(40);
    expect(maxQLate).toBeLessThan(0.01);
    expect(sim.snapshot().crashed).toBe(0);
  });

  it('el compensador cambia la velocidad de equilibrio', () => {
    const slow = trimLevelFlight(cfg, 38, 1000);
    const fast = trimLevelFlight(cfg, 58, 1000);
    expect(slow.trim).toBeGreaterThan(fast.trim);
    expect(slow.alpha).toBeGreaterThan(fast.alpha);
  });
});
