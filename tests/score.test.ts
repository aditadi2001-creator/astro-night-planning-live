import { describe, expect, it } from 'vitest';
import { ksAirmass, magToNl, moonSkyBrightness, nlToMag } from '../src/lib/physics/moonlight';
import {
  cloudFactor,
  darknessFactor,
  imagingScore,
  modelAgreement,
  transparencyFactor,
} from '../src/lib/physics/score';

describe('Krisciunas & Schaefer (1991) moonlight', () => {
  it('converts the paper’s dark sky 21.587 mag/arcsec² to 79.0 nL and back', () => {
    expect(magToNl(21.587)).toBeCloseTo(79.0, 0);
    expect(nlToMag(79.0)).toBeCloseTo(21.587, 2);
  });
  it('scattering airmass is 1 at the zenith and 5 at the horizon (eq. 3)', () => {
    expect(ksAirmass(0)).toBeCloseTo(1, 10);
    expect(ksAirmass(90)).toBeCloseTo(5, 10);
  });
  it('full Moon at 60° altitude brightens a target 45° away by ~3 mag at k = 0.172', () => {
    // The paper's fig. 2 setting (Mauna Kea, k = 0.172): a bright full Moon
    // raises the sky to roughly 18–19 mag/arcsec² well away from the Moon.
    const b = moonSkyBrightness(
      { phaseAngle: 0, moonAlt: 60, targetAlt: 60, separation: 45 },
      0.172,
    );
    const total = nlToMag(b + magToNl(21.587));
    expect(total).toBeGreaterThan(17.8);
    expect(total).toBeLessThan(19.2);
  });
  it('is zero with the Moon below the horizon, and weaker for a crescent', () => {
    const g = { phaseAngle: 0, moonAlt: -5, targetAlt: 45, separation: 90 };
    expect(moonSkyBrightness(g, 0.2)).toBe(0);
    const full = moonSkyBrightness({ ...g, moonAlt: 40 }, 0.2);
    const crescent = moonSkyBrightness({ ...g, moonAlt: 40, phaseAngle: 120 }, 0.2);
    expect(crescent).toBeLessThan(full / 10);
  });
});

describe('imaging score', () => {
  const ideal = {
    cloudLow: 0,
    cloudMid: 0,
    cloudHigh: 0,
    extinction: 0.15,
    sunAlt: -30,
    moonAlt: -10,
    moonPhaseAngle: 0,
  };
  it('is 100 for a clear, clean, dark, moonless hour', () => {
    expect(imagingScore(ideal).score).toBe(100);
  });
  it('is 0 in daylight or civil/nautical twilight', () => {
    expect(imagingScore({ ...ideal, sunAlt: -10 }).score).toBe(0);
    expect(darknessFactor(-15)).toBeCloseTo(0.5, 10);
  });
  it('is 0 under full low overcast; thin high cloud only dims', () => {
    expect(cloudFactor(100, 0, 0)).toBe(0);
    expect(cloudFactor(0, 0, 100)).toBeCloseTo(0.4, 10);
  });
  it('transparency factor: 1 at k0, about 0.78 at k = 0.3', () => {
    expect(transparencyFactor(0.15)).toBe(1);
    expect(transparencyFactor(0.3)).toBeCloseTo(10 ** (-0.4 * 0.15 * 1.5), 10);
  });
  it('a high full Moon cuts the score sharply', () => {
    const s = imagingScore({ ...ideal, moonAlt: 50, moonPhaseAngle: 0 });
    expect(s.moon).toBeLessThan(0.3);
  });
});

describe('model agreement', () => {
  it('uses the spread of total cloud between models', () => {
    expect(modelAgreement([0, 6, 15, 1])).toEqual({ agreement: 'high', spread: 15 });
    expect(modelAgreement([10, 50]).agreement).toBe('medium');
    expect(modelAgreement([0, 90, 40]).agreement).toBe('low');
    expect(modelAgreement([null, 20]).agreement).toBe('unknown');
  });
});
