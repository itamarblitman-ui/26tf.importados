import { describe, expect, it } from 'vitest';
import { isaAtmosphere, pressureAltitude } from '../../src/physics/Atmosphere';

describe('atmósfera ISA', () => {
  it('valores al nivel del mar', () => {
    const a = isaAtmosphere(0);
    expect(a.temperature).toBeCloseTo(288.15, 2);
    expect(a.pressure).toBeCloseTo(101325, 0);
    expect(a.density).toBeCloseTo(1.225, 3);
    expect(a.speedOfSound).toBeCloseTo(340.3, 1);
  });

  it('tropopausa (11 km)', () => {
    const a = isaAtmosphere(11000);
    expect(a.temperature).toBeCloseTo(216.65, 2);
    expect(a.pressure).toBeCloseTo(22632, -1);
    expect(a.density).toBeCloseTo(0.3639, 3);
  });

  it('3000 m', () => {
    const a = isaAtmosphere(3000);
    expect(a.density).toBeCloseTo(0.9091, 3);
  });

  it('día caluroso reduce la densidad', () => {
    expect(isaAtmosphere(0, 20).density).toBeLessThan(isaAtmosphere(0).density);
  });

  it('altitud de presión inversa', () => {
    expect(pressureAltitude(isaAtmosphere(2500).pressure)).toBeCloseTo(2500, 1);
  });
});
