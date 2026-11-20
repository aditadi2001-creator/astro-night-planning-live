import { describe, expect, it } from 'vitest';
import { addMonths, addUnits, describeOffset } from '../src/lib/time/shift';
import * as bridge from '../tools/bridge/bridge.mjs';
import * as links from '../tools/bridge/mounts.mjs';
import { SERIAL_CONTROL, SERIAL_READ, serialAllowed } from '../src/lib/telescope/serial';
import {
  findMount,
  INDI_CONTROL,
  parseIndiMount,
  type IndiSnapshot,
} from '../src/lib/telescope/indi';
import { MOUNTS } from '../src/lib/telescope/mounts';

describe('timeline steps', () => {
  const t = new Date('2026-01-31T20:15:00Z');
  it('moves by calendar months and years, keeping the clock', () => {
    expect(addMonths(t, 1).toISOString()).toBe('2026-02-28T20:15:00.000Z');
    expect(addMonths(new Date('2028-01-31T20:15:00Z'), 1).toISOString()).toBe(
      '2028-02-29T20:15:00.000Z',
    );
    expect(addUnits(t, 'year', 10).toISOString()).toBe('2036-01-31T20:15:00.000Z');
    expect(addUnits(t, 'year', -5).toISOString()).toBe('2021-01-31T20:15:00.000Z');
    expect(addUnits(t, 'century', -5).getUTCFullYear()).toBe(1526);
    expect(addUnits(t, 'decade', 3).getUTCFullYear()).toBe(2056);
    // Years below 100 do not wrap into the 1900s.
    expect(addUnits(t, 'century', -20).getUTCFullYear()).toBe(26);
  });
  it('moves by fixed lengths for short units, fractions for the scrubber', () => {
    expect(addUnits(t, 'hour', -3).toISOString()).toBe('2026-01-31T17:15:00.000Z');
    expect(addUnits(t, 'week', 1).toISOString()).toBe('2026-02-07T20:15:00.000Z');
    const half = addUnits(t, 'year', 0.5).getTime() - t.getTime();
    expect(half / 86400_000).toBeCloseTo(182.6, 1);
  });
  it('describes scrubber offsets', () => {
    expect(describeOffset(3 * 3600_000)).toBe('+3 hours');
    expect(describeOffset(-45 * 86400_000)).toBe('−45 days');
    expect(describeOffset(5 * 365.2425 * 86400_000)).toBe('+5 years');
  });
});

describe('bridge mount links', () => {
  it('uses the same allow-lists as the page', () => {
    expect(links.SERIAL_READ).toEqual(SERIAL_READ);
    expect(links.SERIAL_CONTROL).toEqual(SERIAL_CONTROL);
    expect(links.INDI_CONTROL).toEqual([...INDI_CONTROL]);
    for (const c of [':GR#', ':MS#', ':Sr05:35:17#', ':hP#', ':St+13*02#'])
      for (const ctl of [false, true])
        expect(links.serialAllowed('lx200', c, ctl)).toBe(serialAllowed('lx200', c, ctl));
  });
  it('parses INDI property streams, sexagesimal numbers included, across chunks', () => {
    const xml =
      '<defNumberVector device="EQMod Mount" name="EQUATORIAL_EOD_COORD" state="Ok" perm="rw">' +
      '<defNumber name="RA" format="%010.6m">5:35:17</defNumber><defNumber name="DEC">-5.3911</defNumber></defNumberVector>' +
      '<setSwitchVector device="EQMod Mount" name="TELESCOPE_PARK" state="Ok"><oneSwitch name="PARK">Off</oneSwitch>' +
      '<oneSwitch name="UNPARK">On</oneSwitch></setSwitchVector><setNumberVector device="EQMod Mount" name="EQUA';
    const r = links.parseIndi(xml);
    expect(r.updates).toHaveLength(2);
    expect(r.updates[0]?.values.RA).toBeCloseTo(5.5881, 4);
    expect(r.updates[0]?.values.DEC).toBeCloseTo(-5.3911, 4);
    expect(r.updates[1]?.values.UNPARK).toBe('On');
    expect(r.rest.startsWith('<setNumberVector')).toBe(true);
    expect(links.indiNumber('-5 23 28')).toBeCloseTo(-5.3911, 4);
  });
  it('writes INDI change requests with escaped names', () => {
    expect(links.indiNew('My <Mount>', 'TELESCOPE_PARK', 'Switch', { PARK: 'On' })).toBe(
      '<newSwitchVector device="My &#60;Mount&#62;" name="TELESCOPE_PARK"><oneSwitch name="PARK">On</oneSwitch></newSwitchVector>\n',
    );
  });
  it('answers only the published app and local development across origins', () => {
    expect(bridge.corsOrigin('https://astro-night-planning-live.pages.dev')).toBe(
      'https://astro-night-planning-live.pages.dev',
    );
    expect(
      bridge.corsOrigin('https://redesign.astro-night-planning-live.pages.dev'),
    ).not.toBeNull();
    expect(bridge.corsOrigin('http://localhost:5173')).not.toBeNull();
    for (const o of [
      'https://evil.example',
      'https://astro-night-planning-live.pages.dev.evil.example',
      undefined,
    ])
      expect(bridge.corsOrigin(o)).toBeNull();
  });
});

describe('INDI mounts in the page', () => {
  const snap: IndiSnapshot = {
    connected: true,
    error: null,
    devices: {
      'CCD Simulator': {
        CCD_EXPOSURE: { kind: 'Number', state: 'Idle', values: { CCD_EXPOSURE_VALUE: 1 } },
      },
      'Telescope Simulator': {
        EQUATORIAL_EOD_COORD: {
          kind: 'Number',
          state: 'Busy',
          values: { RA: 5.5881, DEC: -5.3911 },
        },
        TELESCOPE_TRACK_STATE: {
          kind: 'Switch',
          state: 'Ok',
          values: { TRACK_ON: 'On', TRACK_OFF: 'Off' },
        },
        TELESCOPE_PARK: { kind: 'Switch', state: 'Ok', values: { PARK: 'Off', UNPARK: 'On' } },
        TELESCOPE_PIER_SIDE: {
          kind: 'Switch',
          state: 'Ok',
          values: { PIER_EAST: 'Off', PIER_WEST: 'On' },
        },
      },
    },
  };
  it('finds the mount and reads it', () => {
    expect(findMount(snap)).toBe('Telescope Simulator');
    const s = parseIndiMount(
      snap,
      'Telescope Simulator',
      { lat: 13, lon: 77.6 },
      new Date('2026-11-20T18:00:00Z'),
    );
    expect(s.epoch).toBe('JNow');
    expect(s.raNow).toBeCloseTo(83.82, 2);
    expect(s.slewing).toBe(true);
    expect(s.tracking).toBe(true);
    expect(s.atPark).toBe(false);
    expect(s.pier).toBe('west');
  });
});

describe('mount picker', () => {
  it('offers at least one route for every family, recommended first', () => {
    for (const m of MOUNTS) {
      expect(m.routes.length).toBeGreaterThan(0);
      for (const r of m.routes) expect(r.steps.length).toBeGreaterThan(1);
    }
    expect(MOUNTS.find((m) => m.id === 'zwo')?.routes[0]?.kind).toBe('serial');
    expect(MOUNTS.find((m) => m.id === 'ioptron')?.routes.some((r) => r.kind === 'serial')).toBe(
      false,
    );
  });
});
