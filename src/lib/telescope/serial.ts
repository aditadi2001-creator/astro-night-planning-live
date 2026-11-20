/**
 * Direct connection to a GoTo mount's hand controller over USB/serial (Web Serial API: Chrome
 * and Edge on a computer). Two protocols cover most mounts:
 *  - LX200 (Meade LX200/Autostar, OnStep, many others): ":GR#" ":GD#" ":Sr…#" ":Sd…#" ":MS#"
 *    ":CM#" ":Q#" ":D#".
 *  - NexStar (Celestron NexStar/StarSense hand controllers, and Sky-Watcher SynScan hand
 *    controllers, which use the same serial commands): "e" "r" "s" "L" "M" "t" "T".
 * Both run at 9600 baud and report RA/Dec of date (JNow) unless the mount is set to J2000.
 * Only the commands listed in SERIAL_READ / SERIAL_CONTROL are ever sent; control commands need
 * "Enable control" (CLAUDE.md rule 8), checked here as well as in the UI.
 */
import { altAzNow, j2000ToNow, localSiderealH, nowToJ2000 } from './coords';
import {
  NO_CAPS,
  TelescopeError,
  type MountState,
  type PierSide,
  type TelescopeAdapter,
} from './types';

export type SerialProtocol = 'lx200' | 'nexstar';

/** Every command the app may send, by protocol (the first characters of the command). */
export const SERIAL_READ: Record<SerialProtocol, readonly string[]> = {
  lx200: [':GR#', ':GD#', ':D#'],
  nexstar: ['Kx', 'e', 'L', 't'],
};
export const SERIAL_CONTROL: Record<SerialProtocol, readonly string[]> = {
  lx200: [':Sr', ':Sd', ':MS#', ':CM#', ':Q#'],
  nexstar: ['r', 's', 'M', 'T'],
};

/** Is this command allowed (reads always, control only with control on)? Exported for tests. */
export function serialAllowed(p: SerialProtocol, cmd: string, control: boolean): boolean {
  if (SERIAL_READ[p].some((c) => (c.endsWith('#') ? cmd === c : cmd.startsWith(c)))) return true;
  return (
    control && SERIAL_CONTROL[p].some((c) => (c.endsWith('#') ? cmd === c : cmd.startsWith(c)))
  );
}

// ---- LX200 ---------------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** RA degrees → "HH:MM:SS" (high precision). */
export function lx200Ra(raDeg: number): string {
  let s = Math.round((((raDeg % 360) + 360) % 360) * 240); // seconds of time
  s %= 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
/** Dec degrees → "sDD*MM:SS". */
export function lx200Dec(dec: number): string {
  const sign = dec < 0 ? '-' : '+';
  const s = Math.round(Math.min(90, Math.abs(dec)) * 3600);
  return `${sign}${pad(Math.floor(s / 3600))}*${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
/** "HH:MM:SS#" or "HH:MM.T#" → degrees (null when unreadable). */
export function parseLx200Ra(r: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?)|\.(\d))#?$/.exec(r.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]) + (m[4] != null ? Number(m[4]) / 10 : 0);
  const sec = m[3] != null ? Number(m[3]) : 0;
  return (h + min / 60 + sec / 3600) * 15;
}
/** "sDD*MM:SS#", "sDD*MM'SS#", "sDD°MM#" (any separator) → degrees. */
export function parseLx200Dec(r: string): number | null {
  const m = /^([+-]?)(\d{1,2})\D(\d{1,2})(?:\D(\d{1,2}))?#?$/.exec(r.trim());
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + (m[4] != null ? Number(m[4]) / 3600 : 0);
  return m[1] === '-' ? -v : v;
}

// ---- NexStar ---------------------------------------------------------------------------------

/** Degrees → 32-bit fraction of a turn, 8 hex digits (the low byte zero, as the HC sends it). */
export function nexHex(deg: number): string {
  const f = (((deg % 360) + 360) % 360) / 360;
  const v = Math.round(f * 2 ** 24) % 2 ** 24;
  return (v.toString(16).toUpperCase().padStart(6, '0') + '00').slice(0, 8);
}
/** "RRRRRRRR,DDDDDDDD#" → RA/Dec degrees (Dec above 180° is negative). */
export function parseNexPrecise(r: string): { ra: number; dec: number } | null {
  const m = /^([0-9A-Fa-f]{8}),([0-9A-Fa-f]{8})#?$/.exec(r.trim());
  if (!m) return null;
  const ra = (parseInt(m[1] as string, 16) / 2 ** 32) * 360;
  let dec = (parseInt(m[2] as string, 16) / 2 ** 32) * 360;
  if (dec > 180) dec -= 360;
  return { ra, dec };
}

// ---- the serial link -----------------------------------------------------------------------

/** Minimal Web Serial types (not in TypeScript's DOM library). */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(o?: object): Promise<SerialPortLike>;
}
export const serialSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

/** One command at a time; replies end with "#" (or are one character for some LX200 sets). */
export class SerialLink {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buf = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private port: SerialPortLike) {}

  /** Ask the user to pick the port (must run inside a click), then open it at 9600 baud. */
  static async pick(): Promise<SerialLink> {
    if (!serialSupported())
      throw new TelescopeError(
        'This browser cannot open serial ports.',
        'Use Chrome or Edge on a computer, or connect through NINA or ASCOM instead.',
      );
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    let port: SerialPortLike;
    try {
      port = await serial.requestPort();
    } catch {
      throw new TelescopeError('No port was chosen.', 'Plug in the mount and pick its port.');
    }
    await port.open({ baudRate: 9600 }).catch((e: unknown) => {
      throw new TelescopeError(
        `The port could not be opened (${(e as Error).message}).`,
        'Close other programs using it (NINA, the ASCOM driver, SynScan) and try again.',
      );
    });
    return new SerialLink(port);
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
    } catch {
      /* already closed */
    }
    this.reader = null;
    await this.port.close().catch(() => undefined);
  }

  /** Send `cmd`; read until "#" (or `chars` characters when given). */
  send(cmd: string, reply: { chars?: number; none?: boolean } = {}, timeoutMs = 2500) {
    const run = async (): Promise<string> => {
      const w = this.port.writable?.getWriter();
      if (!w) throw new TelescopeError('The serial port is closed.', 'Connect again.');
      this.buf = '';
      try {
        await w.write(new TextEncoder().encode(cmd));
      } finally {
        w.releaseLock();
      }
      if (reply.none) return '';
      return this.readUntil(reply.chars, timeoutMs);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async readUntil(chars: number | undefined, timeoutMs: number): Promise<string> {
    this.reader ??= this.port.readable?.getReader() ?? null;
    const r = this.reader;
    if (!r) throw new TelescopeError('The serial port is closed.', 'Connect again.');
    const done = () => (chars != null ? this.buf.length >= chars : this.buf.includes('#'));
    const deadline = Date.now() + timeoutMs;
    while (!done()) {
      const left = deadline - Date.now();
      if (left <= 0)
        throw new TelescopeError(
          'The mount did not answer.',
          'Check the cable, that the hand controller is on, and the protocol chosen.',
        );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const t = new Promise<null>((res) => (timer = setTimeout(() => res(null), left)));
      const chunk = await Promise.race([r.read(), t]);
      clearTimeout(timer);
      if (chunk && 'value' in chunk && chunk.value)
        this.buf += new TextDecoder('latin1').decode(chunk.value);
      if (chunk && 'done' in chunk && chunk.done)
        throw new TelescopeError('The serial port closed.', 'Connect again.');
    }
    const out =
      chars != null ? this.buf.slice(0, chars) : this.buf.slice(0, this.buf.indexOf('#') + 1);
    this.buf = '';
    return out;
  }
}

/** Something that answers commands (the real link, or a fake one in tests). */
export interface Wire {
  send(
    cmd: string,
    reply?: { chars?: number; none?: boolean },
    timeoutMs?: number,
  ): Promise<string>;
  close?(): Promise<void>;
}

export function serialAdapter(opts: {
  wire: Wire;
  protocol: SerialProtocol;
  /** The mount works in J2000 (most hand controllers use the position of date). */
  j2000: boolean;
  site: { lat: number; lon: number };
  control: () => boolean;
}): TelescopeAdapter {
  const { wire, protocol: p } = opts;
  const name = p === 'lx200' ? 'LX200 mount (serial)' : 'NexStar/SynScan mount (serial)';
  async function send(cmd: string, reply?: { chars?: number; none?: boolean }) {
    if (!serialAllowed(p, cmd, opts.control()))
      throw new TelescopeError(
        `Blocked: ${cmd} is not allowed.`,
        'Switch on "Enable control" first.',
      );
    return wire.send(cmd, reply);
  }
  /** J2000 → the mount's own system, and back. */
  const toMount = (ra: number, dec: number) =>
    opts.j2000 ? { ra, dec } : j2000ToNow(ra, dec, new Date());
  const fromMount = (ra: number, dec: number, d: Date) =>
    opts.j2000 ? { ra, dec } : nowToJ2000(ra, dec, d);

  async function lxSet(ra: number, dec: number) {
    const m = toMount(ra, dec);
    const a = await send(`:Sr${lx200Ra(m.ra)}#`, { chars: 1 });
    const b = await send(`:Sd${lx200Dec(m.dec)}#`, { chars: 1 });
    if (a !== '1' || b !== '1')
      throw new TelescopeError('The mount refused the coordinates.', 'Check it is aligned.');
  }

  return {
    kind: 'serial',
    label: name,
    caps: { ...NO_CAPS, tracking: p === 'nexstar' },
    async read() {
      const date = new Date();
      let raM: number | null;
      let decM: number | null;
      let slewing: boolean;
      let tracking: boolean | null = null;
      if (p === 'lx200') {
        raM = parseLx200Ra(await send(':GR#'));
        decM = parseLx200Dec(await send(':GD#'));
        // Distance bars: anything before "#" means a slew is under way.
        const d = await send(':D#').catch(() => '#');
        slewing = d.replace('#', '').trim().length > 0;
      } else {
        const e = parseNexPrecise(await send('e'));
        raM = e?.ra ?? null;
        decM = e?.dec ?? null;
        slewing = (await send('L').catch(() => '0#')).startsWith('1');
        const t = await send('t', { chars: 2 }).catch(() => '');
        if (t.length === 2) tracking = t.charCodeAt(0) !== 0;
      }
      if (raM == null || decM == null)
        throw new TelescopeError(
          'The mount answered, but not with a position.',
          'Is the protocol right (LX200 or NexStar/SynScan) and the mount aligned?',
        );
      const j = fromMount(raM, decM, date);
      const now = opts.j2000 ? j2000ToNow(raM, decM, date) : { ra: raM, dec: decM };
      const lst = localSiderealH(date, opts.site.lon);
      const { alt, az } = altAzNow(now.ra, now.dec, opts.site.lat, lst);
      const pier: PierSide = 'unknown';
      const s: MountState = {
        connected: true,
        ra2000: j.ra,
        dec2000: j.dec,
        raNow: now.ra,
        decNow: now.dec,
        epoch: opts.j2000 ? 'J2000' : 'JNow',
        alt,
        az,
        pier,
        tracking,
        slewing,
        atPark: null,
        lstH: lst,
        flipInH: null,
        rotatorDeg: null,
        at: date.getTime(),
      };
      return s;
    },
    async slew(ra, dec) {
      if (p === 'lx200') {
        await lxSet(ra, dec);
        const r = await send(':MS#', { chars: 1 });
        if (r !== '0')
          // "1<message>#": below the mount's limits; "2<message>#": busy.
          throw new TelescopeError(
            r === '1' ? 'The mount says the target is below its limits.' : 'The mount is busy.',
            "Check the mount's horizon limits, or wait for the current slew to finish.",
          );
      } else {
        const m = toMount(ra, dec);
        await send(`r${nexHex(m.ra)},${nexHex(m.dec)}`);
      }
    },
    async sync(ra, dec) {
      if (p === 'lx200') {
        await lxSet(ra, dec);
        await send(':CM#');
      } else {
        const m = toMount(ra, dec);
        await send(`s${nexHex(m.ra)},${nexHex(m.dec)}`);
      }
    },
    async stop() {
      if (p === 'lx200') await send(':Q#', { none: true });
      else await send('M');
    },
    async setTracking(on) {
      if (p !== 'nexstar') return;
      // 0 off, 2 equatorial north, 3 equatorial south (NexStar protocol).
      const mode = on ? (opts.site.lat >= 0 ? 2 : 3) : 0;
      await send(`T${String.fromCharCode(mode)}`);
    },
    async close() {
      await wire.close?.();
    },
  };
}
