/**
 * Measured air quality near the site: OpenAQ reference monitors (government
 * stations such as India's CPCB/DPCC, the US EPA, the EEA), read through the
 * data Worker (it holds the free OpenAQ key and caches each 0.01° cell for
 * 20 minutes). The Worker returns NowCast PM2.5/PM10 per station; the US AQI is
 * computed here (air/aqi.ts).
 *
 * Why not just the forecast model: the CAMS global model behind the forecast
 * AQI runs on a ~45 km grid and badly underestimates city particle pollution in
 * places (in Delhi in November by a factor of ~5), so for "now" a nearby
 * monitor is far more accurate. The model stays for forecast hours and for
 * places without a monitor within 25 km.
 */
import { DATA_BASE } from '../config';
import { aqiPm10, aqiPm25 } from '../air/aqi';
import { fetchJson, type Cached } from './cache';

export const STATION_AIR_ENABLED = !!DATA_BASE;

export interface Station {
  name: string;
  provider: string | null;
  /** Reference-grade monitor (vs a low-cost sensor). */
  monitor: boolean;
  km: number;
  /** End of the newest hour reported (ms), or null. */
  time: number | null;
  /** NowCast concentrations (µg/m³). */
  pm25: number | null;
  pm10: number | null;
  /** US AQI: the larger of the PM2.5 and PM10 indices. */
  aqi: number | null;
}

export interface StationAir {
  fetched: number;
  /** Nearest first. */
  stations: Station[];
}

interface Raw {
  fetched: number;
  stations: Omit<Station, 'aqi'>[];
}

export function parseStationAir(raw: Raw): StationAir {
  return {
    fetched: raw.fetched,
    stations: (raw.stations ?? [])
      .map((s) => {
        const a = [aqiPm25(s.pm25), aqiPm10(s.pm10)].filter((v): v is number => v != null);
        return { ...s, aqi: a.length ? Math.max(...a) : null };
      })
      .filter((s) => s.aqi != null),
  };
}

/** The site's measured AQI: the nearest station, with the spread of the others. */
export function siteAqi(sa: StationAir | null): {
  aqi: number;
  station: Station;
  others: number[];
} | null {
  const st = sa?.stations ?? [];
  const first = st[0];
  if (!first || first.aqi == null) return null;
  return {
    aqi: first.aqi,
    station: first,
    others: st.slice(1).map((s) => s.aqi ?? 0),
  };
}

export async function loadStationAir(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<StationAir | null>> {
  const la = (Math.round(lat * 100) / 100).toFixed(2);
  const lo = (Math.round(lon * 100) / 100).toFixed(2);
  try {
    return await fetchJson<StationAir | null, Raw>(
      `aq:${la},${lo}`,
      `${DATA_BASE}/aq/${la}/${lo}`,
      {
        maxAgeMs: force ? 0 : 20 * 60_000,
        // 503 = no station source configured on the Worker: don't retry.
        retries: 0,
        signal,
        transform: parseStationAir,
      },
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { data: null, fetchedAt: Date.now() };
  }
}
