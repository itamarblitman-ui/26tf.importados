import { describe, expect, it } from 'vitest';
import { defaultAutopilot } from '../../src/physics/Autopilot';
import { airborne, run, trainer } from './helpers';

const R2D = 180 / Math.PI;

describe('piloto automático', () => {
  const cfg = trainer();

  it('mantiene la altitud después de una perturbación', () => {
    const sim = airborne(cfg, 50, 1500);
    const alt0 = sim.snapshot().altMsl;
    sim.setControls({ autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, hdgHold: true, heading: 90, altitude: alt0, session: 1 } });
    run(sim, 2);
    sim.omega = [0.3, 0.15, 0];
    let maxDev = 0;
    run(sim, 90, (t) => { if (t > 30) maxDev = Math.max(maxDev, Math.abs(sim.snapshot().altMsl - alt0)); });
    expect(maxDev).toBeLessThan(15);
    expect(Math.abs(sim.snapshot().roll * R2D)).toBeLessThan(3);
    expect(sim.snapshot().apEngaged).toBe(1);
  });

  it('vira al rumbo seleccionado sin perder altura', () => {
    const sim = airborne(cfg, 50, 1500);
    const alt0 = sim.snapshot().altMsl;
    sim.setControls({ autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, hdgHold: true, heading: 200, altitude: alt0, session: 1 } });
    let maxBank = 0;
    run(sim, 90, () => { maxBank = Math.max(maxBank, Math.abs(sim.snapshot().roll * R2D)); });
    const s = sim.snapshot();
    expect(Math.abs(s.heading * R2D - 200)).toBeLessThan(3);
    expect(maxBank).toBeLessThan(30);
    expect(Math.abs(s.altMsl - alt0)).toBeLessThan(25);
  });

  it('asciende a la altitud seleccionada y la captura', () => {
    const sim = airborne(cfg, 45, 1000);
    const alt0 = sim.snapshot().altMsl;
    sim.setControls({
      throttle: 1,
      autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, hdgHold: true, heading: 90, altitude: alt0 + 300, session: 1 },
    });
    run(sim, 180);
    expect(Math.abs(sim.snapshot().altMsl - (alt0 + 300))).toBeLessThan(15);
  });

  it('el control de velocidad lleva la IAS al valor pedido', () => {
    const sim = airborne(cfg, 45, 1500);
    const alt0 = sim.snapshot().altMsl;
    sim.setControls({ autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, spdHold: true, hdgHold: true, heading: 90, altitude: alt0, speed: 52, session: 1 } });
    run(sim, 150);
    expect(Math.abs(sim.snapshot().ias - 52)).toBeLessThan(2);
  });

  it('se desconecta si el piloto mueve la palanca con firmeza', () => {
    const sim = airborne(cfg, 50, 1500);
    sim.setControls({ autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, altitude: 1500, session: 7 } });
    run(sim, 2);
    sim.setControls({ elevator: 0.8 });
    run(sim, 0.2);
    expect(sim.snapshot().apEngaged).toBe(0);
    expect(sim.snapshot().apDisconnects).toBe(1);
    // Un pedido viejo con la misma sesión no lo vuelve a conectar
    sim.setControls({ elevator: 0, autopilot: { ...defaultAutopilot(), engaged: true, altHold: true, altitude: 1500, session: 7 } });
    run(sim, 1);
    expect(sim.snapshot().apDisconnects).toBe(1);
  });
});
