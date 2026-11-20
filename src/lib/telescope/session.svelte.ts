/**
 * The live telescope connection: settings (remembered on this device), one poll loop, the last
 * reading and a plain-language error. Control is OFF on every page load: "Enable control" has to
 * be switched on again each session, and every slew/sync also needs a confirmation in the UI.
 */
import { alpacaAdapter } from './alpaca';
import { ninaAdapter } from './nina';
import { serialAdapter, SerialLink, type SerialProtocol } from './serial';
import { simulatorAdapter } from './simulator';
import {
  NO_CAPS,
  TelescopeError,
  type AdapterKind,
  type Capabilities,
  type GotoOptions,
  type MountState,
  type TelescopeAdapter,
} from './types';

export interface TelescopeSettings {
  kind: AdapterKind;
  /** Host name or IP of the computer running NINA / Alpaca (ignored for the simulator). */
  host: string;
  port: number;
  /** Alpaca device number. */
  device: number;
  /** Go through the bridge served by this page's own origin (tools/bridge). */
  viaBridge: boolean;
  /** Direct (serial) connection: the hand controller's protocol. */
  protocol: SerialProtocol;
  /** Direct connection: the mount works in J2000 instead of the position of date. */
  serialJ2000: boolean;
}

const KEY = 'anp.telescope.v1';
const DEFAULT_PORT: Record<AdapterKind, number> = {
  simulator: 0,
  nina: 1888,
  alpaca: 11111,
  serial: 0,
};
const KINDS: AdapterKind[] = ['simulator', 'nina', 'alpaca', 'serial'];

function loadSettings(): TelescopeSettings {
  const d: TelescopeSettings = {
    kind: 'simulator',
    host: 'localhost',
    port: 1888,
    device: 0,
    viaBridge: false,
    protocol: 'lx200',
    serialJ2000: false,
  };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TelescopeSettings>;
    return {
      kind: v.kind && KINDS.includes(v.kind) ? v.kind : d.kind,
      host: typeof v.host === 'string' && v.host.trim() ? v.host.trim() : d.host,
      port: Number.isInteger(v.port) ? (v.port as number) : d.port,
      device: Number.isInteger(v.device) ? (v.device as number) : d.device,
      viaBridge: v.viaBridge === true,
      protocol: v.protocol === 'nexstar' ? 'nexstar' : 'lx200',
      serialJ2000: v.serialJ2000 === true,
    };
  } catch {
    return d;
  }
}

export function defaultPort(kind: AdapterKind): number {
  return DEFAULT_PORT[kind];
}

export type Status = 'off' | 'connecting' | 'live' | 'error';

class TelescopeSession {
  settings = $state<TelescopeSettings>(loadSettings());
  status = $state<Status>('off');
  state = $state<MountState | null>(null);
  error = $state<{ message: string; hint: string } | null>(null);
  /** Off on every load (CLAUDE.md rule 8). */
  control = $state(false);
  follow = $state(false);
  /** What the current connection can do (reactive, for the panel). */
  caps = $state<Capabilities>(NO_CAPS);
  private adapter: TelescopeAdapter | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private fails = 0;

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* not remembered */
    }
  }

  private async make(site: { lat: number; lon: number }): Promise<TelescopeAdapter> {
    const s = this.settings;
    const control = () => this.control;
    const hostPort = `${s.host}:${s.port}`;
    if (s.kind === 'nina')
      return ninaAdapter({
        base: s.viaBridge ? '/nina' : `http://${hostPort}/v2/api`,
        label: s.viaBridge ? 'NINA (through the bridge)' : `NINA at ${hostPort}`,
        control,
      });
    if (s.kind === 'alpaca')
      return alpacaAdapter({
        base: s.viaBridge ? '/alpaca' : `http://${hostPort}/api/v1`,
        device: s.device,
        label: s.viaBridge ? 'Alpaca (through the bridge)' : `Alpaca at ${hostPort}`,
        control,
      });
    if (s.kind === 'serial')
      return serialAdapter({
        wire: await SerialLink.pick(),
        protocol: s.protocol,
        j2000: s.serialJ2000,
        site,
        control,
      });
    return simulatorAdapter(site);
  }

  /** The adapter, for the NINA extras (sequence, framing). */
  get link(): TelescopeAdapter | null {
    return this.adapter;
  }

  get label(): string {
    return this.adapter?.label ?? '';
  }

  /** Connect; a direct (serial) connection asks for the port, so call this from a click. */
  async connect(site: { lat: number; lon: number }) {
    this.disconnect();
    this.save();
    this.status = 'connecting';
    this.error = null;
    this.fails = 0;
    try {
      this.adapter = await this.make(site);
      this.caps = this.adapter.caps;
    } catch (e) {
      this.status = 'error';
      const te = e instanceof TelescopeError ? e : new TelescopeError(String(e), 'Try again.');
      this.error = { message: te.message, hint: te.hint };
      return;
    }
    void this.poll();
  }

  disconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
    void this.adapter?.close?.();
    this.adapter = null;
    this.caps = NO_CAPS;
    this.status = 'off';
    this.state = null;
    this.follow = false;
    this.control = false;
  }

  private async poll() {
    const a = this.adapter;
    if (!a) return;
    this.abort = new AbortController();
    try {
      const s = await a.read(this.abort.signal);
      if (a !== this.adapter) return;
      this.state = s;
      this.status = 'live';
      this.error = null;
      this.fails = 0;
    } catch (e) {
      if (a !== this.adapter || this.abort.signal.aborted) return;
      this.fails++;
      const te =
        e instanceof TelescopeError
          ? e
          : new TelescopeError(
              `${a.label}: ${(e as Error).message}`,
              'Try again, or check the program.',
            );
      this.error = { message: te.message, hint: te.hint };
      // Keep the last position for a few failures (Wi-Fi blips), then mark it lost.
      if (this.fails >= 3 || !this.state) {
        this.status = 'error';
        this.state = null;
      }
    }
    // Slow down while failing so a missing NINA is not hammered.
    const wait =
      this.fails === 0 ? (this.state?.slewing ? 500 : 1500) : Math.min(15000, 2000 * this.fails);
    this.timer = setTimeout(() => void this.poll(), wait);
  }

  /** Control actions; the caller has already asked for confirmation. */
  async act(
    kind: 'slew' | 'sync' | 'stop' | 'park' | 'unpark' | 'track' | 'untrack',
    ra = 0,
    dec = 0,
    opts: GotoOptions = {},
  ) {
    const a = this.adapter;
    if (!a) throw new TelescopeError('Not connected.', 'Connect first.');
    // Read-only means read-only: even "stop" is a command to the mount.
    if (!this.control)
      throw new TelescopeError('Control is off.', 'Switch on "Enable control" first.');
    if (kind === 'slew') await a.slew(ra, dec, opts);
    else if (kind === 'sync') await a.sync(ra, dec);
    else if (kind === 'park') await a.park?.();
    else if (kind === 'unpark') await a.unpark?.();
    else if (kind === 'track' || kind === 'untrack') await a.setTracking?.(kind === 'track');
    else await a.stop();
    // Read straight away so the HUD shows the slew starting.
    if (this.timer) clearTimeout(this.timer);
    void this.poll();
  }
}

export const telescope = new TelescopeSession();
