import { describe, expect, it } from 'vitest';
import { coverAt, groundDistance, renderClouds, type CloudInput } from '../src/lib/sky/clouds';

function input(
  low: number,
  mid: number,
  high: number,
  ring: Partial<Record<'low' | 'mid' | 'high', number>> = {},
): CloudInput {
  const samples = [35, 100].flatMap((dist) =>
    Array.from({ length: 8 }, (_, k) => ({
      az: k * 45,
      dist,
      low: ring.low ?? low,
      mid: ring.mid ?? mid,
      high: ring.high ?? high,
    })),
  );
  const wind = { speed: 30, dir: 270 };
  return {
    center: { low, mid, high },
    samples,
    wind: { low: wind, mid: wind, high: wind },
    time: 0,
    color: { low: [100, 100, 100], mid: [120, 120, 120], high: [200, 200, 200] },
    width: 256,
    height: 64,
  };
}

describe('cloud geometry', () => {
  it('distance to a layer is its height at the zenith and grows toward the horizon', () => {
    expect(groundDistance(90, 1.5)).toBeCloseTo(0, 6);
    expect(groundDistance(45, 1.5)).toBeCloseTo(1.5, 2);
    // Flat-earth h / tan(a) at 10° is 8.5 km; curvature barely matters there.
    expect(groundDistance(10, 1.5)).toBeCloseTo(8.5, 0);
    // At the horizon the line of sight grazes the Earth: √(2Rh) ≈ 138 km for 1.5 km.
    expect(groundDistance(0, 1.5)).toBeCloseTo(Math.sqrt(2 * 6371 * 1.5), -1);
  });
  it('interpolates cover between the site and the rings', () => {
    const c = input(0, 0, 0, { low: 80 });
    expect(coverAt(c, 'low', 0, 0)).toBeCloseTo(0, 6);
    expect(coverAt(c, 'low', 90, 17.5)).toBeCloseTo(0.4, 6);
    expect(coverAt(c, 'low', 90, 300)).toBeCloseTo(0.8, 6);
  });
});

describe('cloud coverage matches the forecast fraction', () => {
  for (const pct of [0, 25, 50, 75, 100]) {
    it(`low cloud ${pct}% → on average ${pct}% of the sky dome covered`, () => {
      // Sky cover as an observer judges it: the fraction of the dome's solid
      // angle (weight cos alt) that is covered. Any single moment is one random
      // realisation (the overhead patch is only ~3 km of cloud deck), so we
      // average over the deck drifting past for two hours.
      let sum = 0;
      const steps = 12;
      for (let s = 0; s < steps; s++) {
        const c = { ...input(pct, 0, 0), width: 256, height: 64, time: s * 600 };
        const img = renderClouds(c);
        let covered = 0;
        let total = 0;
        for (let j = 0; j < c.height; j++) {
          const wgt = Math.cos((((j + 0.5) / c.height) * 90 * Math.PI) / 180);
          for (let i = 0; i < c.width; i++) {
            covered += (wgt * (img[(j * c.width + i) * 4 + 3] ?? 0)) / 255 / 0.97;
            total += wgt;
          }
        }
        sum += covered / total;
      }
      expect(Math.abs(sum / steps - pct / 100)).toBeLessThan(0.06);
    });
  }
  it('clear sky gives a fully transparent texture', () => {
    const img = renderClouds(input(0, 0, 0));
    expect(Math.max(...Array.from(img.filter((_, k) => k % 4 === 3)))).toBe(0);
  });
});

describe('light domes in the sky glow', () => {
  it('a town to the east glows more in the east, and less higher up', () => {
    const domes = new Array<number>(36).fill(0);
    domes[9] = 40; // 90–100° azimuth
    const base = {
      width: 72,
      height: 18,
      center: { low: 0, mid: 0, high: 0 },
      samples: [],
      wind: { low: { speed: 0, dir: 0 }, mid: { speed: 0, dir: 0 }, high: { speed: 0, dir: 0 } },
      time: 0,
      color: { low: [0, 0, 0], mid: [0, 0, 0], high: [0, 0, 0] },
    } as unknown as CloudInput;
    const img = renderClouds({
      ...base,
      glow: { rgb: [128, 102, 86], zenithA: 0.05, domes, zenithRatio: 2 },
    });
    const a = (az: number, row: number) =>
      img[(row * 72 + Math.round((az / 360) * 72)) * 4 + 3] ?? 0;
    expect(a(95, 0)).toBeGreaterThan(a(275, 0) + 20);
    expect(a(95, 0)).toBeGreaterThan(a(95, 10));
  });
});
