import { describe, expect, it } from 'vitest';
import {
  bestWindow,
  moonUpSpans,
  ribbonSpan,
  twilightSegments,
  type RibbonHour,
} from '../src/lib/ribbon';
import type { TwilightTimes } from '../src/lib/conditions';

const H = 3600_000;
const t0 = Date.UTC(2026, 10, 19, 12, 0); // 17:30 IST
const at = (h: number) => new Date(t0 + h * H);
const tw: TwilightTimes = {
  sunset: at(0.5),
  civilEnd: at(0.9),
  nauticalEnd: at(1.4),
  astroEnd: at(1.9),
  astroStart: at(11.3),
  nauticalStart: at(11.8),
  civilStart: at(12.3),
  sunrise: at(12.7),
};

describe('night ribbon', () => {
  it('spans 30 minutes before sunset to 30 minutes after sunrise', () => {
    const s = ribbonSpan(tw, t0);
    expect(s.start).toBe(at(0).getTime());
    expect(s.end).toBe(at(13.2).getTime());
  });

  it('orders the twilight bands and covers the span without gaps', () => {
    const span = ribbonSpan(tw, t0);
    const seg = twilightSegments(tw, span);
    expect(seg.map((s) => s.band)).toEqual([
      'day',
      'civil',
      'nautical',
      'astro',
      'dark',
      'astro',
      'nautical',
      'civil',
      'day',
    ]);
    expect(seg[0]?.from).toBe(span.start);
    expect(seg.at(-1)?.to).toBe(span.end);
    for (let i = 1; i < seg.length; i++) expect(seg[i]?.from).toBe(seg[i - 1]?.to);
  });

  it('leaves out the dark band when the Sun never reaches −18°', () => {
    const summer = { ...tw, astroEnd: null, astroStart: null };
    const seg = twilightSegments(summer, ribbonSpan(summer, t0));
    expect(seg.some((s) => s.band === 'dark')).toBe(false);
  });

  const hour = (h: number, score: number | null, moonAlt = -10, sunAlt = -30): RibbonHour => ({
    t: at(h).getTime(),
    cloud: null,
    moonAlt,
    sunAlt,
    score,
  });

  it('picks the contiguous dark run with the highest summed score', () => {
    const hours = [
      hour(1, 0.9, -10, -5), // twilight: excluded
      hour(2, 0.5),
      hour(3, 0.6),
      hour(4, 0.1), // clouds break the run
      hour(5, 0.8),
      hour(6, 0.9),
      hour(7, 0.7),
    ];
    expect(bestWindow(hours)).toEqual({ start: at(5).getTime(), end: at(8).getTime() });
  });

  it('returns no window when every hour is poor', () => {
    expect(bestWindow([hour(2, 0.1), hour(3, null)])).toBeNull();
  });

  it('finds the hours the Moon is up', () => {
    const hours = [hour(1, 1, -5), hour(2, 1, 3), hour(3, 1, 10), hour(4, 1, -1), hour(5, 1, 2)];
    expect(moonUpSpans(hours)).toEqual([
      { start: at(2).getTime(), end: at(4).getTime() },
      { start: at(5).getTime(), end: at(6).getTime() },
    ]);
  });
});
