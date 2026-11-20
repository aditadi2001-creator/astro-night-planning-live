/**
 * Moving the sky's clock by calendar units, for the Sky timeline: hours to centuries, forwards
 * or backwards, keeping the time of day (months and years are calendar months, so 31 Jan + 1
 * month = 28/29 Feb). Fractions (from the scrubber) are spread over the unit's mean length.
 */
export type TimeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade' | 'century';

const MIN = 60_000;
export const UNIT_MS: Record<TimeUnit, number> = {
  minute: MIN,
  hour: 60 * MIN,
  day: 1440 * MIN,
  week: 7 * 1440 * MIN,
  month: 30.436875 * 1440 * MIN,
  year: 365.2425 * 1440 * MIN,
  decade: 3652.425 * 1440 * MIN,
  century: 36524.25 * 1440 * MIN,
};
const MONTHS: Partial<Record<TimeUnit, number>> = {
  month: 1,
  year: 12,
  decade: 120,
  century: 1200,
};

export const UNIT_LABEL: Record<TimeUnit, [string, string]> = {
  minute: ['minute', 'minutes'],
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
  decade: ['decade', 'decades'],
  century: ['century', 'centuries'],
};

/** Add whole calendar months, keeping the day (clamped to the month's length) and the clock. */
export function addMonths(t: Date, n: number): Date {
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + n;
  const dayMs = t.getTime() - Date.UTC(y, t.getUTCMonth(), t.getUTCDate());
  const target = new Date(0);
  target.setUTCFullYear(y, m + 1, 0); // last day of the target month (handles years < 100)
  const last = target.getUTCDate();
  const out = new Date(0);
  out.setUTCFullYear(y, m, Math.min(t.getUTCDate(), last));
  return new Date(out.getTime() + dayMs);
}

/** `t` moved by `n` units (n may be fractional or negative). */
export function addUnits(t: Date, unit: TimeUnit, n: number): Date {
  const months = MONTHS[unit];
  if (!months) return new Date(t.getTime() + n * UNIT_MS[unit]);
  const whole = Math.trunc(n);
  const moved = whole ? addMonths(t, whole * months) : t;
  const frac = n - whole;
  return frac ? new Date(moved.getTime() + frac * UNIT_MS[unit]) : moved;
}

/** "+3 years 2 months", "−5 hours": the scrubber's offset in words. */
export function describeOffset(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms);
  const pick = (u: TimeUnit) => {
    const v = a / UNIT_MS[u];
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${sign}${r} ${UNIT_LABEL[u][r === 1 ? 0 : 1]}`;
  };
  if (a < UNIT_MS.hour) return pick('minute');
  if (a < UNIT_MS.day) return pick('hour');
  if (a < 2 * UNIT_MS.month) return pick('day');
  if (a < 2 * UNIT_MS.year) return pick('month');
  if (a < 2 * UNIT_MS.century) return pick('year');
  return pick('century');
}
