import { describe, expect, it } from 'vitest';
import {
  altitudeAt,
  parseHorizonFile,
  parseHorizonJson,
  parseHorizonText,
  toHrz,
  toProfile,
} from '../src/lib/sky/customHorizon';

describe('custom horizon', () => {
  it('parses NINA .hrz text with comments and mixed separators, sorting the points', () => {
    const pts = parseHorizonText('# my roof\n180 20\n0\t10\n90;15\n270, 5\n\n# end');
    expect(pts).toEqual([
      [0, 10],
      [90, 15],
      [180, 20],
      [270, 5],
    ]);
  });

  it('skips CSV headers and rejects files with fewer than two points', () => {
    expect(parseHorizonText('azimuth,altitude\n0,5\n180,10')).toEqual([
      [0, 5],
      [180, 10],
    ]);
    expect(parseHorizonText('# nothing\n42 7')).toBeNull();
  });

  it('reads JSON pairs, objects and NINA API output', () => {
    expect(parseHorizonJson('[[0,5],[180,10]]')).toHaveLength(2);
    expect(parseHorizonJson('{"points":[{"az":10,"alt":3},{"az":200,"alt":8}]}')).toEqual([
      [10, 3],
      [200, 8],
    ]);
    expect(parseHorizonJson('{"Azimuths":[0,120,240],"Altitudes":[5,6,7]}')).toHaveLength(3);
    expect(parseHorizonFile('h.json', '{"Azimuths":[0,120],"Altitudes":[5,6]}')?.source).toBe(
      'json',
    );
  });

  it('interpolates linearly with wrap-around through north', () => {
    const pts: [number, number][] = [
      [10, 10],
      [350, 30],
    ];
    expect(altitudeAt(pts, 10)).toBe(10);
    expect(altitudeAt(pts, 180)).toBeCloseTo(20, 5);
    expect(altitudeAt(pts, 0)).toBeCloseTo(20, 5); // halfway from 350° (30°) to 10° (10°)
    const prof = toProfile(pts);
    expect(prof).toHaveLength(720);
    expect(prof[360]).toBeCloseTo(20, 4);
  });

  it('exports NINA .hrz that parses back to the same points', () => {
    const h = {
      name: 'Roof',
      points: [
        [0, 12.3],
        [90, 4],
        [200, 18],
      ] as [number, number][],
      source: 'drawn' as const,
      updated: Date.UTC(2026, 10, 19),
    };
    const txt = toHrz(h);
    expect(txt.startsWith('# Roof')).toBe(true);
    expect(parseHorizonText(txt)).toEqual(h.points);
  });
});
