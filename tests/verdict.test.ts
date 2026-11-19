import { describe, expect, it } from 'vitest';
import { verdict, darkWindow } from '../src/lib/plan/verdict';
import type { HourRow, TwilightTimes } from '../src/lib/conditions';

const H = 3600_000;
const t0 = Date.UTC(2026, 10, 19, 14, 30); // 20:00 IST
const tw: TwilightTimes = {
  sunset: new Date(t0 - 2 * H),
  civilEnd: new Date(t0 - 1.6 * H),
  nauticalEnd: new Date(t0 - 1.1 * H),
  astroEnd: new Date(t0 - 0.6 * H),
  astroStart: new Date(t0 + 8.8 * H),
  nauticalStart: new Date(t0 + 9.3 * H),
  civilStart: new Date(t0 + 9.8 * H),
  sunrise: new Date(t0 + 10.2 * H),
};
const fmt = (t: number) => new Date(t).toISOString().slice(11, 16);

function row(
  h: number,
  score: number,
  cloud: number,
  moonAlt = -10,
  extra: Partial<HourRow> = {},
): HourRow {
  return {
    t: t0 + h * H,
    weather: null,
    air: null,
    aod: null,
    extinction: null,
    sunAlt: -30,
    moonAlt,
    moonPhaseAngle: 120,
    agreement: 'high',
    cloudSpread: null,
    modelClouds: {},
    dew: null,
    seeing: {
      arcsec: 1.2,
      range: [1, 1.4],
      rating: 4,
      label: 'good',
      parts: { jet: 1, lower: 0.5, ground: 0.7 },
    } as HourRow['seeing'],
    score: { clouds: 1, transparency: 0.9, moon: 1, darkness: 1, seeing: 1, score },
    cloud: {
      total: cloud,
      low: cloud,
      mid: 0,
      high: 0,
      min: null,
      max: null,
      models: 8,
    } as HourRow['cloud'],
    ...extra,
  };
}

describe('tonight verdict', () => {
  it('uses astronomical darkness when there is some', () => {
    expect(darkWindow(tw)?.kind).toBe('astronomical');
    expect(darkWindow({ ...tw, astroEnd: null, astroStart: null })?.kind).toBe('nautical');
  });

  it('says go for a clear, moonless night', () => {
    const v = verdict(
      [0, 1, 2, 3, 4, 5, 6, 7].map((h) => row(h, 80, 5)),
      tw,
      0.05,
      fmt,
    );
    expect(v.level).toBe('go');
    expect(v.usableHours).toBe(8);
    expect(v.headline).toMatch(/^Yes/);
    expect(v.reasons[0]).toMatch(/Mostly clear/);
    expect(v.reasons.join(' ')).toMatch(/Moon only 5 %/);
  });

  it('says when clouds clear', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => (h < 3 ? row(h, 5, 90) : row(h, 70, 10)));
    const v = verdict(rows, tw, 0.1, fmt);
    expect(v.level).toBe('go');
    expect(v.reasons[0]).toBe(`Clouds early, clearing around ${fmt(t0 + 3 * H)}.`);
  });

  it('is marginal with one usable hour and no-go when nothing is usable', () => {
    const one = [0, 1, 2, 3].map((h) => row(h, h === 2 ? 50 : 10, 70));
    expect(verdict(one, tw, 0.5, fmt).level).toBe('maybe');
    const none = [0, 1, 2, 3].map((h) => row(h, 5, 100));
    const v = verdict(none, tw, 0.5, fmt);
    expect(v.level).toBe('nogo');
    expect(v.reasons[0]).toMatch(/Cloudy all night/);
  });

  it('recommends narrowband under a bright Moon and warns about dew and model disagreement', () => {
    const rows = [0, 1, 2, 3].map((h) =>
      row(h, 60, 5, 40, { dew: { risk: 'high', spread: 1, margin: 0 }, agreement: 'low' }),
    );
    const text = verdict(rows, tw, 0.8, fmt).reasons.join(' ');
    expect(text).toMatch(/narrowband/);
    expect(text).toMatch(/dew heater/);
    expect(text).toMatch(/models disagree/);
  });

  it('reports no darkness and missing forecasts honestly', () => {
    const noDark = {
      ...tw,
      astroEnd: null,
      astroStart: null,
      nauticalEnd: null,
      nauticalStart: null,
    };
    expect(verdict([], noDark, 0, fmt).level).toBe('nodark');
    expect(verdict([], tw, 0, fmt).level).toBe('unknown');
  });
});
