/**
 * INDI mounts (indiserver on Linux, Raspberry Pi, StellarMate, Astroberry, KStars/Ekos: hundreds
 * of mount drivers) through the bridge, which holds the INDI connection (browsers cannot open
 * raw TCP sockets). Standard INDI telescope properties: EQUATORIAL_EOD_COORD (RA hours, Dec
 * degrees, of date), ON_COORD_SET (TRACK / SLEW / SYNC), TELESCOPE_ABORT_MOTION,
 * TELESCOPE_PARK, TELESCOPE_TRACK_STATE, TELESCOPE_PIER_SIDE.
 */
import { j2000ToNow, localSiderealH, nowToJ2000 } from './coords';
import { localFetch } from './http';
import {
  NO_CAPS,
  TelescopeError,
  type MountState,
  type PierSide,
  type TelescopeAdapter,
} from './types';

/** Properties the page may change (the bridge keeps the same list: tools/bridge/mounts.mjs). */
export const INDI_CONTROL = [
  'EQUATORIAL_EOD_COORD',
  'ON_COORD_SET',
  'TELESCOPE_ABORT_MOTION',
  'TELESCOPE_PARK',
  'TELESCOPE_TRACK_STATE',
] as const;

interface Prop {
  kind: string;
  state: string | null;
  values: Record<string, number | string | null>;
}
export interface IndiSnapshot {
  connected: boolean;
  error: string | null;
  devices: Record<string, Record<string, Prop>>;
}

/** The first device that looks like a telescope (has equatorial coordinates of date). */
export function findMount(s: IndiSnapshot): string | null {
  return (
    Object.keys(s.devices).find((d) => s.devices[d]?.EQUATORIAL_EOD_COORD) ??
    Object.keys(s.devices).find((d) => s.devices[d]?.EQUATORIAL_COORD) ??
    null
  );
}

const on = (p: Prop | undefined, name: string) => p?.values[name] === 'On';
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** INDI snapshot → MountState (exported for tests). */
export function parseIndiMount(
  s: IndiSnapshot,
  device: string,
  site: { lat: number; lon: number },
  date: Date,
): MountState {
  const d = s.devices[device] ?? {};
  const eod = d.EQUATORIAL_EOD_COORD;
  const j2k = d.EQUATORIAL_COORD;
  const raH = n(eod?.values.RA) ?? n(j2k?.values.RA);
  const dec = n(eod?.values.DEC) ?? n(j2k?.values.DEC);
  const isJ2000 = !eod && !!j2k;
  let ra2000 = 0;
  let dec2000 = 0;
  let raNow = 0;
  let decNow = 0;
  if (raH != null && dec != null) {
    if (isJ2000) {
      ra2000 = raH * 15;
      dec2000 = dec;
      ({ ra: raNow, dec: decNow } = j2000ToNow(ra2000, dec2000, date));
    } else {
      raNow = raH * 15;
      decNow = dec;
      ({ ra: ra2000, dec: dec2000 } = nowToJ2000(raNow, decNow, date));
    }
  }
  const hor = d.HORIZONTAL_COORD;
  const pierP = d.TELESCOPE_PIER_SIDE;
  const pier: PierSide = on(pierP, 'PIER_EAST')
    ? 'east'
    : on(pierP, 'PIER_WEST')
      ? 'west'
      : 'unknown';
  const track = d.TELESCOPE_TRACK_STATE;
  const park = d.TELESCOPE_PARK;
  return {
    connected: s.connected && raH != null && dec != null,
    ra2000,
    dec2000,
    raNow,
    decNow,
    epoch: isJ2000 ? 'J2000' : 'JNow',
    alt: n(hor?.values.ALT),
    az: n(hor?.values.AZ),
    pier,
    tracking: track ? on(track, 'TRACK_ON') : null,
    // INDI marks a property "Busy" while the driver works on it: a GoTo in progress.
    slewing: eod?.state === 'Busy' || j2k?.state === 'Busy',
    atPark: park ? on(park, 'PARK') : null,
    lstH: localSiderealH(date, site.lon),
    flipInH: null,
    rotatorDeg: null,
    at: date.getTime(),
  };
}

export function indiAdapter(opts: {
  /** The bridge's origin path (same origin as the page). */
  base: string;
  site: { lat: number; lon: number };
  control: () => boolean;
}): TelescopeAdapter {
  const label = 'INDI (through the bridge)';
  let device: string | null = null;
  async function snapshot(signal?: AbortSignal): Promise<IndiSnapshot> {
    const r = await localFetch(
      `${opts.base}/mount/indi`,
      {},
      label,
      signal,
      4000,
      'Is the bridge running with --indi host:7624, and indiserver (or KStars/Ekos) running?',
    );
    const j = (await r.json()) as IndiSnapshot & { error?: string };
    if (!r.ok)
      throw new TelescopeError(`INDI: ${j.error ?? `HTTP ${r.status}`}.`, 'Check the bridge.');
    return j;
  }
  async function send(
    name: (typeof INDI_CONTROL)[number],
    kind: 'Number' | 'Switch',
    values: Record<string, string>,
  ) {
    if (!opts.control())
      throw new TelescopeError(
        `Blocked: ${name} needs control.`,
        'Switch on "Enable control" first.',
      );
    if (!device)
      throw new TelescopeError('No INDI mount found yet.', 'Connect the mount in INDI/Ekos.');
    const r = await localFetch(
      `${opts.base}/mount/indi`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, name, kind, values }),
      },
      label,
    );
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new TelescopeError(
        `INDI: ${j.error ?? `HTTP ${r.status}`}.`,
        'Start the bridge with --allow-control to allow commands.',
      );
    }
  }
  const coords = (ra: number, dec: number) => {
    const p = j2000ToNow(ra, dec, new Date());
    return { RA: (p.ra / 15).toFixed(6), DEC: p.dec.toFixed(6) };
  };
  return {
    kind: 'indi',
    label,
    caps: { ...NO_CAPS, park: true, tracking: true },
    async read(signal) {
      const s = await snapshot(signal);
      if (!s.connected)
        throw new TelescopeError(
          `The bridge cannot reach indiserver${s.error ? ` (${s.error})` : ''}.`,
          'Start indiserver (or KStars/Ekos) with your mount driver.',
        );
      device ??= findMount(s);
      if (!device)
        throw new TelescopeError(
          'indiserver is running, but no mount driver reports coordinates.',
          'Connect the mount in INDI/Ekos (Connection → Connect).',
        );
      return parseIndiMount(s, device, opts.site, new Date());
    },
    async slew(ra, dec) {
      await send('ON_COORD_SET', 'Switch', { TRACK: 'On', SLEW: 'Off', SYNC: 'Off' });
      await send('EQUATORIAL_EOD_COORD', 'Number', coords(ra, dec));
    },
    async sync(ra, dec) {
      await send('ON_COORD_SET', 'Switch', { TRACK: 'Off', SLEW: 'Off', SYNC: 'On' });
      await send('EQUATORIAL_EOD_COORD', 'Number', coords(ra, dec));
    },
    async stop() {
      await send('TELESCOPE_ABORT_MOTION', 'Switch', { ABORT: 'On' });
    },
    async park() {
      await send('TELESCOPE_PARK', 'Switch', { PARK: 'On', UNPARK: 'Off' });
    },
    async unpark() {
      await send('TELESCOPE_PARK', 'Switch', { PARK: 'Off', UNPARK: 'On' });
    },
    async setTracking(onOff) {
      await send('TELESCOPE_TRACK_STATE', 'Switch', {
        TRACK_ON: onOff ? 'On' : 'Off',
        TRACK_OFF: onOff ? 'Off' : 'On',
      });
    },
  };
}

/** A "wire" to a Wi-Fi / Ethernet mount through the bridge (LX200 or NexStar commands). */
export function bridgeWire(base: string) {
  return {
    async send(cmd: string, reply: { chars?: number; none?: boolean } = {}): Promise<string> {
      const r = await localFetch(
        `${base}/mount/tcp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, ...reply }),
        },
        'the mount (through the bridge)',
        undefined,
        5000,
        'Is the bridge running with --tcp <mount address>:<port>, and the mount on the same network?',
      );
      const j = (await r.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!r.ok || j.reply == null)
        throw new TelescopeError(
          `Mount: ${j.error ?? `HTTP ${r.status}`}.`,
          r.status === 403
            ? 'Start the bridge with --allow-control to allow commands.'
            : 'Check the mount address and protocol.',
        );
      return j.reply;
    },
  };
}
