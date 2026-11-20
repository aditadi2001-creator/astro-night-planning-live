import { describe, expect, it } from 'vitest';
import { estimateSeeing, type SeeingInput } from '../src/lib/physics/seeing';
import { surfaceLayer, urbanFromLight, wyngaard } from '../src/lib/physics/surfacelayer';

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

// Measured median seeing (typical night weather for each site as input).
const SITES: [name: string, measured: number, input: SeeingInput][] = [
  // Short-exposure CCD study, 1.3 m telescope (RAA 2019, 19, 74).
  ['Kavalur VBO, 725 m', 1.85, site(725, 15, 2.5, 930, 293, 0.5, U(0.3))],
  // MASS-DIMM, first year (Catala et al. 2013, MNRAS 436, 590).
  ['Sutherland, 1760 m', 1.32, site(1760, 30, 5, 820, 283, 0.05, U(0.05))],
  // DIMM 1998–99, mirror ~2 m above ground (ARIES).
  ['Devasthal, 2450 m', 1.1, site(2450, 35, 4, 750, 280, 0.5, U(0.1), 2)],
  // DIMM medians ~0.6–0.7″ at ~7 m.
  ['Mauna Kea, 4200 m', 0.65, site(4200, 25, 7, 615, 275, 0.05, U(0.05), 7)],
  // DIMM median ~0.8″ at 6 m (summit flow not modelled: we read ~30 % high).
  ['Paranal, 2635 m', 0.8, site(2635, 30, 7, 743, 285, 0.05, U(0.02), 6)],
];

describe('seeing model against measured observatory medians', () => {
  for (const [name, measured, input] of SITES) {
    it(`${name}: within 35 % of the measured ${measured}″`, () => {
      const e = estimateSeeing(input);
      expect(e).not.toBeNull();
      expect(Math.abs((e?.arcsec ?? 0) / measured - 1)).toBeLessThan(0.35);
    });
  }

  it('is clearly better than the old fixed 0.7″ ground layer on average', () => {
    let newErr = 0;
    let oldErr = 0;
    for (const [, measured, input] of SITES) {
      newErr += Math.abs((estimateSeeing(input)?.arcsec ?? 0) - measured);
      oldErr += Math.abs((estimateSeeing({ ...input, surface: null })?.arcsec ?? 0) - measured);
    }
    expect(newErr / SITES.length).toBeLessThan(0.15);
    expect(newErr).toBeLessThan(oldErr * 0.6);
  });

  it('puts a city at 900 m (Bangalore centre) in the 2–3″ range amateurs report', () => {
    const e = estimateSeeing(site(920, 15, 3, 910, 295, 1.0, U(4.9)));
    expect(e?.arcsec).toBeGreaterThan(1.8);
    expect(e?.arcsec).toBeLessThan(3.0);
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
