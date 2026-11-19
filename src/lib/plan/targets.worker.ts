/// <reference lib="webworker" />
/**
 * Best-targets Web Worker: loads the core catalog shard once (a static Pages asset) and ranks
 * ~25,000 objects for the night off the main thread, so the page and the sky stay smooth.
 */
import {
  nightSamples,
  objectsFromShard,
  rankAll,
  type Obj,
  type RankInput,
  type Ranked,
} from './rank';

export type TargetsRequest = { id: number; input: RankInput };
export type TargetsResponse =
  | {
      id: number;
      ok: true;
      list: Ranked[];
      considered: number;
      cloudLimitedShare: number;
      ms: number;
    }
  | { id: number; ok: false; error: string };

const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/';
let objs: Promise<Obj[]> | null = null;
let nightKey = '';
let night: ReturnType<typeof nightSamples> | null = null;

function load(): Promise<Obj[]> {
  objs ??= fetch(`${BASE}catalog/dso-core-v1.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
      return r.json();
    })
    .then(objectsFromShard);
  return objs;
}

self.onmessage = async (e: MessageEvent<TargetsRequest>) => {
  const { id, input } = e.data;
  try {
    const all = await load();
    const t0 = performance.now();
    // The Moon and cloud samples depend only on the place, night and forecast: reuse them
    // while only the filters change.
    const key = JSON.stringify([input.lat, input.lon, input.darkStart, input.darkEnd, input.clear]);
    if (key !== nightKey || !night) {
      night = nightSamples(input);
      nightKey = key;
    }
    const r = rankAll(all, input, night);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      ok: true,
      ...r,
      ms: Math.round(performance.now() - t0),
    } satisfies TargetsResponse);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies TargetsResponse);
  }
};
