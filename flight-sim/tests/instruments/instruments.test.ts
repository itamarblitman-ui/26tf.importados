import { describe, expect, it } from 'vitest';
import { isaAtmosphere } from '../../src/physics/Atmosphere';
import { emptySnapshot, type Snapshot } from '../../src/physics/snapshot';
import { indicatedAltitude, InstrumentModel, lag } from '../../src/instruments/InstrumentModel';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...emptySnapshot(), qnh: 101325, staticPressure: 101325, nz: 1, rpm0: 2300, ...over,
});

describe('instrumentos', () => {
  it('el altímetro indica la altitud ISA con 1013 hPa', () => {
    const p = isaAtmosphere(1500).pressure;
    expect(indicatedAltitude(p, 101325)).toBeCloseTo(1500 * 3.28084, 0);
  });

  it('subir el QNH en la ventanilla sube la indicación (~28 ft por hPa)', () => {
    const p = isaAtmosphere(500).pressure;
    const diff = indicatedAltitude(p, 101425) - indicatedAltitude(p, 101325);
    expect(diff).toBeGreaterThan(25);
    expect(diff).toBeLessThan(32);
  });

  it('el variómetro tiene retardo', () => {
    const m = new InstrumentModel();
    m.update(snap(), 0); // inicialización
    const r = m.update(snap({ vD: -5 }), 0.5); // 5 m/s de ascenso ≈ 984 fpm
    expect(r.verticalSpeed).toBeGreaterThan(100);
    expect(r.verticalSpeed).toBeLessThan(500);
    for (let i = 0; i < 100; i++) m.update(snap({ vD: -5 }), 0.1);
    expect(m.r.verticalSpeed).toBeCloseTo(984, -1);
  });

  it('la bola se desplaza hacia el lado de la fuerza lateral', () => {
    const m = new InstrumentModel();
    m.update(snap(), 0);
    for (let i = 0; i < 30; i++) m.update(snap({ ny: 0.1 }), 0.1);
    expect(m.r.slip).toBeGreaterThan(0.2);
  });

  it('sin motor, los giróscopos de vacío pierden rigidez', () => {
    const m = new InstrumentModel();
    m.update(snap(), 0);
    for (let i = 0; i < 1500; i++) m.update(snap({ rpm0: 0 }), 0.1);
    expect(m.r.gyroHealth).toBeLessThan(0.1);
  });

  it('filtro de primer orden converge', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = lag(v, 10, 0.5, 0.05);
    expect(v).toBeCloseTo(10, 3);
  });
});
