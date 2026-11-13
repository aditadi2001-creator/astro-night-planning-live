/**
 * Small JSON fetch helper with an in-memory cache, a persistent "last good"
 * copy in localStorage, and retries with growing delays.
 *
 * Never throws for a cached key: if the network fails we return the last good
 * data with its timestamp so the UI can show its age instead of a blank card.
 */

export interface Cached<T> {
  data: T;
  /** When the data was fetched (ms since epoch). */
  fetchedAt: number;
  /** Set when the network failed and this is the last good copy. */
  stale?: boolean;
  error?: string;
}

const memory = new Map<string, Cached<unknown>>();
const PREFIX = 'anp.cache.v1.';
/** Drop persisted entries older than this, whatever the source. */
const MAX_PERSIST_AGE = 3 * 24 * 3600_000;

function readPersisted<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Cached<T>;
    if (typeof v.fetchedAt !== 'number' || Date.now() - v.fetchedAt > MAX_PERSIST_AGE) return null;
    return v;
  } catch {
    return null;
  }
}

function writePersisted(key: string, v: Cached<unknown>): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(v));
  } catch {
    // Storage full or disabled: memory cache still works. Free some space.
    pruneOld();
  }
}

function pruneOld(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function peek<T>(key: string): Cached<T> | null {
  const m = memory.get(key) as Cached<T> | undefined;
  if (m) return m;
  const p = readPersisted<T>(key);
  if (p) memory.set(key, p);
  return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${new URL(url).host}`);
  }
}

/**
 * Fetch JSON for `key`, using the cache when it is younger than `maxAgeMs`.
 * Retries up to `retries` times with 1 s, 2 s, 4 s… delays (not for 4xx).
 */
export async function fetchJson<T, R = T>(
  key: string,
  url: string,
  opts: {
    maxAgeMs: number;
    retries?: number;
    signal?: AbortSignal;
    /** Reduce the response before it is cached (large feeds keep only what we use). */
    transform?: (raw: R) => T;
  },
): Promise<Cached<T>> {
  const hit = peek<T>(key);
  if (hit && Date.now() - hit.fetchedAt < opts.maxAgeMs) return hit;

  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { signal: opts.signal ?? null });
      if (!res.ok) {
        const err = new HttpError(res.status, url);
        // Client errors won't fix themselves by retrying (except rate limits).
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
        continue;
      }
      const raw = (await res.json()) as R;
      const data = opts.transform ? opts.transform(raw) : (raw as unknown as T);
      const v: Cached<T> = { data, fetchedAt: Date.now() };
      memory.set(key, v);
      writePersisted(key, v);
      return v;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) break;
    }
  }
  const error = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  // Network down or source failing: hand back the last good copy, marked stale.
  if (hit) return { ...hit, stale: true, error: error.message };
  throw error;
}

/** Round a coordinate for cache keys and requests (~1.1 km at 2 decimals). */
export function roundCoord(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
