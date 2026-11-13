import { describe, expect, it } from 'vitest';
import {
  bodyFor,
  colourClass,
  distanceFromParallax,
  targetVisibility,
} from '../src/lib/astro/target';

const greenwich = { lat: 51.4769, lon: -0.0005, elevation: 46, name: 'Greenwich' };
const NOW = new Date('2026-01-15T22:00:00Z');
const dark = { start: new Date('2026-01-15T18:00:00Z'), end: new Date('2026-01-16T05:30:00Z') };

describe('target visibility', () => {
  it('Sirius from Greenwich transits about 21.8° high (90 − 51.48 − 16.72, plus refraction)', () => {
    const v = targetVisibility(
      { name: 'Sirius', ra2000: 101.2872, dec2000: -16.7161 },
      greenwich,
      NOW,
      dark,
    );
    expect(v.transitAlt).toBeGreaterThan(21.6);
    expect(v.transitAlt).toBeLessThan(22.2);
    expect(v.rise).not.toBeNull();
    expect(v.set).not.toBeNull();
    expect(v.circumpolar).toBe(false);
    // Below 30° all night, so no hours above 30°.
    expect(v.darkHoursAbove30).toBe(0);
    expect(v.bestTonight?.alt).toBeGreaterThan(21);
  });

  it('knows circumpolar and never-rising objects', () => {
    const polaris = targetVisibility(
      { name: 'Polaris', ra2000: 37.95, dec2000: 89.264 },
      greenwich,
      NOW,
      dark,
    );
    expect(polaris.circumpolar).toBe(true);
    expect(polaris.darkHoursAbove30).toBeGreaterThan(11);
    const canopus = targetVisibility(
      { name: 'Canopus', ra2000: 95.988, dec2000: -52.696 },
      greenwich,
      NOW,
      dark,
    );
    expect(canopus.neverRises).toBe(true);
  });

  it('uses the ephemeris for planets and the Moon', () => {
    expect(bodyFor(['NAME Saturn'])).toBe('Saturn');
    expect(bodyFor(['HIP 88601'])).toBeNull();
    const moon = targetVisibility(
      { name: 'Moon', ra2000: 0, dec2000: 0, body: 'Moon' },
      greenwich,
      NOW,
      dark,
    );
    expect(moon.moonSep).toBeNull();
    expect(moon.rise ?? moon.set).not.toBeNull();
  });
});

describe('star properties', () => {
  it('distance from parallax', () => {
    const d = distanceFromParallax(379.21); // Sirius
    expect(d?.pc).toBeCloseTo(2.637, 3);
    expect(d?.ly).toBeCloseTo(8.6, 1);
    expect(distanceFromParallax(0)).toBeNull();
  });
  it('colour class from B−V', () => {
    expect(colourClass(0.65)?.cls).toBe('G'); // the Sun
    expect(colourClass(0.65)?.tempK).toBeGreaterThan(5600);
    expect(colourClass(0.65)?.tempK).toBeLessThan(6000);
    expect(colourClass(1.85)?.cls).toBe('M'); // Betelgeuse
    expect(colourClass(-0.03)?.cls).toBe('B'); // Rigel
  });
});
