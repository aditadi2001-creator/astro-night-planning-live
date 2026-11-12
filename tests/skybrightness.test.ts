import { describe, expect, it } from 'vitest';
import {
  limitingMagnitude,
  nelmCrumey,
  nelmFromSqm,
  twilightZenithNl,
  zenithSkyBrightness,
} from '../src/lib/physics/skybrightness';
import { magToNl } from '../src/lib/physics/moonlight';
import { colourExcessPerAirmass } from '../src/lib/physics/extinction';

describe('limiting magnitude (Hecht threshold, Schaefer 1990)', () => {
  it('≈ 6.6 under a natural 22.0 mag/arcsec² sky', () => {
    expect(limitingMagnitude(magToNl(22.0))).toBeCloseTo(6.6, 1);
  });
  it('dark/rural skies: matches Birriel et al. (2014) form of Schaefer to 0.02 mag', () => {
    for (const sqm of [18.7, 19, 20, 21, 21.5, 22]) {
      expect(Math.abs(limitingMagnitude(magToNl(sqm)) - nelmFromSqm(sqm))).toBeLessThan(0.02);
    }
  });
  it('bright skies: within 0.4 mag of Crumey (2014) with F = 2', () => {
    for (const sqm of [16, 16.5, 17, 17.5, 18, 18.5]) {
      expect(Math.abs(limitingMagnitude(magToNl(sqm)) - nelmCrumey(sqm))).toBeLessThan(0.4);
    }
  });
  it('falls to ~4 in a bright suburban sky (18.5 mag/arcsec²)', () => {
    const m = limitingMagnitude(magToNl(18.5));
    expect(m).toBeGreaterThan(3.8);
    expect(m).toBeLessThan(4.6);
  });
});

describe('zenith sky brightness', () => {
  it('is the natural 22.0 when the Sun and Moon are well down', () => {
    const b = zenithSkyBrightness({
      sunAlt: -40,
      moonAlt: -20,
      moonPhaseAngle: 0,
      extinction: 0.2,
    });
    expect(b.mag).toBeCloseTo(22.0, 5);
  });
  it('twilight is negligible at −18° and dominates at −12° (end of nautical twilight)', () => {
    const at18 = zenithSkyBrightness({
      sunAlt: -18,
      moonAlt: -20,
      moonPhaseAngle: 0,
      extinction: 0.2,
    });
    expect(at18.mag).toBeGreaterThan(21.9);
    expect(twilightZenithNl(-12, 0.2)).toBeGreaterThan(magToNl(22) * 3);
  });
  it('brightens by several magnitudes with a high full Moon', () => {
    const b = zenithSkyBrightness({ sunAlt: -40, moonAlt: 60, moonPhaseAngle: 0, extinction: 0.2 });
    expect(b.mag).toBeLessThan(19.5);
    expect(b.mag).toBeGreaterThan(17.5);
  });
});

describe('reddening', () => {
  it('B−V excess per airmass ≈ 0.12–0.16 for a clear sea-level night', () => {
    // Rayleigh dominates: τ_R(440) − τ_R(550) ≈ 0.14 → 0.15 mag, plus a little aerosol, minus ozone.
    const e = colourExcessPerAirmass(1013.25, 0.1);
    expect(e).toBeGreaterThan(0.12);
    expect(e).toBeLessThan(0.2);
  });
});
