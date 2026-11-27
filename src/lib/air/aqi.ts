/**
 * US EPA Air Quality Index from particle concentrations.
 *
 * Breakpoints: 40 CFR Part 58 Appendix G as revised in February 2024 (PM2.5
 * "Good" now ends at 9.0 µg/m³). The index is piecewise linear inside each
 * band, truncated to one decimal (PM2.5) or an integer (PM10) first, as the
 * EPA specifies. "Current" AQI uses the NowCast concentration (computed by the
 * data Worker from the last 12 hourly readings), which is what AirNow and most
 * AQI sites show for the present hour.
 */

type Band = [cLo: number, cHi: number, iLo: number, iHi: number];

const PM25: Band[] = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

const PM10: Band[] = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
];

function index(c: number, bands: Band[]): number {
  for (const [cLo, cHi, iLo, iHi] of bands) {
    if (c <= cHi) return Math.round(((iHi - iLo) / (cHi - cLo)) * (Math.max(c, cLo) - cLo) + iLo);
  }
  // Beyond the table: the EPA extends the top band linearly ("beyond the AQI").
  const [cLo, cHi, iLo, iHi] = bands[bands.length - 1] ?? [0, 1, 0, 1];
  return Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo);
}

/** US AQI for a PM2.5 concentration (µg/m³), or null. */
export function aqiPm25(c: number | null): number | null {
  if (c == null || !Number.isFinite(c) || c < 0) return null;
  return index(Math.floor(c * 10) / 10, PM25);
}

/** US AQI for a PM10 concentration (µg/m³), or null. */
export function aqiPm10(c: number | null): number | null {
  if (c == null || !Number.isFinite(c) || c < 0) return null;
  return index(Math.floor(c), PM10);
}

/*
 * Gases, from Table 6 of the EPA Technical Assistance Document (EPA-403/B-26-003, May 2026).
 * Truncation before indexing: O3 to 3 decimals (ppm), CO to 1 decimal (ppm), SO2 and NO2 to an
 * integer (ppb). Blank cells of the table are not indexed (see the functions below).
 */
const O3_8H: Band[] = [
  [0, 0.054, 0, 50],
  [0.055, 0.07, 51, 100],
  [0.071, 0.085, 101, 150],
  [0.086, 0.105, 151, 200],
  [0.106, 0.2, 201, 300],
];
const O3_1H: Band[] = [
  [0.125, 0.164, 101, 150],
  [0.165, 0.204, 151, 200],
  [0.205, 0.404, 201, 300],
  [0.405, 0.604, 301, 500],
];
const CO_8H: Band[] = [
  [0, 4.4, 0, 50],
  [4.5, 9.4, 51, 100],
  [9.5, 12.4, 101, 150],
  [12.5, 15.4, 151, 200],
  [15.5, 30.4, 201, 300],
  [30.5, 50.4, 301, 500],
];
const SO2_1H: Band[] = [
  [0, 35, 0, 50],
  [36, 75, 51, 100],
  [76, 185, 101, 150],
  [186, 304, 151, 200],
];
const SO2_24H: Band[] = [
  [305, 604, 201, 300],
  [605, 1004, 301, 500],
];
const NO2_1H: Band[] = [
  [0, 53, 0, 50],
  [54, 100, 51, 100],
  [101, 360, 101, 150],
  [361, 649, 151, 200],
  [650, 1249, 201, 300],
  [1250, 2049, 301, 500],
];

const ok = (c: number | null | undefined): c is number => c != null && Number.isFinite(c) && c >= 0;
/** Truncate (not round) to `d` decimals, as the EPA specifies; the epsilon absorbs float noise. */
const trunc = (c: number, d: number) => Math.floor(c * 10 ** d + 1e-9) / 10 ** d;

/**
 * US AQI for ozone (ppm): the 8-hour mean is the basis; the 1-hour value counts only from
 * 0.125 ppm (the table has no lower 1-hour bands) and the larger index is reported. 8-hour
 * values above 0.200 ppm define no index (the hazardous range comes from the 1-hour value).
 */
export function aqiO3(
  mean8hPpm: number | null | undefined,
  hour1Ppm: number | null | undefined,
): { aqi: number; basis: '8h' | '1h' } | null {
  const c8 = ok(mean8hPpm) ? trunc(mean8hPpm, 3) : null;
  const c1 = ok(hour1Ppm) ? trunc(hour1Ppm, 3) : null;
  const i8 = c8 != null && c8 <= 0.2 ? index(c8, O3_8H) : null;
  const i1 = c1 != null && c1 >= 0.125 ? index(c1, O3_1H) : null;
  if (i8 == null && i1 == null) return null;
  return (i1 ?? -1) > (i8 ?? -1) ? { aqi: i1 ?? 0, basis: '1h' } : { aqi: i8 ?? 0, basis: '8h' };
}

/** US AQI for carbon monoxide from its 8-hour mean (ppm), or null. */
export function aqiCo(mean8hPpm: number | null | undefined): number | null {
  return ok(mean8hPpm) ? index(trunc(mean8hPpm, 1), CO_8H) : null;
}

/** US AQI for nitrogen dioxide from a 1-hour value (ppb), or null. */
export function aqiNo2(hour1Ppb: number | null | undefined): number | null {
  return ok(hour1Ppb) ? index(trunc(hour1Ppb, 0), NO2_1H) : null;
}

/**
 * US AQI for sulphur dioxide: 1-hour values (ppb) below 305 use the 1-hour bands; from 305 ppb
 * the 24-hour mean is used when it is 305 or more, otherwise the index is fixed at 200, exactly
 * as the EPA document prescribes.
 */
export function aqiSo2(
  hour1Ppb: number | null | undefined,
  mean24hPpb: number | null | undefined,
): number | null {
  const c24 = ok(mean24hPpb) ? trunc(mean24hPpb, 0) : null;
  if (c24 != null && c24 >= 305) return index(c24, SO2_24H);
  if (!ok(hour1Ppb)) return null;
  const c1 = trunc(hour1Ppb, 0);
  return c1 < 305 ? index(c1, SO2_1H) : 200;
}

/** Molar masses (g/mol) for µg/m³ ↔ ppb at the EPA reference state (25 °C, 1 atm). */
export const MOLAR_MASS = { o3: 48.0, no2: 46.0055, so2: 64.066, co: 28.01 } as const;
export type Gas = keyof typeof MOLAR_MASS;
/** Molar volume of an ideal gas at 25 °C and 1 atm (L/mol). */
const MOLAR_VOLUME = 24.45;

/**
 * ppb (O3, NO2, SO2) or ppm (CO), as the data Worker sends measured gases, → µg/m³, so the
 * monitors can be compared with the model (which reports every gas in µg/m³).
 */
export function aqiUnitToUgm3(value: number, gas: Gas): number {
  const ppb = gas === 'co' ? value * 1000 : value;
  return (ppb * MOLAR_MASS[gas]) / MOLAR_VOLUME;
}

export const AQI_CATEGORIES: readonly { max: number; label: string; color: string }[] = [
  { max: 50, label: 'Good', color: '#00e400' },
  { max: 100, label: 'Moderate', color: '#ffff00' },
  { max: 150, label: 'Unhealthy for sensitive groups', color: '#ff7e00' },
  { max: 200, label: 'Unhealthy', color: '#ff0000' },
  { max: 300, label: 'Very unhealthy', color: '#8f3f97' },
  { max: Infinity, label: 'Hazardous', color: '#7e0023' },
];

export const aqiCategory = (aqi: number) =>
  AQI_CATEGORIES.find((c) => aqi <= c.max) ?? AQI_CATEGORIES[AQI_CATEGORIES.length - 1];

/**
 * What to do at each category, shortened from the EPA's cautionary statements (Table 5 of the
 * same document; particle pollution column, which is what usually sets the AQI).
 */
export const AQI_ADVICE: readonly string[] = [
  'Air quality is satisfactory: a good night to be out.',
  'Unusually sensitive people should keep exertion shorter and lighter.',
  'Sensitive groups (heart or lung disease, older adults, children): make outdoor activity shorter and lighter, take more breaks.',
  'Sensitive groups should consider moving activities inside; everyone else keep outdoor activity shorter and lighter.',
  'Sensitive groups should avoid all physical activity outdoors; everyone else limit outdoor activity.',
  'Everyone should avoid physical activity outdoors; sensitive groups stay indoors.',
];
export const aqiAdvice = (aqi: number) =>
  AQI_ADVICE[
    Math.max(
      0,
      AQI_CATEGORIES.findIndex((c) => aqi <= c.max),
    )
  ] ?? '';

/** European AQI (Open-Meteo's 0–100+ index, EEA bands revised 2024): category name. */
export const EAQI_LEVELS = [
  [20, 'Good'],
  [40, 'Fair'],
  [60, 'Moderate'],
  [80, 'Poor'],
  [100, 'Very poor'],
  [Infinity, 'Extremely poor'],
] as const;
export const eaqiLabel = (v: number) => EAQI_LEVELS.find(([max]) => v <= max)?.[1] ?? '';
