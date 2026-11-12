/**
 * Open-Meteo clients (https://open-meteo.com). Free for non-commercial use
 * (< 10,000 calls/day, 5,000/hour, 600/minute); data CC BY 4.0, credit required.
 *
 * Per location we make three calls, each merging all its variables:
 *   1. forecast, best_match model: surface + cloud layers + pressure levels
 *   2. forecast, 3 other models: total cloud only (model agreement)
 *   3. air quality (CAMS): AOD, dust, PM, AQI
 * Coordinates are rounded to 0.01° (~1 km) so nearby visitors share caches.
 */
import { fetchJson, roundCoord, type Cached } from './cache';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

/** Pressure levels used for the seeing estimate (hPa). */
export const LEVELS = [850, 700, 500, 300, 250, 200] as const;
export type Level = (typeof LEVELS)[number];

export const AGREEMENT_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'] as const;
export const MODEL_LABELS: Record<string, string> = {
  best_match: 'Best match',
  ecmwf_ifs025: 'ECMWF IFS',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
};

const SURFACE = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'surface_pressure',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'visibility',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
] as const;
const UPPER = LEVELS.flatMap((l) => [
  `wind_speed_${l}hPa`,
  `wind_direction_${l}hPa`,
  `temperature_${l}hPa`,
]);
const AQ = ['aerosol_optical_depth', 'dust', 'pm2_5', 'pm10', 'us_aqi', 'european_aqi'] as const;

const TTL = 30 * 60_000;

type Series = (number | null)[];
interface RawForecast {
  timezone: string;
  utc_offset_seconds: number;
  elevation: number;
  hourly: Record<string, Series> & { time: number[] };
}

export interface WeatherHour {
  /** ms since epoch (start of the hour). */
  t: number;
  temperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  /** Station (surface) pressure, hPa. */
  pressure: number | null;
  wind: number | null;
  windDir: number | null;
  gusts: number | null;
  visibility: number | null;
  cloud: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  /** Wind speed (km/h) and direction (°) and temperature (°C) by pressure level. */
  upper: Record<Level, { speed: number | null; dir: number | null; temp: number | null }>;
}

export interface Weather {
  timezone: string;
  utcOffsetSeconds: number;
  /** Model grid elevation used by Open-Meteo (m). */
  elevation: number;
  hours: WeatherHour[];
}

export interface ModelClouds {
  hours: { t: number; byModel: Record<string, number | null> }[];
}

export interface AirHour {
  t: number;
  aod: number | null;
  dust: number | null;
  pm25: number | null;
  pm10: number | null;
  usAqi: number | null;
  euAqi: number | null;
}

export interface Air {
  hours: AirHour[];
}

function q(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
}

function base(lat: number, lon: number) {
  return {
    latitude: roundCoord(lat),
    longitude: roundCoord(lon),
    timezone: 'auto',
    timeformat: 'unixtime',
    past_days: 1,
    forecast_days: 3,
  };
}

const key = (kind: string, lat: number, lon: number) =>
  `${kind}:${roundCoord(lat)},${roundCoord(lon)}`;

const v = (s: Series | undefined, i: number) => (s ? (s[i] ?? null) : null);

export function parseWeather(raw: RawForecast): Weather {
  const h = raw.hourly;
  return {
    timezone: raw.timezone,
    utcOffsetSeconds: raw.utc_offset_seconds,
    elevation: raw.elevation,
    hours: h.time.map((t, i) => ({
      t: t * 1000,
      temperature: v(h.temperature_2m, i),
      humidity: v(h.relative_humidity_2m, i),
      dewPoint: v(h.dew_point_2m, i),
      pressure: v(h.surface_pressure, i),
      wind: v(h.wind_speed_10m, i),
      windDir: v(h.wind_direction_10m, i),
      gusts: v(h.wind_gusts_10m, i),
      visibility: v(h.visibility, i),
      cloud: v(h.cloud_cover, i),
      cloudLow: v(h.cloud_cover_low, i),
      cloudMid: v(h.cloud_cover_mid, i),
      cloudHigh: v(h.cloud_cover_high, i),
      upper: Object.fromEntries(
        LEVELS.map((l) => [
          l,
          {
            speed: v(h[`wind_speed_${l}hPa`], i),
            dir: v(h[`wind_direction_${l}hPa`], i),
            temp: v(h[`temperature_${l}hPa`], i),
          },
        ]),
      ) as WeatherHour['upper'],
    })),
  };
}

export async function loadWeather(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<Weather>> {
  const url = `${FORECAST}?${q({ ...base(lat, lon), models: 'best_match', hourly: [...SURFACE, ...UPPER].join(',') })}`;
  const r = await fetchJson<RawForecast>(key('wx', lat, lon), url, {
    maxAgeMs: force ? 0 : TTL,
    signal,
  });
  return { ...r, data: parseWeather(r.data) };
}

export async function loadModelClouds(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<ModelClouds>> {
  const url = `${FORECAST}?${q({ ...base(lat, lon), models: AGREEMENT_MODELS.join(','), hourly: 'cloud_cover' })}`;
  const r = await fetchJson<RawForecast>(key('models', lat, lon), url, {
    maxAgeMs: force ? 0 : TTL,
    signal,
  });
  const h = r.data.hourly;
  return {
    ...r,
    data: {
      hours: h.time.map((t, i) => ({
        t: t * 1000,
        byModel: Object.fromEntries(AGREEMENT_MODELS.map((m) => [m, v(h[`cloud_cover_${m}`], i)])),
      })),
    },
  };
}

export async function loadAir(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<Air>> {
  const url = `${AIR}?${q({ ...base(lat, lon), hourly: AQ.join(',') })}`;
  const r = await fetchJson<RawForecast>(key('air', lat, lon), url, {
    maxAgeMs: force ? 0 : TTL,
    signal,
  });
  const h = r.data.hourly;
  return {
    ...r,
    data: {
      hours: h.time.map((t, i) => ({
        t: t * 1000,
        aod: v(h.aerosol_optical_depth, i),
        dust: v(h.dust, i),
        pm25: v(h.pm2_5, i),
        pm10: v(h.pm10, i),
        usAqi: v(h.us_aqi, i),
        euAqi: v(h.european_aqi, i),
      })),
    },
  };
}

/** Rings sampled around the site for placing clouds in the right direction. */
export const CLOUD_RINGS_KM = [35, 100] as const;
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** Point `distKm` away from (lat, lon) on bearing `brgDeg` (great circle). */
export function destination(lat: number, lon: number, brgDeg: number, distKm: number) {
  const R = 6371;
  const d = distKm / R;
  const b = (brgDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}

export interface CloudRing {
  points: { az: number; dist: number }[];
  /** hours[k].layers[i] = cover (%) at points[i]. */
  hours: { t: number; low: (number | null)[]; mid: (number | null)[]; high: (number | null)[] }[];
}

/**
 * Low/mid/high cloud at 16 points (8 bearings × 35 and 100 km) in ONE
 * multi-location request, so the sky view can place clouds where they are.
 */
export async function loadCloudRing(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<CloudRing>> {
  const points = CLOUD_RINGS_KM.flatMap((dist) => BEARINGS.map((az) => ({ az, dist })));
  const coords = points.map((p) => destination(roundCoord(lat), roundCoord(lon), p.az, p.dist));
  const url = `${FORECAST}?${q({
    latitude: coords.map((c) => roundCoord(c.lat)).join(','),
    longitude: coords.map((c) => roundCoord(c.lon)).join(','),
    hourly: 'cloud_cover_low,cloud_cover_mid,cloud_cover_high',
    models: 'best_match',
    timeformat: 'unixtime',
    past_days: 1,
    forecast_days: 2,
  })}`;
  const r = await fetchJson<RawForecast[] | RawForecast>(key('ring', lat, lon), url, {
    maxAgeMs: force ? 0 : TTL * 2,
    signal,
  });
  const list = Array.isArray(r.data) ? r.data : [r.data];
  const times = list[0]?.hourly.time ?? [];
  return {
    ...r,
    data: {
      points,
      hours: times.map((t, i) => ({
        t: t * 1000,
        low: list.map((p) => v(p.hourly.cloud_cover_low, i)),
        mid: list.map((p) => v(p.hourly.cloud_cover_mid, i)),
        high: list.map((p) => v(p.hourly.cloud_cover_high, i)),
      })),
    },
  };
}

/** Row for the hour containing `t` (rows are hourly, starting on the hour). */
export function hourAt<T extends { t: number }>(rows: readonly T[], t: number): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.t <= t) best = r;
    else break;
  }
  return best && t - best.t < 3600_000 ? best : null;
}

export interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
}

export async function searchPlaces(name: string, signal: AbortSignal): Promise<GeoResult[]> {
  const url = `${GEOCODE}?${q({ name, count: 8, language: 'en', format: 'json' })}`;
  const r = await fetchJson<{ results?: GeoResult[] }>(`geo:${name.toLowerCase()}`, url, {
    maxAgeMs: 7 * 24 * 3600_000,
    retries: 1,
    signal,
  });
  return r.data.results ?? [];
}
