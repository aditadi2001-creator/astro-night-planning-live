import { describe, expect, it } from 'vitest';
import {
  aqiAdvice,
  aqiCo,
  aqiNo2,
  aqiO3,
  aqiPm10,
  aqiPm25,
  aqiSo2,
  aqiUnitToUgm3,
  eaqiLabel,
} from '../src/lib/air/aqi';
import { parseAir } from '../src/lib/data/openmeteo';
import {
  gasPart,
  parseStationAir,
  siteAqi,
  stationShares,
  stationWeight,
  type GasReading,
} from '../src/lib/data/stationair';
import { buildRow } from '../src/lib/conditions';
import { rateHour } from '../src/lib/ratings';
import { parseHash } from '../src/lib/state/route';
import {
  bboxAround,
  gasToStd,
  hourlySeries,
  roundSeries,
  trailingMean,
} from '../worker/src/routes';

// Worked examples and rules: EPA Technical Assistance Document for the Reporting of Daily Air
// Quality (EPA-403/B-26-003, May 2026), section IV and Table 6.
describe('EPA gas sub-indices (May 2026 document)', () => {
  it('reproduces the worked examples', () => {
    expect(aqiO3(0.07853333, null)).toEqual({ aqi: 126, basis: '8h' });
    // 1-hour 0.162 and 8-hour 0.078: the higher index is reported. The document prints 148
    // (2018 and 2026 editions), but its own Equation 1 gives 49 / 0.039 × 0.037 + 101 = 147.49,
    // which rounds to 147; the equation is the rule, so 147 (DECISIONS.md D73).
    expect(aqiO3(0.078, 0.162)).toEqual({ aqi: 147, basis: '1h' });
    // A 1-hour value below 0.125 ppm is disregarded.
    expect(aqiO3(0.078, 0.104)).toEqual({ aqi: 126, basis: '8h' });
    expect(aqiCo(8.4)).toBe(90);
    expect(aqiPm25(35.9)).toBe(102);
  });

  it('ozone: no 8-hour index above 0.200 ppm, hazardous from the 1-hour value', () => {
    expect(aqiO3(0.21, null)).toBeNull();
    expect(aqiO3(0.21, 0.405)).toEqual({ aqi: 301, basis: '1h' });
    expect(aqiO3(0.054, null)?.aqi).toBe(50);
    expect(aqiO3(0.055, null)?.aqi).toBe(51);
    expect(aqiO3(null, null)).toBeNull();
  });

  it('NO2 and CO band edges, truncated first', () => {
    expect(aqiNo2(53.9)).toBe(50); // truncated to 53
    expect(aqiNo2(54)).toBe(51);
    expect(aqiNo2(100)).toBe(100);
    expect(aqiNo2(2049)).toBe(500);
    expect(aqiCo(4.49)).toBe(50); // 4.4
    expect(aqiCo(4.5)).toBe(51);
    expect(aqiNo2(-1)).toBeNull();
  });

  it('SO2: 1-hour below 305 ppb, 24-hour from 305, else fixed at 200', () => {
    expect(aqiSo2(35, null)).toBe(50);
    expect(aqiSo2(36, null)).toBe(51);
    expect(aqiSo2(304, null)).toBe(200);
    expect(aqiSo2(400, 200)).toBe(200);
    expect(aqiSo2(400, null)).toBe(200);
    expect(aqiSo2(400, 305)).toBe(201);
    expect(aqiSo2(700, 1004)).toBe(500);
  });

  it('µg/m³ ↔ ppb at 25 °C, 1 atm', () => {
    // 1 ppb NO2 = 46.0055 / 24.45 µg/m³
    expect(aqiUnitToUgm3(1, 'no2')).toBeCloseTo(1.8816, 3);
    expect(aqiUnitToUgm3(1, 'co')).toBeCloseTo(1145.6, 0); // 1 ppm CO
    expect(gasToStd(100, 'µg/m³', 'o3')).toBeCloseTo((100 * 24.45) / 48, 6);
    expect(gasToStd(100, 'ug/m3', 'o3')).toBeCloseTo((100 * 24.45) / 48, 6);
    expect(gasToStd(0.043, 'ppm', 'o3')).toBeCloseTo(43, 9);
    expect(gasToStd(1.2, 'mg/m³', 'co')).toBeCloseTo((1.2 * 24.45) / 28.01, 6);
    expect(gasToStd(0.4, 'ppm', 'co')).toBeCloseTo(0.4, 9);
    expect(gasToStd(5, 'furlongs', 'no2')).toBeNull();
    expect(gasToStd(-1, 'ppb', 'no2')).toBeNull();
  });

  it('advice and European labels follow the categories', () => {
    expect(aqiAdvice(30)).toMatch(/satisfactory/);
    expect(aqiAdvice(120)).toMatch(/Sensitive groups/);
    expect(aqiAdvice(450)).toMatch(/Everyone/);
    expect(eaqiLabel(15)).toBe('Good');
    expect(eaqiLabel(41)).toBe('Moderate');
    expect(eaqiLabel(130)).toBe('Extremely poor');
  });
});

describe('Worker averaging helpers', () => {
  it('trailing means need 75 % of the hours', () => {
    const s = [10, 20, 30, 40, 50, 60, null, null, 90];
    expect(trailingMean(s, 8)).toBeCloseTo((10 + 20 + 30 + 40 + 50 + 60) / 6, 9);
    expect(trailingMean([1, null, null, 4, 5, 6, null, 8], 8)).toBeNull(); // 5 of 8
    expect(trailingMean(new Array(24).fill(12), 24)).toBe(12);
  });
  it('series can be 24 hours long', () => {
    const H = 3600_000;
    const t = Date.UTC(2026, 10, 27, 12);
    const rows = Array.from({ length: 30 }, (_, i) => ({ value: i, end: t - i * H }));
    const s = hourlySeries(rows, 24);
    expect(s.series).toHaveLength(24);
    expect(s.series[23]).toBe(23);
    expect(hourlySeries(rows).series).toHaveLength(12);
  });
  it('the regional box reaches 100 km and stays on the globe', () => {
    const [w = 0, s = 0, e = 0, n = 0] = bboxAround(-24.63, -70.4, 100).split(',').map(Number);
    expect(n - s).toBeCloseTo((2 * 100) / 111.2, 3);
    expect(e - w).toBeGreaterThan(n - s); // wider in longitude away from the equator
    const polar = bboxAround(-89.5, 0, 100).split(',').map(Number);
    expect(polar[1]).toBe(-90);
    expect(polar[0]).toBeGreaterThanOrEqual(-180);
    expect(roundSeries([1.234, null], 1)).toEqual([1.2, null]);
  });
});

describe('measured AQI with gases', () => {
  const fetched = Date.UTC(2026, 10, 27, 12);
  const gas = (over: Partial<GasReading>): GasReading => ({
    name: 'ITO',
    provider: 'CPCB',
    monitor: true,
    km: 3.7,
    time: fetched - 1800_000,
    unit: 'ppb',
    reported: 'µg/m³',
    latest: null,
    mean8: null,
    mean24: null,
    series: [],
    ...over,
  });
  const stA = { name: 'A', provider: 'X', monitor: true, km: 2, time: fetched, pm25: 8, pm10: 20 };

  it('the AQI is the highest sub-index and names its pollutant', () => {
    const s = siteAqi(
      parseStationAir({
        fetched,
        stations: [stA],
        gases: { o3: gas({ mean8: 78.5, latest: 90 }), no2: gas({ latest: 40 }) },
      }),
    );
    // PM2.5 8 → 44; O3 8-h 0.078 ppm → 126; NO2 40 ppb → 38; PM10 20 → 19.
    expect(s?.aqi).toBe(126);
    expect(s?.dominant).toBe('o3');
    expect(s?.parts.map((p) => p.key)).toEqual(['o3', 'pm25', 'no2', 'pm10']);
    expect(s?.parts[0]?.basis).toBe('8-h mean');
  });

  it('without gases the figure is unchanged (PM only), and old responses still parse', () => {
    const s = siteAqi(parseStationAir({ fetched, stations: [stA] }));
    expect(s?.aqi).toBe(Math.max(aqiPm25(8) ?? 0, aqiPm10(20) ?? 0));
    expect(s?.dominant).toBe('pm25');
    expect(parseStationAir({ fetched, stations: [stA] }).regional).toEqual([]);
  });

  it('stale or too-short gas records are left out', () => {
    expect(gasPart('no2', gas({ latest: 300, time: fetched - 4 * 3600_000 }), fetched)).toBeNull();
    expect(gasPart('co', gas({ unit: 'ppm', latest: 9, mean8: null }), fetched)).toBeNull();
    expect(gasPart('co', gas({ unit: 'ppm', mean8: 8.4 }), fetched)?.aqi).toBe(90);
  });

  it('24-hour PM means give the daily AQI; shares sum to one', () => {
    const st = parseStationAir({
      fetched,
      stations: [
        { ...stA, pm25Mean24: 40 },
        {
          name: 'B',
          provider: 'X',
          monitor: true,
          km: 6,
          time: fetched,
          pm25: 30,
          pm10: null,
          pm25Mean24: 20,
        },
      ],
    });
    const s = siteAqi(st);
    const wA = stationWeight(2);
    const wB = stationWeight(6);
    expect(s?.pm25Mean24).toBeCloseTo((40 * wA + 20 * wB) / (wA + wB), 9);
    expect(s?.aqi24).toBe(aqiPm25(s?.pm25Mean24 ?? 0));
    const [a = 0, b = 0] = stationShares(st.stations);
    expect(a + b).toBeCloseTo(1, 9);
    expect(a).toBeGreaterThan(b);
  });

  it('a station that stopped reporting hours ago is left out of the blend (London, 27 Nov 2026)', () => {
    // Bexley's newest PM hour was 6 h old but still carried 21 % of the blend.
    const sa = parseStationAir({
      fetched,
      stations: [
        {
          name: 'Tower Hamlets',
          provider: 'LAQN',
          monitor: true,
          km: 5.6,
          time: fetched - 2.75 * 3600_000,
          pm25: 21.5,
          pm10: null,
        },
        {
          name: 'Bexley',
          provider: 'LAQN',
          monitor: true,
          km: 12.9,
          time: fetched - 6 * 3600_000,
          pm25: 26,
          pm10: 32.4,
        },
      ],
    });
    const s = siteAqi(sa);
    expect(s?.used).toBe(1);
    expect(s?.pm25).toBeCloseTo(21.5, 9);
    expect(s?.pm10).toBeNull();
    expect(stationShares(sa.stations, fetched)).toEqual([1, 0]);
    // Every station too old: no measured figure (the site shows the model).
    expect(siteAqi({ ...sa, stations: sa.stations.slice(1) })).toBeNull();
  });

  it('regional stations are parsed apart and never set the site figure', () => {
    const sa = parseStationAir({
      fetched,
      stations: [],
      regional: [
        {
          name: 'Calama',
          provider: 'SINCA',
          monitor: true,
          km: 88,
          time: fetched,
          pm25: 60,
          pm10: null,
        },
      ],
    });
    expect(sa.regional).toHaveLength(1);
    expect(siteAqi(sa)).toBeNull();
  });
});

describe('Open-Meteo air: every field', () => {
  it('parses gases, sub-indices, UV and pollen (null outside Europe)', () => {
    const a = parseAir({
      timezone: 'GMT',
      utc_offset_seconds: 0,
      elevation: 0,
      latitude: 51.5,
      longitude: 0,
      hourly: {
        time: [1795795200],
        pm2_5: [17.2],
        ozone: [29],
        us_aqi: [66],
        us_aqi_pm2_5: [66],
        us_aqi_ozone: [13],
        european_aqi_nitrogen_dioxide: [36],
        uv_index: [0],
        birch_pollen: [null],
      },
    });
    const h = a.hours[0];
    expect(h?.pm25).toBe(17.2);
    expect(h?.o3).toBe(29);
    expect(h?.us?.pm25).toBe(66);
    expect(h?.us?.o3).toBe(13);
    expect(h?.eu?.no2).toBe(36);
    expect(h?.uv).toBe(0);
    expect(h?.pollen?.birch).toBeNull();
    expect(h?.nh3).toBeNull();
    expect(a.lat).toBe(51.5);
  });
});

describe('Ratings use the measured AQI for the present hour', () => {
  const place = { name: 'Test', lat: 28.6, lon: 77.2, elevation: 216 };
  const t = Date.UTC(2026, 10, 20, 18, 30);
  const air = parseAir({
    timezone: 'Asia/Kolkata',
    utc_offset_seconds: 19800,
    elevation: 216,
    hourly: { time: [(t - 1800_000) / 1000], us_aqi: [90], aerosol_optical_depth: [0.4] },
  });
  const row = buildRow(t, place, null, null, air, 18);
  it('measured replaces the model, and says so', () => {
    const base = { row, rain: null, darkSkyMag: 18, siteSqm: 18, elevation: 216 };
    const model = rateHour(base).find((r) => r.id === 'air');
    const meas = rateHour({ ...base, measuredAqi: { aqi: 180, note: '5 nearby stations' } }).find(
      (r) => r.id === 'air',
    );
    expect(model?.value).toBe(70); // 100 × (1 − 90/300)
    expect(meas?.value).toBe(40); // 100 × (1 − 180/300)
    expect(meas?.inputs).toMatch(/measured \(5 nearby stations\); forecast model 90/);
  });
});

describe('Air section route', () => {
  it('opens from #/plan?s=air and the old-style #/aqi link', () => {
    expect(parseHash('#/plan?s=air')?.params.s).toBe('air');
    expect(parseHash('#/aqi')?.params.s).toBe('air');
  });
});
