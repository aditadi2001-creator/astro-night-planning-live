import { describe, expect, it } from 'vitest';
import { darkWindow, tonight } from '../src/lib/astro/time';

const greenwich = { name: 'Greenwich', lat: 51.4769, lon: -0.0005, elevation: 46 };

describe('darkness window', () => {
  it('finds astronomical dusk/dawn for Greenwich on 2026-11-12', () => {
    // Reference: timeanddate.com, London, November 2026 table (GMT = UTC):
    // astronomical twilight ends 18:11 on the 12th and starts 05:18 on the 13th.
    // London is 0.13° west of Greenwich (~30 s later), within the 2-minute tolerance.
    const w = darkWindow(greenwich, new Date('2026-11-12T12:00:00Z'));
    expect(w.never).toBe(false);
    expect(Math.abs((w.start?.getTime() ?? 0) - Date.parse('2026-11-12T18:11:00Z'))).toBeLessThan(
      2 * 60e3,
    );
    expect(Math.abs((w.end?.getTime() ?? 0) - Date.parse('2026-11-13T05:18:00Z'))).toBeLessThan(
      2 * 60e3,
    );
  });

  it('returns now for "tonight" when it is already dark', () => {
    const now = new Date('2026-11-12T23:00:00Z');
    expect(tonight(greenwich, now)).toEqual(now);
  });

  it('handles midsummer at high latitude with no astronomical darkness', () => {
    const oslo = { name: 'Oslo', lat: 59.91, lon: 10.75, elevation: 20 };
    const w = darkWindow(oslo, new Date('2026-06-21T12:00:00Z'));
    expect(w.never).toBe(true);
    // Falls back to the Sun's lowest point, around local solar midnight (~23:17 UTC).
    const t = tonight(oslo, new Date('2026-06-21T12:00:00Z'));
    expect(Math.abs(t.getTime() - Date.parse('2026-06-21T23:17:00Z'))).toBeLessThan(20 * 60e3);
  });
});
