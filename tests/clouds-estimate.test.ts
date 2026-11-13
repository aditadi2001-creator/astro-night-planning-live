import { describe, expect, it } from 'vitest';
import {
  consensusAt,
  estimateClouds,
  median,
  nowcastWeight,
  overlap,
  scaleLayers,
  timelineEnd,
  timelineStart,
} from '../src/lib/clouds/estimate';
import { CONSENSUS_MODELS, type ModelClouds } from '../src/lib/data/openmeteo';

const H = 3600_000;
const IST = 19800;
// 13 Nov 2026, 17:00 IST = 11:30 UTC.
const NOW = Date.parse('2026-11-13T11:30:00Z');

/** Eight models, all with the same layers except where given per model. */
function models(
  start: number,
  hours: number,
  layers: (m: number, i: number) => [number, number, number],
): ModelClouds {
  return {
    hours: Array.from({ length: hours }, (_, i) => {
      const byModel: Record<string, number | null> = {};
      const L: ModelClouds['hours'][number]['layers'] = {};
      CONSENSUS_MODELS.forEach((m, k) => {
        const [l, mi, h] = layers(k, i);
        L[m] = { low: l, mid: mi, high: h };
        byModel[m] = Math.round(overlap(l, mi, h));
      });
      return { t: start + i * H, byModel, layers: L };
    }),
  };
}

describe('model consensus', () => {
  it('takes the median per layer', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
    const mc = models(NOW, 1, (k) => [k * 10, 0, k === 7 ? 100 : 0]);
    const c = consensusAt(mc, NOW);
    expect(c?.low).toBe(35); // median of 0..70
    expect(c?.high).toBe(0); // one model's 100 % cirrus is outvoted
    expect(c?.models).toBe(8);
    expect(c?.max).toBe(100);
  });
});

describe('satellite correction', () => {
  it('scales layers to a target total, keeping their proportions', () => {
    const s = scaleLayers({ low: 10, mid: 10, high: 90 }, 40, null);
    expect(overlap(s.low, s.mid, s.high)).toBeCloseTo(40, 0);
    expect(s.high).toBeGreaterThan(s.low * 5);
    // Forecast clear, satellite sees a cold (high) top.
    expect(scaleLayers({ low: 0, mid: 0, high: 0 }, 50, 225)).toEqual({ low: 0, mid: 0, high: 50 });
  });

  it('fades the satellite out over a few hours', () => {
    expect(nowcastWeight(NOW, NOW)).toBeCloseTo(0.85, 5);
    expect(nowcastWeight(NOW + 3 * H, NOW)).toBeCloseTo(0.85 / Math.E, 5);
    expect(nowcastWeight(NOW + 12 * H, NOW)).toBeLessThan(0.02);
  });

  it('Bangalore, 13 Nov 2026: models say 95 % cirrus, the satellite sees clear sky', () => {
    const mc = models(NOW - 6 * H, 24, () => [5, 3, 95]);
    const obs = [
      { time: NOW, frac: 0, meanK: 292.5 },
      { time: NOW - H, frac: 0, meanK: 294.5 },
      { time: NOW - 2 * H, frac: 0.05, meanK: 294.5 },
    ];
    const at = (dh: number) => estimateClouds(NOW + dh * H - 1800_000, NOW, mc, null, obs);
    // Hours already past come from the satellite record.
    const past = at(-2);
    expect(past?.kind).toBe('observed');
    expect(past?.total).toBeCloseTo(5, 5);
    // Next hour: mostly the satellite.
    const next = at(1);
    expect(next?.kind).toBe('nowcast');
    expect(next?.total).toBeLessThan(40);
    // Later in the night the models take over again.
    const late = at(9);
    expect(late?.kind).toBe('forecast');
    expect(late?.total).toBeGreaterThan(85);
  });
});

describe('timeline window', () => {
  it('runs from 3 hours ago to the coming 05:00 local', () => {
    // 17:00 IST → starts 14:00 IST, ends after the 05:00–06:00 hour next morning.
    expect(new Date(timelineStart(NOW, IST)).toISOString()).toBe('2026-11-13T08:30:00.000Z');
    expect(new Date(timelineEnd(NOW, IST)).toISOString()).toBe('2026-11-14T00:30:00.000Z');
    // 02:00 IST → the same night's 05:00.
    const late = Date.parse('2026-11-13T20:30:00Z');
    expect(new Date(timelineEnd(late, IST)).toISOString()).toBe('2026-11-14T00:30:00.000Z');
  });
});
