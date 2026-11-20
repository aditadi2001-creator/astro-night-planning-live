/**
 * Main-thread side of the search Web Worker, plus recents/favorites (on this device only) and
 * the online fallback (CDS Sesame via the CfA mirror) for names that are not in the local catalogs.
 */
import SearchWorker from './search.worker?worker';
import type { ResultEntry, SearchAsk, SearchRequest, SearchResponse } from './search.worker';
import { fetchJson } from '../data/cache';

export type { ResultEntry };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: SearchResponse) => void>();

function w(): Worker {
  if (!worker) {
    worker = new SearchWorker();
    worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
  }
  return worker;
}

function ask(req: SearchAsk): Promise<SearchResponse> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const msg: SearchRequest = { ...req, id };
    w().postMessage(msg);
  });
}

/** Warm the index (call when the user is likely to search soon, e.g. on hover of the button). */
export function warmSearch(): void {
  void ask({ type: 'query', q: '' });
}

export function searchCatalogs(q: string, limit = 40): Promise<SearchResponse> {
  return ask({ type: 'query', q, limit });
}

/** The installed SDSS galaxies around a point (from the deep-sky layer's tiles). */
export function sdssInstalled(ra: number, dec: number, radiusDeg: number): Promise<SearchResponse> {
  return ask({ type: 'sdss', ra, dec, radiusDeg });
}

export function browseCatalog(badge: string): Promise<SearchResponse> {
  return ask({ type: 'browse', badge });
}

/** The catalog entry for an object known by any of these names (null when not in the catalogs). */
export async function lookupObject(keys: string[]): Promise<ResultEntry | null> {
  const r = await ask({ type: 'lookup', keys });
  return r.ok ? (r.results[0] ?? null) : null;
}

// ---- recents and favorites (localStorage, this device only) -------------------------------

const RECENT_KEY = 'anp.search.recent.v1';
const FAV_KEY = 'anp.search.fav.v1';

function read(key: string): ResultEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v)
      ? (v as ResultEntry[]).filter((x) => x && typeof x.label === 'string')
      : [];
  } catch {
    return [];
  }
}
function write(key: string, list: ResultEntry[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}
const same = (a: ResultEntry, b: ResultEntry) => a.kind === b.kind && a.label === b.label;

export const recents = (): ResultEntry[] => read(RECENT_KEY);
export function addRecent(e: ResultEntry): void {
  write(RECENT_KEY, [e, ...read(RECENT_KEY).filter((x) => !same(x, e))].slice(0, 12));
}
export const favorites = (): ResultEntry[] => read(FAV_KEY);
export const isFavorite = (e: ResultEntry): boolean => read(FAV_KEY).some((x) => same(x, e));
export function toggleFavorite(e: ResultEntry): boolean {
  const list = read(FAV_KEY);
  const on = !list.some((x) => same(x, e));
  write(FAV_KEY, on ? [e, ...list].slice(0, 100) : list.filter((x) => !same(x, e)));
  return on;
}

// ---- online fallback: CDS Sesame (SIMBAD/NED/VizieR name resolver), CfA mirror ------------

const SESAME = [
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?',
  'https://vizier.idia.ac.za/viz-bin/nph-sesame/-oxp/SNV?',
];

/** Parse Sesame's XML answer; null when the name is unknown. Exported for tests. */
export function parseSesame(xml: string, query: string): ResultEntry | null {
  const ra = /<jradeg>([-\d.]+)<\/jradeg>/.exec(xml)?.[1];
  const dec = /<jdedeg>([-\d.]+)<\/jdedeg>/.exec(xml)?.[1];
  if (!ra || !dec) return null;
  const oname = /<oname>([^<]+)<\/oname>/
    .exec(xml)?.[1]
    ?.replace(/^\{Name\}\s*|^\*+\s*/g, '')
    .trim();
  const otype = /<otype>([^<]+)<\/otype>/.exec(xml)?.[1]?.trim();
  const vmag = /<mag band="V">\s*<v>([-\d.]+)<\/v>/.exec(xml)?.[1];
  return {
    kind: 'online',
    label: oname || query,
    sub: ['Found online (SIMBAD via Sesame)', otype ? `type ${otype}` : '', vmag ? `V ${vmag}` : '']
      .filter(Boolean)
      .join(' · '),
    badges: ['SIMBAD'],
    ra: Number(ra),
    dec: Number(dec),
    mag: vmag ? Number(vmag) : null,
    sizeDeg: 0.25,
  };
}

/**
 * Resolve a name online. Results (and "not found") are cached on the device for 30 days, so a
 * repeated lookup never reaches the service again; only an explicit user action calls this.
 */
export async function resolveOnline(
  name: string,
  signal?: AbortSignal,
): Promise<ResultEntry | null> {
  const q = name.trim().slice(0, 80);
  if (q.length < 2) return null;
  let lastErr: unknown = null;
  for (const base of SESAME) {
    try {
      const r = await fetchJson<{ hit: ResultEntry | null }, string>(
        `sesame:${q.toLowerCase()}`,
        base + encodeURIComponent(q),
        {
          maxAgeMs: 30 * 24 * 3600_000,
          retries: 0,
          text: true,
          ...(signal ? { signal } : {}),
          transform: (raw) => ({ hit: parseSesame(raw, q) }),
        },
      );
      return r.data.hit;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('online lookup failed');
}

// ---- online catalogs: SDSS DR16 around the view, from VizieR (CfA mirror, CORS open) ------

const VIZIER = [
  'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?',
  'https://vizier.idia.ac.za/viz-bin/asu-tsv?',
];

/** VizieR TSV (SDSS16, RA, Dec, rmag, zsp, spCl) → entries, brightest first. Exported for tests. */
export function parseSdssTsv(tsv: string): ResultEntry[] {
  const out: ResultEntry[] = [];
  const seen = new Set<string>();
  for (const line of tsv.split('\n')) {
    if (!line.startsWith('SDSS J')) continue;
    const [name, ra, dec, r, z, cls] = line.split('\t').map((s) => s.trim());
    if (!name || seen.has(name) || !ra || !dec) continue;
    seen.add(name);
    const zN = z ? Number(z) : null;
    const kind = cls === 'QSO' ? 'Quasar' : cls === 'GALAXY' ? 'Galaxy' : (cls ?? 'Object');
    out.push({
      kind: 'online',
      label: name,
      sub: [
        `${kind} (SDSS spectrum)`,
        r ? `r ${Number(r).toFixed(1)}` : '',
        zN != null && Number.isFinite(zN) ? `redshift ${zN.toFixed(4)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      badges: ['SDSS'],
      ra: Number(ra),
      dec: Number(dec),
      mag: r ? Number(r) : null,
      sizeDeg: 0.05,
      type: cls === 'QSO' ? 'quasar' : 'galaxy',
    });
  }
  return out;
}

/**
 * SDSS DR16 objects with a spectrum (galaxies and quasars; stars left out) within `radiusDeg` of
 * a point, brightest first, up to 200. Cached on the device for 30 days per 0.1° cell.
 */
export async function sdssAround(
  ra: number,
  dec: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<ResultEntry[]> {
  const rm = Math.round(Math.min(60, Math.max(3, radiusDeg * 60)));
  const c = `${ra.toFixed(2)}${dec >= 0 ? '+' : ''}${dec.toFixed(2)}`;
  const q =
    `-source=V/154/sdss16&-c=${encodeURIComponent(c)}&-c.rm=${rm}` +
    '&-out=SDSS16,RA_ICRS,DE_ICRS,rmag,zsp,spCl&-out.max=200&-sort=rmag&mode=1&zsp=%3E0.001';
  let lastErr: unknown = null;
  for (const base of VIZIER) {
    try {
      const r = await fetchJson<{ list: ResultEntry[] }, string>(`sdss:${c}:${rm}`, base + q, {
        maxAgeMs: 30 * 24 * 3600_000,
        retries: 0,
        text: true,
        ...(signal ? { signal } : {}),
        transform: (raw) => ({ list: parseSdssTsv(raw) }),
      });
      return r.data.list;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('SDSS lookup failed');
}
