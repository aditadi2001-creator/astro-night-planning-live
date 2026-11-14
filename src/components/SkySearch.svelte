<script lang="ts" module>
  export type SearchHit =
    | { kind: 'engine'; label: string; sub: string; id: string }
    | { kind: 'coords'; label: string; sub: string; ra: number; dec: number }
    | {
        kind: 'dso';
        label: string;
        sub: string;
        /** Catalogue designation the engine can select (e.g. "M 42", "NGC 7000"). */
        id: string;
        ra: number;
        dec: number;
        sizeDeg: number;
      };

  const PLANETS = [
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto',
  ];
  /** Bright stars with proper names → Hipparcos number (the engine finds stars by "HIP n"). */
  const STARS: [string, number][] = [
    ['Sirius', 32349],
    ['Canopus', 30438],
    ['Arcturus', 69673],
    ['Vega', 91262],
    ['Capella', 24608],
    ['Rigel', 24436],
    ['Procyon', 37279],
    ['Achernar', 7588],
    ['Betelgeuse', 27989],
    ['Hadar', 68702],
    ['Altair', 97649],
    ['Acrux', 60718],
    ['Aldebaran', 21421],
    ['Antares', 80763],
    ['Spica', 65474],
    ['Pollux', 37826],
    ['Fomalhaut', 113368],
    ['Deneb', 102098],
    ['Mimosa', 62434],
    ['Regulus', 49669],
    ['Adhara', 33579],
    ['Castor', 36850],
    ['Shaula', 85927],
    ['Gacrux', 61084],
    ['Bellatrix', 25336],
    ['Elnath', 25428],
    ['Miaplacidus', 45238],
    ['Alnilam', 26311],
    ['Alnair', 109268],
    ['Alnitak', 26727],
    ['Alioth', 62956],
    ['Dubhe', 54061],
    ['Mirfak', 15863],
    ['Wezen', 34444],
    ['Sargas', 86228],
    ['Kaus Australis', 90185],
    ['Avior', 41037],
    ['Alkaid', 67301],
    ['Menkalinan', 28360],
    ['Atria', 82273],
    ['Alhena', 31681],
    ['Peacock', 100751],
    ['Polaris', 11767],
    ['Mirzam', 30324],
    ['Alphard', 46390],
    ['Hamal', 9884],
    ['Algieba', 50583],
    ['Diphda', 3419],
    ['Nunki', 92855],
    ['Menkent', 68933],
    ['Mirach', 5447],
    ['Alpheratz', 677],
    ['Rasalhague', 86032],
    ['Kochab', 72607],
    ['Saiph', 27366],
    ['Denebola', 57632],
    ['Algol', 14576],
    ['Mizar', 65378],
    ['Alcor', 65477],
    ['Albireo', 95947],
    ['Mintaka', 25930],
    ['Merak', 53910],
    ['Schedar', 3179],
    ['Caph', 746],
    ['Mira', 10826],
    ['Thuban', 68756],
    ['Enif', 107315],
    ['Markab', 113963],
    ['Scheat', 113881],
    ['Sadr', 100453],
    ['Zubenelgenubi', 72622],
    ['Unukalhai', 77070],
    ['Izar', 72105],
  ];
  const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');
</script>

<script lang="ts">
  import type { Target } from '../lib/targets';
  import { parseTargets } from '../lib/targets';
  import { fmtDMS, fmtRA, parseRaDec } from '../lib/astro/skycoords';
  import { DATA_BASE } from '../lib/config';

  type NebRow = [string, number, number, number, string];
  type PgcRow = [number, number, number, number, string];
  const NEB_KIND: Record<string, string> = {
    HII: 'H II region',
    ISM: 'bright nebula',
    DNe: 'dark nebula',
    RNe: 'reflection nebula',
  };

  let { onpick }: { onpick: (hit: SearchHit) => boolean | Promise<boolean> } = $props();
  let input: HTMLInputElement;
  export function focus() {
    input?.focus();
  }

  let q = $state('');
  let open = $state(false);
  let activeI = $state(0);
  let message = $state('');
  let catalog = $state<Target[] | null>(null);
  let nebulae = $state<NebRow[] | null>(null);
  let pgcHits = $state<SearchHit[]>([]);
  let pgcNote = $state('');

  let catalogLoad: Promise<void> | null = null;
  function loadCatalog(): Promise<void> {
    if (catalogLoad) return catalogLoad;
    const base = import.meta.env.BASE_URL;
    catalogLoad = Promise.all([
      fetch(`${base}skydata/targets.json`)
        .then((r) => r.json())
        .then((d: { rows: unknown[] }) => {
          catalog = parseTargets(d);
        }),
      fetch(`${base}skydata/nebulae.json`)
        .then((r) => r.json())
        .then((d: { rows: NebRow[] }) => {
          nebulae = d.rows;
        })
        .catch(() => undefined),
    ])
      .then(() => undefined)
      .catch(() => {
        catalogLoad = null; // try again next time
      });
    return catalogLoad;
  }

  // PGC / LEDA numbers: looked up in the chunk files the deep-sky job publishes
  // in R2 (data/pgc-NNN.json, PGC number // 10000), loaded only when asked for.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a request cache, not UI state
  const pgcChunks = new Map<number, Promise<PgcRow[] | null>>();
  function pgcChunk(c: number): Promise<PgcRow[] | null> {
    let p = pgcChunks.get(c);
    if (!p) {
      p = fetch(`${DATA_BASE}/data/pgc-${String(c).padStart(3, '0')}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: PgcRow[] }>) : null))
        .then((d) => {
          if (!d) throw new Error('no index');
          return d.rows;
        })
        .catch(() => {
          pgcChunks.delete(c);
          return null;
        });
      pgcChunks.set(c, p);
    }
    return p;
  }
  $effect(() => {
    const m = /^(?:pgc|leda)\s*(\d{1,7})$/i.exec(q.trim());
    pgcHits = [];
    pgcNote = '';
    if (!m || !DATA_BASE) return;
    const digits = m[1] ?? '';
    const num = Number(digits);
    let cancelled = false;
    pgcNote = 'Looking up PGC…';
    void pgcChunk(Math.floor(num / 10000)).then((rows) => {
      if (cancelled) return;
      if (!rows) {
        pgcNote = 'The PGC lookup could not be reached right now.';
        return;
      }
      const exact = rows.filter((r) => r[0] === num);
      const more = rows.filter((r) => r[0] !== num && String(r[0]).startsWith(digits));
      pgcHits = [...exact, ...more].slice(0, 8).map((r) => ({
        kind: 'dso',
        id: `PGC ${r[0]}`,
        label: `PGC ${r[0]}${r[4] ? ` · ${r[4]}` : ''}`,
        sub: `galaxy${r[3] ? `, ${r[3]}′` : ''}`,
        ra: r[1],
        dec: r[2],
        sizeDeg: Math.max(r[3] || 0.5, 0.3) / 60,
      }));
      pgcNote = pgcHits.length ? '' : `No PGC ${digits} in the catalogue.`;
    });
    return () => {
      cancelled = true;
    };
  });

  const hits = $derived.by((): SearchHit[] => {
    const n = norm(q);
    if (n.length < 1) return [];
    const out: SearchHit[] = [];
    // Coordinates typed directly (J2000): "83.82 -5.39", "5h35m17s -5d23m28s", "05:35:17 -05:23:28".
    const c = parseRaDec(q);
    if (c)
      out.push({
        kind: 'coords',
        label: `RA ${fmtRA(c.ra)}  Dec ${fmtDMS(c.dec)}`,
        sub: 'Go to coordinates (J2000)',
        ra: c.ra,
        dec: c.dec,
      });
    const starts = (s: string) => norm(s).startsWith(n);
    for (const p of PLANETS)
      if (starts(p)) out.push({ kind: 'engine', label: p, sub: 'Solar system', id: `NAME ${p}` });
    for (const [s, hip] of STARS)
      if (starts(s))
        out.push({ kind: 'engine', label: s, sub: `Star · HIP ${hip}`, id: `HIP ${hip}` });
    if (catalog) {
      for (const t of catalog) {
        if (out.length >= 12) break;
        const nm = norm(t.name);
        const common = t.common ? norm(t.common) : '';
        if (nm === n || nm.startsWith(n) || (n.length >= 3 && common.includes(n)))
          out.push({
            kind: 'dso',
            id: t.name,
            label: t.common ? `${t.name} · ${t.common}` : t.name,
            sub: `${t.kind} in ${t.con}`,
            ra: t.ra,
            dec: t.dec,
            sizeDeg: (t.maj ?? 10) / 60,
          });
      }
    }
    if (nebulae && n.length >= 2) {
      for (const r of nebulae) {
        if (out.length >= 12) break;
        if (norm(r[0]).startsWith(n))
          out.push({
            kind: 'dso',
            id: r[0],
            label: r[0],
            sub: `${NEB_KIND[r[4]] ?? 'nebula'}${r[3] ? `, ${r[3]}′` : ''}`,
            ra: r[1],
            dec: r[2],
            sizeDeg: Math.max(r[3] || 5, 1) / 60,
          });
      }
    }
    out.unshift(...pgcHits);
    return out.slice(0, 12);
  });

  async function choose(h: SearchHit | undefined) {
    if (!h) return;
    open = false;
    message = 'Looking…';
    const ok = await onpick(h);
    message = ok ? '' : `“${h.label}” was not found in the sky data.`;
    if (ok) q = '';
  }
  async function submit() {
    // Typed fast (e.g. "M45" + Enter): wait for the deep-sky list before deciding.
    if (!hits.length && !catalog) {
      await loadCatalog();
      await Promise.resolve();
    }
    if (hits.length) return void choose(hits[activeI] ?? hits[0]);
    const raw = q.trim();
    if (!raw) return;
    // Catalogue designations the engine knows (e.g. "HIP 91262", "HD 172167", "* alf Lyr").
    void Promise.resolve(onpick({ kind: 'engine', label: raw, sub: '', id: raw })).then((ok) => {
      if (ok) {
        q = '';
        open = false;
        message = '';
      } else
        message = `Nothing called “${raw}” found. Try a planet, a star name, HIP number or M/NGC/IC number.`;
    });
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      open = true;
      activeI = Math.min(hits.length - 1, activeI + 1);
    } else if (e.key === 'ArrowUp') {
      activeI = Math.max(0, activeI - 1);
    } else if (e.key === 'Enter') {
      void submit();
    } else if (e.key === 'Escape') {
      open = false;
      return;
    } else return;
    e.preventDefault();
  }
</script>

<div class="search">
  <label class="visually-hidden" for="sky-search">Find an object in the sky</label>
  <input
    id="sky-search"
    type="search"
    placeholder="Search: Mars, Vega, M31, or RA Dec…"
    autocomplete="off"
    role="combobox"
    aria-expanded={open && hits.length > 0}
    aria-controls="sky-search-list"
    aria-autocomplete="list"
    aria-activedescendant={open && hits[activeI] ? `ss-${activeI}` : undefined}
    bind:value={q}
    bind:this={input}
    onfocus={() => {
      void loadCatalog();
      open = true;
    }}
    oninput={() => {
      open = true;
      activeI = 0;
      message = '';
    }}
    onblur={() => setTimeout(() => (open = false), 150)}
    onkeydown={onKey}
  />
  {#if open && hits.length}
    <ul id="sky-search-list" role="listbox" aria-label="Matching objects">
      {#each hits as h, i (h.label + i)}
        <li
          id={`ss-${i}`}
          role="option"
          aria-selected={i === activeI}
          onmousedown={(e) => {
            e.preventDefault();
            void choose(h);
          }}
        >
          <span>{h.label}</span><span class="sub">{h.sub}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if open && !q.trim()}
    <div class="cats">
      <p>Search by name or catalogue number:</p>
      <ul>
        <li>Sun, Moon, planets</li>
        <li>Stars: name, HIP n, HD n</li>
        <li>Messier, NGC, IC (OpenNGC): M 31, NGC 7000</li>
        <li>Galaxies: PGC n (HyperLEDA, about 980,000)</li>
        <li>Nebulae: Sh 2-n (Sharpless), LBN n, LDN n, vdB n, B n (Barnard)</li>
        <li>Coordinates: 83.82 -5.39 or 5h35m17s -5d23m28s</li>
      </ul>
    </div>
  {/if}
  {#if pgcNote && q.trim()}<p class="msg info" role="status">{pgcNote}</p>{/if}
  {#if message}<p class="msg" role="status">{message}</p>{/if}
</div>

<style>
  .search {
    position: relative;
    width: min(330px, calc(100vw - 210px));
    min-width: 150px;
    pointer-events: auto;
  }
  input {
    width: 100%;
    min-height: 36px;
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: color-mix(in srgb, var(--panel) 82%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 4px 10px;
    backdrop-filter: blur(6px);
  }
  input::placeholder {
    color: var(--muted);
  }
  ul {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 6;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    max-height: 50vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  li[aria-selected='true'],
  li:hover {
    background: var(--panel-2);
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .cats {
    margin-top: 4px;
    padding: 8px 10px;
    font-size: 12px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--muted);
  }
  .cats p {
    margin: 0 0 4px;
    color: var(--text);
  }
  .cats ul {
    margin: 0;
    padding-left: 16px;
  }
  .msg.info {
    color: var(--muted);
  }
  .msg {
    margin: 4px 0 0;
    padding: 4px 8px;
    font-size: 12px;
    background: var(--panel);
    border-radius: 8px;
    color: var(--warn);
  }
</style>
