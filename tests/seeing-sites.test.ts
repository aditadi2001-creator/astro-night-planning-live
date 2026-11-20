import { describe, expect, it } from 'vitest';
import { estimateSeeing, type SeeingInput } from '../src/lib/physics/seeing';
import {
  roughnessFromLight,
  surfaceLayer,
  urbanFromLight,
  wyngaard,
} from '../src/lib/physics/surfacelayer';
import nights from './fixtures/seeing-nights.json';

/** Light pollution in mag → how built-up (as the site derives it). */
const U = (mag: number) => urbanFromLight(10 ** (0.4 * mag) - 1);

function site(
  elev: number,
  jet: number,
  wind: number,
  P: number,
  T: number,
  z0: number,
  urban: number,
  heightM = 1.5,
  cloud = 0.2,
): SeeingInput {
  return {
    upper: [jet * 0.6, jet, jet, jet * 0.9].map((s) => ({ speed: s, dir: 270 })),
    w850: { speed: wind * 1.8, dir: 260 },
    w10: { speed: wind, dir: 240 },
    elevation: elev,
    surface: { windMs: wind, tempK: T, pressureHpa: P, cloud, sunAlt: -30, z0, urban, heightM },
  };
}

// Real nights: ECMWF forecasts for 25 Aug – 12 Nov 2026 at each site (every 5th dark hour),
// replayed through the model; its median must match the site's measured median seeing.
type Night = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
const NIGHTS = nights as unknown as {
  sites: Record<string, { elevation: number; lightMag: number; rows: Night[] }>;
};
const KMH = 1 / 3.6;
function replay(name: string): number[] {
  const site = NIGHTS.sites[name];
  if (!site) throw new Error(name);
  const urban = U(site.lightMag);
  const z0 = roughnessFromLight(site.lightMag);
  return site.rows
    .map(
      ([u500, u300, u250, u200, u850, d850, u10, d10, t, p, cloud, sunAlt]) =>
        estimateSeeing({
          upper: [u500, u300, u250, u200].map((v) => ({ speed: v * KMH, dir: 270 })),
          w850: { speed: u850 * KMH, dir: d850 },
          w10: { speed: u10 * KMH, dir: d10 },
          elevation: site.elevation,
          surface: {
            windMs: u10 * KMH,
            tempK: t + 273.15,
            pressureHpa: p,
            cloud: cloud / 100,
            sunAlt,
            z0,
            urban,
            heightM: 1.5,
          },
        })?.arcsec ?? NaN,
    )
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}
const med = (xs: number[]) => xs[Math.floor((xs.length - 1) / 2)] ?? NaN;

// Measured medians: Kavalur short-exposure CCD study, 1.3 m (RAA 2019, 19, 74); Sutherland
// MASS-DIMM (Catala et al. 2013); Devasthal DIMM 1998–99 (ARIES); Hanle DIMM (Parihar et al.
// 2015, 1.27″; the observatory quotes "below 1″").
const LAND: [name: string, measured: number][] = [
  ['Kavalur', 1.85],
  ['Sutherland', 1.32],
  ['Devasthal', 1.1],
  ['Hanle', 1.27],
];

describe('seeing model on real nights against measured observatory medians', () => {
  for (const [name, measured] of LAND) {
    it(`${name}: median within 20 % of the measured ${measured}″`, () => {
      const xs = replay(name);
      expect(xs.length).toBeGreaterThan(100);
      expect(Math.abs(med(xs) / measured - 1)).toBeLessThan(0.2);
    });
  }

  it('Bangalore centre (Bortle 9, 920 m) sits in the 2–3″ observers report', () => {
    const xs = replay('Bangalore');
    expect(med(xs)).toBeGreaterThan(2);
    expect(med(xs)).toBeLessThan(3);
  });

  it('ocean-facing summits with laminar inflow read high, never low (safe side)', () => {
    expect(med(replay('MaunaKea'))).toBeGreaterThan(0.65);
    expect(med(replay('Paranal'))).toBeGreaterThan(0.8);
    expect(med(replay('MaunaKea'))).toBeLessThan(0.65 * 2);
  });

  it('the old typical-weather calibration was ~2× too optimistic on real nights', () => {
    // Kavalur: 0.91″ with the old ground physics on these nights vs 1.85″ measured.
    expect(med(replay('Kavalur'))).toBeGreaterThan(1.5);
    expect(med(replay('Hanle'))).toBeGreaterThan(1);
  });

  it('a clear night with a breeze is worse than an overcast calm one', () => {
    const at = (w: number, c: number) =>
      estimateSeeing(site(900, 15, w, 910, 290, 0.1, 0, 1.5, c))?.arcsec ?? 0;
    expect(at(9, 0)).toBeGreaterThan(at(2, 1));
  });
});

describe('near-ground physics (surfacelayer.ts)', () => {
  const base = { tempK: 285, pressureHpa: 1010, sunAlt: -30, z0: 0.1 };

  it('Wyngaard functions: 4.9 at neutral, stronger when stable, weaker when convective', () => {
    expect(wyngaard(0)).toBeCloseTo(4.9, 9);
    expect(wyngaard(1)).toBeCloseTo(4.9 * 3.4, 9);
    expect(wyngaard(-1)).toBeCloseTo(4.9 * 8 ** (-2 / 3), 9);
  });

  it('AERMOD night fluxes: θ* = 0.09 (1 − 0.5 n²) above the critical wind', () => {
    const clear = surfaceLayer({ ...base, windMs: 6, cloud: 0 });
    const overcast = surfaceLayer({ ...base, windMs: 6, cloud: 1 });
    expect(clear.stable).toBe(true);
    expect(clear.thetaStar).toBeCloseTo(0.09, 9);
    expect(overcast.thetaStar).toBeCloseTo(0.045, 9);
    expect(overcast.J).toBeLessThan(clear.J);
  });

  it('turbulence falls with the telescope’s height above the ground', () => {
    const low = surfaceLayer({ ...base, windMs: 4, cloud: 0, heightM: 1.5 });
    const high = surfaceLayer({ ...base, windMs: 4, cloud: 0, heightM: 10 });
    expect(high.J).toBeLessThan(low.J);
  });

  it('a city’s stored heat adds turbulence at night', () => {
    const rural = surfaceLayer({ ...base, windMs: 3, cloud: 0, z0: 1, urban: 0 });
    const city = surfaceLayer({ ...base, windMs: 3, cloud: 0, z0: 1, urban: 1 });
    expect(city.J).toBeGreaterThan(rural.J);
    expect(city.H).toBeGreaterThan(rural.H);
  });

  it('a sunny day is convective and much worse than night', () => {
    const day = surfaceLayer({ ...base, windMs: 3, cloud: 0.1, sunAlt: 60, tempK: 300 });
    const night = surfaceLayer({ ...base, windMs: 3, cloud: 0.1 });
    expect(day.stable).toBe(false);
    expect(day.H).toBeGreaterThan(100);
    expect(day.J).toBeGreaterThan(night.J * 3);
  });

  it('urbanFromLight: country 0, big-city centre 1', () => {
    expect(urbanFromLight(0)).toBe(0);
    expect(urbanFromLight(99)).toBeCloseTo(1, 9);
    expect(urbanFromLight(null)).toBe(0);
  });
});
