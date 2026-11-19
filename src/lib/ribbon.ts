/**
 * The night ribbon (DESIGN.md): sunset → sunrise with twilight bands, the hours
 * the Moon is up, cloud cover per hour and the best imaging window. Pure
 * functions so the drawing component stays thin and the logic is tested.
 */
import type { TwilightTimes } from './conditions';

export type Band = 'day' | 'civil' | 'nautical' | 'astro' | 'dark';

export interface Segment {
  from: number;
  to: number;
  band: Band;
}

export interface Span {
  start: number;
  end: number;
}

const MIN = 60_000;

/** The ribbon's time span: 30 min before sunset to 30 min after sunrise (or ±12 h). */
export function ribbonSpan(tw: TwilightTimes, around: number): Span {
  const s = tw.sunset?.getTime();
  const r = tw.sunrise?.getTime();
  if (s != null && r != null && r > s) return { start: s - 30 * MIN, end: r + 30 * MIN };
  return { start: around - 12 * 3600_000, end: around + 12 * 3600_000 };
}

/**
 * Twilight bands across the span. Missing milestones (summer nights that never
 * reach −18°, polar days) simply leave out the deeper bands.
 */
export function twilightSegments(tw: TwilightTimes, span: Span): Segment[] {
  const marks: [number | undefined, Band][] = [
    [tw.sunset?.getTime(), 'civil'],
    [tw.civilEnd?.getTime(), 'nautical'],
    [tw.nauticalEnd?.getTime(), 'astro'],
    [tw.astroEnd?.getTime(), 'dark'],
    [tw.astroStart?.getTime(), 'astro'],
    [tw.nauticalStart?.getTime(), 'nautical'],
    [tw.civilStart?.getTime(), 'civil'],
    [tw.sunrise?.getTime(), 'day'],
  ];
  const pts = marks
    .filter((m): m is [number, Band] => m[0] != null && m[0] > span.start && m[0] < span.end)
    .sort((a, b) => a[0] - b[0]);
  const out: Segment[] = [];
  let t = span.start;
  let band: Band = 'day';
  for (const [at, next] of pts) {
    if (at > t) out.push({ from: t, to: at, band });
    t = at;
    band = next;
  }
  if (span.end > t) out.push({ from: t, to: span.end, band });
  return out;
}

export interface RibbonHour {
  t: number;
  /** Cloud cover 0–100 %, null when unknown. */
  cloud: number | null;
  /** Moon altitude (degrees) in the middle of the hour. */
  moonAlt: number;
  /** Sun altitude (degrees). */
  sunAlt: number;
  /** Imaging score 0–1, null when unknown. */
  score: number | null;
}

/**
 * Best imaging window: the contiguous run of dark hours (Sun below −12°) with
 * the largest summed score, keeping only hours scoring at least 0.25. Null when
 * no hour qualifies (the verdict then explains why).
 */
export function bestWindow(hours: readonly RibbonHour[], minScore = 0.25): Span | null {
  type Run = { start: number; end: number; sum: number };
  let best: Run | null = null;
  let cur: Run | null = null;
  for (const h of hours) {
    const score = h.score ?? 0;
    if (h.sunAlt < -12 && h.score != null && score >= minScore) {
      const next: Run = cur
        ? { start: cur.start, end: h.t + 3600_000, sum: cur.sum + score }
        : { start: h.t, end: h.t + 3600_000, sum: score };
      cur = next;
      if (!best || next.sum > best.sum) best = next;
    } else {
      cur = null;
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

/** Spans in which the Moon is above the horizon, from hourly samples. */
export function moonUpSpans(hours: readonly RibbonHour[]): Span[] {
  const out: Span[] = [];
  let cur: Span | null = null;
  for (const h of hours) {
    if (h.moonAlt > 0) {
      if (cur) cur.end = h.t + 3600_000;
      else cur = { start: h.t, end: h.t + 3600_000 };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Position (0–1) of time t on the span. */
export function frac(t: number, span: Span): number {
  return Math.min(1, Math.max(0, (t - span.start) / (span.end - span.start)));
}
