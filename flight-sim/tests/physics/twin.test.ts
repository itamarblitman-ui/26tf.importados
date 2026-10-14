import { describe, expect, it } from 'vitest';
import { trimLevelFlight } from '../../src/physics/Simulation';
import { loadAircraft, onRunway, run, airborne } from './helpers';

const R2D = 180 / Math.PI;

describe('bimotor (misma física, otro JSON)', () => {
  const cfg = loadAircraft('chaja-t300');

  it('se compensa en crucero a varias velocidades', () => {
    for (const V of [50, 70, 85]) {
      const t = trimLevelFlight(cfg, V, 2000);
      expect(t.converged, `V=${V}`).toBe(true);
      expect(Math.abs(t.aileron)).toBeLessThan(0.05); // motores contrarrotativos: simétrico
    }
  });

  it('vuelo nivelado estable con hélices de velocidad constante', () => {
    const sim = airborne(cfg, 80, 2000);
    const h0 = sim.geodetic().h;
    let maxDev = 0;
    run(sim, 60, () => { maxDev = Math.max(maxDev, Math.abs(sim.geodetic().h - h0)); });
    expect(maxDev).toBeLessThan(8);
    const s = sim.snapshot();
    // El regulador mantiene las RPM cerca de 2550
    expect(s.rpm0).toBeGreaterThan(2400);
    expect(s.rpm0).toBeLessThan(2700);
    expect(Math.abs(s.rpm0 - s.rpm1)).toBeLessThan(5);
  });

  it('despega en menos distancia que la pista de Aeroparque', () => {
    const sim = onRunway(cfg, 90);
    sim.setControls({ throttle: 1, gearDown: true });
    const start = sim.snapshot();
    let dist = -1;
    run(sim, 60, () => {
      const s = sim.snapshot();
      if (s.ias > cfg.limits.vr) sim.setControls({ elevator: 0.35 });
      if (s.agl > 0.5 && !s.onGround) {
        dist = (s.lon - start.lon) * Math.PI / 180 * 6371000 * Math.cos(s.lat * Math.PI / 180);
        return false;
      }
    });
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(1200);
  });

  it('el tren sube en vuelo y no se puede retraer en tierra', () => {
    const ground = onRunway(cfg);
    ground.setControls({ gearDown: false });
    run(ground, 3);
    expect(ground.snapshot().gearExtension).toBe(1);
    const air = airborne(cfg, 70, 1500);
    air.setControls({ gearDown: false });
    run(air, 8);
    expect(air.snapshot().gearExtension).toBe(0);
    air.setControls({ gearDown: true });
    run(air, 8);
    expect(air.snapshot().gearExtension).toBe(1);
  });

  it('con un motor detenido guiña hacia el motor muerto y el timón lo controla', () => {
    const free = airborne(cfg, 60, 1500);
    free.setControls({ throttle: 1, engineOn: [true, false] });
    const h0 = free.snapshot().heading;
    run(free, 6);
    const yawFree = free.snapshot().heading - h0;

    const held = airborne(cfg, 60, 1500);
    held.setControls({ throttle: 1, engineOn: [true, false], rudder: -0.33, aileron: -0.05 });
    const h1 = held.snapshot().heading;
    run(held, 6);
    const yawHeld = held.snapshot().heading - h1;

    expect(yawFree * R2D).toBeGreaterThan(5); // derecho muerto ⇒ nariz a la derecha
    expect(Math.abs(yawHeld)).toBeLessThan(Math.abs(yawFree) * 0.5);
  });
});
