import { describe, expect, it } from 'vitest';
import { parseSequenceTargets } from '../src/lib/telescope/nina';
import {
  lx200Dec,
  lx200Ra,
  nexHex,
  parseLx200Dec,
  parseLx200Ra,
  parseNexPrecise,
  serialAdapter,
  serialAllowed,
  type Wire,
} from '../src/lib/telescope/serial';
import { gotoCheck } from '../src/lib/telescope/safety';
import { simulatorAdapter } from '../src/lib/telescope/simulator';
import { j2000ToNow } from '../src/lib/telescope/coords';

describe('LX200 serial protocol', () => {
  it('formats and reads coordinates both ways', () => {
    expect(lx200Ra(83.8221)).toBe('05:35:17');
    expect(lx200Dec(-5.3911)).toBe('-05*23:28');
    expect(lx200Dec(41.269)).toBe('+41*16:08');
    expect(parseLx200Ra('05:35:17#')).toBeCloseTo(83.8208, 3);
    expect(parseLx200Ra('05:35.3#')).toBeCloseTo(83.825, 3);
    expect(parseLx200Dec('-05*23:28#')).toBeCloseTo(-5.3911, 3);
    expect(parseLx200Dec("+41ß16'08#")).toBeCloseTo(41.2689, 3);
    expect(parseLx200Dec('+41*16#')).toBeCloseTo(41.2667, 3);
    expect(parseLx200Ra('garbage')).toBeNull();
  });
});

describe('NexStar / SynScan serial protocol', () => {
  it('encodes positions as fractions of a turn', () => {
    expect(nexHex(0)).toBe('00000000');
    expect(nexHex(180)).toBe('80000000');
    expect(nexHex(-90)).toBe('C0000000');
    const p = parseNexPrecise('34AB0500,12CE0500#');
    expect(p?.ra).toBeCloseTo(74.064, 3);
    expect(p?.dec).toBeCloseTo((0x12ce0500 / 2 ** 32) * 360, 6);
    expect(parseNexPrecise('C0000000,F0000000#')?.dec).toBeCloseTo(-22.5, 6);
  });
});

/** A pretend LX200 mount answering on the "wire". */
function fakeLx200() {
  const sent: string[] = [];
  let ra = '05:35:17#';
  let dec = '-05*23:28#';
  const wire: Wire = {
    send(cmd) {
      sent.push(cmd);
      if (cmd === ':GR#') return Promise.resolve(ra);
      if (cmd === ':GD#') return Promise.resolve(dec);
      if (cmd === ':D#') return Promise.resolve('#');
      if (cmd.startsWith(':Sr')) {
        ra = `${cmd.slice(3, -1)}#`;
        return Promise.resolve('1');
      }
      if (cmd.startsWith(':Sd')) {
        dec = `${cmd.slice(3, -1)}#`;
        return Promise.resolve('1');
      }
      if (cmd === ':MS#') return Promise.resolve('0');
      return Promise.resolve('');
    },
  };
  return { wire, sent };
}

describe('serial adapter', () => {
  const site = { lat: 13.04, lon: 77.57 };
  it('reads the position and converts JNow to J2000', async () => {
    const { wire } = fakeLx200();
    const a = serialAdapter({ wire, protocol: 'lx200', j2000: false, site, control: () => false });
    const s = await a.read();
    expect(s.epoch).toBe('JNow');
    expect(s.raNow).toBeCloseTo(83.8208, 3);
    // Precession over ~27 years moves Orion by a few arcminutes.
    expect(Math.abs(s.ra2000 - s.raNow)).toBeGreaterThan(0.1);
    expect(Math.abs(s.ra2000 - s.raNow)).toBeLessThan(0.5);
  });
  it('refuses control commands until control is on, then slews in the mount epoch', async () => {
    const { wire, sent } = fakeLx200();
    let control = false;
    const a = serialAdapter({
      wire,
      protocol: 'lx200',
      j2000: false,
      site,
      control: () => control,
    });
    await expect(a.slew(10.6847, 41.269)).rejects.toThrow(/Blocked/);
    expect(sent.some((c) => c.startsWith(':Sr'))).toBe(false);
    control = true;
    await a.slew(10.6847, 41.269);
    const now = j2000ToNow(10.6847, 41.269, new Date());
    expect(sent).toContain(`:Sr${lx200Ra(now.ra)}#`);
    expect(sent).toContain(':MS#');
  });
  it('only ever sends listed commands', () => {
    expect(serialAllowed('lx200', ':GR#', false)).toBe(true);
    expect(serialAllowed('lx200', ':MS#', false)).toBe(false);
    expect(serialAllowed('lx200', ':MS#', true)).toBe(true);
    // Not on any list: set site, set time, park, reset.
    for (const c of [':St+13*02#', ':SL12:00:00#', ':hP#', ':RS#'])
      expect(serialAllowed('lx200', c, true)).toBe(false);
    expect(serialAllowed('nexstar', 'e', false)).toBe(true);
    expect(serialAllowed('nexstar', 'r00000000,00000000', false)).toBe(false);
    expect(serialAllowed('nexstar', 'W\x0d\x02\x1b\x00', true)).toBe(false);
  });
});

describe('NINA sequence targets', () => {
  it('finds target containers depth first, with names and coordinates', () => {
    const json = [
      { GlobalTriggers: [] },
      { Name: 'Start_Container', Items: [] },
      {
        Name: 'Targets_Container',
        Items: [
          {
            Name: 'M 31_Container',
            Target: {
              TargetName: 'M 31',
              InputCoordinates: { Coordinates: { RA: 0.7123, Dec: 41.27 } },
              PositionAngle: 35,
            },
            Items: [],
          },
          {
            Name: 'Second_Container',
            Target: { TargetName: '', InputCoordinates: { RAHours: 5, RAMinutes: 35, Dec: -5 } },
            Items: [],
          },
        ],
      },
    ];
    const t = parseSequenceTargets(json);
    expect(t.map((x) => x.name)).toEqual(['M 31', 'Second']);
    expect(t[0]?.index).toBe(0);
    expect(t[0]?.ra).toBeCloseTo(10.68, 1);
    expect(t[1]?.ra).toBeCloseTo(83.75, 2);
    expect(parseSequenceTargets({ nothing: true })).toEqual([]);
  });
});

describe('GoTo safety checks', () => {
  const base = { alt: 50, horizonAlt: 0, sunSepDeg: 90, sunAlt: -30, haH: -2, solarFilter: false };
  it('refuses near the Sun without a filter and below the horizon', () => {
    expect(gotoCheck(base).blocked).toBeNull();
    const sun = gotoCheck({ ...base, sunSepDeg: 8, sunAlt: 20 });
    expect(sun.blocked).toMatch(/Sun/);
    expect(sun.needsSolarFilter).toBe(true);
    expect(gotoCheck({ ...base, sunSepDeg: 8, sunAlt: 20, solarFilter: true }).blocked).toBeNull();
    // At night the Sun is far below: no solar block.
    expect(gotoCheck({ ...base, sunSepDeg: 8, sunAlt: -30 }).blocked).toBeNull();
    expect(gotoCheck({ ...base, alt: -5 }).blocked).toMatch(/below the horizon/);
  });
  it('warns about the user horizon and the meridian', () => {
    expect(gotoCheck({ ...base, alt: 20, horizonAlt: 25 }).warnings.join(' ')).toMatch(/horizon/);
    expect(gotoCheck({ ...base, haH: -0.1 }).warnings.join(' ')).toMatch(/meridian in 6 min/);
  });
});

describe('simulator park and tracking', () => {
  it('parks, unparks, and drifts when tracking stops', async () => {
    let t = new Date('2026-11-20T15:00:00Z');
    const a = simulatorAdapter({ lat: 13.04, lon: 77.57 }, () => t);
    expect((await a.read()).atPark).toBe(true);
    await a.unpark?.();
    await a.slew(83.82, -5.39);
    t = new Date(t.getTime() + 120_000);
    const s1 = await a.read();
    expect(s1.tracking).toBe(true);
    expect(s1.ra2000).toBeCloseTo(83.82, 2);
    await a.setTracking?.(false);
    t = new Date(t.getTime() + 600_000);
    const s2 = await a.read();
    expect(s2.tracking).toBe(false);
    // Ten minutes without tracking: the RA pointed at moves by about 2.5°.
    expect(s2.ra2000 - s1.ra2000).toBeCloseTo(2.5, 0);
    await a.park?.();
    expect((await a.read()).atPark).toBe(true);
  });
});
