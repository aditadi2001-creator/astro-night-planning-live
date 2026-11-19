#!/usr/bin/env node
/**
 * Dev-time only: download reference values from NASA/JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api)
 * for the accuracy tests (tests/accuracy.test.ts). Nothing from this script ships in the app.
 *
 *   node scripts/accuracy/fetch-horizons.mjs
 *
 * Site: the Bangalore preset (public city-centre coordinates, rounded to 0.01°).
 * Quantities: apparent topocentric RA/Dec of date and airless azimuth/elevation (QUANTITIES 2,4),
 * and 1-minute airless elevation + angular diameter series of the Sun and Moon for rise, set,
 * transit and twilight crossings (interpolated in the tests).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = { lon: 77.59, lat: 12.97, km: 0.92 };
const BODIES = {
  Sun: '10',
  Moon: '301',
  Mercury: '199',
  Venus: '299',
  Mars: '499',
  Jupiter: '599',
  Saturn: '699',
  Uranus: '799',
  Neptune: '899',
};
const EPOCHS = ['2026-11-19 16:00', '2026-11-20 00:00', '2026-12-01 18:00'];
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

function url(params) {
  const q = new URLSearchParams({
    format: 'text',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: "'coord@399'",
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `'${SITE.lon},${SITE.lat},${SITE.km}'`,
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    EXTRA_PREC: 'YES',
    TIME_DIGITS: 'SECONDS',
    ...params,
  });
  return `${API}?${q}`;
}

async function rows(params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url(params));
    const text = await r.text();
    const m = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(text);
    if (m)
      return m[1]
        .trim()
        .split('\n')
        .map((l) => l.split(',').map((x) => x.trim()));
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  throw new Error(`Horizons gave no data for ${JSON.stringify(params)}`);
}

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
function toIso(s) {
  const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(s);
  if (!m) throw new Error(`time ${s}`);
  const ms =
    Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5], 0) + Math.round(Number(m[6] ?? 0) * 1000);
  return new Date(ms).toISOString();
}

const out = {
  source: 'NASA/JPL Horizons API, fetched by scripts/accuracy/fetch-horizons.mjs',
  fetched: new Date().toISOString(),
  site: SITE,
  positions: [],
  series: {},
};

for (const [name, id] of Object.entries(BODIES)) {
  for (const t of EPOCHS) {
    const [r] = await rows({
      COMMAND: `'${id}'`,
      START_TIME: `'${t}'`,
      STOP_TIME: `'${t}:30'`,
      STEP_SIZE: "'1m'",
      QUANTITIES: "'2,4'",
    });
    // Date, solar flag, lunar flag, RA, Dec, Az, El
    out.positions.push({
      body: name,
      time: toIso(r[0]),
      ra: Number(r[3]),
      dec: Number(r[4]),
      az: Number(r[5]),
      alt: Number(r[6]),
    });
  }
  console.log(`positions ${name}`);
}

// Airless apparent elevation + angular diameter every minute for two days (Sun, Moon).
// Rise/set/twilight crossings are interpolated from these in the tests, with the same
// convention as the app (upper limb on the refracted horizon: centre at −(34′ + radius)).
for (const name of ['Sun', 'Moon']) {
  const rs = await rows({
    COMMAND: `'${BODIES[name]}'`,
    START_TIME: "'2026-11-19 00:00'",
    STOP_TIME: "'2026-11-21 00:00'",
    STEP_SIZE: "'1m'",
    QUANTITIES: "'4,13'",
  });
  // Date, flag, flag, Az, El, ang-diam (arcsec)
  out.series[name] = rs.map((r) => [toIso(r[0]), Number(r[4]), Number(r[5])]);
  console.log(`series ${name}: ${rs.length} rows`);
}

const dir = fileURLToPath(new URL('../../tests/fixtures/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}horizons-bangalore-2026-11.json`, JSON.stringify(out, null, 1) + '\n');
console.log('wrote tests/fixtures/horizons-bangalore-2026-11.json');
