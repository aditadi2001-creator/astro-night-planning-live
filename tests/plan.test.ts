import { describe, expect, it } from 'vitest';
import {
  autoOrder,
  decDms,
  raHms,
  toIcs,
  toJson,
  toNinaCsv,
  type PlanItem,
} from '../src/lib/plan/plan';

const m31: PlanItem = {
  name: 'M 31',
  common: 'Andromeda Galaxy',
  type: 'Galaxy',
  ra: 10.68471,
  dec: 41.26875,
  pa: 35,
  window: { start: Date.UTC(2026, 10, 19, 14, 0), end: Date.UTC(2026, 10, 19, 18, 0) },
  transit: Date.UTC(2026, 10, 19, 15, 30),
};
const m42: PlanItem = {
  name: 'M 42',
  common: 'Great Orion Nebula, "the sword"',
  type: 'Emission nebula',
  ra: 83.8221,
  dec: -5.3911,
  pa: 0,
  window: { start: Date.UTC(2026, 10, 19, 18, 0), end: Date.UTC(2026, 10, 19, 23, 0) },
  transit: Date.UTC(2026, 10, 19, 21, 0),
};

describe('plan exports', () => {
  it('formats sexagesimal J2000 coordinates', () => {
    expect(raHms(10.68471)).toBe('00:42:44.3');
    expect(decDms(41.26875)).toBe('+41:16:08');
    expect(decDms(-5.3911)).toBe('-05:23:28');
    expect(raHms(359.99999)).toBe('00:00:00.0');
  });

  it('writes NINA / Target Scheduler CSV with the expected headers and quoting', () => {
    const csv = toNinaCsv([m31, m42]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Familiar Name,Catalogue Entry,Type,Right Ascension (J2000),Declination (J2000),Position Angle (East)',
    );
    expect(lines[1]).toBe('Andromeda Galaxy,M 31,Galaxy,00:42:44.3,+41:16:08,35.0');
    expect(lines[2]).toBe(
      '"Great Orion Nebula, ""the sword""",M 42,Emission nebula,05:35:17.3,-05:23:28,0.0',
    );
  });

  it('orders the night by best window', () => {
    expect(autoOrder([m42, m31]).map((i) => i.name)).toEqual(['M 31', 'M 42']);
  });

  it('writes a valid iCalendar with the dark window and target windows', () => {
    const ics = toIcs(
      [m31, m42],
      { start: m31.window?.start ?? 0, end: m42.window?.end ?? 0 },
      'Bangalore',
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261119T140000Z');
    expect(ics).toContain('SUMMARY:Image M 42 (Great Orion Nebula\\, "the sword")');
  });

  it('JSON keeps J2000 coordinates in both forms', () => {
    const j = JSON.parse(toJson([m31], { site: 'Bangalore', date: '2026-11-19' }));
    expect(j.targets[0]).toMatchObject({ name: 'M 31', raHms: '00:42:44.3', epoch: 'J2000' });
  });
});
