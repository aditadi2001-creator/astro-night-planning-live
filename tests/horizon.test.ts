import { describe, expect, it } from 'vitest';
import {
  glowAlpha,
  domeAt,
  horizonDip,
  horizonProfile,
  renderTerrain,
} from '../src/lib/sky/horizon';

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

describe('light domes on the horizon', () => {
  it('judges a dome against the local sky, not the natural sky', () => {
    // Same dome excess, dark rural site vs city centre: much stronger in the country.
    expect(glowAlpha(20, 0.2, 2)).toBeGreaterThan(0.5);
    expect(glowAlpha(20, 50, 2)).toBeLessThan(0.4);
    expect(glowAlpha(1000, 0, 0)).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it('adds a capped all-round haze for bright skies and tapers out before 28°', () => {
    expect(glowAlpha(0, 0, 1)).toBe(0); // natural sky: nothing
    expect(glowAlpha(0, 50, 0)).toBeCloseTo(0.35, 2); // city: capped haze
    expect(glowAlpha(0, 50, 20)).toBeLessThan(0.05);
    expect(glowAlpha(100, 50, 28)).toBe(0);
    expect(glowAlpha(100, 50, -1)).toBe(0); // below the horizon: ground
  });

  it('interpolates sectors around the compass', () => {
    const domes = new Array<number>(36).fill(0);
    domes[9] = 10; // 90°–100° (centre 95°)
    expect(domeAt(domes, 95)).toBeCloseTo(10, 9);
    expect(domeAt(domes, 270)).toBe(0);
    expect(domeAt(domes, 100)).toBeCloseTo(5, 9);
  });

  it('paints a dome towards a town from a dark site, only at night', () => {
    const profile = new Float32Array(720); // flat horizon
    const domes = new Array<number>(36).fill(0);
    domes[9] = 20; // a town to the east
    const w = 360;
    const h = 120; // 1° per row from −90° to +30°
    const glow = { domes, zenith: 0.3, strength: 1 };
    const lit = renderTerrain(profile, [0, 0, 0], w, h, -90, 30, glow);
    const alpha = (az: number, alt: number) => lit[(Math.floor(alt + 90) * w + az) * 4 + 3] ?? 0;
    expect(alpha(95, 2)).toBeGreaterThan(100); // east, just above the horizon
    expect(alpha(95, 15)).toBeLessThan(alpha(95, 2)); // fades with height
    expect(alpha(95, 29)).toBe(0); // no edge at the top of the layer
    expect(alpha(275, 2)).toBeLessThan(10); // west: only a faint haze
    expect(alpha(95, -10)).toBe(255); // ground stays opaque
    const day = renderTerrain(profile, [0, 0, 0], w, h, -90, 30, { ...glow, strength: 0 });
    expect(day[(92 * w + 95) * 4 + 3]).toBe(0);
  });
});
