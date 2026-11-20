import { describe, expect, it } from 'vitest';
import * as bridge from '../tools/bridge/bridge.mjs';
import {
  ALPACA_CONTROL,
  ALPACA_READ,
  alpacaAllowed,
  NINA_CONTROL,
  NINA_READ,
  ninaAllowed,
} from '../src/lib/telescope/allow';
import { parseAlpaca } from '../src/lib/telescope/alpaca';
import {
  altAzNow,
  expectedPier,
  hourAngleH,
  hoursToHorizon,
  hoursToMeridian,
  j2000ToNow,
  nowToJ2000,
  separation,
} from '../src/lib/telescope/coords';
import { parseNinaMount } from '../src/lib/telescope/nina';
import { simulatorAdapter, slerp } from '../src/lib/telescope/simulator';
import { mosaicPanes, mosaicSpan } from '../src/lib/equipment';
import { toMosaicCsv } from '../src/lib/plan/plan';

const DATE = new Date('2026-11-19T18:00:00Z');
const R2D = 180 / Math.PI;

describe('allow-lists (read-only by default)', () => {
  it('lets info through and blocks control until enabled', () => {
    expect(ninaAllowed('/equipment/mount/info', false)).toBe(true);
    expect(ninaAllowed('/equipment/mount/slew?ra=1&dec=2', false)).toBe(false);
    expect(ninaAllowed('/equipment/mount/slew?ra=1&dec=2', true)).toBe(true);
    // Park, tracking and the sequence target are control actions now (owner's request, 20 Nov).
    expect(ninaAllowed('/equipment/mount/park', false)).toBe(false);
    expect(ninaAllowed('/equipment/mount/park', true)).toBe(true);
    expect(ninaAllowed('/sequence/set-target', false)).toBe(false);
    expect(ninaAllowed('/sequence/json', false)).toBe(true);
    // Never allowed, even with control: flip, connect, starting a sequence, and the endpoint
    // exposing API keys.
    for (const p of [
      '/sequence/start',
      '/equipment/mount/flip',
      '/equipment/mount/connect',
      '/profile/show',
    ])
      expect(ninaAllowed(p, true)).toBe(false);
    expect(alpacaAllowed('RightAscension', false)).toBe(true);
    expect(alpacaAllowed('slewtocoordinatesasync', false, 'PUT')).toBe(false);
    expect(alpacaAllowed('slewtocoordinatesasync', true, 'PUT')).toBe(true);
    // Every PUT is control; reads are GET only.
    expect(alpacaAllowed('park', false, 'PUT')).toBe(false);
    expect(alpacaAllowed('park', true, 'PUT')).toBe(true);
    expect(alpacaAllowed('tracking', false)).toBe(true);
    expect(alpacaAllowed('tracking', false, 'PUT')).toBe(false);
    expect(alpacaAllowed('tracking', true, 'PUT')).toBe(true);
    expect(alpacaAllowed('connected', true, 'PUT')).toBe(false);
  });
  it('the bridge uses the same lists and routes', () => {
    expect(bridge.NINA_READ).toEqual([...NINA_READ]);
    expect(bridge.NINA_CONTROL).toEqual([...NINA_CONTROL]);
    expect(bridge.ALPACA_READ).toEqual([...ALPACA_READ]);
    expect(bridge.ALPACA_CONTROL).toEqual([...ALPACA_CONTROL]);
    expect(bridge.route('GET', '/nina/equipment/mount/info', false)).toEqual({
      target: 'nina',
      path: '/v2/api/equipment/mount/info',
    });
    expect(bridge.route('GET', '/nina/equipment/mount/slew?ra=1&dec=2', false)).toBeNull();
    expect(bridge.route('GET', '/nina/equipment/mount/slew?ra=1&dec=2', true)?.path).toBe(
      '/v2/api/equipment/mount/slew?ra=1&dec=2',
    );
    expect(bridge.route('GET', '/nina/profile/show', true)).toBeNull();
    expect(bridge.route('GET', '/alpaca/telescope/0/declination', false)?.path).toBe(
      '/api/v1/telescope/0/declination',
    );
    expect(bridge.route('PUT', '/alpaca/telescope/0/slewtocoordinatesasync', false)).toBeNull();
    expect(bridge.route('PUT', '/alpaca/telescope/0/slewtocoordinatesasync', true)).not.toBeNull();
    expect(bridge.route('GET', '/alpaca/camera/0/imagearray', true)).toBeNull();
    expect(bridge.route('GET', '/nina/../etc/passwd', true)).toBeNull();
  });
});

describe('coordinates', () => {
  it('J2000 ↔ JNow round-trips and precesses by the expected amount', () => {
    const now = j2000ToNow(0, 0, DATE);
    // ~26.9 years × 46.1″/yr in RA at the equinox ≈ 0.344°, plus nutation (< 20″).
    expect(now.ra).toBeGreaterThan(0.33);
    expect(now.ra).toBeLessThan(0.36);
    const back = nowToJ2000(now.ra, now.dec, DATE);
    expect(Math.abs(back.ra - 0) * 3600).toBeLessThan(0.01);
    expect(Math.abs(back.dec) * 3600).toBeLessThan(0.01);
  });
  it('hour angle, pier side, meridian and horizon times', () => {
    expect(hourAngleH(10, 150)).toBeCloseTo(0, 9);
    expect(hourAngleH(1, 330)).toBeCloseTo(3, 9); // wraps through 0 h
    expect(expectedPier(-2)).toBe('west');
    expect(expectedPier(1)).toBe('east');
    expect(hoursToMeridian(-2)).toBeCloseTo(2 * 0.99727, 4);
    // On the meridian at the zenith from 13° N: altitude 90°.
    expect(altAzNow(150, 13, 13, 10).alt).toBeCloseTo(90, 6);
    // An equator object on the meridian sets ~6 sidereal hours later from the equator.
    const set = hoursToHorizon(150, 0, 0, 10);
    expect(set).not.toBeNull();
    expect(Math.abs((set as number) - 6 * 0.99727)).toBeLessThan(0.05);
    // A 30° horizon brings it down sooner.
    expect(hoursToHorizon(150, 0, 0, 10, () => 30) as number).toBeLessThan(set as number);
    // Circumpolar from 60° N: never sets.
    expect(hoursToHorizon(0, 80, 60, 0)).toBeNull();
  });
  it('separation and position angle', () => {
    const s = separation(10, 0, 10, 1);
    expect(s.sepDeg).toBeCloseTo(1, 9);
    expect(s.paDeg).toBeCloseTo(0, 6); // due north
    expect(separation(10, 0, 11, 0).paDeg).toBeCloseTo(90, 6); // due east
  });
});

describe('NINA and Alpaca readings', () => {
  it('converts NINA JNow coordinates to J2000 and maps pier side', () => {
    const now = j2000ToNow(83.82, -5.39, DATE);
    const s = parseNinaMount(
      {
        Connected: true,
        Coordinates: { RADegrees: now.ra, Dec: now.dec, Epoch: 'JNOW' },
        Altitude: 44.4,
        Azimuth: 111,
        SideOfPier: 'pierWest',
        TrackingEnabled: true,
        Slewing: false,
        AtPark: false,
        SiderealTime: 2.8,
        TimeToMeridianFlip: 2.5,
      },
      DATE,
    );
    expect(s.connected).toBe(true);
    expect(s.epoch).toBe('JNow');
    expect(s.ra2000).toBeCloseTo(83.82, 6);
    expect(s.dec2000).toBeCloseTo(-5.39, 6);
    expect(s.pier).toBe('west');
    expect(s.flipInH).toBe(2.5);
    // Unknown fields stay unknown.
    const bare = parseNinaMount(
      { Connected: true, Coordinates: { RADegrees: 10, Dec: 5, Epoch: 'J2000' } },
      DATE,
    );
    expect(bare.alt).toBeNull();
    expect(bare.tracking).toBeNull();
    expect(bare.pier).toBe('unknown');
    expect(bare.flipInH).toBeNull();
  });
  it('reads Alpaca values in hours and its equatorial system', () => {
    const j = parseAlpaca(
      { RightAscension: 5.588, Declination: -5.39, SideOfPier: 0, Tracking: true },
      2,
      DATE,
    );
    expect(j.epoch).toBe('J2000');
    expect(j.ra2000).toBeCloseTo(83.82, 6);
    expect(j.pier).toBe('east');
    const t = parseAlpaca({ RightAscension: 5.588, Declination: -5.39, SideOfPier: -1 }, 1, DATE);
    expect(t.epoch).toBe('JNow');
    expect(t.raNow).toBeCloseTo(83.82, 6);
    expect(t.ra2000).not.toBeCloseTo(83.82, 2);
    expect(t.pier).toBe('unknown');
    expect(parseAlpaca({}, 2, DATE).connected).toBe(false);
  });
});

describe('simulator', () => {
  it('starts parked, slews at 4°/s and takes a GEM pier side', async () => {
    let t = DATE.getTime();
    const sim = simulatorAdapter({ lat: 13.04, lon: 77.57 }, () => new Date(t));
    const p0 = await sim.read();
    expect(p0.atPark).toBe(true);
    expect(p0.tracking).toBe(false);
    // Parked = fixed in the sky of the site: on the meridian (hour angle 0), the same a minute later.
    expect(Math.abs(hourAngleH(p0.lstH as number, p0.raNow))).toBeLessThan(0.01);
    t += 60_000;
    const p0b = await sim.read();
    expect(Math.abs((p0b.alt as number) - (p0.alt as number))).toBeLessThan(0.01);
    await sim.slew(83.82, -5.39);
    t += 1000;
    const p1 = await sim.read();
    expect(p1.slewing).toBe(true);
    t += 60_000;
    const p2 = await sim.read();
    expect(p2.slewing).toBe(false);
    expect(p2.ra2000).toBeCloseTo(83.82, 6);
    expect(p2.dec2000).toBeCloseTo(-5.39, 6);
    expect(p2.tracking).toBe(true);
    const ha = hourAngleH(p2.lstH as number, p2.raNow);
    expect(p2.pier).toBe(expectedPier(ha));
  });
  it('slerp keeps to the great circle', () => {
    const mid = slerp(0, 0, 90, 0, 0.5);
    expect(mid.ra).toBeCloseTo(45, 9);
    expect(mid.dec).toBeCloseTo(0, 9);
    expect(mid.sepDeg).toBeCloseTo(90, 9);
  });
});

describe('mosaic', () => {
  it('centres panes symmetrically with the requested overlap', () => {
    const ra0 = 10.68 / R2D;
    const dec0 = 41.27 / R2D;
    const one = mosaicPanes(ra0, dec0, 1, 0.5, 1, 1, 0.1, 0);
    expect(one[0]?.ra).toBeCloseTo(ra0, 12);
    expect(one[0]?.dec).toBeCloseTo(dec0, 12);
    /** Separation between the first two panes. */
    const between = (list: { ra: number; dec: number }[]) => {
      const [a, b] = list;
      if (!a || !b) throw new Error('expected two panes');
      return separation(a.ra * R2D, a.dec * R2D, b.ra * R2D, b.dec * R2D);
    };
    const sep = between(mosaicPanes(ra0, dec0, 1, 0.5, 2, 1, 0.2, 0));
    expect(sep.sepDeg).toBeCloseTo(0.8, 3); // 1° wide × (1 − 0.2)
    expect(Math.abs(sep.paDeg - 90)).toBeLessThan(1); // side by side east–west
    // Turned by 90°: stacked north–south.
    const s2 = between(mosaicPanes(ra0, dec0, 1, 0.5, 2, 1, 0.2, 90));
    expect(Math.min(s2.paDeg, 360 - s2.paDeg, Math.abs(s2.paDeg - 180))).toBeLessThan(1);
    expect(mosaicSpan(1, 0.5, 3, 2, 0.1)).toEqual({ w: 1 + 2 * 0.9, h: 0.5 + 0.5 * 0.9 });
  });
  it('writes NINA mosaic panes CSV', () => {
    const csv = toMosaicCsv('M 31', [{ pane: 1, ra: 10.68, dec: 41.27 }], -30);
    expect(csv.split('\r\n')[0]).toBe('Pane,RA,DEC,Position Angle (East)');
    expect(csv).toContain('M 31 Panel 1,');
    expect(csv).toContain(',330.0');
  });
});
