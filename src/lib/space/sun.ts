/**
 * Space weather on the Sun from NOAA SWPC (public JSON, CORS allowed, docs/RESEARCH.md §7):
 * the latest 10.7 cm radio flux, the active regions of the latest report day, and the monthly
 * sunspot number. Cached for an hour; any missing piece is reported as unknown.
 */
import { fetchJson, type Cached } from '../data/cache';

const SWPC = 'https://services.swpc.noaa.gov';

export interface SunData {
  flux: { value: number; time: string } | null;
  regions: {
    date: string;
    count: number;
    spots: number;
    largest: { region: number; area: number; cls: string } | null;
    mFlareMax: number | null;
  } | null;
  ssn: { month: string; value: number } | null;
}

interface Region {
  observed_date?: string;
  region?: number;
  area?: number;
  spot_class?: string;
  number_spots?: number;
  m_flare_probability?: number | null;
}

export function summariseRegions(rows: Region[]): SunData['regions'] {
  const dates = rows
    .map((r) => r.observed_date ?? '')
    .filter(Boolean)
    .sort();
  const last = dates.at(-1);
  if (!last) return null;
  const today = rows.filter((r) => r.observed_date === last);
  const largest = today.reduce<Region | null>(
    (a, b) => ((b.area ?? 0) > (a?.area ?? -1) ? b : a),
    null,
  );
  const m = today
    .map((r) => r.m_flare_probability)
    .filter((x): x is number => typeof x === 'number');
  return {
    date: last,
    count: today.length,
    spots: today.reduce((s, r) => s + (r.number_spots ?? 0), 0),
    largest: largest?.region
      ? { region: largest.region, area: largest.area ?? 0, cls: largest.spot_class ?? '' }
      : null,
    mFlareMax: m.length ? Math.max(...m) : null,
  };
}

async function part<T>(p: Promise<Cached<T>>): Promise<T | null> {
  try {
    return (await p).data;
  } catch {
    return null;
  }
}

export async function loadSunData(signal?: AbortSignal): Promise<SunData> {
  const opt = { maxAgeMs: 3600_000, retries: 1, ...(signal ? { signal } : {}) };
  const [flux, regions, cycle] = await Promise.all([
    part(
      fetchJson<{ flux: number; time_tag: string }[]>(
        'swpc.flux',
        `${SWPC}/products/summary/10cm-flux.json`,
        opt,
      ),
    ),
    part(
      fetchJson<SunData['regions'], Region[]>('swpc.regions', `${SWPC}/json/solar_regions.json`, {
        ...opt,
        transform: summariseRegions,
      }),
    ),
    part(
      fetchJson<{ month: string; value: number } | null, { 'time-tag': string; ssn: number }[]>(
        'swpc.ssn',
        `${SWPC}/json/solar-cycle/observed-solar-cycle-indices.json`,
        {
          ...opt,
          transform: (rows) => {
            const last = rows.at(-1);
            return last ? { month: last['time-tag'], value: last.ssn } : null;
          },
        },
      ),
    ),
  ]);
  const f = flux?.[0];
  return {
    flux: f ? { value: f.flux, time: f.time_tag } : null,
    regions: regions ?? null,
    ssn: cycle ?? null,
  };
}
