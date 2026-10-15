import { describe, expect, it } from 'vitest';
import { dateForLocalSolarHour, localSolarHour, solarElevation } from '../../src/world/sun';

describe('sol', () => {
  it('equinoccio, mediodía solar en el ecuador: sol casi en el cenit', () => {
    const d = dateForLocalSolarHour(12, 0, new Date(Date.UTC(2026, 2, 20)));
    expect(solarElevation(d, 0, 0)).toBeGreaterThan(87);
  });

  it('Buenos Aires: mediodía de verano alto, medianoche bajo el horizonte', () => {
    const base = new Date(Date.UTC(2026, 11, 21));
    const noon = dateForLocalSolarHour(12, -58.4, base);
    const midnight = dateForLocalSolarHour(0, -58.4, base);
    // 90 - (34.6 - 23.44) ≈ 78.9°
    expect(solarElevation(noon, -34.6, -58.4)).toBeCloseTo(78.9, 0);
    expect(solarElevation(midnight, -34.6, -58.4)).toBeLessThan(-20);
  });

  it('el amanecer está entre las 5 y las 7 hora solar en el equinoccio', () => {
    const base = new Date(Date.UTC(2026, 8, 22));
    expect(solarElevation(dateForLocalSolarHour(5, -58.4, base), -34.6, -58.4)).toBeLessThan(0);
    expect(solarElevation(dateForLocalSolarHour(7, -58.4, base), -34.6, -58.4)).toBeGreaterThan(0);
  });

  it('hora solar local ida y vuelta', () => {
    expect(localSolarHour(dateForLocalSolarHour(17.5, -58.4), -58.4)).toBeCloseTo(17.5, 6);
  });
});
