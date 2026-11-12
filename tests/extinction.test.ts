import { describe, expect, it } from 'vitest';
import {
  ozoneTau,
  rayleighTau,
  transparencyClass,
  zenithExtinction,
} from '../src/lib/physics/extinction';

describe('extinction', () => {
  it('Rayleigh optical depth at 550 nm matches Bucholtz (1995) Table 2: 0.09728', () => {
    expect(rayleighTau(0.55)).toBeCloseTo(0.0973, 3);
  });
  it('Rayleigh optical depth at 400 nm ≈ 0.36 (Bucholtz 0.3639)', () => {
    expect(rayleighTau(0.4)).toBeCloseTo(0.364, 2);
  });
  it('Rayleigh scales with pressure', () => {
    expect(rayleighTau(0.55, 506.625)).toBeCloseTo(rayleighTau(0.55) / 2, 10);
  });
  it('ozone Chappuis optical depth for 300 DU ≈ 0.027', () => {
    expect(ozoneTau(300)).toBeCloseTo(0.0266, 3);
  });
  it('total V extinction for a clean high site is ~0.11–0.13 (Mauna Kea, Krisciunas et al. 1987)', () => {
    // Mauna Kea ~615 hPa, AOD ~0.02.
    const k = zenithExtinction(615, 0.02).total;
    expect(k).toBeGreaterThan(0.1);
    expect(k).toBeLessThan(0.14);
  });
  it('a clear sea-level night (AOD 0.1) gives k ≈ 0.24 mag/airmass', () => {
    const k = zenithExtinction(1013.25, 0.1);
    expect(k.rayleigh).toBeCloseTo(0.1056, 3);
    expect(k.aerosol).toBeCloseTo(0.1086, 3);
    expect(k.total).toBeCloseTo(0.243, 2);
    expect(transparencyClass(k.total)).toBe('good');
  });
  it('classifies heavy haze as bad', () => {
    expect(transparencyClass(zenithExtinction(1013, 0.6).total)).toBe('bad');
  });
});
