import { describe, expect, it } from 'vitest';
import { isaAtmosphere } from '../../src/physics/Atmosphere';
import { propellerLoads, steadyOmega } from '../../src/physics/Propulsion';
import { trainer } from './helpers';

const rpm = (w: number) => (w * 60) / (2 * Math.PI);

describe('motor y hélice', () => {
  const eng = trainer().engines[0];
  const rho0 = isaAtmosphere(0).density;

  it('RPM estáticas a pleno y al ralentí en rangos realistas', () => {
    const full = rpm(steadyOmega(eng, 1, 0, rho0));
    const idle = rpm(steadyOmega(eng, 0, 0, rho0));
    expect(full).toBeGreaterThan(2100);
    expect(full).toBeLessThan(2450);
    expect(idle).toBeGreaterThan(550);
    expect(idle).toBeLessThan(900);
  });

  it('las RPM suben con la velocidad (hélice de paso fijo)', () => {
    expect(steadyOmega(eng, 0.7, 55, rho0)).toBeGreaterThan(steadyOmega(eng, 0.7, 20, rho0));
  });

  it('el empuje estático es de ~2-3 kN y disminuye con la altitud', () => {
    const sl = propellerLoads(eng, steadyOmega(eng, 1, 0, rho0), 0, rho0).thrust;
    const rhoHigh = isaAtmosphere(3000).density;
    const hi = propellerLoads(eng, steadyOmega(eng, 1, 0, rhoHigh), 0, rhoHigh).thrust;
    expect(sl).toBeGreaterThan(2000);
    expect(sl).toBeLessThan(3200);
    expect(hi).toBeLessThan(sl * 0.85);
  });

  it('el empuje cae con la velocidad', () => {
    const w = steadyOmega(eng, 1, 0, rho0);
    expect(propellerLoads(eng, w, 50, rho0).thrust).toBeLessThan(propellerLoads(eng, w, 0, rho0).thrust);
  });
});
