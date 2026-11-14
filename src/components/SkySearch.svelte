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
  /** Famous objects found by nickname (SDSS discoveries and others). */
  const NOTABLE: {
    label: string;
    sub: string;
    keys: string[];
    ra: number;
    dec: number;
    am: number;
  }[] = [
    {
      label: 'SDSS J1038+4849 · Cheshire Cat “smiley face” lens',
      sub: 'galaxy group lensing background galaxies into a smile (best in Hubble images)',
      keys: ['smiley', 'smile', 'cheshire', 'sdssj1038', 'sdss'],
      ra: 159.6816,
      dec: 48.8216,
      am: 0.6,
    },
    {
      label: 'Hanny’s Voorwerp · SDSS J094103.80+344334.2',
      sub: 'glowing gas cloud found by Galaxy Zoo volunteers in SDSS images',
      keys: ['hanny', 'voorwerp', 'sdssj0941', 'sdss'],
      ra: 145.2658,
      dec: 34.7262,
      am: 0.5,
    },
  ];
</script>

<script lang="ts">
  import type { Target } from '../lib/targets';
  import { parseTargets } from '../lib/targets';
  import { fmtDMS, fmtRA, parseRaDec } from '../lib/astro/skycoords';
  import { DATA_BASE } from '../lib/config';

  type NebRow = [string, number, number, number, string];
  /** dsonames.json: "M 31|NGC 224", common name, RA, Dec, size (′), type. */
  type NameRow = [string, string, number, number, number, string];
  const DSO_KIND: Record<string, string> = {
    G: 'galaxy',
    PaG: 'galaxy pair',
    GrG: 'galaxy group',
    OpC: 'open cluster',
    GlC: 'globular cluster',
    HII: 'H II region',
    As: 'association',
    PN: 'planetary nebula',
    ISM: 'nebula',
    RNe: 'reflection nebula',
    DNe: 'dark nebula',
    SNR: 'supernova remnant',
  };
  /**
   * A catalogue name alone (or with the start of a number) lists that catalogue in
   * number order: "NGC", "NGC 70", "M", "PGC 12", "Sh2", "LDN 16", "B 3"…
   */
  const BROWSE = /^(m|ngc|ic|pgc|leda|sh\s*2|sh|lbn|ldn|vdb|b)\s*-?\s*(\d{0,7})$/i;
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
  let names = $state<NameRow[] | null>(null);
  /** How many browse results to show (Show more adds 60). */
  let limit = $state(60);
  let pgcHits = $state<SearchHit[]>([]);
  let pgcNote = $state('');
  let pgcTotal = $state(0);

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
      fetch(`${base}skydata/dsonames.json`)
        .then((r) => r.json())
        .then((d: { rows: NameRow[] }) => {
          names = d.rows;
        })
        .catch(() => undefined),
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
    const m = /^(?:pgc|leda)\s*(\d{0,7})$/i.exec(q.trim());
    const max = limit;
    pgcHits = [];
    pgcNote = '';
    if (!m || !DATA_BASE) return;
    const digits = m[1] ?? '';
    const num = Number(digits || '0');
    let cancelled = false;
    pgcNote = 'Looking up PGC…';
    // Numbers starting with these digits live in a few chunk files (PGC // 10000).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not UI state
    const chunks = new Set<number>();
    for (let k = 0; k < 4 && digits; k++) {
      const lo = num * 10 ** k;
      if (lo > 9_999_999) break;
      chunks.add(Math.floor(lo / 10000));
    }
    if (!digits) chunks.add(0);
    void Promise.all([...chunks].map((c) => pgcChunk(c))).then((parts) => {
      if (cancelled) return;
      const rows =
        parts.some((r) => r === null) && parts.every((r) => !r?.length)
          ? null
          : parts.flatMap((r) => r ?? []);
      if (!rows) {
        pgcNote = 'The PGC lookup could not be reached right now.';
        return;
      }
      const exact = rows.filter((r) => r[0] === num);
      const more = rows
        .filter((r) => r[0] !== num && String(r[0]).startsWith(digits))
        .sort((a, b) => a[0] - b[0]);
      pgcTotal = exact.length + more.length;
      pgcHits = [...exact, ...more].slice(0, max).map((r) => ({
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

  const browse = $derived(BROWSE.exec(q.trim()));
  const browseHits = $derived.by((): SearchHit[] | null => {
    const m = browse;
    if (!m) return null;
    const cat = (m[1] ?? '').toLowerCase().replace(/\s+/g, '');
    const digits = m[2] ?? '';
    if (cat === 'pgc' || cat === 'leda') return pgcHits;
    const out: { n: number; hit: SearchHit }[] = [];
    const prefix = cat === 'm' ? 'M' : cat === 'ngc' ? 'NGC' : cat === 'ic' ? 'IC' : '';
    if (prefix && names) {
      for (const r of names) {
        for (const nm of r[0].split('|')) {
          const [p, num] = nm.split(' ');
          if (p !== prefix || !num || !num.startsWith(digits)) continue;
          const others = r[0].split('|').filter((x) => x !== nm);
          out.push({
            n: parseInt(num, 10),
            hit: {
              kind: 'dso',
              id: nm,
              label: [nm, ...others].join(' · ') + (r[1] ? ` · ${r[1]}` : ''),
              sub: `${DSO_KIND[r[5]] ?? 'deep-sky object'}${r[4] ? `, ${r[4]}′` : ''}`,
              ra: r[2],
              dec: r[3],
              sizeDeg: Math.max(r[4] || 2, 0.5) / 60,
            },
          });
        }
      }
    }
    const nebPre: Record<string, string> = {
      sh: 'Sh 2-',
      sh2: 'Sh 2-',
      lbn: 'LBN ',
      ldn: 'LDN ',
      vdb: 'vdB ',
      b: 'B ',
    };
    const np = nebPre[cat];
    if (np && nebulae) {
      for (const r of nebulae) {
        if (!r[0].startsWith(np)) continue;
        const num = r[0].slice(np.length);
        if (!num.startsWith(digits)) continue;
        out.push({
          n: parseInt(num, 10),
          hit: {
            kind: 'dso',
            id: r[0],
            label: r[0],
            sub: `${NEB_KIND[r[4]] ?? 'nebula'}${r[3] ? `, ${r[3]}′` : ''}`,
            ra: r[1],
            dec: r[2],
            sizeDeg: Math.max(r[3] || 5, 1) / 60,
          },
        });
      }
    }
    out.sort((a, b) => a.n - b.n);
    return out.map((o) => o.hit);
  });
  const pgcPlain = $derived(/^(pgc|leda)$/i.test(q.trim()));
  const browseTotal = $derived(
    browse && /^(pgc|leda)$/i.test(browse[1] ?? '') ? pgcTotal : (browseHits?.length ?? 0),
  );

  const hits = $derived.by((): SearchHit[] => {
    if (browseHits) return browseHits.slice(0, limit);
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
    for (const o of NOTABLE)
      if (n.length >= 3 && o.keys.some((k) => k.startsWith(n) || n.startsWith(k)))
        out.push({
          kind: 'dso',
          id: o.label,
          label: o.label,
          sub: o.sub,
          ra: o.ra,
          dec: o.dec,
          sizeDeg: o.am / 60,
        });
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
      limit = 60;
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
  {#if open && browse && browseTotal > hits.length}
    <button
      class="more"
      onmousedown={(e) => {
        e.preventDefault();
        limit += 60;
      }}
      >Show more ({hits.length} of {browseTotal.toLocaleString()}{pgcPlain
        ? ' with PGC 1–9999; type digits for the others'
        : ''})</button
    >
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
        <li>Type just a catalogue name (NGC, IC, M, PGC, Sh2, LBN, LDN, vdB, B) to list it</li>
        <li>Coordinates: 83.82 -5.39 or 5h35m17s -5d23m28s</li>
        <li>Nicknames: smiley (SDSS Cheshire Cat lens), Hanny’s Voorwerp</li>
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
  /* In the flow of the corner panel (which scrolls): an absolutely placed list was clipped. */
  ul[role='listbox'] {
    margin: 4px 0 0;
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
  .more {
    margin-top: 4px;
    width: 100%;
    font-size: 12px;
    min-height: 30px;
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
