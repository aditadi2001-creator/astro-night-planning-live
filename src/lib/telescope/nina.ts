/**
 * NINA Advanced API v2 (plugin "Advanced API" 2.2.x, NINA 3.2+, default port 1888).
 * Read: mount and rotator info, the loaded sequence's target containers, saved sequences.
 * Control: slew (optionally plate-solve "centre" and rotate), sync, stop, park, tracking,
 * set a sequence target, load a sequence, send to the framing assistant. NINA takes J2000
 * degrees (ninaAPI Mount.cs; Sequence.cs SequenceSetTarget: Angle.ByDegree, Epoch.J2000,
 * rotation → Target.PositionAngle). Every path is checked against the allow-list first,
 * because NINA's actions are plain GET requests.
 */
import { ninaAllowed } from './allow';
import { nowToJ2000, j2000ToNow } from './coords';
import { localFetch } from './http';
import {
  TelescopeError,
  type MountState,
  type PierSide,
  type SequenceTarget,
  type TelescopeAdapter,
} from './types';

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

/**
 * The target containers in NINA's /sequence/json reply, in the order set-target indexes them
 * (depth first, as NINA's GetAllTargetsInAdvancedSequence walks the tree). A container is any
 * node whose "Target" object carries a TargetName (the plugin adds it by reflection). Coordinates
 * are read when present (InputCoordinates RA hours / Dec degrees, or RADegrees). Exported for tests.
 */
export function parseSequenceTargets(json: unknown): SequenceTarget[] {
  const out: SequenceTarget[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const t = o.Target as Record<string, unknown> | undefined;
    if (t && typeof t === 'object' && ('TargetName' in t || 'InputCoordinates' in t)) {
      const ic = (t.InputCoordinates ?? {}) as Record<string, unknown>;
      const c = (ic.Coordinates ?? ic) as Record<string, unknown>;
      const raDeg =
        num(c.RADegrees) ??
        (num(c.RA) != null ? (c.RA as number) * 15 : null) ??
        (num(ic.RAHours) != null
          ? ((ic.RAHours as number) +
              (num(ic.RAMinutes) ?? 0) / 60 +
              (num(ic.RASeconds) ?? 0) / 3600) *
            15
          : null);
      const dec = num(c.Dec) ?? num(ic.Dec);
      out.push({
        index: out.length,
        name:
          (typeof t.TargetName === 'string' && t.TargetName) ||
          (typeof o.Name === 'string' ? o.Name.replace(/_Container$/, '') : '') ||
          `Target ${out.length + 1}`,
        ra: raDeg,
        dec,
      });
    }
    for (const k of ['Items', 'Response']) if (k in o) walk(o[k]);
  };
  walk(json);
  return out;
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
    caps: {
      centre: true,
      rotate: true,
      park: true,
      tracking: true,
      sequence: true,
      framing: true,
    },
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
    async slew(ra, dec, o = {}) {
      const p: Record<string, string> = {
        ra: ra.toFixed(6),
        dec: dec.toFixed(6),
        waitForResult: 'false',
      };
      // "center": NINA slews, takes an exposure, plate-solves and re-slews until the target is
      // within its centring tolerance. "rotate" also turns the rotator to the position angle.
      if (o.rotatePa != null) {
        p.rotate = 'true';
        p.rotationAngle = (((o.rotatePa % 360) + 360) % 360).toFixed(2);
      } else if (o.centre) p.center = 'true';
      await call('/equipment/mount/slew', p);
    },
    async park() {
      await call('/equipment/mount/park');
    },
    async unpark() {
      await call('/equipment/mount/unpark');
    },
    async setTracking(on) {
      // 0 sidereal … 4 stopped (ninaAPI api_spec.yaml).
      await call('/equipment/mount/tracking', { mode: on ? '0' : '4' });
    },
    async sequenceTargets(signal) {
      return parseSequenceTargets(await call<unknown>('/sequence/json', {}, signal));
    },
    async setSequenceTarget(index, name, ra, dec, pa) {
      await call('/sequence/set-target', {
        name: name.slice(0, 80),
        ra: ra.toFixed(6),
        dec: dec.toFixed(6),
        rotation: (((pa % 360) + 360) % 360).toFixed(2),
        index: String(index),
      });
    },
    async listSequences(signal) {
      const r = await call<unknown>('/sequence/list-available', {}, signal);
      return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
    },
    async loadSequence(name) {
      await call('/sequence/load', { sequenceName: name });
    },
    async toFraming(ra, dec, pa) {
      await call('/framing/set-coordinates', { RAangle: ra.toFixed(6), DecAngle: dec.toFixed(6) });
      await call('/framing/set-rotation', { rotation: (((pa % 360) + 360) % 360).toFixed(2) });
    },
    async sync(ra, dec) {
      await call('/equipment/mount/sync', { ra: ra.toFixed(6), dec: dec.toFixed(6) });
    },
    async stop() {
      await call('/equipment/mount/slew/stop');
    },
  };
}
