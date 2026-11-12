import * as Astronomy from 'astronomy-engine';
import type { Place } from './sky';

export const HOUR = 3600_000;

export interface DarkWindow {
  /** Sun reaches −18° going down (start of astronomical darkness). */
  start: Date | null;
  /** Sun reaches −18° going up (end of astronomical darkness). */
  end: Date | null;
  /** True when the Sun never gets that low (e.g. summer at high latitude). */
  never: boolean;
}

function sunAltitude(place: Place, date: Date): number {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
  return Astronomy.Horizon(date, obs, eq.ra, eq.dec).altitude;
}

/**
 * Astronomical darkness window for "tonight": if it is dark now, the window
 * containing now; otherwise the next one (searching up to 2 days ahead).
 */
export function darkWindow(place: Place, from: Date): DarkWindow {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const darkNow = sunAltitude(place, from) <= -18;
  const search = (dir: 1 | -1, start: Date, days: number) =>
    Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, dir, start, days, -18)?.date ?? null;

  if (darkNow) {
    // Find the dusk before now (look back up to 1 day) and the dawn after now.
    const dawn = search(1, from, 1.5);
    const back = new Date(from.getTime() - 24 * HOUR);
    let dusk = search(-1, back, 1);
    if (dusk && dusk > from) dusk = null;
    return { start: dusk, end: dawn, never: false };
  }
  const start = search(-1, from, 2);
  if (!start) return { start: null, end: null, never: true };
  const end = search(1, start, 1.5);
  return { start, end, never: false };
}

/** Time to jump to for "Tonight": now if already dark, else the next dusk. */
export function tonight(place: Place, from: Date): Date {
  const w = darkWindow(place, from);
  if (w.never) {
    // No astronomical darkness: use the time of the Sun's lowest point instead.
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    const lowest = Astronomy.SearchHourAngle(Astronomy.Body.Sun, obs, 12, from);
    return lowest.time.date;
  }
  return w.start && w.start > from ? w.start : from;
}
