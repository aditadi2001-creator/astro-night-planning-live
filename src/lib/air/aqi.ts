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
