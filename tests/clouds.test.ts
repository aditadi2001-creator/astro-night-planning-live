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

describe('thick and thin high cloud, and low cloud the satellite cannot see', () => {
  /** Mean texture alpha (0–1) above `minAlt` degrees, and the smallest one. */
  function alphaStats(img: Uint8ClampedArray, w: number, h: number, minAlt = 20) {
    let sum = 0;
    let n = 0;
    let min = 1;
    for (let j = Math.floor((minAlt / 90) * h); j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = (img[(j * w + i) * 4 + 3] ?? 0) / 255;
        sum += a;
        n++;
        min = Math.min(min, a);
      }
    }
    return { mean: sum / n, min };
  }

  it('draws 100 % high cloud as an opaque overcast when it is thick', () => {
    const c = { ...input(0, 0, 100), highOpacity: 0.98 };
    const s = alphaStats(renderClouds(c), c.width, c.height);
    expect(s.mean).toBeGreaterThan(0.95);
    expect(s.min).toBeGreaterThan(0.9); // no holes in a full overcast
  });

  it('still draws thin cirrus as a veil the sky shows through', () => {
    const c = { ...input(0, 0, 100), highOpacity: 0.4 };
    const s = alphaStats(renderClouds(c), c.width, c.height);
    expect(s.mean).toBeGreaterThan(0.35);
    expect(s.mean).toBeLessThan(0.45);
  });

  /** A uniform satellite field of one brightness temperature. */
  const field = (bt: number, surfaceK: number, weight: number) => {
    const n = 41;
    return {
      n,
      stepKm: 5,
      bt: new Float32Array(n * n).fill(bt),
      surfaceK,
      weight,
      ageS: 0,
      highK: 235,
    };
  };

  it('takes the thickness of high cloud from the satellite where it sees it', () => {
    // Model: 100 % high, typical (thin) opacity; satellite: a 240 K deck over 299 K ground.
    const c = { ...input(0, 0, 100), highOpacity: 0.5, field: field(240, 299, 0.85) };
    expect(alphaStats(renderClouds(c), c.width, c.height).mean).toBeGreaterThan(0.85);
  });

  it('keeps most of the model’s low cloud when the satellite reads warm (stratus)', () => {
    // Satellite sees ground temperature everywhere; the model has an overcast of low cloud.
    const c = { ...input(100, 0, 0), field: field(299, 299, 0.85) };
    // At most LOW_DENY × weight = 25.5 % removed → ≥ 74.5 % cover × 0.97 opacity.
    expect(alphaStats(renderClouds(c), c.width, c.height).mean).toBeGreaterThan(0.68);
  });
});

describe('the satellite corrects total cover without splitting a deck', () => {
  const field = (bt: number, weight: number) => {
    const n = 41;
    return {
      n,
      stepKm: 5,
      bt: new Float32Array(n * n).fill(bt),
      surfaceK: 299,
      weight,
      ageS: 0,
      highK: 235,
    };
  };
  const meanAlpha = (img: Uint8ClampedArray, w: number, h: number) => {
    let s = 0;
    let n = 0;
    for (let j = Math.floor(h * 0.2); j < h; j++)
      for (let i = 0; i < w; i++) {
        s += (img[(j * w + i) * 4 + 3] ?? 0) / 255;
        n++;
      }
    return s / n;
  };

  it('keeps a 100 % deck whole when its tops straddle the mid/high boundary (Bangalore, 15 Nov)', () => {
    // 255 K tops over 299 K ground = 6.8 km: the satellite alone would call it 36 % high, 64 % mid.
    const c = { ...input(0, 0, 100), highOpacity: 0.95, field: field(255, 0.6) };
    expect(meanAlpha(renderClouds(c), c.width, c.height)).toBeGreaterThan(0.9);
  });

  it('clears the sky where the satellite sees ground under a forecast high deck', () => {
    const c = { ...input(0, 0, 100), highOpacity: 0.95, field: field(299, 0.85) };
    expect(meanAlpha(renderClouds(c), c.width, c.height)).toBeLessThan(0.3);
  });

  it('adds a deck the models missed, at the height its tops say', () => {
    const c = { ...input(0, 0, 0), field: field(240, 0.85) };
    expect(meanAlpha(renderClouds(c), c.width, c.height)).toBeGreaterThan(0.6);
  });
});
