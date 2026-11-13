/**
 * The cloud figure the site shows for any hour.
 *
 * - Forecast: the median of eight global models, layer by layer (low, mid, high).
 *   One model alone can be badly wrong for a place; the median of several is a
 *   standard, more robust ensemble estimate. The spread (min–max of the models'
 *   totals) is kept as the uncertainty.
 * - Nowcast: the newest satellite infrared image pulls the forecast towards what
 *   is really overhead, with a weight that fades with the image's age
 *   (0.85 · e^(−Δt / 3 h)), the usual persistence-to-forecast hand-over.
 * - Observed: hours already past use the satellite's measurement for that hour.
 */
import { CONSENSUS_MODELS, hourAt, type ModelClouds, type Weather } from '../data/openmeteo';
import { HIGH_TOP_K } from '../sat/ir';

export type CloudKind = 'observed' | 'nowcast' | 'forecast';

export interface CloudEstimate {
  /** Total cover (%), random overlap of the layers. */
  total: number;
  low: number;
  mid: number;
  high: number;
  /** Lowest and highest model total (%) for this hour, when known. */
  min: number | null;
  max: number | null;
  /** Models that had a value. */
  models: number;
  kind: CloudKind;
  /** Satellite share in the figure (0–1). */
  satWeight: number;
}

/** A satellite measurement at the site. */
export interface SatObs {
  time: number;
  /** Cloud fraction 0–1. */
  frac: number;
  /** Mean brightness temperature (K), to tell high cloud from low. */
  meanK: number | null;
}

export const NOWCAST_TAU_H = 3;
export const NOWCAST_MAX_WEIGHT = 0.85;
/** Satellite images older than this (relative to the clock) are not used. */
export const NOWCAST_MAX_AGE_H = 4;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
/** Total of three layers with random overlap (%). */
export const overlap = (l: number, m: number, h: number): number =>
  100 * (1 - (1 - l / 100) * (1 - m / 100) * (1 - h / 100));

/** Median of the models, per layer, at time t (null if no model covers it). */
export function consensusAt(models: ModelClouds | null, t: number) {
  const h = models ? hourAt(models.hours, t) : null;
  if (!h) return null;
  const lows: number[] = [];
  const mids: number[] = [];
  const highs: number[] = [];
  const totals: number[] = [];
  for (const m of CONSENSUS_MODELS) {
    const L = h.layers?.[m];
    if (L && L.low != null && L.mid != null && L.high != null) {
      lows.push(L.low);
      mids.push(L.mid);
      highs.push(L.high);
    }
    const tot = h.byModel[m];
    if (tot != null) totals.push(tot);
  }
  const low = median(lows);
  const mid = median(mids);
  const high = median(highs);
  if (low == null || mid == null || high == null) return null;
  return {
    low,
    mid,
    high,
    total: overlap(low, mid, high),
    min: totals.length ? Math.min(...totals) : null,
    max: totals.length ? Math.max(...totals) : null,
    models: lows.length,
  };
}

/** Satellite weight for an hour `t` given an image taken at `satTime`. */
export function nowcastWeight(t: number, satTime: number): number {
  const dh = (t - satTime) / 3600_000;
  if (dh < -1) return 0; // the image is from after this hour
  return NOWCAST_MAX_WEIGHT * Math.exp(-Math.max(0, dh) / NOWCAST_TAU_H);
}

/** Move layer covers so their total becomes `target` (%), keeping their proportions. */
export function scaleLayers(
  l: { low: number; mid: number; high: number },
  target: number,
  meanK: number | null,
): { low: number; mid: number; high: number } {
  const cur = overlap(l.low, l.mid, l.high);
  if (cur < 1) {
    // Forecast clear but the satellite sees cloud: put it where its top temperature says.
    return meanK != null && meanK < HIGH_TOP_K
      ? { low: 0, mid: 0, high: target }
      : { low: target, mid: 0, high: 0 };
  }
  // Solve 1 − Π(1 − f·xᵢ) = target by bisection on the common factor f.
  let lo = 0;
  let hi = 100 / Math.max(l.low, l.mid, l.high, 1);
  for (let i = 0; i < 40; i++) {
    const f = (lo + hi) / 2;
    if (overlap(clamp(l.low * f), clamp(l.mid * f), clamp(l.high * f)) < target) lo = f;
    else hi = f;
  }
  const f = (lo + hi) / 2;
  return { low: clamp(l.low * f), mid: clamp(l.mid * f), high: clamp(l.high * f) };
}

/**
 * Cloud estimate for the hour starting at `t`.
 * `obs` holds satellite measurements at the site, newest first.
 */
export function estimateClouds(
  t: number,
  now: number,
  models: ModelClouds | null,
  weather: Weather | null,
  obs: readonly SatObs[],
): CloudEstimate | null {
  const c = consensusAt(models, t);
  const w = weather ? hourAt(weather.hours, t) : null;
  const base =
    c ??
    (w && w.cloudLow != null && w.cloudMid != null && w.cloudHigh != null
      ? {
          low: w.cloudLow,
          mid: w.cloudMid,
          high: w.cloudHigh,
          total: overlap(w.cloudLow, w.cloudMid, w.cloudHigh),
          min: null,
          max: null,
          models: 1,
        }
      : null);

  // Past hours: the satellite's own measurement within ±40 min of the hour's middle.
  const mid = t + 1800_000;
  if (mid < now - 1800_000) {
    const o = obs.find(
      (x) => Math.abs(x.time - mid) <= 40 * 60_000 || Math.abs(x.time - t) <= 40 * 60_000,
    );
    if (o) {
      const total = clamp(o.frac * 100);
      const layers = base
        ? scaleLayers(base, total, o.meanK)
        : scaleLayers({ low: 0, mid: 0, high: 0 }, total, o.meanK);
      return {
        ...layers,
        total,
        min: base?.min ?? null,
        max: base?.max ?? null,
        models: base?.models ?? 0,
        kind: 'observed',
        satWeight: 1,
      };
    }
  }
  if (!base) return null;

  // Now and later: nudge towards the newest usable image.
  const newest = obs.find((x) => now - x.time <= NOWCAST_MAX_AGE_H * 3600_000);
  if (newest) {
    const sw = nowcastWeight(mid, newest.time);
    if (sw > 0.01) {
      const total = sw * newest.frac * 100 + (1 - sw) * base.total;
      const layers = scaleLayers(base, total, newest.meanK);
      return {
        ...layers,
        total: overlap(layers.low, layers.mid, layers.high),
        min: base.min,
        max: base.max,
        models: base.models,
        kind: sw >= 0.15 ? 'nowcast' : 'forecast',
        satWeight: sw,
      };
    }
  }
  return { ...base, kind: 'forecast', satWeight: 0 };
}

/** First hour shown: three hours before the current hour (local hour grid). */
export function timelineStart(now: number, utcOffsetSec: number): number {
  const off = utcOffsetSec * 1000;
  return Math.floor((now + off) / 3600_000) * 3600_000 - off - 3 * 3600_000;
}

/** Last hour shown: the coming 05:00 local (the 05:00–06:00 hour included). */
export function timelineEnd(now: number, utcOffsetSec: number): number {
  const off = utcOffsetSec * 1000;
  const local = now + off;
  const day = Math.floor(local / 86_400_000) * 86_400_000;
  let five = day + 5 * 3600_000;
  if (five <= local) five += 86_400_000;
  return five - off + 3600_000;
}
