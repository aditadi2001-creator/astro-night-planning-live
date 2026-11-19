/**
 * The live telescope connection: settings (remembered on this device), one poll loop, the last
 * reading and a plain-language error. Control is OFF on every page load: "Enable control" has to
 * be switched on again each session, and every slew/sync also needs a confirmation in the UI.
 */
import { alpacaAdapter } from './alpaca';
import { ninaAdapter } from './nina';
import { simulatorAdapter } from './simulator';
import { TelescopeError, type AdapterKind, type MountState, type TelescopeAdapter } from './types';

export interface TelescopeSettings {
  kind: AdapterKind;
  /** Host name or IP of the computer running NINA / Alpaca (ignored for the simulator). */
  host: string;
  port: number;
  /** Alpaca device number. */
  device: number;
  /** Go through the bridge served by this page's own origin (tools/bridge). */
  viaBridge: boolean;
}

const KEY = 'anp.telescope.v1';
const DEFAULT_PORT: Record<AdapterKind, number> = { simulator: 0, nina: 1888, alpaca: 11111 };

function loadSettings(): TelescopeSettings {
  const d: TelescopeSettings = {
    kind: 'simulator',
    host: 'localhost',
    port: 1888,
    device: 0,
    viaBridge: false,
  };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TelescopeSettings>;
    return {
      kind: v.kind === 'nina' || v.kind === 'alpaca' || v.kind === 'simulator' ? v.kind : d.kind,
      host: typeof v.host === 'string' && v.host.trim() ? v.host.trim() : d.host,
      port: Number.isInteger(v.port) ? (v.port as number) : d.port,
      device: Number.isInteger(v.device) ? (v.device as number) : d.device,
      viaBridge: v.viaBridge === true,
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

  private make(site: { lat: number; lon: number }): TelescopeAdapter {
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
    return simulatorAdapter(site);
  }

  get label(): string {
    return this.adapter?.label ?? '';
  }

  connect(site: { lat: number; lon: number }) {
    this.disconnect();
    this.save();
    this.adapter = this.make(site);
    this.status = 'connecting';
    this.error = null;
    this.fails = 0;
    void this.poll();
  }

  disconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
    this.adapter = null;
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
  async act(kind: 'slew' | 'sync' | 'stop', ra = 0, dec = 0) {
    const a = this.adapter;
    if (!a) throw new TelescopeError('Not connected.', 'Connect first.');
    // Read-only means read-only: even "stop" is a command to the mount.
    if (!this.control)
      throw new TelescopeError('Control is off.', 'Switch on "Enable control" first.');
    if (kind === 'slew') await a.slew(ra, dec);
    else if (kind === 'sync') await a.sync(ra, dec);
    else await a.stop();
    // Read straight away so the HUD shows the slew starting.
    if (this.timer) clearTimeout(this.timer);
    void this.poll();
  }
}

export const telescope = new TelescopeSession();
