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
import { aqiCo, aqiNo2, aqiO3, aqiPm10, aqiPm25, aqiSo2, type Gas } from '../air/aqi';
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
  /** Newest hourly PM2.5 (µg/m³). */
  pm25Latest?: number | null;
  /** 24-hour means (µg/m³; null with fewer than 18 of 24 hours), the basis of the daily AQI. */
  pm25Mean24?: number | null;
  pm10Mean24?: number | null;
  /** Hourly PM2.5 for the last 24 hours, newest first (µg/m³). */
  pm25Series?: (number | null)[] | null;
}

/** One gas from the nearest station that measures it (ppb; ppm for CO). */
export interface GasReading {
  name: string;
  provider: string | null;
  monitor: boolean;
  km: number;
  /** End of the newest hour (ms). */
  time: number;
  unit: 'ppb' | 'ppm';
  /** The unit the station itself reports in. */
  reported: string;
  latest: number | null;
  mean8: number | null;
  mean24: number | null;
  /** Last 24 hours, newest first. */
  series: (number | null)[];
}

export interface StationAir {
  fetched: number;
  /** Nearest first. */
  stations: Station[];
  /** Gases (only from a data Worker that reads them; older ones send none). */
  gases: Partial<Record<Gas, GasReading | null>>;
  /** When nothing reports within 25 km: the nearest monitors within 100 km, for reference. */
  regional: Station[];
}

interface Raw {
  fetched: number;
  stations: Omit<Station, 'aqi'>[];
  gases?: Partial<Record<Gas, GasReading | null>>;
  regional?: Omit<Station, 'aqi'>[];
}

const withAqi = (list: Omit<Station, 'aqi'>[] | undefined): Station[] =>
  (list ?? [])
    .map((s) => {
      const a = [aqiPm25(s.pm25), aqiPm10(s.pm10)].filter((v): v is number => v != null);
      return { ...s, aqi: a.length ? Math.max(...a) : null };
    })
    .filter((s) => s.aqi != null);

export function parseStationAir(raw: Raw): StationAir {
  return {
    fetched: raw.fetched,
    stations: withAqi(raw.stations),
    gases: raw.gases ?? {},
    regional: withAqi(raw.regional),
  };
}

/** A reading is current when its newest hour ended within 3 hours of the fetch. */
export const GAS_MAX_AGE_MS = 3 * 3600_000;

export type Pollutant = 'pm25' | 'pm10' | Gas;

/** One pollutant's part of the measured AQI. */
export interface AqiPart {
  key: Pollutant;
  /** Concentration in the EPA table's unit (µg/m³ for PM, ppb for O3/NO2/SO2, ppm for CO). */
  value: number;
  unit: 'µg/m³' | 'ppb' | 'ppm';
  /** Averaging behind the index, e.g. "NowCast", "8-h mean". */
  basis: string;
  aqi: number;
  /** Where it comes from, e.g. "3 stations weighted by distance" or the station name. */
  from: string;
  km: number | null;
  time: number | null;
}

export const POLLUTANT_LABEL: Record<Pollutant, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  o3: 'Ozone (O₃)',
  no2: 'Nitrogen dioxide (NO₂)',
  so2: 'Sulphur dioxide (SO₂)',
  co: 'Carbon monoxide (CO)',
};

/** The EPA sub-index of one measured gas, with the averaging it used, or null. */
export function gasPart(
  gas: Gas,
  g: GasReading | null | undefined,
  fetched: number,
): AqiPart | null {
  if (!g || fetched - g.time > GAS_MAX_AGE_MS) return null;
  const common = { key: gas, unit: g.unit, from: g.name, km: g.km, time: g.time };
  if (gas === 'o3') {
    // ppb → ppm for the table.
    const r = aqiO3(
      g.mean8 != null ? g.mean8 / 1000 : null,
      g.latest != null ? g.latest / 1000 : null,
    );
    if (!r) return null;
    const v = r.basis === '1h' ? g.latest : g.mean8;
    return v == null
      ? null
      : { ...common, value: v, basis: r.basis === '1h' ? '1-h' : '8-h mean', aqi: r.aqi };
  }
  if (gas === 'co') {
    const a = aqiCo(g.mean8);
    return a == null || g.mean8 == null
      ? null
      : { ...common, value: g.mean8, basis: '8-h mean', aqi: a };
  }
  if (gas === 'no2') {
    const a = aqiNo2(g.latest);
    return a == null || g.latest == null
      ? null
      : { ...common, value: g.latest, basis: '1-h', aqi: a };
  }
  const a = aqiSo2(g.latest, g.mean24);
  if (a == null || g.latest == null) return null;
  const by24 = g.mean24 != null && g.mean24 >= 305;
  return {
    ...common,
    value: by24 ? (g.mean24 ?? g.latest) : g.latest,
    basis: by24 ? '24-h mean' : '1-h',
    aqi: a,
  };
}

/** Distance weight for station blending: inverse square, softened over the first 2 km. */
export const stationWeight = (km: number) => 1 / (Math.max(0, km) + 2) ** 2;

/** Distance-weighted mean of one pollutant over the stations that report it, or null. */
function blend(st: Station[], key: 'pm25' | 'pm10'): number | null {
  let sw = 0;
  let sc = 0;
  for (const s of st) {
    const c = s[key];
    if (c == null) continue;
    const w = stationWeight(s.km);
    sw += w;
    sc += w * c;
  }
  return sw > 0 ? sc / sw : null;
}

/** Distance-weighted mean of a station field over the stations that report it, or null. */
function blendField(st: Station[], key: 'pm25Mean24' | 'pm10Mean24'): number | null {
  let sw = 0;
  let sc = 0;
  for (const s of st) {
    const c = s[key];
    if (c == null) continue;
    const w = stationWeight(s.km);
    sw += w;
    sc += w * c;
  }
  return sw > 0 ? sc / sw : null;
}

/** A station is current when its newest hour ended within 3 hours of the fetch. */
export const isCurrent = (s: Station, fetched: number) =>
  s.time != null && fetched - s.time <= GAS_MAX_AGE_MS;

/** Share of the blend each station carries for PM2.5 (0–1), by station index; 0 when too old. */
export function stationShares(st: Station[], fetched = Infinity): number[] {
  const w = st.map((s) =>
    s.pm25 != null && (fetched === Infinity || isCurrent(s, fetched)) ? stationWeight(s.km) : 0,
  );
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (sum > 0 ? x / sum : 0));
}

/**
 * The site's measured AQI. PM2.5 and PM10 are each averaged over the nearby stations that
 * report them, weighted by inverse distance squared (the usual way a point's value is
 * estimated from a monitoring network). One station can be unrepresentative (Bangalore, 20
 * Nov 2026 05:30: Jayanagar alone gave 175 while the city read 112–138 on IQAir and WAQI), so
 * the blend is the headline and the stations are listed. Ozone, NO2, SO2 and CO come from the
 * nearest station within 25 km that measures each, with the EPA's averaging for each gas. The
 * AQI is the highest of all these sub-indices, as the EPA defines it (Technical Assistance
 * Document, May 2026); `dominant` names the pollutant that sets it.
 */
export function siteAqi(sa: StationAir | null): {
  aqi: number;
  /** Nearest station that reports PM2.5 (else the nearest station). */
  station: Station;
  /** AQI of the other stations. */
  others: number[];
  /** Blended concentrations (µg/m³) and how many stations went into the PM2.5 blend. */
  pm25: number | null;
  pm10: number | null;
  used: number;
  /** Blended 24-hour means (µg/m³) and the daily-style AQI from them (PM only), or null. */
  pm25Mean24: number | null;
  pm10Mean24: number | null;
  aqi24: number | null;
  /** Every pollutant's sub-index, highest first. */
  parts: AqiPart[];
  dominant: Pollutant;
} | null {
  // Only stations whose newest hour is current: a station that went quiet hours ago still has
  // a NowCast (it counts back from its own newest hour), but it no longer describes now.
  const fetched = sa?.fetched ?? Date.now();
  const st = (sa?.stations ?? []).filter((s) => isCurrent(s, fetched));
  const pick = st.find((s) => s.pm25 != null) ?? st[0];
  if (!pick) return null;
  const pm25 = blend(st, 'pm25');
  const pm10 = blend(st, 'pm10');
  const used = st.filter((s) => s.pm25 != null).length;
  const usedPm10 = st.filter((s) => s.pm10 != null).length;
  const fromN = (n: number) =>
    n > 1
      ? `${n} stations weighted by distance`
      : (st.find((s) => s.pm25 != null)?.name ?? pick.name);
  const parts: AqiPart[] = [];
  const i25 = aqiPm25(pm25);
  if (i25 != null && pm25 != null)
    parts.push({
      key: 'pm25',
      value: pm25,
      unit: 'µg/m³',
      basis: 'NowCast',
      aqi: i25,
      from: fromN(used),
      km: used > 1 ? null : pick.km,
      time: pick.time,
    });
  const i10 = aqiPm10(pm10);
  if (i10 != null && pm10 != null) {
    const s10 = st.find((s) => s.pm10 != null);
    parts.push({
      key: 'pm10',
      value: pm10,
      unit: 'µg/m³',
      basis: 'NowCast',
      aqi: i10,
      from: usedPm10 > 1 ? `${usedPm10} stations weighted by distance` : (s10?.name ?? pick.name),
      km: usedPm10 > 1 ? null : (s10?.km ?? null),
      time: s10?.time ?? null,
    });
  }
  if (!parts.length) return null;
  for (const g of ['o3', 'no2', 'so2', 'co'] as const) {
    const p = gasPart(g, sa?.gases?.[g], fetched);
    if (p) parts.push(p);
  }
  parts.sort((a, b) => b.aqi - a.aqi);
  const top = parts[0] as AqiPart;
  const pm25Mean24 = blendField(st, 'pm25Mean24');
  const pm10Mean24 = blendField(st, 'pm10Mean24');
  const d24 = [aqiPm25(pm25Mean24), aqiPm10(pm10Mean24)].filter((v): v is number => v != null);
  return {
    aqi: top.aqi,
    station: pick,
    others: st.filter((s) => s !== pick).map((s) => s.aqi ?? 0),
    pm25,
    pm10,
    used,
    pm25Mean24,
    pm10Mean24,
    aqi24: d24.length ? Math.max(...d24) : null,
    parts,
    dominant: top.key,
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
      // aq2: the parsed shape gained gases and regional stations (older entries lack them).
      `aq2:${la},${lo}`,
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
