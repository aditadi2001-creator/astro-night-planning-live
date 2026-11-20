<script lang="ts">
  /**
   * Unified search (Ctrl/Cmd-K): every catalog, bright stars, constellations, Solar System,
   * notable objects, and the catalogs and sky surveys themselves. Keyboard-driven, grouped results
   * with catalog badges; recents and favorites stay on this device; names that are not in the
   * local catalogs can be looked up online (SIMBAD via Sesame) on request.
   */
  import { onMount, tick } from 'svelte';
  import {
    addRecent,
    browseCatalog,
    favorites,
    isFavorite,
    recents,
    resolveOnline,
    sdssAround,
    searchCatalogs,
    toggleFavorite,
    type ResultEntry,
  } from '../lib/search/client';
  import { parseRaDec, fmtRA, fmtDMS } from '../lib/astro/skycoords';
  import { looksLikeDesignation, norm, ONLINE_PREFIX } from '../lib/search/index';

  interface Props {
    onclose: () => void;
    /** An object, star, constellation, planet or coordinates was chosen. */
    onpick: (e: ResultEntry) => void;
    /** A sky survey was chosen: turn it on. */
    onsurvey: (id: string) => void;
    /** Centre of the sky view and its field (degrees), for catalogs listed around the view. */
    centre?: () => { ra: number; dec: number; fovDeg: number } | null;
  }
  let { onclose, onpick, onsurvey, centre }: Props = $props();

  let q = $state('');
  let results = $state<ResultEntry[]>([]);
  let browsing = $state<string | null>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('loading');
  let error = $state('');
  let active = $state(0);
  let online = $state<'idle' | 'loading' | 'none' | 'error'>('idle');
  let favs = $state<ResultEntry[]>(favorites());
  let recent = $state<ResultEntry[]>(recents());
  let input: HTMLInputElement;
  let listEl: HTMLUListElement;
  let seq = 0;

  const GROUPS: { kind: ResultEntry['kind']; label: string }[] = [
    { kind: 'planet', label: 'Solar System' },
    { kind: 'dso', label: 'Deep-sky objects' },
    { kind: 'star', label: 'Stars' },
    { kind: 'constellation', label: 'Constellations' },
    { kind: 'notable', label: 'Notable objects' },
    { kind: 'catalog', label: 'Catalogs' },
    { kind: 'survey', label: 'Sky surveys' },
    { kind: 'online', label: 'Found online' },
  ];

  const coords = $derived(parseRaDec(q));
  /** Results in display order (grouped), so keyboard navigation follows what is on screen. */
  const flat = $derived.by<ResultEntry[]>(() => {
    const base: ResultEntry[] = coords
      ? [
          {
            kind: 'online',
            label: `RA ${fmtRA(coords.ra)}  Dec ${fmtDMS(coords.dec)}`,
            sub: 'Coordinates (J2000) · point the sky there',
            badges: ['RA/Dec'],
            ra: coords.ra,
            dec: coords.dec,
            sizeDeg: 1,
          },
        ]
      : [];
    if (browsing) return [...base, ...results];
    // Groups appear in the order of their best-ranked result (an exact constellation match first).
    const order = [...new Set(results.map((r) => r.kind))];
    const byGroup = order.flatMap((k) => results.filter((r) => r.kind === k));
    return [...base, ...byGroup];
  });

  $effect(() => {
    const text = q;
    const id = ++seq;
    browsing = null;
    online = 'idle';
    onlineNote = '';
    active = 0;
    if (!text.trim()) {
      results = [];
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchCatalogs(text);
      if (id !== seq) return;
      if (r.ok) {
        results = r.results;
        status = 'ready';
        // Designations only an online service knows (SDSS J…, 2MASS J…, Mrk, MCG, UGCA, HD…):
        // ask SIMBAD by itself once the typing stops, unless the exact name is already here.
        const exact = r.results.some((x) => norm(x.label.split(' · ')[0] ?? '') === norm(text));
        if (!exact && ONLINE_PREFIX.test(text) && /\d/.test(text) && text.trim().length >= 5)
          autoT = setTimeout(() => {
            if (id === seq && online === 'idle') void lookOnline();
          }, 650);
      } else {
        status = 'error';
        error = r.error;
      }
    }, 40);
    return () => {
      clearTimeout(t);
      clearTimeout(autoT);
    };
  });
  let autoT: ReturnType<typeof setTimeout> | undefined;
  /** Offer SIMBAD under the results too, not only when nothing local matched. */
  const offerOnline = $derived(
    !browsing &&
      q.trim().length >= 3 &&
      looksLikeDesignation(q) &&
      !flat.some((x) => x.kind === 'online' && x.badges.includes('SIMBAD')) &&
      !flat.some((x) => norm(x.label.split(' · ')[0] ?? '') === norm(q)),
  );
  let onlineNote = $state('');

  onMount(() => {
    input?.focus();
    // Build the index right away (first open: ~2–3 MB of catalog files, then cached).
    void searchCatalogs('m1').then((r) => {
      status = r.ok ? 'ready' : 'error';
      if (!r.ok) error = r.error;
    });
  });

  async function choose(e: ResultEntry) {
    if (e.kind === 'catalog' && e.ref?.startsWith('online:')) {
      const c = centre?.();
      if (!c) {
        onlineNote = 'Open the Sky page first: this catalog is listed around the view centre.';
        return;
      }
      const id = ++seq;
      online = 'loading';
      onlineNote = '';
      try {
        const radius = Math.min(1, Math.max(0.1, c.fovDeg / 2));
        const list = await sdssAround(c.ra, c.dec, radius);
        if (id !== seq) return;
        online = 'idle';
        browsing = `${e.label} within ${radius < 1 ? `${Math.round(radius * 60)}′` : '1°'} of the view centre`;
        results = list;
        if (!list.length)
          onlineNote =
            'SDSS has no galaxies or quasars with spectra here. SDSS covers about a third of the sky, mostly far from the Milky Way: try around M 51, M 101 or the Coma cluster.';
        active = 0;
        await tick();
        listEl?.scrollTo({ top: 0 });
      } catch {
        if (id === seq) online = 'error';
      }
      return;
    }
    if (e.kind === 'catalog' && e.ref) {
      const id = ++seq;
      const r = await browseCatalog(e.ref);
      if (id !== seq || !r.ok) return;
      browsing = e.label;
      results = r.results;
      active = 0;
      await tick();
      listEl?.scrollTo({ top: 0 });
      return;
    }
    addRecent(e);
    if (e.kind === 'survey' && e.ref) onsurvey(e.ref);
    else onpick(e);
    onclose();
  }

  async function lookOnline() {
    online = 'loading';
    try {
      const hit = await resolveOnline(q);
      if (!hit) {
        online = 'none';
        return;
      }
      online = 'idle';
      results = [...results.filter((r) => r.kind !== 'online'), hit];
    } catch {
      online = 'error';
    }
  }

  function key(e: KeyboardEvent) {
    const n = (q.trim() ? flat : [...favs, ...recent]).length;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (browsing) {
        browsing = null;
        q = q + '';
      } else onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(n - 1, active + 1);
      scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
      scrollActive();
    } else if (e.altKey && e.key.toLowerCase() === 'f') {
      // Keyboard favorite for the highlighted result (the ★ buttons are for the mouse).
      e.preventDefault();
      const pick = (q.trim() ? flat : [...favs, ...recent])[active];
      if (pick && pick.kind !== 'catalog') {
        toggleFavorite(pick);
        favs = favorites();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const list = q.trim() ? flat : [...favs, ...recent];
      const pick = list[active];
      if (pick) void choose(pick);
      else if (q.trim().length >= 2 && online === 'idle') void lookOnline();
    }
  }
  function scrollActive() {
    void tick().then(() =>
      listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
    );
  }
  function fav(e: ResultEntry, ev: MouseEvent) {
    ev.stopPropagation();
    toggleFavorite(e);
    favs = favorites();
  }
  const groupStart = (list: ResultEntry[], i: number) =>
    !browsing && (i === 0 || list[i - 1]?.kind !== list[i]?.kind);
  const groupLabel = (k: ResultEntry['kind']) => GROUPS.find((g) => g.kind === k)?.label ?? '';
  const shown = $derived(q.trim() ? flat : [...favs, ...recent]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="scrim" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Search the sky">
  <div class="field">
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg
    >
    <input
      bind:this={input}
      bind:value={q}
      onkeydown={key}
      type="search"
      placeholder="M 31, Vega, Sh2-129, Saturn, SDSS, Mrk 421, 2MASS J…, 10h45m −59°…"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded={shown.length > 0}
      aria-controls="search-results"
      aria-activedescendant={shown.length ? `sr-${active}` : undefined}
    />
    <button class="close" onclick={onclose} aria-label="Esc: close search">Esc</button>
  </div>

  {#if browsing}
    <p class="crumb">
      <button class="link" onclick={() => ((browsing = null), (q = q + ''))}>← All results</button>
      <span>{browsing}: {results.length}{results.length >= 200 ? ' (first 200)' : ''} objects</span>
    </p>
  {/if}

  <ul
    id="search-results"
    class="results"
    role="listbox"
    bind:this={listEl}
    aria-label="Search results"
  >
    {#if !q.trim() && (favs.length || recent.length)}
      {#each shown as r, i (`${i}-${r.kind}-${r.label}`)}
        {#if i === 0 && favs.length}<li class="group" role="presentation">Favorites</li>{/if}
        {#if i === favs.length && recent.length}<li class="group" role="presentation">
            Recent
          </li>{/if}
        {@render row(r, i)}
      {/each}
    {:else}
      {#each shown as r, i (`${i}-${r.kind}-${r.label}`)}
        {#if groupStart(shown, i)}<li class="group" role="presentation">
            {groupLabel(r.kind)}
          </li>{/if}
        {@render row(r, i)}
      {/each}
    {/if}
  </ul>

  <footer class="foot">
    {#if status === 'loading'}
      <span role="status">Loading the catalogs (about 3 MB, once)…</span>
    {:else if status === 'error'}
      <span role="status">The catalogs could not be loaded ({error}). Check the connection.</span>
    {:else if q.trim() && !flat.length && online === 'idle'}
      <span>Not in the local catalogs.</span>
      <button onclick={lookOnline}>Search SIMBAD online for “{q.trim()}”</button>
    {:else if online === 'loading'}
      <span role="status">Asking online (SIMBAD / VizieR, CfA mirror)…</span>
    {:else if onlineNote}
      <span role="status">{onlineNote}</span>
    {:else if online === 'none'}
      <span role="status">SIMBAD does not know “{q.trim()}” either.</span>
    {:else if online === 'error'}
      <span role="status">The online service could not be reached right now. Try again later.</span>
    {:else if offerOnline}
      <button onclick={lookOnline}>Also search SIMBAD online for “{q.trim()}”</button>
    {:else}
      <span class="hint">↑ ↓ to move · Enter to open · Alt+F or ★ to keep as favorite</span>
    {/if}
  </footer>
</div>

{#snippet row(r: ResultEntry, i: number)}
  <li
    id={`sr-${i}`}
    role="option"
    aria-selected={i === active}
    class="row"
    onclick={() => void choose(r)}
    onkeydown={(e) => e.key === 'Enter' && void choose(r)}
    onmousemove={() => (active = i)}
  >
    <span class="main">
      <span class="label" class:obj-name={r.kind === 'dso' || r.kind === 'notable'}
        >{r.label}{#if favs.some((f) => f.kind === r.kind && f.label === r.label)}<span
            class="visually-hidden">, favorite</span
          >{/if}</span
      >
      <span class="sub">{r.sub}</span>
    </span>
    <span class="badges">
      {#each r.badges.slice(0, 4) as b (b)}<span class="badge">{b}</span>{/each}
    </span>
    {#if r.kind !== 'catalog'}
      <!-- Mouse only: a listbox option cannot contain a button; Alt+F does it by keyboard,
           and the option's name already says whether it is a favorite. -->
      <span
        class="star"
        class:on={favs.some((f) => f.kind === r.kind && f.label === r.label)}
        aria-hidden="true"
        title={isFavorite(r) ? 'Remove from favorites (Alt+F)' : 'Keep as favorite (Alt+F)'}
        onclick={(ev) => fav(r, ev)}>★</span
      >
    {/if}
  </li>
{/snippet}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 0.55);
  }
  .dialog {
    position: fixed;
    z-index: 41;
    top: min(10vh, 80px);
    left: 50%;
    transform: translateX(-50%);
    width: min(680px, calc(100vw - 24px));
    max-height: min(78vh, 720px);
    display: flex;
    flex-direction: column;
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-sheet);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
    border-bottom: 1px solid var(--rule);
  }
  .field svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--text-2);
    stroke-width: 2;
    flex: none;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-18);
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
    padding: var(--s2) 0;
  }
  .close {
    font-size: var(--fs-12);
    min-height: 28px;
    padding: 2px 8px;
    color: var(--text-2);
  }
  .crumb {
    margin: 0;
    padding: var(--s2) var(--s4);
    display: flex;
    gap: var(--s3);
    align-items: center;
    color: var(--text-2);
    font-size: var(--fs-14);
    border-bottom: 1px solid var(--rule);
  }
  .link {
    background: none;
    border: 0;
    color: var(--brass);
    padding: 0;
    min-height: 32px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: var(--s2) 0;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .group {
    padding: var(--s3) var(--s4) var(--s1);
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s4);
    min-height: var(--touch);
    cursor: pointer;
  }
  .row[aria-selected='true'] {
    background: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--rule);
  }
  .main {
    display: grid;
    min-width: 0;
  }
  .label {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: var(--fs-12);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badges {
    display: flex;
    gap: 4px;
  }
  .badge {
    font-size: var(--fs-12);
    color: var(--text-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 0 6px;
    white-space: nowrap;
  }
  .star {
    display: inline-flex;
    align-items: center;
    color: var(--text-2);
    min-height: 32px;
    padding: 0 6px;
    cursor: pointer;
  }
  .star.on {
    color: var(--brass);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    padding: var(--s2) var(--s4);
    border-top: 1px solid var(--rule);
    font-size: var(--fs-14);
    color: var(--text-2);
  }
  @media (max-width: 599px) {
    .dialog {
      top: 0;
      width: 100vw;
      max-height: 100dvh;
      height: 100dvh;
      border-radius: 0;
    }
    .badges {
      display: none;
    }
  }
</style>
