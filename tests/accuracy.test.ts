/**
 * Accuracy against NASA/JPL Horizons (fixtures from scripts/accuracy/fetch-horizons.mjs) and
 * Astropy (scripts/accuracy/astropy_dso.py). Targets (docs/ACCURACY.md):
 *   Sun, Moon, planets ≤ 1′ · rise/set/transit/twilight ≤ 1 min · deep-sky alt/az ≤ 0.1°.
 * These exercise the same code paths the app uses (astronomy-engine via src/lib).
 */
import { describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import horizons from './fixtures/horizons-bangalore-2026-11.json';
import astropy from './fixtures/astropy-dso-bangalore.json';
import { twilight, moonEvents } from '../src/lib/conditions';
import { altAz } from '../src/lib/astro/target';
import type { Place } from '../src/lib/astro/sky';

const site: Place = {
  name: 'Bangalore (Horizons site)',
  lat: horizons.site.lat,
  lon: horizons.site.lon,
  elevation: horizons.site.km * 1000,
};
const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
const D = Math.PI / 180;

/** Great-circle separation in arcseconds. */
function sepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * D) * Math.sin(dec2 * D) +
    Math.cos(dec1 * D) * Math.cos(dec2 * D) * Math.cos((ra1 - ra2) * D);
  return (Math.acos(Math.min(1, c)) / D) * 3600;
}

const report: string[] = [];

describe('Sun, Moon and planets vs JPL Horizons (target ≤ 1′)', () => {
  let worstRaDec = 0;
  let worstAltAz = 0;
  for (const p of horizons.positions) {
    it(`${p.body} at ${p.time}`, () => {
      const body = Astronomy.Body[p.body as keyof typeof Astronomy.Body] as Astronomy.Body;
      const t = new Date(p.time);
      // Topocentric apparent RA/Dec of date, as the app's cards compute it.
      const eq = Astronomy.Equator(body, t, obs, true, true);
      const radec = sepArcsec(eq.ra * 15, eq.dec, p.ra, p.dec);
      // Airless alt/az (Horizons "a-app"): no refraction.
      const hor = Astronomy.Horizon(t, obs, eq.ra, eq.dec, '');
      const altaz = sepArcsec(hor.azimuth, hor.altitude, p.az, p.alt);
      worstRaDec = Math.max(worstRaDec, radec);
      worstAltAz = Math.max(worstAltAz, altaz);
      expect(radec).toBeLessThan(60);
      expect(altaz).toBeLessThan(60);
    });
  }
  it('summary', () => {
    report.push(
      `positions: worst RA/Dec ${worstRaDec.toFixed(1)}″, worst alt/az ${worstAltAz.toFixed(1)}″`,
    );
  });
});

type Sample = [string, number, number];

/** Times where the series crosses `level(sample)` in the given direction (linear interpolation). */
function crossings(series: Sample[], level: (s: Sample) => number, rising: boolean): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1] as Sample;
    const b = series[i] as Sample;
    const fa = a[1] - level(a);
    const fb = b[1] - level(b);
    if (rising ? fa < 0 && fb >= 0 : fa > 0 && fb <= 0) {
      const ta = Date.parse(a[0]);
      const tb = Date.parse(b[0]);
      out.push(ta + ((tb - ta) * -fa) / (fb - fa));
    }
  }
  return out;
}

/** Upper limb on the refracted horizon: centre at −(34′ + angular radius). */
const limb = (s: Sample) => -(34 / 60 + s[2] / 2 / 3600);
const sun = horizons.series.Sun as Sample[];
const moon = horizons.series.Moon as Sample[];
const nearest = (list: number[], t: number) =>
  list.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Number.POSITIVE_INFINITY);

describe('rise, set and twilight vs JPL Horizons (target ≤ 1 min)', () => {
  const tw = twilight(site, new Date('2026-11-19T12:00:00Z'));
  const errs: Record<string, number> = {};
  const check = (label: string, app: Date | null, ref: number[]) => {
    expect(app, label).not.toBeNull();
    const e = Math.abs((app as Date).getTime() - nearest(ref, (app as Date).getTime())) / 1000;
    errs[label] = e;
    expect(e, `${label}: ${e.toFixed(1)} s`).toBeLessThan(60);
  };

  it('sunset and sunrise', () => {
    check('sunset', tw.sunset, crossings(sun, limb, false));
    check('sunrise', tw.sunrise, crossings(sun, limb, true));
  });

  it('civil, nautical and astronomical twilight', () => {
    for (const [label, alt, d] of [
      ['civil dusk', -6, tw.civilEnd],
      ['nautical dusk', -12, tw.nauticalEnd],
      ['astronomical dusk', -18, tw.astroEnd],
    ] as const)
      check(
        label,
        d,
        crossings(sun, () => alt, false),
      );
    for (const [label, alt, d] of [
      ['astronomical dawn', -18, tw.astroStart],
      ['nautical dawn', -12, tw.nauticalStart],
      ['civil dawn', -6, tw.civilStart],
    ] as const)
      check(
        label,
        d,
        crossings(sun, () => alt, true),
      );
  });

  it('moonrise and moonset', () => {
    const m = moonEvents(site, new Date('2026-11-19T18:00:00Z'));
    check('moonrise', m.rise, crossings(moon, limb, true));
    check('moonset', m.set, crossings(moon, limb, false));
  });

  it('solar transit', () => {
    const t = Astronomy.SearchHourAngle(
      Astronomy.Body.Sun,
      obs,
      0,
      new Date('2026-11-19T00:00:00Z'),
    ).time.date;
    // Horizons transit = maximum elevation: fit a parabola through the three samples around it.
    let k = 1;
    for (let i = 1; i < sun.length - 1; i++)
      if ((sun[i] as Sample)[1] > (sun[k] as Sample)[1]) k = i;
    const [y0, y1, y2] = [sun[k - 1], sun[k], sun[k + 1]].map((s) => (s as Sample)[1]) as [
      number,
      number,
      number,
    ];
    const off = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
    const ref = Date.parse((sun[k] as Sample)[0]) + off * 60_000;
    check('solar transit', t, [ref]);
  });

  it('summary', () => {
    const worst = Math.max(...Object.values(errs));
    report.push(
      `events: worst ${worst.toFixed(1)} s (${Object.entries(errs)
        .map(([k, v]) => `${k} ${v.toFixed(1)} s`)
        .join(', ')})`,
    );
  });
});

describe('deep-sky alt/az vs Astropy (target ≤ 0.1°)', () => {
  let worst = 0;
  for (const o of astropy.objects) {
    it(`${o.name} at ${astropy.time}`, () => {
      Astronomy.DefineStar(Astronomy.Body.Star2, o.ra / 15, o.dec, 1000);
      const h = altAz(Astronomy.Body.Star2, obs, new Date(astropy.time));
      const e = sepArcsec(h.az, h.alt, o.az, o.alt) / 3600;
      worst = Math.max(worst, e);
      expect(e).toBeLessThan(0.1);
    });
  }
  it('summary', () => {
    report.push(`deep-sky alt/az: worst ${(worst * 3600).toFixed(1)}″`);
    console.log(`\nACCURACY REPORT\n${report.map((r) => `  ${r}`).join('\n')}\n`);
  });
});
