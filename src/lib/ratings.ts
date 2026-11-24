/**
 * Every condition rated 0–100 (100 = ideal for imaging), with the rule and the worked
 * numbers, for the Ratings and Rain sections. Pure functions: nothing is fetched here.
 *
 * Five ratings are the factors of the existing hourly imaging score (physics/score.ts) and
 * are computed with the same functions, so they always agree with it. The others (rain,
 * wind, dew, sky darkness, air quality, forecast confidence) are new planning guides; they
 * are shown next to the score but do not change it.
 */
import type { HourRow } from './conditions';
import type { RainHour } from './data/rain';
import { zenithExtinction } from './physics/extinction';
import { magToNl, moonSkyBrightness } from './physics/moonlight';
import { cloudFactor, darknessFactor, transparencyFactor } from './physics/score';
import { seeingFactor } from './physics/seeing';
import { NATURAL_SKY_MAG } from './physics/skybrightness';

export type RatingId =
  | 'clouds'
  | 'transparency'
  | 'moon'
  | 'darkness'
  | 'seeing'
  | 'rain'
  | 'wind'
  | 'dew'
  | 'skydark'
  | 'air'
  | 'confidence';

export interface Rating {
  id: RatingId;
  label: string;
  /** 0–100, or null when the data is missing. */
  value: number | null;
  /** What went in, in words. */
  inputs: string;
  /** This hour's numbers put through the rule. */
  math: string;
  /** Part of the hourly imaging score (multiplied in). */
  inScore: boolean;
}

/** The rule behind each rating, in words (the same for every hour). */
export const RULES: Record<RatingId, { label: string; rule: string; formula: string }> = {
  clouds: {
    label: 'Clouds',
    rule: 'The share of starlight that gets through the clouds. Each layer blocks the part of the sky it covers. High cloud is mostly thin cirrus, so it counts 60 %. The layers overlap at random.',
    formula: '100 × (1 − low)(1 − mid)(1 − 0.6 × high)',
  },
  transparency: {
    label: 'Transparency',
    rule: 'Light lost to air, haze and dust (extinction k), compared with a very clean site (k₀ = 0.15 mag) for a target at airmass 1.5, about 42° high.',
    formula: '100 × 10^(−0.4 × (k − 0.15) × 1.5), at most 100',
  },
  moon: {
    label: 'Moonlight',
    rule: 'Moonlight added to the dark sky for a typical target 45° high and 90° from the Moon (Krisciunas & Schaefer 1991). Faint signal is lost in the extra sky noise, so the rating is the square root of the dark share.',
    formula: '100 × √(dark sky / (dark sky + moonlight))',
  },
  darkness: {
    label: 'Darkness (twilight)',
    rule: 'Twilight brightens the sky. 0 while the Sun is higher than 12° below the horizon, 100 once it is 18° below (astronomical night), a straight line between.',
    formula: '100 × (−12° − Sun altitude) / 6°, between 0 and 100',
  },
  seeing: {
    label: 'Seeing',
    rule: 'Steadiness of the air (our own estimate from the forecast winds). Star images are the seeing combined with about 1.5″ from optics and guiding; signal-to-noise falls as the star image grows. 100 at 0.8″ seeing.',
    formula: '100 × √(0.8² + 1.5²) / √(seeing² + 1.5²), at most 100',
  },
  rain: {
    label: 'Rain',
    rule: 'The chance the hour stays dry, reduced by how much rain the forecast expects: 1 mm or more in the hour counts as fully wet.',
    formula: '100 × (1 − chance of rain) × (1 − rain mm, capped at 1)',
  },
  wind: {
    label: 'Wind',
    rule: 'Gusts shake the telescope. 100 with gusts up to 10 km/h, 0 at 50 km/h or more, a straight line between. Uses the steady wind when gusts are not given.',
    formula: '100 × (50 − gusts km/h) / 40, between 0 and 100',
  },
  dew: {
    label: 'Dew',
    rule: 'How far the optics stay above the dew point. On clear, calm nights the optics cool about 3 °C below the air, less with wind or cloud (physics/dew.ts). 100 with a margin of 3 °C or more, 0 when the optics reach the dew point.',
    formula: '100 × margin °C / 3, between 0 and 100',
  },
  skydark: {
    label: 'Sky darkness (light pollution)',
    rule: 'The moonless sky brightness at the site (SQM, mag/arcsec²). 100 for a pristine 22.0, 0 for a city sky of 17.0, a straight line between.',
    formula: '100 × (SQM − 17) / 5, between 0 and 100',
  },
  air: {
    label: 'Air quality',
    rule: 'US AQI from the air-quality forecast (health, and smoke or dust in the sky). 100 at AQI 0, 0 at AQI 300 or more ("hazardous").',
    formula: '100 × (1 − AQI / 300), between 0 and 100',
  },
  confidence: {
    label: 'Forecast confidence',
    rule: 'How much the weather models agree on the cloud cover: the gap between the clearest and the cloudiest model.',
    formula: '100 − (highest − lowest model cloud %)',
  },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (f: number) => Math.round(100 * f);
const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);
const n0 = (x: number) => Math.round(x).toString();
const minus = (s: string) => s.replace('-', '−');
/** "57" when nothing was clipped, "−493 → 0" when the 0–100 limits applied. */
const ends = (raw: number, final: number) =>
  Math.round(raw) === final ? `${final}` : `${minus(n0(raw))} → ${final}`;

/** Station pressure for the hour, or the barometric standard for the site's elevation. */
export const sitePressure = (row: HourRow, elevation: number) =>
  row.weather?.pressure ?? 1013.25 * Math.exp(-elevation / 8434);
/** The extinction the imaging score used (typical AOD 0.1 without air-quality data). */
export const extinctionK = (row: HourRow, elevation: number) =>
  row.extinction?.total ?? zenithExtinction(sitePressure(row, elevation), 0.1).total;

export function rainFactor(mm: number | null, prob: number | null): number | null {
  if (mm == null && prob == null) return null;
  const p = prob != null ? prob / 100 : (mm ?? 0) >= 0.1 ? 1 : 0;
  return clamp01((1 - clamp01(p)) * (1 - Math.min(1, Math.max(0, mm ?? 0))));
}
export const windFactor = (kmh: number) => clamp01((50 - kmh) / 40);
export const dewFactor = (marginC: number) => clamp01(marginC / 3);
export const skyDarkFactor = (sqm: number) => clamp01((sqm - 17) / 5);
export const airFactor = (aqi: number) => clamp01(1 - aqi / 300);

export interface RateInput {
  row: HourRow;
  rain: RainHour | null;
  /** Moonless sky brightness at the site for this hour, mag/arcsec². */
  darkSkyMag: number | null;
  /** The site's moonless sky (SQM) from the light-pollution map or the user's reading, or null. */
  siteSqm: number | null;
  /** Site elevation, m (for the fallback pressure). */
  elevation: number;
}

/** All ratings for one hour. */
export function rateHour({ row, rain, darkSkyMag, siteSqm, elevation }: RateInput): Rating[] {
  const w = row.weather;
  const out: Rating[] = [];
  const push = (
    id: RatingId,
    value: number | null,
    inputs: string,
    math: string,
    inScore = false,
  ) => out.push({ id, label: RULES[id].label, value, inputs, math, inScore });

  // ---- the five factors of the imaging score ----
  if (w && w.cloudLow != null && w.cloudMid != null && w.cloudHigh != null) {
    const L = w.cloudLow / 100;
    const M = w.cloudMid / 100;
    const H = w.cloudHigh / 100;
    const f = cloudFactor(w.cloudLow, w.cloudMid, w.cloudHigh);
    push(
      'clouds',
      pct(f),
      `Low ${n0(w.cloudLow)} %, mid ${n0(w.cloudMid)} %, high ${n0(w.cloudHigh)} %`,
      `100 × (1 − ${f2(L)}) × (1 − ${f2(M)}) × (1 − 0.6 × ${f2(H)}) = ${pct(f)}`,
      true,
    );
  } else push('clouds', null, 'No cloud forecast yet', '—', true);

  const pressure = sitePressure(row, elevation);
  const k = extinctionK(row, elevation);
  const tf = transparencyFactor(k);
  push(
    'transparency',
    pct(tf),
    row.aod != null
      ? `Extinction k = ${f2(k)} mag (haze AOD ${f2(row.aod)}, pressure ${n0(pressure)} hPa)`
      : `Extinction k = ${f2(k)} mag (no haze data: typical AOD 0.10 assumed)`,
    `100 × 10^(−0.4 × (${f2(k)} − 0.15) × 1.5) = ${pct(tf)}`,
    true,
  );

  const darkMag = darkSkyMag ?? NATURAL_SKY_MAG;
  const bMoon = moonSkyBrightness(
    { phaseAngle: row.moonPhaseAngle, moonAlt: row.moonAlt, targetAlt: 45, separation: 90 },
    k,
  );
  const bDark = magToNl(darkMag);
  const mf = Math.sqrt(bDark / (bDark + bMoon));
  const lit = (1 + Math.cos((row.moonPhaseAngle * Math.PI) / 180)) / 2;
  push(
    'moon',
    pct(mf),
    row.moonAlt > 0
      ? `Moon ${pct(lit)} % lit, ${n0(row.moonAlt)}° high; dark sky ${f1(darkMag)} mag/arcsec²`
      : `Moon below the horizon (${minus(n0(row.moonAlt))}°)`,
    `100 × √(${n0(bDark)} nL / (${n0(bDark)} + ${n0(bMoon)} nL)) = ${pct(mf)}`,
    true,
  );

  const df = darknessFactor(row.sunAlt);
  push(
    'darkness',
    pct(df),
    `Sun ${minus(f1(row.sunAlt))}°`,
    `100 × (−12 − (${minus(f1(row.sunAlt))})) / 6 = ${ends(100 * ((-12 - row.sunAlt) / 6), pct(df))}`,
    true,
  );

  if (row.seeing) {
    const s = row.seeing.arcsec;
    const sf = seeingFactor(s);
    push(
      'seeing',
      pct(sf),
      `Estimated seeing ${f1(s)}″ (${row.seeing.label.toLowerCase()})`,
      `100 × 1.70 / √(${f1(s)}² + 1.5²) = ${pct(sf)}`,
      true,
    );
  } else push('seeing', null, 'No seeing estimate (counts as 100 in the score)', '—', true);

  // ---- planning guides (not in the imaging score) ----
  const rf = rain ? rainFactor(rain.mm, rain.prob) : null;
  if (rain && rf != null) {
    const mm = Math.max(0, rain.mm ?? 0);
    const p = rain.prob ?? (mm >= 0.1 ? 100 : 0);
    push(
      'rain',
      pct(rf),
      `${p} % chance, ${f1(mm)} mm expected${rain.snow ? `, ${f1(rain.snow)} cm snow` : ''}`,
      `100 × (1 − ${f2(p / 100)}) × (1 − ${f2(Math.min(1, mm))}) = ${pct(rf)}`,
    );
  } else push('rain', null, 'Rain forecast not loaded', '—');

  const gust = w?.gusts ?? w?.wind ?? null;
  if (gust != null) {
    const wf = windFactor(gust);
    push(
      'wind',
      pct(wf),
      `${w?.gusts != null ? 'Gusts' : 'Wind'} ${n0(gust)} km/h${w?.wind != null && w.gusts != null ? `, steady ${n0(w.wind)} km/h` : ''}`,
      `100 × (50 − ${n0(gust)}) / 40 = ${ends((100 * (50 - gust)) / 40, pct(wf))}`,
    );
  } else push('wind', null, 'No wind forecast yet', '—');

  if (row.dew) {
    const m = row.dew.margin;
    const dwf = dewFactor(m);
    push(
      'dew',
      pct(dwf),
      `Air ${f1(row.dew.spread)} °C above the dew point; optics margin ${minus(f1(m))} °C`,
      `100 × ${minus(f1(m))} / 3 = ${ends((100 * m) / 3, pct(dwf))}`,
    );
  } else push('dew', null, 'No temperature or humidity yet', '—');

  if (siteSqm != null) {
    const sk = skyDarkFactor(siteSqm);
    push(
      'skydark',
      pct(sk),
      `SQM ${f2(siteSqm)} mag/arcsec² (moonless zenith)`,
      `100 × (${f2(siteSqm)} − 17) / 5 = ${ends((100 * (siteSqm - 17)) / 5, pct(sk))}`,
    );
  } else push('skydark', null, 'Light-pollution map not loaded', '—');

  const aqi = row.air?.usAqi ?? null;
  if (aqi != null) {
    const af = airFactor(aqi);
    push('air', pct(af), `US AQI ${n0(aqi)}`, `100 × (1 − ${n0(aqi)} / 300) = ${pct(af)}`);
  } else push('air', null, 'No air-quality forecast yet', '—');

  if (row.cloudSpread != null) {
    const c = Math.max(0, 100 - row.cloudSpread);
    const n = Object.values(row.modelClouds).filter((x) => x != null).length;
    push(
      'confidence',
      Math.round(c),
      `${n} models; their cloud forecasts span ${n0(row.cloudSpread)} points`,
      `100 − ${n0(row.cloudSpread)} = ${Math.round(c)}`,
    );
  } else push('confidence', null, 'Only one model loaded', '—');

  return out;
}

/** The imaging score as the product of its five factors, with this hour's numbers. */
export function scoreMath(row: HourRow): string | null {
  const s = row.score;
  if (!s) return null;
  return `100 × ${f2(s.clouds)} × ${f2(s.transparency)} × ${f2(s.moon)} × ${f2(s.darkness)} × ${f2(s.seeing)} = ${s.score}`;
}

/** Word and colour class for a 0–100 rating. */
export function band(v: number | null): {
  word: string;
  cls: 'great' | 'ok' | 'meh' | 'bad' | 'none';
} {
  if (v == null) return { word: 'no data', cls: 'none' };
  if (v >= 80) return { word: 'great', cls: 'great' };
  if (v >= 55) return { word: 'good', cls: 'ok' };
  if (v >= 30) return { word: 'poor', cls: 'meh' };
  return { word: 'bad', cls: 'bad' };
}
