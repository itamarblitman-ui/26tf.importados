import { describe, expect, it } from 'vitest';
import { cloudsAround, cloudsForCell } from '../../src/world/cloudField';

describe('campo de nubes', () => {
  it('es determinista por celda', () => {
    expect(cloudsForCell(10, -20, 'scattered')).toEqual(cloudsForCell(10, -20, 'scattered'));
  });

  it('más cobertura ⇒ más nubes; despejado ⇒ ninguna', () => {
    const n = (c: Parameters<typeof cloudsAround>[2]) => cloudsAround(-34.5, -58.4, c, 6).length;
    expect(n('clear')).toBe(0);
    expect(n('few')).toBeLessThan(n('scattered'));
    expect(n('scattered')).toBeLessThan(n('broken'));
    expect(n('broken')).toBeLessThanOrEqual(n('overcast'));
  });

  it('moverse un poco no cambia las nubes ya existentes', () => {
    const a = cloudsAround(-34.5, -58.4, 'broken', 5);
    const b = cloudsAround(-34.5005, -58.4005, 'broken', 5);
    const key = (c: { lat: number; lon: number }) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
    const setB = new Set(b.map(key));
    const shared = a.filter((c) => setB.has(key(c))).length;
    expect(shared / a.length).toBeGreaterThan(0.9);
  });
});
