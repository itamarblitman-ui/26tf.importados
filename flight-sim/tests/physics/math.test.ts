import { describe, expect, it } from 'vitest';
import { qFromEuler, qRotate, qToEuler } from '../../src/physics/math/quat';
import { ecefToGeodetic, geodeticToEcef, deg2rad, LocalFrame } from '../../src/physics/geodesy';

describe('cuaterniones', () => {
  it('ida y vuelta Euler ↔ cuaternión', () => {
    const [y, p, r] = [deg2rad(123), deg2rad(-12), deg2rad(33)];
    const e = qToEuler(qFromEuler(y, p, r));
    expect(e[0]).toBeCloseTo(y, 9);
    expect(e[1]).toBeCloseTo(p, 9);
    expect(e[2]).toBeCloseTo(r, 9);
  });

  it('rumbo 90° apunta la nariz al este', () => {
    const nose = qRotate(qFromEuler(Math.PI / 2, 0, 0), [1, 0, 0]);
    expect(nose[0]).toBeCloseTo(0, 9);
    expect(nose[1]).toBeCloseTo(1, 9);
  });

  it('cabeceo positivo levanta la nariz (z NED negativa)', () => {
    const nose = qRotate(qFromEuler(0, deg2rad(10), 0), [1, 0, 0]);
    expect(nose[2]).toBeLessThan(0);
  });
});

describe('geodesia', () => {
  it('ECEF ↔ geodésica', () => {
    const g = { lat: deg2rad(-34.55), lon: deg2rad(-58.42), h: 1234.5 };
    const back = ecefToGeodetic(geodeticToEcef(g));
    expect(back.lat).toBeCloseTo(g.lat, 10);
    expect(back.lon).toBeCloseTo(g.lon, 10);
    expect(back.h).toBeCloseTo(g.h, 4);
  });

  it('el marco local respeta norte/este/abajo', () => {
    const f = new LocalFrame({ lat: deg2rad(-34.55), lon: deg2rad(-58.42), h: 0 });
    const north = f.toGeodetic([1000, 0, 0]);
    const up = f.toGeodetic([0, 0, -500]);
    expect(north.lat).toBeGreaterThan(deg2rad(-34.55));
    expect(up.h).toBeCloseTo(500, 3);
  });
});
