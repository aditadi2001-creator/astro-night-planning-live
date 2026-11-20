import { describe, expect, it } from 'vitest';
import { buildHash, locParam, parseHash, validLoc } from '../src/lib/state/route';

describe('parseHash', () => {
  it('opens the Plan page by default', () => {
    expect(parseHash('')).toEqual({ page: 'plan', params: {}, redirected: false });
    expect(parseHash('#/')).toEqual({ page: 'plan', params: {}, redirected: false });
  });

  it('ignores non-route hashes such as the skip link', () => {
    expect(parseHash('#main')).toBeNull();
  });

  it.each([
    ['#/tonight', 'tonight'],
    ['#/week', 'week'],
    ['#/targets', 'targets'],
    ['#/equipment', 'telescope'],
    ['#/maps', 'maps'],
    ['#/space', 'space'],
    ['#/about', 'about'],
    ['#/credits', 'about'],
  ])('redirects the old tab %s to the Plan section %s', (hash, section) => {
    expect(parseHash(hash)).toEqual({ page: 'plan', params: { s: section }, redirected: true });
  });

  it('keeps #/sky and its parameters', () => {
    expect(parseHash('#/sky?t=M%2031&l=con,eqgrid')).toEqual({
      page: 'sky',
      params: { t: 'M 31', l: 'con,eqgrid' },
      redirected: false,
    });
  });

  it('drops invalid parameters', () => {
    const r = parseHash('#/plan?s=nope&at=yesterday&loc=12.97123,77.59&x=1');
    expect(r).toEqual({ page: 'plan', params: {}, redirected: true });
  });

  it('round-trips through buildHash', () => {
    const params = {
      s: 'targets',
      t: 'NGC 7000',
      at: '2026-11-19T16:00:00.000Z',
      loc: 'greenwich',
      p: 'r80-2600',
    };
    const h = buildHash('plan', params);
    expect(parseHash(h)).toEqual({ page: 'plan', params, redirected: false });
  });
});

describe('location parameter privacy', () => {
  it('accepts presets and coordinates with at most two decimals', () => {
    expect(validLoc('mauna-kea')).toBe(true);
    expect(validLoc('13.04,77.57')).toBe(true);
    expect(validLoc('13.0412,77.5701')).toBe(false);
    expect(validLoc('95,10')).toBe(false);
  });

  it('rounds shared coordinates to 0.01°', () => {
    expect(locParam(13.04123, 77.56789)).toBe('13.04,77.57');
  });
});
