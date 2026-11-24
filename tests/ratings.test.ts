import { describe, expect, it } from 'vitest';
import { buildRow } from '../src/lib/conditions';
import { parseRain, weatherWord } from '../src/lib/data/rain';
import type { Weather } from '../src/lib/data/openmeteo';
import {
  airFactor,
  band,
  dewFactor,
  rainFactor,
  rateHour,
  scoreMath,
  skyDarkFactor,
  windFactor,
} from '../src/lib/ratings';
import type { Rating } from '../src/lib/ratings';
import { SIMS, simStart } from '../src/lib/ratingsim';
import { parseHash } from '../src/lib/state/route';

function pick(rs: Rating[], id: Rating['id']): Rating {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no ${id} rating`);
  return r;
}

describe('rating rules', () => {
  it('rain: dry chance times the amount left below 1 mm', () => {
    expect(rainFactor(0, 0)).toBe(1);
    expect(rainFactor(0.2, 30)).toBeCloseTo(0.7 * 0.8, 10);
    expect(rainFactor(3, 10)).toBe(0);
    expect(rainFactor(null, null)).toBeNull();
    // No chance given: any measurable rain counts as certain.
    expect(rainFactor(0.5, null)).toBe(0);
    expect(rainFactor(0, null)).toBe(1);
  });
  it('wind, dew, sky darkness and air are straight lines clamped to 0–1', () => {
    expect(windFactor(10)).toBe(1);
    expect(windFactor(30)).toBeCloseTo(0.5, 10);
    expect(windFactor(60)).toBe(0);
    expect(dewFactor(-1)).toBe(0);
    expect(dewFactor(1.5)).toBeCloseTo(0.5, 10);
    expect(dewFactor(5)).toBe(1);
    expect(skyDarkFactor(22)).toBe(1);
    expect(skyDarkFactor(19.5)).toBeCloseTo(0.5, 10);
    expect(skyDarkFactor(16)).toBe(0);
    expect(airFactor(0)).toBe(1);
    expect(airFactor(150)).toBeCloseTo(0.5, 10);
    expect(airFactor(400)).toBe(0);
  });
  it('bands', () => {
    expect(band(null).cls).toBe('none');
    expect(band(80).cls).toBe('great');
    expect(band(55).cls).toBe('ok');
    expect(band(30).cls).toBe('meh');
    expect(band(29).cls).toBe('bad');
  });
});

describe('rateHour', () => {
  const place = { name: 'Test', lat: 13, lon: 77.6, elevation: 900 };
  // 2026-11-20 18:30 UTC = midnight in India: Sun far below the horizon.
  const t = Date.UTC(2026, 10, 20, 18, 30);
  const hour = {
    t: t - 1800_000,
    temperature: 18,
    humidity: 70,
    dewPoint: 12,
    pressure: 910,
    wind: 8,
    windDir: 90,
    gusts: 20,
    visibility: 20000,
    cloud: 30,
    cloudLow: 10,
    cloudMid: 0,
    cloudHigh: 40,
    upper: Object.fromEntries(
      [850, 700, 500, 300, 250, 200].map((l) => [l, { speed: 20, dir: 270, temp: -20 }]),
    ),
  } as Weather['hours'][number];
  const weather: Weather = {
    timezone: 'Asia/Kolkata',
    utcOffsetSeconds: 19800,
    elevation: 900,
    hours: [hour],
  };
  const row = buildRow(t, place, weather, null, null, 21.2);

  it('the five score factors match the imaging score exactly', () => {
    const rs = rateHour({ row, rain: null, darkSkyMag: 21.2, siteSqm: 21.2, elevation: 900 });
    const s = row.score;
    if (!s) throw new Error('no score');
    expect(pick(rs, 'clouds').value).toBe(Math.round(100 * s.clouds));
    expect(pick(rs, 'transparency').value).toBe(Math.round(100 * s.transparency));
    expect(pick(rs, 'moon').value).toBe(Math.round(100 * s.moon));
    expect(pick(rs, 'darkness').value).toBe(Math.round(100 * s.darkness));
    expect(pick(rs, 'seeing').value).toBe(Math.round(100 * s.seeing));
    expect(rs.filter((r) => r.inScore).map((r) => r.id)).toEqual([
      'clouds',
      'transparency',
      'moon',
      'darkness',
      'seeing',
    ]);
    expect(scoreMath(row)).toMatch(new RegExp(`= ${s.score}$`));
  });
  it('rates every condition, with the worked sum', () => {
    const rs = rateHour({
      row,
      rain: { t: hour.t, mm: 0.2, prob: 30, rain: 0.2, showers: 0, snow: 0, code: 61 },
      darkSkyMag: 21.2,
      siteSqm: 21.2,
      elevation: 900,
    });
    expect(rs).toHaveLength(11);
    expect(pick(rs, 'rain').value).toBe(56);
    expect(pick(rs, 'rain').math).toBe('100 × (1 − 0.30) × (1 − 0.20) = 56');
    expect(pick(rs, 'wind').value).toBe(75);
    expect(pick(rs, 'skydark').value).toBe(84);
    expect(pick(rs, 'clouds').math).toBe('100 × (1 − 0.10) × (1 − 0.00) × (1 − 0.6 × 0.40) = 68');
    expect(pick(rs, 'air').value).toBeNull();
    expect(pick(rs, 'confidence').value).toBeNull();
  });
  it('the try-it sliders start at the card values, with the same sum', () => {
    const input = {
      row,
      rain: { t: hour.t, mm: 0.2, prob: 30, rain: 0.2, showers: 0, snow: 0, code: 61 },
      darkSkyMag: 21.2,
      siteSqm: 21.2,
      elevation: 900,
    };
    for (const r of rateHour(input)) {
      if (r.value == null) continue;
      const out = SIMS[r.id].run(simStart(r.id, input));
      expect(out.value, r.id).toBe(r.value);
      expect(out.math, r.id).toBe(r.math);
    }
    // Sliders change the result.
    expect(SIMS.wind.run({ gust: 50 }).value).toBe(0);
    expect(SIMS.clouds.run({ low: 0, mid: 0, high: 0 }).value).toBe(100);
  });
});

describe('rain data', () => {
  it('parses hourly and daily series', () => {
    const r = parseRain({
      utc_offset_seconds: 19800,
      hourly: {
        time: [1000, 4600],
        precipitation: [0, 1.2],
        precipitation_probability: [5, 80],
        rain: [0, 1.2],
        showers: [0, 0],
        snowfall: [0, 0],
        weather_code: [1, 63],
      },
      daily: {
        time: [0],
        precipitation_sum: [1.2],
        precipitation_hours: [1],
        precipitation_probability_max: [80],
        snowfall_sum: [0],
        weather_code: [63],
      },
    });
    expect(r.hours[1]).toEqual({
      t: 4600_000,
      mm: 1.2,
      prob: 80,
      rain: 1.2,
      showers: 0,
      snow: 0,
      code: 63,
    });
    expect(r.days[0]?.probMax).toBe(80);
    expect(weatherWord(63)).toBe('Rain');
    expect(weatherWord(95)).toBe('Thunderstorm');
  });
  it('the new sections have links', () => {
    expect(parseHash('#/plan?s=rain')?.params.s).toBe('rain');
    expect(parseHash('#/plan?s=ratings')?.params.s).toBe('ratings');
    expect(parseHash('#/rain')).toEqual({ page: 'plan', params: { s: 'rain' }, redirected: true });
  });
});
