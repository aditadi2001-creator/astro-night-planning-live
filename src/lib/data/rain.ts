/**
 * Rain forecast from Open-Meteo (https://open-meteo.com, CC BY 4.0): one call per
 * location for seven days of hourly and daily precipitation. It is a separate call from
 * the main weather one (openmeteo.ts) so the rest of the app is unchanged; it starts only
 * when the Rain or Ratings section is near the screen and is cached for 30 minutes.
 */
import { fetchJson, roundCoord, type Cached } from './cache';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const TTL = 30 * 60_000;

type Series = (number | null)[];
interface RawRain {
  utc_offset_seconds: number;
  hourly: Record<string, Series> & { time: number[] };
  daily: Record<string, Series> & { time: number[] };
}

export interface RainHour {
  /** ms since epoch (start of the hour). */
  t: number;
  /** Total precipitation (rain + showers + snow as water) over the hour, mm. */
  mm: number | null;
  /** Chance of at least 0.1 mm in the hour, %. */
  prob: number | null;
  rain: number | null;
  showers: number | null;
  /** Snowfall, cm. */
  snow: number | null;
  /** WMO weather code. */
  code: number | null;
}

export interface RainDay {
  /** ms since epoch of local midnight. */
  t: number;
  mm: number | null;
  /** Hours with precipitation. */
  hours: number | null;
  /** Highest hourly chance of precipitation that day, %. */
  probMax: number | null;
  snow: number | null;
  code: number | null;
}

export interface Rain {
  utcOffsetSeconds: number;
  hours: RainHour[];
  days: RainDay[];
}

const v = (s: Series | undefined, i: number) => (s ? (s[i] ?? null) : null);

export function parseRain(raw: RawRain): Rain {
  const h = raw.hourly;
  const d = raw.daily;
  return {
    utcOffsetSeconds: raw.utc_offset_seconds,
    hours: h.time.map((t, i) => ({
      t: t * 1000,
      mm: v(h.precipitation, i),
      prob: v(h.precipitation_probability, i),
      rain: v(h.rain, i),
      showers: v(h.showers, i),
      snow: v(h.snowfall, i),
      code: v(h.weather_code, i),
    })),
    days: d.time.map((t, i) => ({
      t: t * 1000,
      mm: v(d.precipitation_sum, i),
      hours: v(d.precipitation_hours, i),
      probMax: v(d.precipitation_probability_max, i),
      snow: v(d.snowfall_sum, i),
      code: v(d.weather_code, i),
    })),
  };
}

export async function loadRain(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<Rain>> {
  const qs = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    timezone: 'auto',
    timeformat: 'unixtime',
    past_days: '1',
    forecast_days: '7',
    models: 'best_match',
    hourly: 'precipitation,precipitation_probability,rain,showers,snowfall,weather_code',
    daily:
      'precipitation_sum,precipitation_hours,precipitation_probability_max,snowfall_sum,weather_code',
  });
  return fetchJson<Rain, RawRain>(
    `rain:${roundCoord(lat)},${roundCoord(lon)}`,
    `${FORECAST}?${qs}`,
    { maxAgeMs: force ? 0 : TTL, signal, transform: parseRain },
  );
}

/** Short words for a WMO weather code (only the wet ones matter here). */
export function weatherWord(code: number | null): string {
  if (code == null) return '';
  if (code >= 95) return 'Thunderstorm';
  if (code >= 85) return 'Snow showers';
  if (code >= 80) return code === 82 ? 'Violent showers' : 'Rain showers';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 66 && code <= 67) return 'Freezing rain';
  if (code >= 61 && code <= 65)
    return code === 65 ? 'Heavy rain' : code === 63 ? 'Rain' : 'Light rain';
  if (code >= 56 && code <= 57) return 'Freezing drizzle';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 45 && code <= 48) return 'Fog';
  if (code === 3) return 'Overcast';
  if (code === 2) return 'Partly cloudy';
  if (code === 1) return 'Mostly clear';
  if (code === 0) return 'Clear';
  return '';
}
