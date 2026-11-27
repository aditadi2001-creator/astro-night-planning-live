/**
 * The data Worker's /aq route end to end, with OpenAQ answered by a stub in the shapes of the
 * OpenAQ v3 documentation (locations with sensors and units; hourly sensor data with periods).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Loaded by a non-literal path so the app's type check (DOM types) does not pull in the Worker,
// which is type-checked on its own with the Cloudflare types (npm run worker:check).
const WORKER_PATH = '../worker/src/index';
let worker: { fetch: (req: Request, env: unknown) => Promise<Response> };
beforeAll(async () => {
  worker = ((await import(/* @vite-ignore */ WORKER_PATH)) as { default: typeof worker }).default;
});

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 27, 12, 20);
const HOUR_END = Date.UTC(2026, 10, 27, 12); // newest complete hour

type Sensor = { id: number; parameter: { name: string; units: string } };
const loc = (
  id: number,
  name: string,
  lat: number,
  lon: number,
  sensors: Sensor[],
  last = HOUR_END,
  isMonitor = true,
) => ({
  id,
  name,
  isMonitor,
  provider: { name: 'CPCB' },
  coordinates: { latitude: lat, longitude: lon },
  sensors,
  datetimeLast: { utc: new Date(last).toISOString() },
});
const s = (id: number, name: string, units: string): Sensor => ({
  id,
  parameter: { name, units },
});

/** 26 hourly values, oldest first, all equal to `v` (or v(i) by hours ago). */
function hours(v: number | ((ago: number) => number)) {
  return {
    results: Array.from({ length: 26 }, (_, k) => {
      const ago = 25 - k;
      const end = HOUR_END - ago * H;
      return {
        value: typeof v === 'number' ? v : v(ago),
        period: {
          datetimeFrom: { utc: new Date(end - H).toISOString() },
          datetimeTo: { utc: new Date(end).toISOString() },
        },
      };
    }),
  };
}

function stub(routes: (url: URL) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      calls.push(url.pathname + url.search);
      const body = routes(url);
      return body == null
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

const env = { OPENAQ_KEY: 'test-key', DATA: {} };
const get = (path: string) => worker.fetch(new Request(`https://w.example${path}`), env);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/aq end to end (stubbed OpenAQ)', () => {
  it('reads PM, converts every gas to the EPA units and stays within the request budget', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const calls = stub((url) => {
      if (url.pathname === '/v3/locations')
        return {
          results: [
            loc(1, 'ITO', 28.6286, 77.241, [
              s(11, 'pm25', 'µg/m³'),
              s(12, 'pm10', 'µg/m³'),
              s(13, 'no2', 'µg/m³'),
              s(14, 'o3', 'µg/m³'),
            ]),
            loc(2, 'Lodhi Road', 28.5918, 77.2273, [
              s(21, 'pm25', 'µg/m³'),
              s(23, 'so2', 'ppm'),
              s(24, 'co', 'mg/m³'),
            ]),
            // Stopped reporting a day ago: never read.
            loc(3, 'Old', 28.6, 77.2, [s(31, 'pm25', 'µg/m³')], HOUR_END - 24 * H),
          ],
        };
      const m = /^\/v3\/sensors\/(\d+)\/hours$/.exec(url.pathname);
      const id = Number(m?.[1]);
      if (id === 11) return hours(120);
      if (id === 12) return hours(240);
      if (id === 13) return hours(94.1); // ≈ 50 ppb
      if (id === 14) return hours((ago) => (ago < 8 ? 157 : 40)); // ≈ 80 ppb for 8 h
      if (id === 21) return hours(80);
      if (id === 23) return hours(0.01); // 10 ppb
      if (id === 24) return hours(1.2); // ≈ 1.05 ppm
      return null;
    });
    const r = await get('/aq/28.61/77.21');
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=1200');
    const j = (await r.json()) as {
      v: number;
      stations: { name: string; pm25: number; pm25Mean24: number; pm25Series: number[] }[];
      gases: Record<string, { unit: string; latest: number; mean8: number; reported: string }>;
      regional: unknown[];
    };
    expect(j.v).toBe(2);
    expect(j.stations.map((x) => x.name)).toEqual(['Lodhi Road', 'ITO']);
    expect(j.stations[1]?.pm25).toBeCloseTo(120, 6);
    expect(j.stations[1]?.pm25Mean24).toBeCloseTo(120, 6);
    expect(j.stations[1]?.pm25Series).toHaveLength(24);
    expect(j.gases.no2?.unit).toBe('ppb');
    expect(j.gases.no2?.latest).toBeCloseTo((94.1 * 24.45) / 46.0055, 0);
    expect(j.gases.o3?.mean8).toBeCloseTo((157 * 24.45) / 48, 0);
    expect(j.gases.so2?.latest).toBeCloseTo(10, 6);
    expect(j.gases.co?.unit).toBe('ppm');
    expect(j.gases.co?.mean8).toBeCloseTo((1.2 * 24.45) / 28.01, 2);
    expect(j.gases.co?.reported).toBe('mg/m³');
    expect(j.regional).toEqual([]);
    // 1 location search + 3 PM sensors + 4 gases; the stale station is never read.
    expect(calls).toHaveLength(8);
    expect(calls.some((c) => c.includes('/sensors/31/'))).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(25);
  });

  it('tries a second station when the nearest has no current gas, and skips impossible CO', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const calls = stub((url) => {
      if (url.pathname === '/v3/locations')
        return {
          results: [
            loc(1, 'Stadium', 28.611, 77.238, [
              s(11, 'pm25', 'µg/m³'),
              s(13, 'o3', 'µg/m³'),
              s(14, 'co', 'ppb'),
            ]),
            loc(2, 'ITO', 28.6286, 77.241, [
              s(21, 'pm25', 'µg/m³'),
              s(23, 'o3', 'µg/m³'),
              s(24, 'co', 'mg/m³'),
            ]),
          ],
        };
      const id = Number(/^\/v3\/sensors\/(\d+)\/hours$/.exec(url.pathname)?.[1]);
      if (id === 11 || id === 21) return hours(100);
      if (id === 13) return { results: [] }; // o3 sensor with no recent hours
      if (id === 14) return hours(6); // "6 ppb" of CO: impossible in surface air
      if (id === 23) return hours(40);
      if (id === 24) return hours(1.5);
      return null;
    });
    const r = await get('/aq/28.62/77.22');
    const j = (await r.json()) as { gases: Record<string, { name: string; latest: number }> };
    expect(j.gases.o3?.name).toBe('ITO');
    expect(j.gases.co?.name).toBe('ITO');
    expect(j.gases.co?.latest).toBeCloseTo((1.5 * 24.45) / 28.01, 3);
    // 1 search + 2 PM + 2 tries for o3 + 2 tries for co.
    expect(calls).toHaveLength(7);
    expect(calls.length).toBeLessThanOrEqual(25);
  });

  it('a remote site gets the nearest monitors within 100 km, kept apart', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const calls = stub((url) => {
      if (url.pathname === '/v3/locations' && url.searchParams.has('coordinates'))
        return { results: [] };
      if (url.pathname === '/v3/locations' && url.searchParams.has('bbox'))
        return {
          results: [
            loc(5, 'Calama', -22.46, -68.93, [s(51, 'pm25', 'µg/m³')]),
            loc(6, 'Far away', -20.0, -68.0, [s(61, 'pm25', 'µg/m³')]), // > 100 km
          ],
        };
      if (url.pathname === '/v3/sensors/51/hours') return hours(30);
      return null;
    });
    // About 92 km from Calama (and 330 km from the other one).
    const r = await get('/aq/-22.95/-68.20');
    const j = (await r.json()) as {
      stations: unknown[];
      regional: { name: string; km: number; pm25: number }[];
    };
    expect(j.stations).toEqual([]);
    expect(j.regional.map((x) => x.name)).toEqual(['Calama']);
    expect(j.regional[0]?.km).toBeLessThan(100);
    expect(calls.find((c) => c.includes('bbox='))).toMatch(/bbox=-?\d+\.\d{4},/);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('a rate-limited answer is never cached as if complete', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const limited = () => new Response('Too many requests', { status: 429 });
    const okLoc = {
      results: [
        loc(1, 'A', 28.61, 77.21, [s(11, 'pm25', 'µg/m³')]),
        loc(2, 'B', 28.62, 77.22, [s(21, 'pm25', 'µg/m³')]),
      ],
    };
    const run = (sensorOk: (id: number) => boolean) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (url.pathname === '/v3/locations') return new Response(JSON.stringify(okLoc));
          const id = Number(/^\/v3\/sensors\/(\d+)\/hours$/.exec(url.pathname)?.[1]);
          return sensorOk(id) ? new Response(JSON.stringify(hours(50))) : limited();
        }),
      );
      return get('/aq/28.61/77.21');
    };
    // Every sensor read refused: 503, not stored.
    const none = await run(() => false);
    expect(none.status).toBe(503);
    expect(none.headers.get('Cache-Control')).toBe('no-store');
    // One read refused: the data that came back, kept 2 minutes only.
    const part = await run((id) => id === 11);
    expect(part.status).toBe(200);
    expect(part.headers.get('Cache-Control')).toBe('public, max-age=120');
  });

  it('without a key it answers 503, so the site keeps the model', async () => {
    const r = await worker.fetch(new Request('https://w.example/aq/1.00/2.00'), {
      DATA: {},
    });
    expect(r.status).toBe(503);
  });
});
