/// <reference lib="webworker" />
/** Computes satellite passes off the main thread (≈150 satellites × 1 day of SGP4). */
import { findPasses, type Omm, type Pass, type Site } from './passes';

export interface PassJob {
  id: number;
  stations: Omm[];
  bright: Omm[];
  site: Site;
  now: number;
}

export interface PassResult {
  id: number;
  /** ISS / Tiangong, next 3 days, all passes above 10°. */
  stations: Pass[];
  /** Bright satellites in the next 24 h: visible passes peaking above 30°. */
  bright: Pass[];
}

self.onmessage = (e: MessageEvent<PassJob>) => {
  const { id, stations, bright, site, now } = e.data;
  const start = now - 10 * 60_000; // include a pass that is happening right now
  const st = stations
    .flatMap((o) => findPasses(o, site, start, now + 3 * 86_400_000, { stepMs: 20_000 }))
    .filter((p) => p.set.t > now)
    .sort((a, b) => a.rise.t - b.rise.t);
  const stationIds = new Set(stations.map((o) => Number(o.NORAD_CAT_ID)));
  const br = bright
    .filter((o) => !stationIds.has(Number(o.NORAD_CAT_ID)))
    .flatMap((o) => findPasses(o, site, start, now + 86_400_000, { stepMs: 30_000, minAlt: 30 }))
    .filter((p) => p.visible && p.set.t > now)
    // Listed by when each becomes visible (the time the card shows).
    .sort((a, b) => (a.visibleFrom?.t ?? a.rise.t) - (b.visibleFrom?.t ?? b.rise.t));
  const res: PassResult = { id, stations: st, bright: br };
  (self as unknown as Worker).postMessage(res);
};
