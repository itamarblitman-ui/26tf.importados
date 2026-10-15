import { describe, expect, it } from 'vitest';
import { onRunway, run, trainer } from './helpers';

describe('tren de aterrizaje', () => {
  const cfg = trainer();

  it('en reposo sobre la pista con freno de estacionamiento queda quieto y estable', () => {
    const sim = onRunway(cfg);
    sim.setControls({ parkingBrake: true, throttle: 0 });
    const g0 = sim.geodetic();
    run(sim, 10);
    const s = sim.snapshot();
    expect(s.crashed).toBe(0);
    expect(s.onGround).toBe(1);
    expect(s.groundSpeed).toBeLessThan(0.05);
    expect(Math.abs(s.pitch)).toBeLessThan(0.03);
    expect(Math.abs(s.roll)).toBeLessThan(0.01);
    expect(Math.abs(sim.geodetic().h - g0.h)).toBeLessThan(0.05);
  });

  it('carrera de despegue a pleno con rotación a Vr', () => {
    const sim = onRunway(cfg, 90);
    sim.setControls({ throttle: 1, flapsIndex: 0 });
    const start = sim.snapshot();
    let liftoffDist = -1;
    run(sim, 60, () => {
      const s = sim.snapshot();
      if (s.ias > cfg.limits.vr) sim.setControls({ elevator: 0.3 });
      if (!s.onGround && liftoffDist < 0 && s.agl > 0.3) {
        const dLon = (s.lon - start.lon) * Math.PI / 180 * 6371000 * Math.cos(s.lat * Math.PI / 180);
        liftoffDist = dLon;
        return false;
      }
    });
    expect(liftoffDist).toBeGreaterThan(200);
    expect(liftoffDist).toBeLessThan(600);
    expect(sim.snapshot().crashed).toBe(0);
  });

  it('el despegue sigue en línea recta (deriva lateral < 5 m)', () => {
    const sim = onRunway(cfg, 0);
    sim.setControls({ throttle: 1 });
    const start = sim.snapshot();
    run(sim, 12);
    const s = sim.snapshot();
    const lateral = (s.lon - start.lon) * Math.PI / 180 * 6371000 * Math.cos(s.lat * Math.PI / 180);
    expect(Math.abs(lateral)).toBeLessThan(5);
  });

  it('los frenos detienen el avión', () => {
    const sim = onRunway(cfg, 90);
    sim.setControls({ throttle: 1 });
    run(sim, 8);
    const v0 = sim.snapshot().groundSpeed;
    expect(v0).toBeGreaterThan(12);
    sim.setControls({ throttle: 0, brakeLeft: 1, brakeRight: 1 });
    run(sim, 10);
    expect(sim.snapshot().groundSpeed).toBeLessThan(0.3);
    expect(sim.snapshot().crashed).toBe(0);
  });

  it('el timón dirige la rueda de nariz en carreteo', () => {
    const sim = onRunway(cfg, 0);
    sim.setControls({ throttle: 0.4, rudder: 1 });
    run(sim, 10);
    const s = sim.snapshot();
    expect(s.heading).toBeGreaterThan(0.3);
    expect(s.heading).toBeLessThan(Math.PI);
  });

  it('rotar de más roza la cola pero no destruye el avión', () => {
    const sim = onRunway(cfg, 90);
    sim.setControls({ throttle: 1 });
    run(sim, 30, () => { if (sim.snapshot().ias > 25) sim.setControls({ elevator: 1 }); });
    const s = sim.snapshot();
    expect(s.crashed).toBe(0);
  });

  it('un impacto vertical fuerte colapsa el tren', () => {
    const sim = onRunway(cfg);
    sim.vel = [0, 0, 6]; // 6 m/s hacia abajo (NED)
    run(sim, 1);
    expect(sim.snapshot().crashed).toBe(1);
  });
});
