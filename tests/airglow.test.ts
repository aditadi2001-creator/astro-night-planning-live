import { describe, expect, it } from 'vitest';
import {
  meanSolarFlux,
  naturalSkyFactor,
  naturalSkyMag,
  REFERENCE_FLUX,
  skyFromReference,
  skyWithNatural,
  TYPICAL_FLUX,
} from '../src/lib/physics/airglow';
import { withNaturalSky, type SiteLight } from '../src/lib/lp/lightpollution';

// Krisciunas et al. (2007) Table 5: yearly zenith V at CTIO, with the yearly mean
// observed F10.7 for the same years (GFZ Potsdam daily series).
const CTIO: [number, number][] = [
  [150.5, 21.842],
  [109.7, 21.897],
  [85.8, 22.034],
  [72.1, 21.904],
  [80.9, 21.803],
  [118.0, 21.911],
  [153.8, 21.6],
  [180.2, 21.564],
  [184.4, 21.668],
  [180.1, 21.694],
  [130.2, 21.817],
  [106.6, 21.71],
  [94.1, 21.854],
  [81.4, 22.061],
];

describe('natural sky vs solar flux', () => {
  it('is 22.0 at the solar-minimum reference', () => {
    expect(naturalSkyMag(REFERENCE_FLUX)).toBeCloseTo(22.0, 6);
    expect(naturalSkyFactor(REFERENCE_FLUX)).toBeCloseTo(1, 6);
  });

  it('brightens by ~0.34 mag at a strong maximum and ~0.13 at the long-run mean', () => {
    expect(naturalSkyMag(190)).toBeCloseTo(21.657, 2);
    expect(naturalSkyMag(TYPICAL_FLUX)).toBeCloseTo(21.873, 2);
  });

  it('is clamped outside the observed flux range', () => {
    expect(naturalSkyMag(10)).toBe(naturalSkyMag(60));
    expect(naturalSkyMag(1000)).toBe(naturalSkyMag(300));
  });

  it('reproduces the CTIO yearly values to within their scatter', () => {
    // CTIO's zero point is 0.03 mag off ours (21.97 at minimum), and single years scatter ±0.1–0.2.
    const res = CTIO.map(([f, v]) => naturalSkyMag(f) - 0.03 - v);
    const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
    expect(rms).toBeLessThan(0.12);
    expect(Math.abs(res.reduce((a, r) => a + r, 0) / res.length)).toBeLessThan(0.03);
  });
});

describe('adding the natural sky to light pollution', () => {
  it('leaves a pristine site at the natural sky', () => {
    expect(skyWithNatural(0, 21.7)).toBeCloseTo(21.7, 6);
    expect(skyFromReference(22.0, 21.7)).toBeCloseTo(21.7, 6);
  });

  it('barely changes a city sky, where artificial light dominates', () => {
    expect(skyFromReference(17.0, 21.65)).toBeCloseTo(17.0, 1);
    expect(17.0 - skyFromReference(17.0, 21.65)).toBeGreaterThan(0);
  });

  it('adds the brighter airglow to a rural sky', () => {
    // 21.0 against 22.0: R = 1.51; at 21.66 natural the total is 20.85.
    expect(skyFromReference(21.0, 21.657)).toBeCloseTo(20.85, 2);
  });
});

describe('withNaturalSky', () => {
  const site: SiteLight = {
    year: 2025,
    sqm: 21.0,
    bortle: 4,
    brightening: 1.0,
    ratio: 10 ** 0.4 - 1,
    domes: [3, 1.5],
    typicalErrorMag: 0.35,
    validationN: 5345,
    naturalSqm: 22.0,
  };

  it('keeps the Bortle class and brightening, shrinks the ratios', () => {
    const now = withNaturalSky(site, 21.7);
    const f = 10 ** (0.4 * 0.3);
    expect(now.bortle).toBe(4);
    expect(now.brightening).toBe(1.0);
    expect(now.ratio).toBeCloseTo(site.ratio / f, 6);
    expect(now.domes[0]).toBeCloseTo(3 / f, 6);
    expect(now.sqm).toBeCloseTo(skyFromReference(21.0, 21.7), 6);
    expect(now.naturalSqm).toBe(21.7);
  });

  it('is the identity at the reference sky', () => {
    expect(withNaturalSky(site, 22.0).sqm).toBeCloseTo(21.0, 6);
  });

  it('treats copies cached without naturalSqm as made against 22.0', () => {
    const old = { ...site } as Partial<SiteLight>;
    delete old.naturalSqm;
    expect(withNaturalSky(old as SiteLight, 22.0).sqm).toBeCloseTo(21.0, 6);
  });
});

describe('meanSolarFlux', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, 15) - d * 86_400_000).toISOString();
  it('averages the 27 days ending 5 days before the newest reading', () => {
    const raw = Array.from({ length: 40 }, (_, d) => ({
      time_tag: day(d).slice(0, 19), // SWPC stamps carry no zone: UTC
      flux: d < 5 ? 300 : 100,
    }));
    const m = meanSolarFlux(raw);
    expect(m?.flux).toBeCloseTo(100, 6);
    expect(m?.readings).toBe(27);
  });

  it('falls back to all readings when the window is nearly empty, and to null when empty', () => {
    const raw = [0, 1, 2].map((d) => ({ time_tag: day(d), flux: 120 }));
    expect(meanSolarFlux(raw)?.flux).toBe(120);
    expect(meanSolarFlux([])).toBeNull();
    expect(meanSolarFlux([{ time_tag: 'x', flux: -1 }])).toBeNull();
  });
});
