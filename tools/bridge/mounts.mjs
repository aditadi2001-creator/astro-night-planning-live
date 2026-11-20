/**
 * Mount links for the bridge (no dependencies): LX200 / NexStar over TCP (Wi-Fi and Ethernet
 * mounts, OnStep, ZWO AM-series, 10Micron…) and INDI (indiserver on Linux, Raspberry Pi,
 * StellarMate, Astroberry, KStars/Ekos). Browsers cannot open raw TCP sockets, so the bridge
 * holds the connection and the page talks to it over plain HTTP on the same origin.
 *
 * Only allow-listed commands and properties pass; control needs --allow-control on the bridge
 * AND "Enable control" in the page (tests/mount-control.test.ts checks the lists agree with
 * src/lib/telescope/serial.ts and indi.ts).
 */
import { Socket } from 'node:net';

// ---- LX200 / NexStar over TCP ------------------------------------------------------------

export const SERIAL_READ = {
  lx200: [':GR#', ':GD#', ':D#'],
  nexstar: ['Kx', 'e', 'L', 't'],
};
export const SERIAL_CONTROL = {
  lx200: [':Sr', ':Sd', ':MS#', ':CM#', ':Q#'],
  nexstar: ['r', 's', 'M', 'T'],
};

export function serialAllowed(p, cmd, control) {
  const hit = (list) => list.some((c) => (c.endsWith('#') ? cmd === c : cmd.startsWith(c)));
  return hit(SERIAL_READ[p] ?? []) || (control && hit(SERIAL_CONTROL[p] ?? []));
}

/** One persistent TCP connection, one command at a time, replies up to "#" (or N characters). */
export class TcpLink {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.sock = null;
    this.buf = '';
    this.queue = Promise.resolve();
  }
  connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = new Socket();
      s.setTimeout(10_000);
      s.once('error', (e) => {
        this.sock = null;
        rej(e);
      });
      s.on('data', (d) => (this.buf += d.toString('latin1')));
      s.on('close', () => (this.sock = null));
      s.on('timeout', () => s.destroy());
      s.connect(this.port, this.host, () => {
        s.setTimeout(0);
        this.sock = s;
        res();
      });
    });
  }
  send(cmd, reply = {}, timeoutMs = 3000) {
    const run = async () => {
      await this.connect();
      this.buf = '';
      this.sock.write(Buffer.from(cmd, 'latin1'));
      if (reply.none) return '';
      const deadline = Date.now() + timeoutMs;
      const done = () =>
        reply.chars != null ? this.buf.length >= reply.chars : this.buf.includes('#');
      while (!done()) {
        if (Date.now() > deadline) throw new Error('the mount did not answer');
        await new Promise((r) => setTimeout(r, 20));
      }
      const out =
        reply.chars != null
          ? this.buf.slice(0, reply.chars)
          : this.buf.slice(0, this.buf.indexOf('#') + 1);
      this.buf = '';
      return out;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

// ---- INDI ------------------------------------------------------------------------------

/** Properties the page may change (with control on). Everything can be read. */
export const INDI_CONTROL = [
  'EQUATORIAL_EOD_COORD',
  'ON_COORD_SET',
  'TELESCOPE_ABORT_MOTION',
  'TELESCOPE_PARK',
  'TELESCOPE_TRACK_STATE',
];

/** "5:30:00" or "5.5" → 5.5 (INDI numbers may be sexagesimal). */
export function indiNumber(s) {
  const t = String(s).trim();
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  const m = /^([+-]?)(\d+)[: ](\d+(?:\.\d+)?)(?:[: ](\d+(?:\.\d+)?))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + (m[4] ? Number(m[4]) / 3600 : 0);
  return m[1] === '-' ? -v : v;
}

const attr = (a, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(a)?.[1] ?? null;

/**
 * Parse complete INDI vectors out of a stream buffer. Returns the property updates found and the
 * unparsed rest. Each update: { device, name, kind, state, values: { elem: number|string } }.
 */
export function parseIndi(buffer) {
  const out = [];
  const re = /<(def|set)(Number|Switch|Text|Light)Vector\b([^>]*)>([\s\S]*?)<\/\1\2Vector>/g;
  let m;
  let last = 0;
  while ((m = re.exec(buffer))) {
    last = re.lastIndex;
    const kind = m[2];
    const values = {};
    const inner =
      /<(?:def|one)(?:Number|Switch|Text|Light)\b([^>]*)>([\s\S]*?)<\/(?:def|one)(?:Number|Switch|Text|Light)>/g;
    let e;
    while ((e = inner.exec(m[4]))) {
      const n = attr(e[1], 'name');
      if (!n) continue;
      const raw = e[2].trim();
      values[n] = kind === 'Number' ? indiNumber(raw) : raw;
    }
    out.push({
      device: attr(m[3], 'device'),
      name: attr(m[3], 'name'),
      kind,
      state: attr(m[3], 'state'),
      values,
    });
  }
  // Keep at most the unparsed tail (a vector still arriving).
  const rest = buffer.slice(last);
  return { updates: out, rest: rest.length > 200_000 ? '' : rest };
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** INDI XML for a change request (newNumberVector / newSwitchVector). */
export function indiNew(device, name, kind, values) {
  const tag = kind === 'Number' ? 'Number' : 'Switch';
  const items = Object.entries(values)
    .map(([k, v]) => `<one${tag} name="${esc(k)}">${esc(v)}</one${tag}>`)
    .join('');
  return `<new${tag}Vector device="${esc(device)}" name="${esc(name)}">${items}</new${tag}Vector>\n`;
}

/** Holds one indiserver connection and the latest value of every property. */
export class IndiClient {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.state = {};
    this.buf = '';
    this.sock = null;
    this.ready = false;
    this.error = null;
  }
  connect() {
    if (this.sock && !this.sock.destroyed) return;
    const s = new Socket();
    this.sock = s;
    s.on('data', (d) => {
      const { updates, rest } = parseIndi(this.buf + d.toString('utf8'));
      this.buf = rest;
      for (const u of updates) {
        if (!u.device || !u.name) continue;
        const dev = (this.state[u.device] ??= {});
        dev[u.name] = {
          kind: u.kind,
          state: u.state ?? dev[u.name]?.state ?? null,
          values: { ...(dev[u.name]?.values ?? {}), ...u.values },
          at: Date.now(),
        };
      }
    });
    s.on('error', (e) => (this.error = e.message));
    s.on('close', () => {
      this.sock = null;
      this.ready = false;
      setTimeout(() => this.connect(), 3000);
    });
    s.connect(this.port, this.host, () => {
      this.ready = true;
      this.error = null;
      s.write('<getProperties version="1.7"/>\n');
    });
  }
  snapshot() {
    this.connect();
    return { connected: this.ready, error: this.error, devices: this.state };
  }
  send(device, name, kind, values) {
    this.connect();
    if (!this.ready || !this.sock) throw new Error('indiserver not connected');
    this.sock.write(indiNew(device, name, kind, values));
  }
}
