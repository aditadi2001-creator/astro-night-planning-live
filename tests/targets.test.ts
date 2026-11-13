import { describe, expect, it } from 'vitest';
import {
  brightnessFactor,
  contrastFactor,
  framingFactor,
  parseTargets,
  rankTargets,
  type Target,
} from '../src/lib/targets';
import doc from '../public/skydata/targets.json';

const targets = parseTargets(doc as { rows: unknown[] });
const byName = (n: string) => targets.find((t) => t.name === n) as Target;

// La Palma-like site in mid-January: Orion high, dark from ~19:30 to ~06:30 UTC.
const site = { lat: 28.76, lon: -17.88, elevation: 2400, name: 'Dark site' };
const base = {
  place: site,
  darkStart: Date.parse('2026-01-20T19:30:00Z'),
  darkEnd: Date.parse('2026-01-21T06:30:00Z'),
  clearAt: () => 1,
  frameShortDeg: 1.87,
};

describe('target catalogue', () => {
  it('has the Messier objects and well-known targets', () => {
    expect(targets.length).toBeGreaterThan(1000);
    expect(targets.filter((t) => t.name.startsWith('M ')).length).toBeGreaterThanOrEqual(105);
    const m42 = byName('M 42');
    expect(m42.kind).toBe('nebula');
    expect(m42.ra).toBeCloseTo(83.82, 1);
    expect(byName('M 31').kind).toBe('galaxy');
  });
});

describe('ranking factors', () => {
  it('contrast: a faint galaxy suffers in a city, not at a dark site', () => {
    expect(contrastFactor(22, 21.8, 'galaxy')).toBeGreaterThan(0.7);
    expect(contrastFactor(22, 17.5, 'galaxy')).toBeLessThan(0.4);
    expect(contrastFactor(23.5, 17.5, 'galaxy')).toBeLessThan(0.12);
    // Clusters keep at least half their score.
    expect(contrastFactor(22, 17.5, 'cluster')).toBeGreaterThan(0.5);
  });
  it('framing and brightness', () => {
    expect(framingFactor(0.5)).toBe(1);
    expect(framingFactor(0.05)).toBeLessThan(0.6);
    expect(framingFactor(3)).toBeLessThan(0.7);
    expect(brightnessFactor(5)).toBe(1);
    expect(brightnessFactor(13)).toBeCloseTo(0.3, 5);
  });
});

describe('best targets tonight', () => {
  it('puts winter showpieces near the top under a dark January sky', () => {
    const top = rankTargets(targets, { ...base, sqm: 21.8 }, 25).map((t) => t.name);
    expect(top).toContain('M 42');
    expect(
      top.some((n) => ['M 45', 'M 31', 'M 1', 'M 35', 'M 36', 'M 37', 'M 38'].includes(n)),
    ).toBe(true);
  });

  it('drops objects that never get 30° high and penalises cloudy nights', () => {
    const r = rankTargets(targets, { ...base, sqm: 21.8 }, 2000);
    // Omega Centauri (Dec −47°) peaks at ~14° from 28.8° N.
    expect(r.find((t) => t.name === 'NGC 5139')).toBeUndefined();
    const clear = r.find((t) => t.name === 'M 42');
    const cloudy = rankTargets(targets, { ...base, sqm: 21.8, clearAt: () => 0.3 }, 2000).find(
      (t) => t.name === 'M 42',
    );
    expect(cloudy?.score ?? 0).toBeLessThan((clear?.score ?? 0) * 0.6);
  });

  it('M 42 stays a top target even from a city', () => {
    const city = rankTargets(targets, { ...base, sqm: 17.3 }, 10).map((t) => t.name);
    expect(city).toContain('M 42');
  });

  it('a city sky favours bright targets over faint galaxies', () => {
    const city = rankTargets(targets, { ...base, sqm: 17.3 }, 40);
    const dark = rankTargets(targets, { ...base, sqm: 21.8 }, 40);
    const galaxies = (l: typeof city) => l.filter((t) => t.kind === 'galaxy').length;
    expect(galaxies(city)).toBeLessThan(galaxies(dark));
  });
});
