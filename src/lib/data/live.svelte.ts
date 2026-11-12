/**
 * A live data source: loads on demand, refreshes on its own schedule, pauses
 * while the tab is hidden, backs off after failures, and always keeps the last
 * good data (with its age) so a source being down never blanks the UI.
 */
import type { Cached } from './cache';

export type SourceStatus = 'idle' | 'loading' | 'ok' | 'stale' | 'error';

export class LiveSource<T> {
  data = $state<T | null>(null);
  fetchedAt = $state<number | null>(null);
  status = $state<SourceStatus>('idle');
  error = $state<string | null>(null);

  #timer: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;
  #ctrl: AbortController | null = null;
  #onVisibility = () => {
    if (document.hidden) {
      this.#clear();
    } else {
      // Coming back: refresh now if the data is due, otherwise reschedule.
      const due = !this.fetchedAt || Date.now() - this.fetchedAt >= this.intervalMs;
      if (due) void this.refresh();
      else this.#schedule(this.intervalMs - (Date.now() - (this.fetchedAt ?? 0)));
    }
  };

  constructor(
    public readonly id: string,
    private loader: (signal: AbortSignal, force: boolean) => Promise<Cached<T>>,
    public readonly intervalMs: number,
    /** Data older than this is shown as stale. */
    public readonly staleAfterMs = intervalMs * 3,
  ) {}

  start(initial?: Cached<T> | null): () => void {
    if (initial) this.#apply(initial);
    document.addEventListener('visibilitychange', this.#onVisibility);
    void this.refresh();
    return () => this.stop();
  }

  stop(): void {
    this.#clear();
    this.#ctrl?.abort();
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  async refresh(force = false): Promise<void> {
    this.#clear();
    this.#ctrl?.abort();
    const ctrl = new AbortController();
    this.#ctrl = ctrl;
    if (!this.data) this.status = 'loading';
    try {
      const v = await this.loader(ctrl.signal, force);
      if (ctrl.signal.aborted) return;
      this.#apply(v);
      if (v.stale) {
        // Last good copy after a failed refresh: keep showing it, retry sooner.
        this.#failures++;
        this.error = v.error ?? 'refresh failed';
        this.status = 'stale';
        this.#schedule(Math.min(this.intervalMs, 30_000 * 2 ** (this.#failures - 1)));
        return;
      }
      this.#failures = 0;
      this.error = null;
      this.#schedule(this.intervalMs - (Date.now() - v.fetchedAt));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.#failures++;
      this.error = e instanceof Error ? e.message : String(e);
      this.status = this.data ? 'stale' : 'error';
      // 30 s, 60 s, 120 s … capped at the normal interval.
      this.#schedule(Math.min(this.intervalMs, 30_000 * 2 ** (this.#failures - 1)));
    }
  }

  #apply(v: Cached<T>): void {
    this.data = v.data;
    this.fetchedAt = v.fetchedAt;
    this.status = Date.now() - v.fetchedAt > this.staleAfterMs ? 'stale' : 'ok';
  }

  #schedule(ms: number): void {
    this.#clear();
    if (typeof document !== 'undefined' && document.hidden) return;
    this.#timer = setTimeout(() => void this.refresh(), Math.max(5_000, ms));
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** "3 min ago", "2 h ago". */
export function ageLabel(fetchedAt: number | null, now = Date.now()): string {
  if (!fetchedAt) return 'never';
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
