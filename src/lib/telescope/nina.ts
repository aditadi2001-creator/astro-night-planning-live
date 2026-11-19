/**
 * NINA Advanced API v2 (plugin "Advanced API", default port 1888). Read: mount and rotator info.
 * Control: slew / sync / stop, which NINA takes in J2000 degrees (ninaAPI Mount.cs). Every path is
 * checked against the allow-list first, because NINA's actions are plain GET requests.
 */
import { ninaAllowed } from './allow';
import { nowToJ2000, j2000ToNow } from './coords';
import { localFetch } from './http';
import { TelescopeError, type MountState, type PierSide, type TelescopeAdapter } from './types';

interface Envelope<T> {
  Response: T;
  Error?: string;
  Success?: boolean;
  StatusCode?: number;
}

export interface NinaMountInfo {
  Connected?: boolean;
  RightAscension?: number;
  Declination?: number;
  Coordinates?: { RADegrees?: number; RA?: number; Dec?: number; Epoch?: string };
  Altitude?: number;
  Azimuth?: number;
  SideOfPier?: string;
  TrackingEnabled?: boolean;
  Slewing?: boolean;
  AtPark?: boolean;
  SiderealTime?: number;
  TimeToMeridianFlip?: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** NINA mount info → MountState (exported for tests). */
export function parseNinaMount(info: NinaMountInfo, date: Date): MountState {
  const c = info.Coordinates ?? {};
  const ra =
    num(c.RADegrees) ??
    (num(c.RA) != null ? (c.RA as number) * 15 : null) ??
    (num(info.RightAscension) != null ? (info.RightAscension as number) * 15 : null);
  const dec = num(c.Dec) ?? num(info.Declination);
  const epochRaw = (c.Epoch ?? '').toUpperCase();
  const epoch: MountState['epoch'] =
    epochRaw === 'J2000' ? 'J2000' : epochRaw === 'JNOW' ? 'JNow' : 'unknown';
  let ra2000 = ra ?? 0;
  let dec2000 = dec ?? 0;
  let raNow = ra2000;
  let decNow = dec2000;
  if (ra != null && dec != null) {
    if (epoch === 'J2000') ({ ra: raNow, dec: decNow } = j2000ToNow(ra, dec, date));
    else ({ ra: ra2000, dec: dec2000 } = nowToJ2000(ra, dec, date));
  }
  const pier: PierSide =
    info.SideOfPier === 'pierEast' ? 'east' : info.SideOfPier === 'pierWest' ? 'west' : 'unknown';
  const flip = num(info.TimeToMeridianFlip);
  return {
    connected: info.Connected === true && ra != null && dec != null,
    ra2000,
    dec2000,
    raNow,
    decNow,
    epoch,
    alt: num(info.Altitude),
    az: num(info.Azimuth),
    pier,
    tracking: typeof info.TrackingEnabled === 'boolean' ? info.TrackingEnabled : null,
    slewing: info.Slewing === true,
    atPark: typeof info.AtPark === 'boolean' ? info.AtPark : null,
    lstH: num(info.SiderealTime),
    // Reported in hours (ninaAPI docs); negative or huge values mean "no flip planned".
    flipInH: flip != null && flip >= 0 && flip < 24 ? flip : null,
    rotatorDeg: null,
    at: date.getTime(),
  };
}

export function ninaAdapter(opts: {
  /** e.g. "http://192.168.1.20:1888/v2/api", or "/nina" through the bridge. */
  base: string;
  label: string;
  control: () => boolean;
}): TelescopeAdapter {
  const base = opts.base.replace(/\/+$/, '');
  async function call<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal) {
    if (!ninaAllowed(path, opts.control()))
      throw new TelescopeError(
        `Blocked: ${path} is not on the allow-list.`,
        'Switch on "Enable control" first.',
      );
    const q = new URLSearchParams(params).toString();
    const r = await localFetch(
      `${base}${path}${q ? `?${q}` : ''}`,
      {},
      opts.label,
      signal,
      4000,
      'Is NINA open with the Advanced API plugin switched on (port 1888)?',
    );
    const j = (await r.json()) as Envelope<T>;
    if (j.Success === false)
      throw new TelescopeError(
        `${opts.label}: ${j.Error || 'request failed'}.`,
        'See NINA for details.',
      );
    return j.Response;
  }
  return {
    kind: 'nina',
    label: opts.label,
    async read(signal) {
      const info = await call<NinaMountInfo>('/equipment/mount/info', {}, signal);
      const s = parseNinaMount(info, new Date());
      if (!info.Connected)
        throw new TelescopeError(
          'NINA is running, but no mount is connected in it.',
          'Connect the mount in NINA (Equipment → Mount).',
        );
      try {
        const rot = await call<{ Connected?: boolean; Position?: number }>(
          '/equipment/rotator/info',
          {},
          signal,
        );
        if (rot.Connected) s.rotatorDeg = num(rot.Position);
      } catch {
        /* no rotator: fine */
      }
      return s;
    },
    async slew(ra, dec) {
      await call('/equipment/mount/slew', {
        ra: ra.toFixed(6),
        dec: dec.toFixed(6),
        waitForResult: 'false',
      });
    },
    async sync(ra, dec) {
      await call('/equipment/mount/sync', { ra: ra.toFixed(6), dec: dec.toFixed(6) });
    },
    async stop() {
      await call('/equipment/mount/slew/stop');
    },
  };
}
