import { describe, expect, it } from 'vitest';
import { fromLocalInput, toLocalInput } from '../src/lib/time/format';

describe('site-time conversion for the date picker', () => {
  it('shows a UTC instant in the site zone', () => {
    const d = new Date('2026-11-12T18:11:00Z');
    expect(toLocalInput(d, 'Europe/London')).toBe('2026-11-12T18:11');
    expect(toLocalInput(d, 'Asia/Kolkata')).toBe('2026-11-12T23:41');
    expect(toLocalInput(d, 'America/New_York')).toBe('2026-11-12T13:11');
  });
  it('round-trips, including across a DST change', () => {
    for (const tz of ['Europe/London', 'Asia/Kolkata', 'America/New_York', 'Australia/Sydney']) {
      for (const iso of ['2026-11-12T18:11:00Z', '2026-03-29T00:30:00Z', '2026-07-01T12:00:00Z']) {
        const d = new Date(iso);
        expect(fromLocalInput(toLocalInput(d, tz), tz)?.toISOString()).toBe(d.toISOString());
      }
    }
  });
});
