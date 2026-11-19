import { describe, expect, it } from 'vitest';
import { horizonAlt, objectCurve, yearCurve } from '../src/lib/plan/curves';

const blr = { lat: 12.97, lon: 77.59, elevation: 920 };

describe('altitude curves', () => {
  it('M 31 from Bangalore peaks near 90 − |12.97 − 41.27| ≈ 61.7° (plus refraction)', () => {
    const from = Date.UTC(2026, 10, 19, 12, 0);
    const c = objectCurve(10.68471, 41.26875, blr, from, from + 12 * 3600_000, 5);
    const max = Math.max(...c.map((p) => p.alt));
    expect(max).toBeGreaterThan(61.5);
    expect(max).toBeLessThan(62.2);
  });

  it('best time of year: Orion is a winter target, Sagittarius a summer one', () => {
    const m42 = yearCurve(83.8221, -5.3911, blr, 2026, 30);
    const m8 = yearCurve(270.9042, -24.3867, blr, 2026, 30);
    const peak = (a: number[]) => a.indexOf(Math.max(...a));
    expect([10, 11, 0, 1]).toContain(peak(m42)); // Nov–Feb
    expect([4, 5, 6, 7]).toContain(peak(m8)); // May–Aug
  });

  it('reads the horizon profile by azimuth', () => {
    const p = new Array(720).fill(0);
    p[180] = 12; // azimuth 90°
    expect(horizonAlt(p, 90)).toBe(12);
    expect(horizonAlt(null, 90)).toBe(0);
  });
});
