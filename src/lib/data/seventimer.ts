/**
 * 7Timer! ASTRO (Ye Quanzhi; https://www.7timer.info), the second opinion on
 * seeing and transparency. Free and non-commercial; GFS-based; one value every
 * 3 hours for 72 hours. Browsers can't call it directly (no CORS headers), so
 * it goes through the data Worker, which caches each location for 3 hours.
 *
 * Classes, from the 7Timer! documentation:
 *   seeing 1–8:        <0.5″, 0.5–0.75″, 0.75–1″, 1–1.25″, 1.25–1.5″, 1.5–2″, 2–2.5″, >2.5″
 *   transparency 1–8:  <0.3, 0.3–0.4, 0.4–0.5, 0.5–0.6, 0.6–0.7, 0.7–0.85, 0.85–1, >1 mag/airmass
 */
import { DATA_BASE } from '../config';
import { fetchJson, type Cached } from './cache';

export const SEEING_CLASSES: readonly [number, number][] = [
  [0, 0.5],
  [0.5, 0.75],
  [0.75, 1],
  [1, 1.25],
  [1.25, 1.5],
  [1.5, 2],
  [2, 2.5],
  [2.5, Infinity],
];

export const TRANSPARENCY_CLASSES: readonly [number, number][] = [
  [0, 0.3],
  [0.3, 0.4],
  [0.4, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.85],
  [0.85, 1],
  [1, Infinity],
];

export interface SevenTimerPoint {
  /** Start of the 3-hour step, ms since epoch. */
  t: number;
  /** Class 1–8, or null when 7Timer has no value. */
  seeing: number | null;
  transparency: number | null;
}

export interface SevenTimer {
  /** Model run time, ms since epoch. */
  init: number;
  points: SevenTimerPoint[];
}

interface Raw {
  init?: string;
  dataseries?: { timepoint?: number; seeing?: number; transparency?: number }[];
}

const cls = (v: number | undefined) =>
  typeof v === 'number' && v >= 1 && v <= 8 ? Math.round(v) : null;

export function parseSevenTimer(raw: Raw): SevenTimer | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(raw.init ?? '');
  if (!m || !raw.dataseries) return null;
  const init = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
  const points = raw.dataseries
    .filter((d) => typeof d.timepoint === 'number')
    .map((d) => ({
      t: init + (d.timepoint ?? 0) * 3600_000,
      seeing: cls(d.seeing),
      transparency: cls(d.transparency),
    }))
    .sort((a, b) => a.t - b.t);
  return { init, points };
}

/** The 3-hour step whose value applies at time t (7Timer values are point forecasts). */
export function sevenTimerAt(st: SevenTimer, t: number): SevenTimerPoint | null {
  let best: SevenTimerPoint | null = null;
  let bestD = Infinity;
  for (const p of st.points) {
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best && bestD <= 90 * 60_000 ? best : null;
}

/** "1–1.25″" for a seeing class. */
export function seeingClassText(c: number): string {
  const r = SEEING_CLASSES[c - 1];
  if (!r) return '—';
  return r[1] === Infinity ? `>${r[0]}″` : r[0] === 0 ? `<${r[1]}″` : `${r[0]}–${r[1]}″`;
}

/** 0.1° grid, written the way the Worker route expects (no "-0.0"). */
const deg = (v: number) => {
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return s === '-0.0' ? '0.0' : s;
};

export const SEVEN_TIMER_ENABLED = !!DATA_BASE;

export async function loadSevenTimer(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<SevenTimer>> {
  const url = `${DATA_BASE}/7timer/${deg(lat)}/${deg(lon)}`;
  const r = await fetchJson<Raw>(`7timer:${deg(lat)},${deg(lon)}`, url, {
    maxAgeMs: force ? 0 : 3 * 3600_000,
    signal,
  });
  const data = parseSevenTimer(r.data);
  if (!data) throw new Error('7Timer! returned no usable data');
  return { ...r, data };
}
