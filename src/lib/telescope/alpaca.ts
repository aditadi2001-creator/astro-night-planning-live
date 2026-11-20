/**
 * ASCOM Alpaca telescope (any Alpaca device, or ASCOM Remote on port 11111). Read via
 * `devicestate` (one request, Platform 7) with a fallback to the single properties. HTTP 200 is
 * not success unless ErrorNumber is 0. RA is in hours in the mount's own equatorial system.
 */
import { alpacaAllowed } from './allow';
import { j2000ToNow, nowToJ2000 } from './coords';
import { localFetch } from './http';
import {
  NO_CAPS,
  TelescopeError,
  type MountState,
  type PierSide,
  type TelescopeAdapter,
} from './types';

interface AlpacaReply<T> {
  Value: T;
  ErrorNumber: number;
  ErrorMessage: string;
}

export interface AlpacaValues {
  RightAscension?: number;
  Declination?: number;
  Altitude?: number;
  Azimuth?: number;
  SideOfPier?: number;
  Tracking?: boolean;
  Slewing?: boolean;
  AtPark?: boolean;
  SiderealTime?: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Alpaca values → MountState (exported for tests). `system`: Alpaca EquatorialSystem
 * (1 = topocentric / JNow, 2 = J2000, others treated as JNow and marked unknown).
 */
export function parseAlpaca(v: AlpacaValues, system: number, date: Date): MountState {
  const raH = num(v.RightAscension);
  const dec = num(v.Declination);
  const epoch: MountState['epoch'] = system === 2 ? 'J2000' : system === 1 ? 'JNow' : 'unknown';
  let ra2000 = 0;
  let dec2000 = 0;
  let raNow = 0;
  let decNow = 0;
  if (raH != null && dec != null) {
    const ra = raH * 15;
    if (epoch === 'J2000') {
      ra2000 = ra;
      dec2000 = dec;
      ({ ra: raNow, dec: decNow } = j2000ToNow(ra, dec, date));
    } else {
      raNow = ra;
      decNow = dec;
      ({ ra: ra2000, dec: dec2000 } = nowToJ2000(ra, dec, date));
    }
  }
  const pier: PierSide = v.SideOfPier === 0 ? 'east' : v.SideOfPier === 1 ? 'west' : 'unknown';
  return {
    connected: raH != null && dec != null,
    ra2000,
    dec2000,
    raNow,
    decNow,
    epoch,
    alt: num(v.Altitude),
    az: num(v.Azimuth),
    pier,
    tracking: typeof v.Tracking === 'boolean' ? v.Tracking : null,
    slewing: v.Slewing === true,
    atPark: typeof v.AtPark === 'boolean' ? v.AtPark : null,
    lstH: num(v.SiderealTime),
    flipInH: null,
    rotatorDeg: null,
    at: date.getTime(),
  };
}

export function alpacaAdapter(opts: {
  /** e.g. "http://192.168.1.20:11111/api/v1", or "/alpaca" through the bridge. */
  base: string;
  device: number;
  label: string;
  control: () => boolean;
}): TelescopeAdapter {
  const base = `${opts.base.replace(/\/+$/, '')}/telescope/${opts.device}`;
  const clientId = 1 + Math.floor(Math.random() * 60000);
  let tx = 0;
  let system: number | null = null;
  let hasDeviceState = true;

  async function get<T>(method: string, signal?: AbortSignal): Promise<T> {
    if (!alpacaAllowed(method, opts.control()))
      throw new TelescopeError(
        `Blocked: ${method} is not on the allow-list.`,
        'Switch on "Enable control" first.',
      );
    const q = `ClientID=${clientId}&ClientTransactionID=${++tx}`;
    const r = await localFetch(
      `${base}/${method}?${q}`,
      {},
      opts.label,
      signal,
      4000,
      'Is ASCOM Remote (or the Alpaca device) running, with cross-origin requests allowed in its settings?',
    );
    const j = (await r.json()) as AlpacaReply<T>;
    if (j.ErrorNumber)
      throw new TelescopeError(
        `${opts.label}: ${j.ErrorMessage || `error ${j.ErrorNumber}`}.`,
        'See the ASCOM driver for details.',
      );
    return j.Value;
  }
  async function put(method: string, params: Record<string, string>) {
    if (!alpacaAllowed(method, opts.control(), 'PUT'))
      throw new TelescopeError(
        `Blocked: ${method} is not on the allow-list.`,
        'Switch on "Enable control" first.',
      );
    const body = new URLSearchParams({
      ...params,
      ClientID: String(clientId),
      ClientTransactionID: String(++tx),
    });
    const r = await localFetch(
      `${base}/${method}`,
      { method: 'PUT', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      opts.label,
    );
    const j = (await r.json()) as AlpacaReply<unknown>;
    if (j.ErrorNumber)
      throw new TelescopeError(
        `${opts.label}: ${j.ErrorMessage || `error ${j.ErrorNumber}`}.`,
        'See the ASCOM driver for details.',
      );
  }
  /** Target in the mount's own system. */
  function toMount(ra2000: number, dec2000: number) {
    const p = system === 2 ? { ra: ra2000, dec: dec2000 } : j2000ToNow(ra2000, dec2000, new Date());
    return { RightAscension: (p.ra / 15).toFixed(6), Declination: p.dec.toFixed(6) };
  }

  return {
    kind: 'alpaca',
    label: opts.label,
    caps: { ...NO_CAPS, park: true, tracking: true },
    async read(signal) {
      if (!(await get<boolean>('connected', signal)))
        throw new TelescopeError(
          'The Alpaca telescope is not connected.',
          'Connect it in its driver or ASCOM Remote.',
        );
      system ??= await get<number>('equatorialsystem', signal).catch(() => 1);
      let v: AlpacaValues = {};
      if (hasDeviceState) {
        try {
          const list = await get<{ Name: string; Value: unknown }[]>('devicestate', signal);
          v = Object.fromEntries(list.map((x) => [x.Name, x.Value])) as AlpacaValues;
        } catch (e) {
          if (signal?.aborted) throw e;
          hasDeviceState = false;
        }
      }
      if (!hasDeviceState) {
        const names = [
          'rightascension',
          'declination',
          'altitude',
          'azimuth',
          'sideofpier',
          'tracking',
          'slewing',
          'atpark',
          'siderealtime',
        ] as const;
        const keys = [
          'RightAscension',
          'Declination',
          'Altitude',
          'Azimuth',
          'SideOfPier',
          'Tracking',
          'Slewing',
          'AtPark',
          'SiderealTime',
        ] as const;
        const vals = await Promise.all(
          names.map((n) => get<unknown>(n, signal).catch(() => undefined)),
        );
        v = Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as AlpacaValues;
      }
      return parseAlpaca(v, system, new Date());
    },
    async slew(ra, dec) {
      await put('slewtocoordinatesasync', toMount(ra, dec));
    },
    async sync(ra, dec) {
      await put('synctocoordinates', toMount(ra, dec));
    },
    async stop() {
      await put('abortslew', {});
    },
    async park() {
      await put('park', {});
    },
    async unpark() {
      await put('unpark', {});
    },
    async setTracking(on) {
      await put('tracking', { Tracking: on ? 'True' : 'False' });
    },
  };
}
