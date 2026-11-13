/**
 * Week-ahead cloud outlook: for each of the next 7 nights, the cloud figure
 * (clouds/estimate.ts) averaged over the dark hours (Sun below −12°), the
 * clearest 3-hour stretch, and the Moon. Forecast skill drops after ~3 days,
 * which the spread between models shows.
 */
import * as Astronomy from 'astronomy-engine';
import type { Place } from '../astro/sky';
import type { ModelClouds, Weather } from '../data/openmeteo';
import { cloudFactor } from '../physics/score';
import { estimateClouds, type SatObs } from './estimate';

export interface NightOutlook {
  /** Local noon before the night (a real timestamp, for formatting the date). */
  date: number;
  /** Dark hours considered (hour starts). */
  hours: number[];
  /** Mean cloud cover over the dark hours (%), per layer and total. */
  total: number;
  low: number;
  mid: number;
  high: number;
  /** Mean model spread (max − min, percentage points). */
  spread: number | null;
  /** Clearest 3-hour stretch (start, end, mean total %). */
  best: { start: number; end: number; total: number } | null;
  /** Moon illumination at local midnight (0–1) and the share of dark hours it is up. */
  moonIllum: number;
  moonUp: number;
  /** Relative imaging quality 0–100 from clouds (high cloud counts 60 %) and moonlight. */
  quality: number;
}

const H = 3600_000;

export function weekAhead(
  place: Place,
  models: ModelClouds | null,
  weather: Weather | null,
  obs: readonly SatObs[],
  now: number,
  utcOffsetSec: number,
): NightOutlook[] {
  if (!models?.hours.length) return [];
  const off = utcOffsetSec * 1000;
  const obsr = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const alt = (body: Astronomy.Body, t: number) => {
    const d = new Date(t);
    const eq = Astronomy.Equator(body, d, obsr, true, true);
    return Astronomy.Horizon(d, obsr, eq.ra, eq.dec, 'normal').altitude;
  };
  const lastModelHour = models.hours[models.hours.length - 1]?.t ?? now;
  // The evening of the local date that contains "now" (after local noon we start tonight).
  const localDay = Math.floor((now + off) / 86_400_000) * 86_400_000;
  const out: NightOutlook[] = [];
  for (let d = 0; d < 7; d++) {
    const day = localDay + d * 86_400_000;
    // Local 12:00 of this day to 12:00 of the next, on the local hour grid.
    const from = day + 12 * H - off;
    const to = from + 24 * H;
    const hours: number[] = [];
    const totals: number[] = [];
    let low = 0;
    let mid = 0;
    let high = 0;
    let spread = 0;
    let spreadN = 0;
    let moonUp = 0;
    let factor = 0;
    for (let t = from; t < to; t += H) {
      if (t + H <= now || t > lastModelHour) continue;
      const tm = t + H / 2;
      if (alt(Astronomy.Body.Sun, tm) > -12) continue;
      const c = estimateClouds(t, now, models, weather, obs);
      if (!c) continue;
      hours.push(t);
      totals.push(c.total);
      low += c.low;
      mid += c.mid;
      high += c.high;
      if (c.min != null && c.max != null) {
        spread += c.max - c.min;
        spreadN++;
      }
      factor += cloudFactor(c.low, c.mid, c.high);
      if (alt(Astronomy.Body.Moon, tm) > 0) moonUp++;
    }
    if (!hours.length) continue;
    const n = hours.length;
    let best: NightOutlook['best'] = null;
    for (let i = 0; i + 3 <= n; i++) {
      // Only consecutive hours form a stretch.
      if ((hours[i + 2] ?? 0) - (hours[i] ?? 0) !== 2 * H) continue;
      const m = ((totals[i] ?? 0) + (totals[i + 1] ?? 0) + (totals[i + 2] ?? 0)) / 3;
      if (!best || m < best.total)
        best = { start: hours[i] ?? 0, end: (hours[i + 2] ?? 0) + H, total: m };
    }
    const midnight = day + 24 * H - off;
    const ill = Astronomy.Illumination(Astronomy.Body.Moon, new Date(midnight)).phase_fraction;
    const up = moonUp / n;
    // Moonlight penalty: up to −60 % for a full Moon up all night.
    const moonFactor = 1 - 0.6 * ill * up;
    out.push({
      date: from,
      hours,
      total: totals.reduce((a, b) => a + b, 0) / n,
      low: low / n,
      mid: mid / n,
      high: high / n,
      spread: spreadN ? spread / spreadN : null,
      best,
      moonIllum: ill,
      moonUp: up,
      quality: Math.round(100 * (factor / n) * moonFactor),
    });
  }
  return out;
}
