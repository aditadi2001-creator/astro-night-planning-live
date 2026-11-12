import { describe, expect, it } from 'vitest';
import {
  apparentAltitude,
  refractionFromApparent,
  refractionFromTrue,
  refractionScale,
} from '../src/lib/physics/refraction';

const arcmin = (deg: number) => deg * 60;

// References: Meeus, Astronomical Algorithms (2nd ed.), ch. 16; Bennett (1982);
// Saemundsson (1986). Standard conditions 1010 hPa, 10 °C.
describe('refraction', () => {
  it('Bennett: ~34.5′ at the apparent horizon', () => {
    expect(arcmin(refractionFromApparent(0))).toBeCloseTo(34.5, 0);
  });
  it('Saemundsson: ~29′ at true altitude 0°', () => {
    expect(arcmin(refractionFromTrue(0))).toBeCloseTo(29.0, 0);
  });
  it('~5.3′ at 10° and ~1.0′ at 45° apparent altitude', () => {
    expect(arcmin(refractionFromApparent(10))).toBeCloseTo(5.3, 1);
    expect(arcmin(refractionFromApparent(45))).toBeCloseTo(1.0, 1);
  });
  it('is zero at the zenith', () => {
    expect(arcmin(refractionFromApparent(90))).toBeCloseTo(0, 2);
    expect(arcmin(refractionFromTrue(90))).toBeCloseTo(0, 2);
  });
  // The two formulas are independent fits, each good to ~0.1′ (Meeus ch. 16),
  // so their round trip agrees to ~0.12′ (≈7″), far below typical seeing.
  it('true → apparent → Bennett refraction is self-consistent within 0.15′', () => {
    for (const h of [0, 1, 2, 5, 15, 30, 60]) {
      const ha = apparentAltitude(h);
      expect(Math.abs(arcmin(refractionFromApparent(ha) - (ha - h)))).toBeLessThan(0.15);
    }
  });
  it('scales with pressure and temperature (Meeus 16.4 factor)', () => {
    expect(refractionScale({ pressureHPa: 1010, temperatureC: 10 })).toBeCloseTo(1, 10);
    const mountain = { pressureHPa: 700, temperatureC: -10 };
    const s = refractionScale(mountain);
    expect(s).toBeCloseTo((700 / 1010) * (283 / 263), 10);
    expect(refractionFromApparent(0, mountain)).toBeCloseTo(refractionFromApparent(0) * s, 4);
  });
});
