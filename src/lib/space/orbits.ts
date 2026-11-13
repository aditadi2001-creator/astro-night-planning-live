/**
 * Satellite orbit elements (OMM) from CelesTrak (https://celestrak.org, T.S. Kelso).
 *
 * Browsers never call CelesTrak: it blocks clients that download the same data
 * more than once every two hours. The hourly GitHub job fetches the two small
 * groups at most every 6 hours (pipelines/orbits/orbits.py) and publishes
 * data/orbits.json to R2; the data Worker serves it with caching. Elements stay
 * good for pass predictions for several days, so an old copy still works.
 */
import { DATA_BASE } from '../config';
import { fetchJson, type Cached } from '../data/cache';
import type { Omm } from './passes';

export const ORBITS_URL: string = DATA_BASE ? `${DATA_BASE}/data/orbits.json` : '';

export interface Orbits {
  /** When CelesTrak was read (ms). */
  fetched: number;
  /** ISS and Tiangong. */
  stations: Omm[];
  /** CelesTrak's "brightest" list (about 150 objects). */
  bright: Omm[];
}

interface Raw {
  fetched?: number;
  stations?: Omm[];
  bright?: Omm[];
}

export function parseOrbits(raw: Raw): Orbits {
  return {
    fetched: Number(raw.fetched) || 0,
    stations: Array.isArray(raw.stations) ? raw.stations : [],
    bright: Array.isArray(raw.bright) ? raw.bright : [],
  };
}

export async function loadOrbits(signal: AbortSignal, force = false): Promise<Cached<Orbits>> {
  if (!ORBITS_URL) throw new Error('orbit data needs the data Worker');
  return fetchJson<Orbits, Raw>('orbits', ORBITS_URL, {
    maxAgeMs: force ? 0 : 60 * 60_000,
    signal,
    transform: parseOrbits,
  });
}
