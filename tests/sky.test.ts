import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { bodyPosition, moonInfo, moonPhaseName } from '../src/lib/astro/sky';

describe('sky positions', () => {
  it('puts the Sun near the zenith at local noon on the equator at an equinox', () => {
    // 2025-03-20 09:01 UTC equinox; local solar noon at lon 0 is ~12:07 UTC.
    const sun = bodyPosition(
      Body.Sun,
      { lat: 0, lon: 0, elevation: 0, name: 't' },
      new Date('2025-03-20T12:07:00Z'),
    );
    expect(sun.altitude).toBeGreaterThan(89);
  });
  it('reports a full Moon on 2025-03-14 (total lunar eclipse date)', () => {
    const m = moonInfo(new Date('2025-03-14T06:58:00Z'));
    expect(m.illumination).toBeGreaterThan(0.99);
    expect(m.phaseName).toBe('Full Moon');
  });
  it('names phases by ecliptic angle', () => {
    expect(moonPhaseName(0)).toBe('New Moon');
    expect(moonPhaseName(90)).toBe('First quarter');
    expect(moonPhaseName(270)).toBe('Last quarter');
    expect(moonPhaseName(-10)).toBe('New Moon');
  });
});
