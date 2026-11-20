import { describe, expect, it } from 'vitest';
import { nightAt, yearEvents, yearNights } from '../src/lib/plan/year';
import { monthlyClear } from '../src/lib/data/climate';
import { nextGoodTime, pinInfo } from '../src/lib/astro/pin';

const BLR = { lat: 13.04, lon: 77.57, elevation: 900 };
const place = { ...BLR, name: 'Bangalore' } as unknown as Parameters<typeof pinInfo>[1];

describe('year planner nights', () => {
  it('has the right darkness length through the year (Bangalore, 13°N)', () => {
    const dec = nightAt(2027, 11, 21, BLR, null, 30);
    const jun = nightAt(2027, 5, 21, BLR, null, 30);
    // Astronomical darkness at 13°N: about 10.0 h at the December solstice, 8.6 h in June.
    expect(dec.darkH).toBeGreaterThan(9.6);
    expect(dec.darkH).toBeLessThan(10.4);
    expect(jun.darkH).toBeGreaterThan(8.2);
    expect(jun.darkH).toBeLessThan(9.0);
    expect(dec.moonlessH).toBeLessThanOrEqual(dec.darkH);
  });
  it('a new-Moon night is moonless all night, a full-Moon night not at all', () => {
    // New Moon 2027-01-07, full Moon 2027-01-22 (UTC dates).
    const nm = nightAt(2027, 0, 7, BLR, null, 30);
    const fm = nightAt(2027, 0, 22, BLR, null, 30);
    expect(nm.moonlessH / nm.darkH).toBeGreaterThan(0.95);
    expect(nm.moonIllum).toBeLessThan(0.05);
    expect(fm.moonlessH).toBeLessThan(0.5);
    expect(fm.moonIllum).toBeGreaterThan(0.95);
  });
  it('target hours follow the seasons (Milky Way core: June, not December)', () => {
    const core = { ra: 266.42, dec: -29.0 };
    const jun = nightAt(2027, 5, 5, BLR, core, 30);
    const dec = nightAt(2027, 11, 5, BLR, core, 30);
    expect(jun.targetH).toBeGreaterThan(4);
    expect(dec.targetH).toBe(0);
    // Highest altitude 90 − |13.04 + 29.0| ≈ 48°.
    expect(jun.targetMaxAlt).toBeGreaterThan(46);
    expect(jun.targetMaxAlt).toBeLessThan(49);
  });
  it('covers every night of a year', () => {
    const n = yearNights(2028, BLR, null);
    expect(n).toHaveLength(366);
    expect(n[0]?.date).toBe('2028-01-01');
    expect(n[365]?.date).toBe('2028-12-31');
  });
});

describe('year planner events', () => {
  const ev = yearEvents(2026, BLR);
  it('finds the year’s Moon phases', () => {
    expect(ev.filter((e) => e.kind === 'new-moon').length).toBeGreaterThanOrEqual(12);
    expect(ev.filter((e) => e.kind === 'full-moon').length).toBeGreaterThanOrEqual(12);
  });
  it('finds the total lunar eclipse of 3 March 2026, visible from India at moonrise', () => {
    const le = ev.find((e) => e.kind === 'lunar-eclipse' && new Date(e.t).getUTCMonth() === 2);
    expect(le?.title).toMatch(/Total/);
    expect(new Date(le?.t ?? 0).getUTCDate()).toBe(3);
  });
  it('lists oppositions and meteor showers, with the solar-filter warning on solar eclipses', () => {
    expect(ev.some((e) => e.kind === 'opposition' && /Saturn/.test(e.title))).toBe(true);
    expect(ev.filter((e) => e.kind === 'meteors')).toHaveLength(9);
    for (const e of yearEvents(2027, BLR).filter((x) => x.kind === 'solar-eclipse'))
      expect(e.detail).toMatch(/certified full-aperture solar filter/);
  });
});

describe('clear-night climate', () => {
  it('counts nights from 9 pm to 3 am local solar time', () => {
    // Longitude 0: solar time = UTC. Night of 1 Jan: clear; night of 2 Jan: cloudy.
    const time: string[] = [];
    const cc: number[] = [];
    for (let d = 1; d <= 3; d++)
      for (let h = 0; h < 24; h++) {
        time.push(`2020-01-0${d}T${String(h).padStart(2, '0')}:00`);
        // Daytime always cloudy (ignored); 2 Jan evening and 3 Jan early morning cloudy.
        const night = h >= 21 || h < 3;
        const cloudy = (d === 2 && h >= 21) || (d === 3 && h < 3);
        cc.push(!night ? 100 : cloudy ? 90 : 5);
      }
    const c = monthlyClear({ hourly: { time, cloud_cover: cc } }, 0);
    const jan = c.months[0];
    // Nights of 1 Jan (21–24 + 2 Jan 0–3) and 2 Jan; the night of 3 Jan has only 3 hours.
    expect(jan?.nights).toBe(2);
    expect(jan?.clear).toBeCloseTo(0.5, 6);
  });
});

describe('pinned objects', () => {
  it('describes an object the 3D sky does not know, and says when to look', () => {
    // Sh 2-129 (Flying Bat), RA 318.8°, Dec +60.2°.
    const t = new Date('2026-11-20T06:00:00Z');
    const info = pinInfo(
      {
        label: 'Sh 2-129',
        ra: 318.8,
        dec: 60.2,
        names: ['Sh 2-129'],
        type: 'emission',
        mag: null,
        sizeArcmin: 138,
      },
      place,
      t,
    );
    expect(info.model).toBe('pin');
    expect(info.ra2000).toBe(318.8);
    expect(info.alt).toBeGreaterThan(-90);
    const next = nextGoodTime(10.68, 41.27, place, t);
    expect(next?.dark).toBe(true);
    // M 31 transits around 20:30 local in late November: best dark moment in the evening.
    expect(next?.alt).toBeGreaterThan(40);
    // Never rises: Dec −85° from 13°N.
    expect(nextGoodTime(0, -85, place, t)).toBeNull();
  });
});
