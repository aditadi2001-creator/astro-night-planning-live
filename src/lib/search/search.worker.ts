/// <reference lib="webworker" />
/**
 * Search Web Worker: loads the static catalog shards (Cloudflare Pages assets — no data-Worker
 * requests), builds the unified index once, and answers queries off the main thread so the sky
 * keeps its frame rate. The large galaxy shard (PGC/UGC/ESO, 6 MB) loads only when a query needs it.
 */
import {
  browse,
  catalogEntries,
  constellationEntries,
  dsoEntries,
  norm,
  notableEntries,
  search,
  solarSystemEntries,
  starEntries,
  surveyEntries,
  type Constellation,
  type Entry,
  type Shard,
} from './index';
import { SURVEYS } from '../sky/surveys';

export type SearchAsk =
  | { type: 'query'; q: string; limit?: number }
  | { type: 'browse'; badge: string }
  | { type: 'lookup'; keys: string[] };
export type SearchRequest = SearchAsk & { id: number };

export type ResultEntry = Omit<Entry, 'ids' | 'words' | 'names' | 'rank'>;

export type SearchResponse =
  | { id: number; ok: true; results: ResultEntry[]; galaxiesLoaded: boolean; size: number }
  | { id: number; ok: false; error: string };

const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/';
let entries: Entry[] = [];
let ready: Promise<void> | null = null;
let galaxies: Promise<void> | null = null;
let galaxiesLoaded = false;

async function json<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

function constellations(
  sky: {
    constellations: {
      iau: string;
      lines: number[][];
      common_name?: { english?: string; native?: string };
    }[];
  },
  stars: Shard,
): Constellation[] {
  const pos = new Map<number, [number, number]>();
  const iHip = stars.columns.indexOf('hip');
  const iRa = stars.columns.indexOf('ra');
  const iDec = stars.columns.indexOf('dec');
  for (const r of stars.rows) pos.set(r[iHip] as number, [r[iRa] as number, r[iDec] as number]);
  const D = Math.PI / 180;
  const out: Constellation[] = [];
  for (const c of sky.constellations) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const hip of c.lines.flat()) {
      const p = pos.get(hip);
      if (!p) continue;
      x += Math.cos(p[1] * D) * Math.cos(p[0] * D);
      y += Math.cos(p[1] * D) * Math.sin(p[0] * D);
      z += Math.sin(p[1] * D);
    }
    if (!x && !y && !z) continue;
    out.push({
      iau: c.iau,
      name: c.common_name?.english ?? c.iau,
      native: c.common_name?.native ?? c.common_name?.english ?? c.iau,
      ra: (((Math.atan2(y, x) / D) % 360) + 360) % 360,
      dec: Math.atan2(z, Math.hypot(x, y)) / D,
    });
  }
  return out;
}

function init(): Promise<void> {
  ready ??= (async () => {
    const [manifest, core, stars, notable, sky] = await Promise.all([
      json<{ catalogs: Record<string, number> }>('catalog/manifest-v1.json'),
      json<Shard>('catalog/dso-core-v1.json'),
      json<Shard>('catalog/stars-v1.json'),
      json<Shard>('catalog/notable-v1.json'),
      json<Parameters<typeof constellations>[0]>('skydata/skycultures/western/index.json'),
    ]);
    entries = [
      ...solarSystemEntries(),
      ...constellationEntries(constellations(sky, stars)),
      ...catalogEntries(manifest.catalogs),
      ...surveyEntries(SURVEYS),
      ...notableEntries(notable),
      ...starEntries(stars),
      ...dsoEntries(core),
    ];
  })();
  return ready;
}

function loadGalaxies(): Promise<void> {
  galaxies ??= json<Shard>('catalog/dso-galaxies-v1.json').then((s) => {
    entries = entries.concat(dsoEntries(s));
    galaxiesLoaded = true;
  });
  return galaxies;
}

/** Queries that are about the big galaxy catalogs, or found almost nothing in the core set. */
const wantsGalaxies = (q: string, hits: number) =>
  /^\s*(pgc|ugc|eso|leda|mcg)\b/i.test(q) || (hits < 3 && q.trim().length >= 3);

/** Drop the index-only fields before sending a result to the page. */
function strip(e: Entry): ResultEntry {
  const out: Partial<Entry> = { ...e };
  delete out.ids;
  delete out.words;
  delete out.names;
  delete out.rank;
  return out as ResultEntry;
}

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const m = e.data;
  try {
    await init();
    if (m.type === 'lookup') {
      // First entry whose designations include one of the keys (e.g. the engine's names).
      const keys = m.keys.map(norm).filter(Boolean);
      let hit = entries.find((e) => e.kind === 'dso' && keys.some((k) => e.ids.includes(k)));
      hit ??= entries.find((e) => keys.some((k) => e.ids.includes(k)));
      post({
        id: m.id,
        ok: true,
        results: hit ? [strip(hit)] : [],
        galaxiesLoaded,
        size: entries.length,
      });
      return;
    }
    if (m.type === 'browse') {
      if (['PGC', 'UGC', 'ESO'].includes(m.badge)) await loadGalaxies();
      const results = browse(entries, m.badge).map(strip);
      post({ id: m.id, ok: true, results, galaxiesLoaded, size: entries.length });
      return;
    }
    let hits = search(entries, m.q, m.limit ?? 40);
    if (!galaxiesLoaded && wantsGalaxies(m.q, hits.length)) {
      await loadGalaxies();
      hits = search(entries, m.q, m.limit ?? 40);
    }
    post({
      id: m.id,
      ok: true,
      results: hits.map((h) => strip(h.entry)),
      galaxiesLoaded,
      size: entries.length,
    });
  } catch (err) {
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

function post(r: SearchResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);
}
