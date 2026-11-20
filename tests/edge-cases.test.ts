import { describe, it, expect } from 'vitest';
import { twilight, nightWindow, moonEvents } from '../src/lib/conditions';
import { darkWindow, tonight } from '../src/lib/astro/time';
import { targetVisibility } from '../src/lib/astro/target';
import { yearNights, yearEvents } from '../src/lib/plan/year';
import { nextGoodTime, pinInfo } from '../src/lib/astro/pin';
const P = (lat: number, lon: number) => ({ name: 'x', lat, lon, elevation: 0 }) as never;
const places = {
  svalbard: P(78.2, 15.6),
  southPole: P(-89.9, 0),
  equator: P(0, 0),
  sydney: P(-33.9, 151.2),
  dateline: P(10, 179.9),
};
const dates = [
  new Date('2026-06-21T12:00:00Z'),
  new Date('2026-12-21T12:00:00Z'),
  new Date('1539-10-16T00:00:00Z'),
  new Date('2999-03-01T00:00:00Z'),
];
describe('edge cases', () => {
  for (const [name, pl] of Object.entries(places))
    for (const d of dates)
      it(`${name} ${d.toISOString().slice(0, 10)}`, () => {
        const tw = twilight(pl, d);
        nightWindow(pl, d);
        moonEvents(pl, d);
        darkWindow(pl, d);
        tonight(pl, d);
        const dw = darkWindow(pl, d) as never;
        const v = targetVisibility(
          { name: 'M 31', ra2000: 10.68, dec2000: 41.27, body: null },
          pl,
          d,
          dw,
        );
        expect(Number.isFinite(v.altNow)).toBe(true);
        nextGoodTime(10.68, 41.27, pl, d);
        pinInfo(
          { label: 'x', ra: 10, dec: 40, names: [], type: '', mag: null, sizeArcmin: null },
          pl,
          d,
        );
        expect(tw).toBeTruthy();
      });
  it('year planner at extreme latitudes and years', () => {
    for (const pl of [places.svalbard, places.southPole]) {
      const n = yearNights(2026, pl as never, { name: 'M31', ra: 10.68, dec: 41.27 });
      expect(n).toHaveLength(365);
      for (const r of n) expect(Number.isFinite(r.darkH)).toBe(true);
      yearEvents(2026, pl as never);
    }
    expect(yearNights(2041, places.sydney as never, null)).toHaveLength(365);
  });
});
