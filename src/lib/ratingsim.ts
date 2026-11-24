/**
 * "Try it yourself" for the Ratings section: each rating as a function of a few sliders,
 * started from the shown hour's real numbers. Uses the same factor functions as the ratings
 * and the imaging score (ratings.ts, physics/score.ts), so moving a slider back to its start
 * value gives the same rating the card shows.
 */
import type { RatingId, RateInput } from './ratings';
import {
  airFactor,
  dewFactor,
  extinctionK,
  rainFactor,
  skyDarkFactor,
  windFactor,
} from './ratings';
import { magToNl, moonSkyBrightness } from './physics/moonlight';
import { cloudFactor, darknessFactor, transparencyFactor } from './physics/score';
import { seeingFactor } from './physics/seeing';

export interface Slider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export type Values = Record<string, number>;

export interface SimResult {
  /** 0–100. */
  value: number;
  /** The rule with these numbers in it. */
  math: string;
  /** The factor (0–1) this rating multiplies into the imaging score, if it is part of it. */
  factor: number;
}

const pct = (f: number) => Math.round(100 * f);
const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);
const n0 = (x: number) => Math.round(x).toString();
const minus = (s: string) => s.replace('-', '−');
const ends = (raw: number, final: number) =>
  Math.round(raw) === final ? `${final}` : `${minus(n0(raw))} → ${final}`;
const res = (f: number, math: string): SimResult => ({ value: pct(f), math, factor: f });

/** Lunar phase angle (degrees, 0 = full) for an illuminated fraction 0–1. */
export const phaseFromIllum = (ill: number) =>
  (Math.acos(Math.min(1, Math.max(-1, 2 * ill - 1))) * 180) / Math.PI;

export const SIMS: Record<RatingId, { sliders: Slider[]; run: (v: Values) => SimResult }> = {
  clouds: {
    sliders: [
      { key: 'low', label: 'Low cloud', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'mid', label: 'Mid cloud', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'high', label: 'High cloud (cirrus)', min: 0, max: 100, step: 1, unit: '%' },
    ],
    run: ({ low = 0, mid = 0, high = 0 }) => {
      const f = cloudFactor(low, mid, high);
      return res(
        f,
        `100 × (1 − ${f2(low / 100)}) × (1 − ${f2(mid / 100)}) × (1 − 0.6 × ${f2(high / 100)}) = ${pct(f)}`,
      );
    },
  },
  transparency: {
    sliders: [{ key: 'k', label: 'Extinction k', min: 0.1, max: 1, step: 0.01, unit: 'mag' }],
    run: ({ k = 0.2 }) => {
      const f = transparencyFactor(k);
      return res(f, `100 × 10^(−0.4 × (${f2(k)} − 0.15) × 1.5) = ${pct(f)}`);
    },
  },
  moon: {
    sliders: [
      { key: 'illum', label: 'Moon lit', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'moonAlt', label: 'Moon altitude', min: -10, max: 90, step: 1, unit: '°' },
      { key: 'dark', label: 'Dark sky (SQM)', min: 17, max: 22, step: 0.1, unit: 'mag' },
    ],
    run: ({ illum = 0, moonAlt = -10, dark = 21.5, k = 0.2 }) => {
      const bMoon = moonSkyBrightness(
        { phaseAngle: phaseFromIllum(illum / 100), moonAlt, targetAlt: 45, separation: 90 },
        k,
      );
      const bDark = magToNl(dark);
      const f = Math.sqrt(bDark / (bDark + bMoon));
      return res(f, `100 × √(${n0(bDark)} nL / (${n0(bDark)} + ${n0(bMoon)} nL)) = ${pct(f)}`);
    },
  },
  darkness: {
    sliders: [{ key: 'sun', label: 'Sun altitude', min: -30, max: 10, step: 0.5, unit: '°' }],
    run: ({ sun = -20 }) => {
      const f = darknessFactor(sun);
      return res(
        f,
        `100 × (−12 − (${minus(f1(sun))})) / 6 = ${ends((100 * (-12 - sun)) / 6, pct(f))}`,
      );
    },
  },
  seeing: {
    sliders: [{ key: 'arcsec', label: 'Seeing', min: 0.5, max: 5, step: 0.1, unit: '″' }],
    run: ({ arcsec = 1.5 }) => {
      const f = seeingFactor(arcsec);
      return res(f, `100 × 1.70 / √(${f1(arcsec)}² + 1.5²) = ${pct(f)}`);
    },
  },
  rain: {
    sliders: [
      { key: 'prob', label: 'Chance of rain', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'mm', label: 'Rain expected', min: 0, max: 3, step: 0.1, unit: 'mm' },
    ],
    run: ({ prob = 0, mm = 0 }) => {
      const f = rainFactor(mm, prob) ?? 1;
      return res(f, `100 × (1 − ${f2(prob / 100)}) × (1 − ${f2(Math.min(1, mm))}) = ${pct(f)}`);
    },
  },
  wind: {
    sliders: [{ key: 'gust', label: 'Gusts', min: 0, max: 80, step: 1, unit: 'km/h' }],
    run: ({ gust = 10 }) => {
      const f = windFactor(gust);
      return res(f, `100 × (50 − ${n0(gust)}) / 40 = ${ends((100 * (50 - gust)) / 40, pct(f))}`);
    },
  },
  dew: {
    sliders: [
      { key: 'margin', label: 'Optics above dew point', min: -3, max: 8, step: 0.1, unit: '°C' },
    ],
    run: ({ margin = 3 }) => {
      const f = dewFactor(margin);
      return res(f, `100 × ${minus(f1(margin))} / 3 = ${ends((100 * margin) / 3, pct(f))}`);
    },
  },
  skydark: {
    sliders: [
      { key: 'sqm', label: 'Sky brightness (SQM)', min: 16, max: 22.2, step: 0.05, unit: 'mag' },
    ],
    run: ({ sqm = 21 }) => {
      const f = skyDarkFactor(sqm);
      return res(f, `100 × (${f2(sqm)} − 17) / 5 = ${ends((100 * (sqm - 17)) / 5, pct(f))}`);
    },
  },
  air: {
    sliders: [{ key: 'aqi', label: 'US AQI', min: 0, max: 400, step: 1, unit: '' }],
    run: ({ aqi = 50 }) => {
      const f = airFactor(aqi);
      return res(f, `100 × (1 − ${n0(aqi)} / 300) = ${ends(100 * (1 - aqi / 300), pct(f))}`);
    },
  },
  confidence: {
    sliders: [
      { key: 'spread', label: 'Gap between models', min: 0, max: 100, step: 1, unit: 'points' },
    ],
    run: ({ spread = 20 }) => {
      const f = Math.max(0, 1 - spread / 100);
      return res(f, `100 − ${n0(spread)} = ${pct(f)}`);
    },
  },
};

/** Slider start values from the hour being rated. */
export function simStart(id: RatingId, c: RateInput): Values {
  const w = c.row.weather;
  switch (id) {
    case 'clouds':
      return { low: w?.cloudLow ?? 0, mid: w?.cloudMid ?? 0, high: w?.cloudHigh ?? 0 };
    case 'transparency':
      return { k: extinctionK(c.row, c.elevation) };
    case 'moon':
      return {
        illum: (100 * (1 + Math.cos((c.row.moonPhaseAngle * Math.PI) / 180))) / 2,
        moonAlt: c.row.moonAlt,
        dark: c.darkSkyMag ?? 22,
        k: extinctionK(c.row, c.elevation),
      };
    case 'darkness':
      return { sun: c.row.sunAlt };
    case 'seeing':
      return { arcsec: c.row.seeing?.arcsec ?? 1.5 };
    case 'rain':
      return {
        prob: c.rain?.prob ?? ((c.rain?.mm ?? 0) >= 0.1 ? 100 : 0),
        mm: Math.max(0, c.rain?.mm ?? 0),
      };
    case 'wind':
      return { gust: w?.gusts ?? w?.wind ?? 10 };
    case 'dew':
      return { margin: c.row.dew?.margin ?? 3 };
    case 'skydark':
      return { sqm: c.siteSqm ?? 21 };
    case 'air':
      return { aqi: c.row.air?.usAqi ?? 50 };
    case 'confidence':
      return { spread: c.row.cloudSpread ?? 20 };
  }
}
