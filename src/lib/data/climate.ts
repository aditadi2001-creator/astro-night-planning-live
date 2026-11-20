/**
 * Clear-night climate for trip planning: ten past years (2016–2025) of hourly ERA5 cloud
 * cover from the Open-Meteo historical archive (free, no key), reduced on the device to one
 * figure per month: how many nights were clear (mean cloud ≤ 30 % between 9 pm and 3 am local
 * solar time). Only the twelve monthly figures are cached (90 days). This is the past, not a
 * forecast: it tells which months are usually clear, not whether a given night will be.
 */
import { fetchJson } from './cache';

export interface MonthClimate {
  /** Share of nights that were clear (0–1). */
  clear: number;
  /** Mean night cloud cover (%). */
  cloud: number;
  nights: number;
}
export interface Climate {
  months: MonthClimate[];
  years: string;
  source: string;
}

export const CLIMATE_YEARS = { from: 2016, to: 2025 };
export const CLEAR_MAX_CLOUD = 30;

interface Raw {
  hourly?: { time?: string[]; cloud_cover?: (number | null)[] };
}

/** Hourly UTC cloud cover → twelve monthly clear-night figures. Exported for tests. */
export function monthlyClear(raw: Raw, lon: number): Climate {
  const time = raw.hourly?.time ?? [];
  const cc = raw.hourly?.cloud_cover ?? [];
  // Night of an evening date: local solar 21:00–03:00.
  const nights = new Map<string, { sum: number; n: number; month: number }>();
  for (let i = 0; i < time.length; i++) {
    const c = cc[i];
    if (c == null) continue;
    const t = Date.parse(`${time[i]}Z`);
    const solar = t + (lon / 15) * 3600_000;
    const h = new Date(solar).getUTCHours();
    if (h < 21 && h >= 3) continue;
    // Hours after midnight belong to the previous evening.
    const evening = new Date(h < 3 ? solar - 86400_000 : solar);
    const key = evening.toISOString().slice(0, 10);
    const e = nights.get(key) ?? { sum: 0, n: 0, month: evening.getUTCMonth() };
    e.sum += c;
    e.n++;
    nights.set(key, e);
  }
  const acc = Array.from({ length: 12 }, () => ({ clear: 0, cloud: 0, nights: 0 }));
  for (const e of nights.values()) {
    if (e.n < 4) continue;
    const mean = e.sum / e.n;
    const a = acc[e.month] as { clear: number; cloud: number; nights: number };
    a.nights++;
    a.cloud += mean;
    if (mean <= CLEAR_MAX_CLOUD) a.clear++;
  }
  return {
    months: acc.map((a) => ({
      clear: a.nights ? a.clear / a.nights : 0,
      cloud: a.nights ? a.cloud / a.nights : 0,
      nights: a.nights,
    })),
    years: `${CLIMATE_YEARS.from}–${CLIMATE_YEARS.to}`,
    source: 'ERA5 reanalysis (ECMWF/Copernicus) via the Open-Meteo historical weather API',
  };
}

/** The site's clear-night climate (rounded to 0.1°, about 11 km: the ERA5 grid is ~25 km). */
export async function loadClimate(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<Climate> {
  const la = lat.toFixed(1);
  const lo = lon.toFixed(1);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}` +
    `&start_date=${CLIMATE_YEARS.from}-01-01&end_date=${CLIMATE_YEARS.to}-12-31` +
    '&hourly=cloud_cover&timezone=GMT';
  const r = await fetchJson<Climate, Raw>(`climate:${la},${lo}`, url, {
    maxAgeMs: 90 * 24 * 3600_000,
    retries: 1,
    ...(signal ? { signal } : {}),
    transform: (raw) => monthlyClear(raw, Number(lo)),
  });
  return r.data;
}
