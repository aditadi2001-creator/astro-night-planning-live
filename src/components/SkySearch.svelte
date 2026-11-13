<script lang="ts" module>
  export type SearchHit =
    | { kind: 'engine'; label: string; sub: string; id: string }
    | { kind: 'dso'; label: string; sub: string; ra: number; dec: number; sizeDeg: number };

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
  /** Bright stars with proper names (the engine finds them as "NAME <star>"). */
  const STARS = [
    'Sirius',
    'Canopus',
    'Arcturus',
    'Vega',
    'Capella',
    'Rigel',
    'Procyon',
    'Achernar',
    'Betelgeuse',
    'Hadar',
    'Altair',
    'Acrux',
    'Aldebaran',
    'Antares',
    'Spica',
    'Pollux',
    'Fomalhaut',
    'Deneb',
    'Mimosa',
    'Regulus',
    'Adhara',
    'Castor',
    'Shaula',
    'Gacrux',
    'Bellatrix',
    'Elnath',
    'Miaplacidus',
    'Alnilam',
    'Alnair',
    'Alnitak',
    'Alioth',
    'Dubhe',
    'Mirfak',
    'Wezen',
    'Sargas',
    'Kaus Australis',
    'Avior',
    'Alkaid',
    'Menkalinan',
    'Atria',
    'Alhena',
    'Peacock',
    'Polaris',
    'Mirzam',
    'Alphard',
    'Hamal',
    'Algieba',
    'Diphda',
    'Nunki',
    'Menkent',
    'Mirach',
    'Alpheratz',
    'Rasalhague',
    'Kochab',
    'Saiph',
    'Denebola',
    'Algol',
    'Mizar',
    'Alcor',
    'Albireo',
    'Mintaka',
    'Merak',
    'Schedar',
    'Caph',
    'Mira',
    'Thuban',
    'Enif',
    'Markab',
    'Scheat',
    'Sadr',
    'Zubenelgenubi',
    'Unukalhai',
    'Izar',
  ];
  const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');
</script>

<script lang="ts">
  import type { Target } from '../lib/targets';
  import { parseTargets } from '../lib/targets';

  let { onpick }: { onpick: (hit: SearchHit) => boolean } = $props();

  let q = $state('');
  let open = $state(false);
  let activeI = $state(0);
  let message = $state('');
  let catalog = $state<Target[] | null>(null);
  let loading = false;

  function loadCatalog() {
    if (catalog || loading) return;
    loading = true;
    fetch(`${import.meta.env.BASE_URL}skydata/targets.json`)
      .then((r) => r.json())
      .then((d: { rows: unknown[] }) => (catalog = parseTargets(d)))
      .catch(() => (loading = false));
  }

  const hits = $derived.by((): SearchHit[] => {
    const n = norm(q);
    if (n.length < 1) return [];
    const out: SearchHit[] = [];
    const starts = (s: string) => norm(s).startsWith(n);
    for (const p of PLANETS)
      if (starts(p)) out.push({ kind: 'engine', label: p, sub: 'Solar system', id: `NAME ${p}` });
    for (const s of STARS)
      if (starts(s)) out.push({ kind: 'engine', label: s, sub: 'Star', id: `NAME ${s}` });
    if (catalog) {
      for (const t of catalog) {
        if (out.length >= 12) break;
        const nm = norm(t.name);
        const common = t.common ? norm(t.common) : '';
        if (nm === n || nm.startsWith(n) || (n.length >= 3 && common.includes(n)))
          out.push({
            kind: 'dso',
            label: t.common ? `${t.name} · ${t.common}` : t.name,
            sub: `${t.kind} in ${t.con}`,
            ra: t.ra,
            dec: t.dec,
            sizeDeg: (t.maj ?? 10) / 60,
          });
      }
    }
    return out.slice(0, 12);
  });

  function choose(h: SearchHit | undefined) {
    if (!h) return;
    const ok = onpick(h);
    message = ok ? '' : `“${h.label}” was not found in the sky data.`;
    if (ok) {
      q = '';
      open = false;
    }
  }
  function submit() {
    if (hits.length) return choose(hits[activeI] ?? hits[0]);
    const raw = q.trim();
    if (!raw) return;
    // Catalogue designations the engine knows (e.g. "HIP 91262", "HD 172167").
    if (onpick({ kind: 'engine', label: raw, sub: '', id: raw })) {
      q = '';
      open = false;
      message = '';
    } else message = `Nothing called “${raw}” found. Try a planet, star name or M/NGC/IC number.`;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      open = true;
      activeI = Math.min(hits.length - 1, activeI + 1);
    } else if (e.key === 'ArrowUp') {
      activeI = Math.max(0, activeI - 1);
    } else if (e.key === 'Enter') {
      submit();
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
    placeholder="Search: Mars, Vega, M31…"
    autocomplete="off"
    role="combobox"
    aria-expanded={open && hits.length > 0}
    aria-controls="sky-search-list"
    aria-autocomplete="list"
    aria-activedescendant={open && hits[activeI] ? `ss-${activeI}` : undefined}
    bind:value={q}
    onfocus={() => {
      loadCatalog();
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
            choose(h);
          }}
        >
          <span>{h.label}</span><span class="sub">{h.sub}</span>
        </li>
      {/each}
    </ul>
  {/if}
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
  .msg {
    margin: 4px 0 0;
    padding: 4px 8px;
    font-size: 12px;
    background: var(--panel);
    border-radius: 8px;
    color: var(--warn);
  }
</style>
