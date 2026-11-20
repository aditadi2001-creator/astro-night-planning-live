import { describe, expect, it } from 'vitest';
import { aqiCategory, aqiPm10, aqiPm25 } from '../src/lib/air/aqi';
import { parseStationAir, siteAqi, stationWeight } from '../src/lib/data/stationair';
import { haversineKm, hourlySeries, nowCast, parseAq } from '../worker/src/routes';

describe('US EPA AQI (2024 breakpoints)', () => {
  it('hits the band edges for PM2.5', () => {
    expect(aqiPm25(0)).toBe(0);
    expect(aqiPm25(9.0)).toBe(50);
    expect(aqiPm25(9.1)).toBe(51);
    expect(aqiPm25(35.4)).toBe(100);
    expect(aqiPm25(55.5)).toBe(151);
    expect(aqiPm25(125.4)).toBe(200);
    expect(aqiPm25(225.4)).toBe(300);
    expect(aqiPm25(325.4)).toBe(500);
  });

  it('truncates before indexing, as the EPA does', () => {
    expect(aqiPm25(35.49)).toBe(100); // 35.4, not 35.5
    expect(aqiPm10(154.9)).toBe(100); // 154
  });

  it('extends past 500 for extreme pollution instead of clipping', () => {
    expect(aqiPm25(400)).toBeGreaterThan(500);
  });

  it('PM10 bands and categories', () => {
    expect(aqiPm10(54)).toBe(50);
    expect(aqiPm10(255)).toBe(151);
    expect(aqiCategory(128)?.label).toBe('Unhealthy for sensitive groups');
    expect(aqiCategory(430)?.label).toBe('Hazardous');
    expect(aqiPm25(null)).toBeNull();
    expect(aqiPm25(-1)).toBeNull();
  });
});

describe('EPA NowCast', () => {
  it('equals the concentration when it is steady', () => {
    expect(nowCast(new Array(12).fill(80))).toBeCloseTo(80, 9);
  });

  it('follows a sudden rise quickly (weight floored at 0.5)', () => {
    // Newest first: jumped from 20 to 200 in the last hour.
    const c = [200, ...new Array(11).fill(20)];
    const w = 0.5; // min/max = 0.1 → floored
    let num = 0;
    let den = 0;
    c.forEach((v, i) => {
      num += w ** i * v;
      den += w ** i;
    });
    expect(nowCast(c)).toBeCloseTo(num / den, 9);
    expect(nowCast(c)).toBeGreaterThan(100);
  });

  it('needs two of the three most recent hours', () => {
    expect(nowCast([50, null, null, 40, 40])).toBeNull();
    expect(nowCast([50, null, 45, 40])).not.toBeNull();
  });

  it('builds the newest-first hourly series from the newest reported hour', () => {
    const H = 3600_000;
    const t = Date.UTC(2026, 10, 15, 6);
    const s = hourlySeries([
      { value: 30, end: t - 2 * H },
      { value: 50, end: t },
      { value: null, end: t - H },
      { value: 40, end: t - 3 * H },
    ]);
    expect(s.newest).toBe(t);
    expect(s.series.slice(0, 4)).toEqual([50, null, 30, 40]);
  });
});

describe('station AQI at the site', () => {
  const raw = {
    fetched: 0,
    stations: [
      { name: 'A', provider: 'CPCB', monitor: true, km: 2.1, time: 1, pm25: 60, pm10: 120 },
      { name: 'B', provider: 'CPCB', monitor: true, km: 5, time: 1, pm25: 250, pm10: null },
      { name: 'C', provider: 'CPCB', monitor: true, km: 7, time: 1, pm25: null, pm10: null },
    ],
  };

  it('takes the larger of the PM2.5 and PM10 indices and drops empty stations', () => {
    const sa = parseStationAir(raw);
    expect(sa.stations).toHaveLength(2);
    expect(sa.stations[0]?.aqi).toBe(Math.max(aqiPm25(60) ?? 0, aqiPm10(120) ?? 0));
  });

  it('blends stations by inverse distance squared and lists the others', () => {
    const s = siteAqi(parseStationAir(raw));
    expect(s?.station.name).toBe('A');
    expect(s?.others).toEqual([aqiPm25(250)]);
    const wA = stationWeight(2.1);
    const wB = stationWeight(5);
    expect(s?.pm25).toBeCloseTo((60 * wA + 250 * wB) / (wA + wB), 9);
    expect(s?.used).toBe(2);
    expect(s?.aqi).toBe(Math.max(aqiPm25(s?.pm25 ?? 0) ?? 0, aqiPm10(120) ?? 0));
    expect(siteAqi(null)).toBeNull();
  });

  it('one high station no longer sets the headline (Bangalore, 20 Nov 2026 05:30)', () => {
    // OpenAQ gave Jayanagar 89.6 µg/m³ (AQI 175); other monitors were far lower
    // (IQAir city 112, WAQI BTM 138 / Peenya 121 at 04:00).
    const s = siteAqi(
      parseStationAir({
        fetched: 0,
        stations: [
          {
            name: 'Jayanagar',
            provider: 'CPCB',
            monitor: true,
            km: 5.5,
            time: 1,
            pm25: 89.6,
            pm10: null,
          },
          {
            name: 'BTM Layout',
            provider: 'CPCB',
            monitor: true,
            km: 6.3,
            time: 1,
            pm25: 50.1,
            pm10: null,
          },
          {
            name: 'Peenya',
            provider: 'CPCB',
            monitor: true,
            km: 9.8,
            time: 1,
            pm25: 43.5,
            pm10: null,
          },
        ],
      }),
    );
    expect(s?.used).toBe(3);
    expect(s?.aqi).toBeLessThan(aqiPm25(89.6) ?? 0);
    expect(s?.aqi).toBeGreaterThan(aqiPm25(43.5) ?? 0);
  });

  it('prefers the nearest station with PM2.5 over a closer PM10-only one (Bangalore, 19 Nov)', () => {
    const s = siteAqi(
      parseStationAir({
        fetched: 0,
        stations: [
          {
            name: 'Hombegowda Nagar',
            provider: 'CPCB',
            monitor: true,
            km: 3.5,
            time: 1,
            pm25: null,
            pm10: 138.5,
          },
          {
            name: 'Jayanagar',
            provider: 'CPCB',
            monitor: true,
            km: 5.5,
            time: 1,
            pm25: 81.0,
            pm10: 138.9,
          },
        ],
      }),
    );
    expect(s?.station.name).toBe('Jayanagar');
    // PM2.5 from Jayanagar alone (the only one with it); PM10 from both, by distance.
    expect(s?.pm25).toBeCloseTo(81.0, 9);
    expect(s?.aqi).toBe(169);
    expect(s?.others).toEqual([aqiPm10(138.5)]);
  });
});

describe('Worker /aq route helpers', () => {
  it('parses and rounds coordinates, rejecting junk', () => {
    expect(parseAq('/aq/12.97/77.59')).toEqual({ lat: 12.97, lon: 77.59 });
    expect(parseAq('/aq/-33.9/151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(parseAq('/aq/95/0')).toBeNull();
    expect(parseAq('/aq/1/2?x=evil')).toBeNull();
    expect(parseAq('/aq/12.9716/77.5946')).toBeNull(); // the site always rounds first
  });

  it('measures distances on the sphere', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.2, 0);
    expect(haversineKm(28.61, 77.21, 12.97, 77.59)).toBeCloseTo(1739, -1);
  });
});
