import { describe, expect, it } from 'vitest';
import {
  constellationOf,
  fmtDMS,
  fmtHours,
  fmtRA,
  galactic,
  hourAngle,
  localSiderealHours,
} from '../src/lib/astro/skycoords';
import { LEGEND, lpColor, paletteTable, recolor, sqmFromGrey } from '../src/lib/lp/lpmap';

describe('galactic coordinates', () => {
  it('galactic centre (Sgr A*) is at l ≈ 0, b ≈ 0', () => {
    const g = galactic(266.405, -28.936);
    expect(Math.min(g.l, 360 - g.l)).toBeLessThan(0.1);
    expect(Math.abs(g.b)).toBeLessThan(0.1);
  });
  it('north galactic pole is at b = 90', () => {
    expect(galactic(192.85948, 27.12825).b).toBeCloseTo(90, 2);
  });
  it('Vega: l ≈ 67.45, b ≈ 19.24', () => {
    const g = galactic(279.2347, 38.7837);
    expect(g.l).toBeCloseTo(67.45, 1);
    expect(g.b).toBeCloseTo(19.24, 1);
  });
});

describe('hour angle and sidereal time', () => {
  it('sidereal time at Greenwich, 2000-01-01 12:00 UT ≈ 18.697 h', () => {
    expect(localSiderealHours(new Date(Date.UTC(2000, 0, 1, 12)), 0)).toBeCloseTo(18.697, 2);
  });
  it('a star on the meridian has hour angle 0', () => {
    const d = new Date(Date.UTC(2026, 10, 13, 20));
    const lst = localSiderealHours(d, 77.2);
    expect(hourAngle(d, 77.2, lst * 15)).toBeCloseTo(0, 6);
    expect(hourAngle(d, 77.2, lst * 15 - 30)).toBeCloseTo(2, 6);
    expect(hourAngle(d, 77.2, lst * 15 + 30)).toBeCloseTo(-2, 6);
  });
  it('formats hours', () => {
    expect(fmtHours(-1.5)).toBe('−1h 30m');
    expect(fmtHours(2.999, true)).toBe('+3h 00m');
  });
});

describe('constellations (IAU boundaries)', () => {
  it('finds Orion, Lyra and Andromeda', () => {
    expect(constellationOf(83.82, -5.39).abbr).toBe('Ori'); // M42
    expect(constellationOf(279.23, 38.78).name).toBe('Lyra'); // Vega
    expect(constellationOf(10.68, 41.27).abbr).toBe('And'); // M31
  });
});

describe('light-pollution palette', () => {
  it('natural sky is transparent, a city is bright', () => {
    expect(lpColor(22.0)[3]).toBe(0);
    expect(lpColor(16)).toEqual([255, 255, 255, 236]);
    const mid = lpColor(19.75); // between green and yellow
    expect(mid[1]).toBeGreaterThan(150);
  });
  it('grey → SQM: 40 steps per magnitude', () => {
    expect(sqmFromGrey(0)).toBe(22);
    expect(sqmFromGrey(40)).toBeCloseTo(21, 6);
    expect(sqmFromGrey(200)).toBeCloseTo(17, 6);
  });
  it('recolours a tile with the table', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
    recolor(px, paletteTable());
    expect(px[3]).toBe(0);
    expect(Array.from(px.slice(4))).toEqual([255, 255, 255, 236]);
  });
  it('legend has nine Bortle classes', () => {
    expect(LEGEND.map((l) => l.bortle)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('sexagesimal formatting', () => {
  it('formats RA and Dec with carries', () => {
    expect(fmtRA(83.8221)).toBe('5h 35m 17.3s');
    expect(fmtRA(359.99999)).toBe('0h 00m 00.0s');
    expect(fmtDMS(-5.3911)).toBe('−5° 23′ 28″');
    expect(fmtDMS(38.99999)).toBe('+39° 00′ 00″');
  });
});
