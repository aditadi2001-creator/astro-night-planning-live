import { describe, expect, it } from 'vitest';
import { horizonDip, horizonProfile, renderTerrain } from '../src/lib/sky/horizon';

const flat = () => 0;
const R_EFF = 6_371_000 / (1 - 0.13);

describe('terrain horizon', () => {
  it('flat ground: horizon sits just below 0° (curvature dip)', () => {
    const p = horizonProfile(flat, 2, { bins: 8 });
    for (const v of p) {
      expect(v).toBeLessThan(0);
      expect(v).toBeGreaterThan(-0.1);
    }
  });

  it('a 1000 m ridge 10 km to the east rises to atan((1000 − 2 − drop)/10 km)', () => {
    const ridge = (e: number) => (e > 9_900 && e < 10_100 ? 1000 : 0);
    const p = horizonProfile(ridge, 2, { bins: 360 });
    const drop = 10_000 ** 2 / (2 * R_EFF);
    const expected = (Math.atan2(1000 - 2 - drop, 10_000) * 180) / Math.PI; // ≈ 5.70°
    expect(p[90]).toBeCloseTo(expected, 1); // bin centred on 90.5°
    expect(p[270]).toBeLessThan(0); // west stays flat
  });

  it('a distant 3000 m range 100 km away appears ~1.3° high after curvature and refraction', () => {
    const range = (_e: number, n: number) => (n > 99_000 && n < 101_000 ? 3000 : 0);
    const p = horizonProfile(range, 2, { bins: 360 });
    const drop = 100_000 ** 2 / (2 * R_EFF); // ≈ 683 m
    expect(p[0]).toBeCloseTo((Math.atan2(3000 - 2 - drop, 100_000) * 180) / Math.PI, 1);
  });

  it('sea-horizon dip for a 2 m eye is ~2.5′ (standard nautical value 1.76′√h ≈ 2.49′)', () => {
    expect(horizonDip(2) * -60).toBeCloseTo(1.76 * Math.sqrt(2), 0);
  });

  it('renders an opaque ground below the profile and clear sky above it', () => {
    const p = new Float32Array(360).fill(5);
    const img = renderTerrain(p, [10, 10, 10], 64, 120, -90, 30); // 1° rows
    const alphaAt = (alt: number) => img[(Math.floor(alt + 90) * 64 + 10) * 4 + 3] ?? 0;
    expect(alphaAt(0)).toBe(255);
    expect(alphaAt(10)).toBe(0);
  });
});
