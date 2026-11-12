import { describe, expect, it } from 'vitest';
import { buildTimeline, moonEvents, nightWindow, twilight } from '../src/lib/conditions';
import type { Weather } from '../src/lib/data/openmeteo';

const greenwich = { name: 'Greenwich', lat: 51.4769, lon: -0.0005, elevation: 46 };

function fakeWeather(startMs: number, hours: number, cloud: number): Weather {
  const level = { speed: 20, dir: 270, temp: -40 };
  return {
    timezone: 'Europe/London',
    utcOffsetSeconds: 0,
    elevation: 47,
    hours: Array.from({ length: hours }, (_, i) => ({
      t: startMs + i * 3600_000,
      temperature: 5,
      humidity: 70,
      dewPoint: 0,
      pressure: 1005,
      wind: 10,
      windDir: 0,
      gusts: 20,
      visibility: 20000,
      cloud,
      cloudLow: cloud,
      cloudMid: 0,
      cloudHigh: 0,
      upper: { 850: level, 700: level, 500: level, 300: level, 250: level, 200: level },
    })),
  };
}

describe('tonight', () => {
  it('twilight times for Greenwich, 12 Nov 2026 (timeanddate.com: sunset 16:15, astro 18:11–05:18, sunrise 07:15)', () => {
    const tw = twilight(greenwich, new Date('2026-11-12T20:00:00Z'));
    const near = (d: Date | null, iso: string) =>
      expect(Math.abs((d?.getTime() ?? 0) - Date.parse(iso))).toBeLessThan(2 * 60e3);
    near(tw.sunset, '2026-11-12T16:15:00Z');
    near(tw.astroEnd, '2026-11-12T18:11:00Z');
    near(tw.astroStart, '2026-11-13T05:18:00Z');
    near(tw.sunrise, '2026-11-13T07:15:00Z');
  });

  it('builds one row per hour of the night with scores', () => {
    const from = new Date('2026-11-12T12:00:00Z');
    const win = nightWindow(greenwich, from);
    expect(win).not.toBeNull();
    if (!win) return;
    const wx = fakeWeather(Date.parse('2026-11-12T00:00:00Z'), 72, 0);
    const rows = buildTimeline(greenwich, win, wx, null, null);
    // Civil dusk ~16:53 to civil dawn ~06:36 → 14–15 hourly rows.
    expect(rows.length).toBeGreaterThanOrEqual(14);
    expect(rows.length).toBeLessThanOrEqual(15);
    // Clear sky in the middle of the night with a crescent Moon down: high score.
    const midnight = rows.find((r) => new Date(r.t).getUTCHours() === 0);
    expect(midnight?.score?.score).toBeGreaterThan(80);
    // Overcast night scores 0.
    const cloudy = buildTimeline(
      greenwich,
      win,
      fakeWeather(Date.parse('2026-11-12T00:00:00Z'), 72, 100),
      null,
      null,
    );
    expect(Math.max(...cloudy.map((r) => r.score?.score ?? 0))).toBe(0);
  });

  it('aligns rows to local hours in half-hour zones (India, UTC+5:30)', () => {
    const pune = { name: 'Pune', lat: 18.51957, lon: 73.85535, elevation: 554 };
    const win = nightWindow(pune, new Date('2026-11-12T16:13:00Z'));
    if (!win) throw new Error('no night');
    const wx = {
      ...fakeWeather(Date.parse('2026-11-11T18:30:00Z'), 72, 0),
      utcOffsetSeconds: 19800,
    };
    const rows = buildTimeline(pune, win, wx, null, null);
    // Every row starts on a local hour, i.e. at :30 UTC.
    expect(rows.every((r) => new Date(r.t).getUTCMinutes() === 30)).toBe(true);
    // 05:00–06:00 IST is sampled at 05:30, Sun ≈ −16°: partly dark, score > 0.
    const five = rows.find((r) => r.t === Date.parse('2026-11-12T23:30:00Z'));
    expect(five?.score?.score).toBeGreaterThan(30);
  });

  it('finds Moon rise and set', () => {
    const m = moonEvents(greenwich, new Date('2026-11-12T20:00:00Z'));
    expect(m.rise).not.toBeNull();
    expect(m.set).not.toBeNull();
    expect(m.illumination).toBeGreaterThan(0.05);
    expect(m.illumination).toBeLessThan(0.2);
  });
});
