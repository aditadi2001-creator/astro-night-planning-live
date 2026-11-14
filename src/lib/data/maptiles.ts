/**
 * Helpers that keep the MapLibre maps usable on slow or flaky connections:
 * a tile-loading status (with a "slow" flag after a while), a retry that asks
 * every raster source for its tiles again, and fetch with a timeout and retries
 * for our custom tile protocols.
 */
import type { Map as MlMap } from 'maplibre-gl';

export interface TileStatus {
  pending: boolean;
  /** Still loading after `slowMs`. */
  slow: boolean;
}

/** Report whether tiles are still loading; returns a function that stops watching. */
export function watchTiles(
  map: MlMap,
  onchange: (s: TileStatus) => void,
  slowMs = 10_000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loading = () => {
    if (timer) return;
    onchange({ pending: true, slow: false });
    timer = setTimeout(() => onchange({ pending: true, slow: true }), slowMs);
  };
  const done = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    onchange({ pending: false, slow: false });
  };
  map.on('dataloading', loading);
  map.on('idle', done);
  return () => {
    map.off('dataloading', loading);
    map.off('idle', done);
    if (timer) clearTimeout(timer);
  };
}

/** Ask every raster source of the map to fetch its tiles again (after network trouble). */
export function reloadRasterSources(map: MlMap): void {
  for (const [id, spec] of Object.entries(map.getStyle()?.sources ?? {})) {
    if (spec.type !== 'raster') continue;
    const src = map.getSource(id) as unknown as {
      setTiles?: (t: string[]) => void;
      tiles?: string[];
    };
    const tiles = (spec as { tiles?: string[] }).tiles ?? src?.tiles;
    if (src?.setTiles && tiles) src.setTiles([...tiles]);
  }
}

/**
 * fetch() with a per-attempt timeout and retries on network errors and 5xx.
 * A 404 is an answer (no tile there), not an error to retry.
 */
export async function fetchRetry(
  url: string,
  signal: AbortSignal,
  tries = 3,
  timeoutMs = 60_000,
): Promise<Response> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal.addEventListener('abort', stop, { once: true });
    const t = setTimeout(stop, timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok || res.status === 404 || res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
      if (signal.aborted) throw e;
    } finally {
      clearTimeout(t);
      signal.removeEventListener('abort', stop);
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw last instanceof Error ? last : new Error('network error');
}
