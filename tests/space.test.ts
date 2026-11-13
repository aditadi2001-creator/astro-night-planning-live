import { describe, expect, it } from 'vitest';
import { compass16, findPasses, type Omm } from '../src/lib/space/passes';
import {
  auroraForSite,
  distBearing,
  elevationOf,
  gScale,
  kpSummary,
  parseKp,
  type OvationRaw,
} from '../src/lib/space/aurora';
import issJson from './fixtures/iss-omm.json';

const iss = issJson[0] as unknown as Omm;
const T0 = Date.parse('2026-11-13T00:00:00Z');
const T1 = Date.parse('2026-11-15T00:00:00Z');

/**
 * Reference: Skyfield 1.55 (independent SGP4 + JPL DE421 Sun) for the same
 * CelesTrak elements (epoch 2026-11-12 21:13 UTC), rise/set at 0°.
 */
const SKYFIELD_PIC = [
  {
    rise: '2026-11-13T00:45:45Z',
    peak: '2026-11-13T00:51:06Z',
    alt: 43.1,
    az: 219.8,
    set: '2026-11-13T00:56:26Z',
  },
  {
    rise: '2026-11-13T17:29:13Z',
    peak: '2026-11-13T17:34:27Z',
    alt: 36.3,
    az: 138.8,
    set: '2026-11-13T17:39:44Z',
  },
  {
    rise: '2026-11-13T19:05:58Z',
    peak: '2026-11-13T19:11:15Z',
    alt: 35.1,
    az: 336.7,
    set: '2026-11-13T19:16:34Z',
  },
  {
    rise: '2026-11-13T23:57:57Z',
    peak: '2026-11-14T00:03:23Z',
    alt: 74.3,
    az: 215.5,
    set: '2026-11-14T00:08:49Z',
  },
  {
    rise: '2026-11-14T18:18:02Z',
    peak: '2026-11-14T18:23:23Z',
    alt: 50.6,
    az: 332.0,
    set: '2026-11-14T18:28:47Z',
  },
];
const pic = { lat: 42.936, lon: 0.142, elevation: 2877 };

describe('satellite passes (SGP4 via satellite.js)', () => {
  const passes = findPasses(iss, pic, T0, T1, { stepMs: 20_000 });

  it('finds the same ISS passes as Skyfield (Pic du Midi, 2 days)', () => {
    expect(passes).toHaveLength(11);
    for (const ref of SKYFIELD_PIC) {
      const p = passes.find((x) => Math.abs(x.peak.t - Date.parse(ref.peak)) < 60_000);
      expect(p, ref.peak).toBeDefined();
      if (!p) continue;
      expect(Math.abs(p.rise.t - Date.parse(ref.rise))).toBeLessThan(3000);
      expect(Math.abs(p.peak.t - Date.parse(ref.peak))).toBeLessThan(3000);
      expect(Math.abs(p.set.t - Date.parse(ref.set))).toBeLessThan(3000);
      expect(p.peak.alt).toBeCloseTo(ref.alt, 0);
      expect(Math.abs(p.peak.az - ref.az)).toBeLessThan(1);
    }
  });

  it('marks a pass visible only while sunlit against a dark sky', () => {
    const at = (iso: string) => passes.find((x) => Math.abs(x.peak.t - Date.parse(iso)) < 60_000);
    // Sunlit at the start, enters Earth's shadow ~19:09:30 (Skyfield: sunlit 19:09, shadow 19:10).
    const evening = at('2026-11-13T19:11:15Z');
    expect(evening?.visible).toBe(true);
    expect(evening?.visibleTo?.t).toBeLessThan(Date.parse('2026-11-13T19:10:00Z'));
    expect(evening?.intoShadow).toBe(true);
    expect(evening?.fromShadow).toBe(false);
    // Seen only on the way up: highest visible point ~16° (Skyfield 15.9° at 19:09), not the 35° peak.
    expect(evening?.visiblePeak?.alt).toBeGreaterThan(14);
    expect(evening?.visiblePeak?.alt).toBeLessThan(25);
    // Sunlit, but the Sun is only 2.5° below the horizon: sky too bright.
    expect(at('2026-11-14T16:46:48Z')?.visible).toBe(false);
    // Local midnight: the station is in Earth's shadow.
    expect(at('2026-11-14T00:03:23Z')?.visible).toBe(false);
  });

  it('names compass points', () => {
    expect(compass16(0)).toBe('N');
    expect(compass16(359)).toBe('N');
    expect(compass16(337.5)).toBe('NNW');
    expect(compass16(135)).toBe('SE');
  });
});

describe('aurora geometry', () => {
  it('puts the lower edge (110 km) on the horizon at about 1170 km', () => {
    expect(elevationOf(0)).toBe(90);
    expect(Math.abs(elevationOf(1175))).toBeLessThan(0.3);
    // atan((cos θ − R/(R+h)) / sin θ) with θ = 500/6371 rad: 10.05°.
    expect(elevationOf(500)).toBeCloseTo(10.05, 1);
  });

  it('computes distance and bearing', () => {
    const d = distBearing(60, 10, 61, 10);
    expect(d.km).toBeCloseTo(111.2, 0);
    expect(d.bearing).toBeCloseTo(0, 5);
    expect(distBearing(0, 0, 0, 1).bearing).toBeCloseTo(90, 5);
  });

  it('finds the best chance in view and the chance overhead', () => {
    const coords: [number, number, number][] = [];
    for (let lon = 0; lon < 360; lon++)
      for (let lat = -90; lat <= 90; lat++)
        coords.push([lon, lat, lat >= 66 ? 60 : lat >= 64 ? 20 : 0]);
    const raw: OvationRaw = {
      'Observation Time': '2026-11-13T10:00:00Z',
      'Forecast Time': '2026-11-13T11:00:00Z',
      coordinates: coords,
    };
    const oslo = auroraForSite(raw, 59.9, 10.75);
    expect(oslo.overhead).toBe(0);
    expect(oslo.best?.chance).toBe(60);
    expect(oslo.best?.bearing).toBeLessThan(5); // due north
    expect(oslo.best?.elevation).toBeGreaterThanOrEqual(5);
    const tromso = auroraForSite(raw, 69.65, 18.96);
    expect(tromso.overhead).toBe(60);
    // Far from the oval: nothing above 5°.
    expect(auroraForSite(raw, 40, 0).best).toBeNull();
    expect(oslo.forecast).toBe(Date.parse('2026-11-13T11:00:00Z'));
  });
});

describe('Kp index', () => {
  const rows = [
    { time_tag: '2026-11-13T00:00:00', kp: 2.33, observed: 'observed' },
    { time_tag: '2026-11-13T03:00:00', kp: 3.0, observed: 'estimated' },
    { time_tag: '2026-11-13T06:00:00', kp: 5.67, observed: 'predicted' },
    { time_tag: '2026-11-14T12:00:00', kp: 8.0, observed: 'predicted' },
  ];

  it('parses both SWPC formats', () => {
    const a = parseKp(rows);
    expect(a.map((p) => p.kp)).toEqual([2.33, 3, 5.67, 8]);
    expect(a[0]?.t).toBe(Date.parse('2026-11-13T00:00:00Z'));
    const b = parseKp([
      ['time_tag', 'kp', 'observed', 'noaa_scale'],
      ['2026-11-13 00:00:00', '2.33', 'observed', null],
    ]);
    expect(b).toEqual([{ t: Date.parse('2026-11-13T00:00:00Z'), kp: 2.33, kind: 'observed' }]);
  });

  it('gives Kp now and the 24-hour maximum', () => {
    const s = kpSummary(parseKp(rows), Date.parse('2026-11-13T04:00:00Z'));
    expect(s.now?.kp).toBe(3);
    expect(s.max24?.kp).toBe(5.67); // the Kp 8 slot is 32 h away
    expect(gScale(5.67)).toBe('G1 minor storm');
    expect(gScale(9)).toBe('G5 extreme storm');
    expect(gScale(4.67)).toBeNull();
  });
});
