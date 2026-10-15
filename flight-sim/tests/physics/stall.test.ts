import { describe, expect, it } from 'vitest';
import { computeAero, liftCoefficient } from '../../src/physics/Aerodynamics';
import { DEG } from '../../src/physics/math/table';
import { airborne, run, trainer } from './helpers';

describe('pérdida', () => {
  const cfg = trainer();
  const crit = cfg.aero.stallAlphaDeg;

  it('CL crece linealmente antes del ángulo crítico y cae después', () => {
    const cl = (a: number) => liftCoefficient(cfg, a * DEG, 0);
    expect(cl(5)).toBeGreaterThan(cl(0));
    expect(cl(10)).toBeGreaterThan(cl(5));
    expect(cl(crit)).toBeGreaterThan(cl(crit - 2));
    expect(cl(crit + 4)).toBeLessThan(cl(crit));
    expect(cl(crit + 9)).toBeLessThan(cl(crit + 4));
  });

  it('con flaps el CL máximo es mayor', () => {
    const max = (flap: number) => Math.max(...Array.from({ length: 30 }, (_, i) => liftCoefficient(cfg, i * DEG, flap)));
    expect(max(1)).toBeGreaterThan(max(0) + 0.4);
  });

  it('computeAero marca pérdida superado el ángulo crítico', () => {
    const base = {
      omega: [0, 0, 0] as [number, number, number], rho: 1.225, elevator: 0, aileron: 0, rudder: 0, trim: 0,
      flapDeg: 0, gearDown: 1, propwashQ: 0, heightAboveGround: Infinity, alphaDot: 0,
    };
    const at = (deg: number) => computeAero(cfg, { ...base, vAir: [30 * Math.cos(deg * DEG), 0, 30 * Math.sin(deg * DEG)] });
    expect(at(crit - 3).stalled).toBe(false);
    expect(at(crit + 3).stalled).toBe(true);
    expect(at(crit + 3).cd).toBeGreaterThan(at(crit - 3).cd);
  });

  it('en vuelo: motor al ralentí y palanca atrás ⇒ entra en pérdida y la nariz cae', () => {
    const sim = airborne(cfg, 40, 2000);
    sim.setControls({ throttle: 0, elevator: 1 });
    let stalledAt = -1;
    let maxAlpha = 0;
    let minPitchAfterStall = Infinity;
    run(sim, 30, (t) => {
      const s = sim.snapshot();
      maxAlpha = Math.max(maxAlpha, s.alpha);
      if (s.stalled && stalledAt < 0) stalledAt = t;
      if (stalledAt >= 0) minPitchAfterStall = Math.min(minPitchAfterStall, s.pitch);
    });
    expect(stalledAt).toBeGreaterThan(0);
    expect(maxAlpha / DEG).toBeGreaterThan(crit);
    // Después de la pérdida la nariz baja por debajo del horizonte.
    expect(minPitchAfterStall).toBeLessThan(0);
  });

  it('se recupera bajando la nariz y dando motor', () => {
    const sim = airborne(cfg, 40, 2000);
    sim.setControls({ throttle: 0, elevator: 1 });
    run(sim, 12);
    sim.setControls({ throttle: 1, elevator: -0.2 });
    run(sim, 6);
    sim.setControls({ elevator: 0.1 });
    run(sim, 10);
    const s = sim.snapshot();
    expect(s.stalled).toBe(0);
    expect(s.crashed).toBe(0);
    expect(s.ias).toBeGreaterThan(cfg.limits.vs);
  });
});
