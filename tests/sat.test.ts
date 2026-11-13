import { describe, expect, it, vi } from 'vitest';
import {
  blendLayers,
  blendSamples,
  cloudsNow,
  irCloudFraction,
  kelvinFromGrey,
  satelliteWeight,
} from '../src/lib/sat/ir';
import {
  GEO_LAYERS,
  floorSlot,
  frameTimes,
  geoTiles,
  gibsTime,
  latestTime,
} from '../src/lib/sat/gibs';
import { pixelFor } from '../src/lib/sat/gmgsi';

describe('infrared cloud estimate', () => {
  it('uses the GMGSI brightness scale', () => {
    expect(kelvinFromGrey(74)).toBe(293);
    expect(kelvinFromGrey(255)).toBe(202.5);
  });

  it('treats near-surface temperatures as clear and cold tops as cloud', () => {
    const surface = 295;
    expect(irCloudFraction([293, 290, 288], surface)).toBe(0); // within the clear margin
    expect(irCloudFraction([250, 240], surface)).toBe(1); // well below: cloud
    expect(irCloudFraction([281], surface)).toBeCloseTo(0.5, 5); // 14 K colder: half
    expect(irCloudFraction([], surface)).toBeNull();
  });

  it('trusts a fresh satellite more than an old one', () => {
    expect(satelliteWeight(1)).toBe(0.6);
    expect(satelliteWeight(-1)).toBe(0.6);
    expect(satelliteWeight(3.75)).toBeCloseTo(0.3, 5);
    expect(satelliteWeight(8)).toBe(0);
  });

  it('blends clouds now from model and satellite', () => {
    expect(cloudsNow(20, 1, 0.6)).toBeCloseTo(68, 5);
    expect(cloudsNow(20, null, 0.6)).toBe(20);
    expect(cloudsNow(null, 0.5, 0.6)).toBe(50);
    expect(cloudsNow(20, 1, 0)).toBe(20);
  });

  it('keeps the model layer split when scaling towards the satellite', () => {
    const out = blendLayers({ low: 20, mid: 0, high: 20 }, { frac: 0, meanK: 290 }, 0.6);
    expect(out.low).toBeCloseTo(8, 5);
    expect(out.high).toBeCloseTo(8, 5);
    expect(out.mid).toBe(0);
  });

  it('adds satellite-only cloud to high or mid by cloud-top temperature', () => {
    const clear = { low: 0, mid: 0, high: 0 };
    expect(blendLayers(clear, { frac: 1, meanK: 225 }, 0.6)).toEqual({ low: 0, mid: 0, high: 60 });
    expect(blendLayers(clear, { frac: 1, meanK: 260 }, 0.6)).toEqual({ low: 0, mid: 60, high: 0 });
    expect(blendLayers(clear, { frac: null, meanK: null }, 0.6)).toEqual(clear);
  });

  it('blends each ring sample with its own satellite point', () => {
    const samples = [
      { az: 0, dist: 35, low: 0, mid: 0, high: 0 },
      { az: 180, dist: 35, low: 0, mid: 0, high: 0 },
    ];
    const out = blendSamples(
      samples,
      [
        { frac: 1, meanK: 250 },
        { frac: 0, meanK: 290 },
      ],
      0.6,
    );
    expect(out[0]?.mid).toBe(60); // clouds to the north…
    expect(out[1]?.mid).toBe(0); // …clear to the south
  });
});

describe('GIBS times', () => {
  it('formats explicit 10-minute slots', () => {
    const t = Date.UTC(2026, 10, 13, 3, 27, 41);
    expect(gibsTime(floorSlot(t))).toBe('2026-11-13T03:20:00Z');
    expect(geoTiles('L', floorSlot(t))).toContain('/L/default/2026-11-13T03:20:00Z/');
    expect(geoTiles('L', floorSlot(t))).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/);
  });

  it('steps back from a missing time to the newest available one', async () => {
    const now = Date.UTC(2026, 10, 13, 4, 0);
    const ok = '2026-11-13T03:20:00Z';
    const fetchFn = vi.fn(async (url: string | URL | Request) => ({
      ok: String(url).includes(ok),
    })) as unknown as typeof fetch;
    const layer = GEO_LAYERS[0];
    if (!layer) throw new Error('no layers');
    const t = await latestTime(layer, now, undefined, fetchFn);
    expect(t).toBe(Date.UTC(2026, 10, 13, 3, 20));
    // 03:40 (start = now − 20 min), 03:30, 03:20 → three HEAD requests.
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('builds animation frames oldest first', () => {
    const latest = Date.UTC(2026, 10, 13, 3, 20);
    const f = frameTimes(latest, 3, 30);
    expect(f.map(gibsTime)).toEqual([
      '2026-11-13T02:20:00Z',
      '2026-11-13T02:50:00Z',
      '2026-11-13T03:20:00Z',
    ]);
  });
});

describe('GMGSI tile addressing', () => {
  it('finds the Web Mercator tile and pixel for a place', () => {
    // London at zoom 4: tile x 7 (lon −22.5…0), y 5.
    const p = pixelFor(51.5, -0.1, 4);
    expect([p.tx, p.ty]).toEqual([7, 5]);
    expect(p.px).toBeGreaterThan(250);
    expect(p.px).toBeLessThan(256);
    // Pune.
    const q = pixelFor(18.52, 73.86, 4);
    expect([q.tx, q.ty]).toEqual([11, 7]);
  });
});
