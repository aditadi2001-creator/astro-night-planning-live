<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import { loadSavedPlaces, locateMe, saveSavedPlaces } from '../lib/location';
  import { searchPlaces, type GeoResult } from '../lib/data/openmeteo';

  interface Props {
    place: Place;
    onplace: (p: Place) => void;
    onclose: () => void;
  }
  let { place, onplace, onclose }: Props = $props();

  let query = $state('');
  let results = $state<GeoResult[]>([]);
  let searching = $state(false);
  let message = $state('');
  let saved = $state<Place[]>(loadSavedPlaces());
  let input: HTMLInputElement;
  let ctrl: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    input?.focus();
  });

  function onInput() {
    if (debounce) clearTimeout(debounce);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    debounce = setTimeout(() => void run(q), 350);
  }

  async function run(q: string) {
    ctrl?.abort();
    ctrl = new AbortController();
    searching = true;
    message = '';
    try {
      results = await searchPlaces(q, ctrl.signal);
      if (!results.length) message = 'No places found.';
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        message = 'Search is unavailable right now. You can still use GPS or a saved place.';
    } finally {
      searching = false;
    }
  }

  function pick(r: GeoResult) {
    onplace({
      name: r.name,
      detail: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
      elevation: Math.round(r.elevation ?? 0),
      ...(r.timezone ? { timezone: r.timezone } : {}),
    });
    onclose();
  }

  async function gps() {
    message = 'Locating…';
    try {
      onplace(await locateMe());
      onclose();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }

  const same = (a: Place, b: Place) =>
    Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
  const isSaved = $derived(saved.some((s) => same(s, place)));

  function toggleSave() {
    saved = isSaved ? saved.filter((s) => !same(s, place)) : [place, ...saved];
    saveSavedPlaces(saved);
  }

  function remove(p: Place) {
    saved = saved.filter((s) => !same(s, p));
    saveSavedPlaces(saved);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<div
  class="picker"
  role="dialog"
  aria-modal="false"
  aria-label="Choose observing location"
  tabindex="-1"
  onkeydown={onKey}
>
  <div class="row">
    <label class="search">
      <span class="visually-hidden">Search for a place</span>
      <input
        bind:this={input}
        bind:value={query}
        oninput={onInput}
        type="search"
        placeholder="Search a town, observatory, dark site…"
        autocomplete="off"
      />
    </label>
    <button onclick={onclose} aria-label="Close location picker">×</button>
  </div>

  <div class="row actions">
    <button onclick={gps}>Use my location (GPS)</button>
    <button onclick={toggleSave} aria-pressed={isSaved}>
      {isSaved ? '★ Saved' : '☆ Save this place'}
    </button>
  </div>

  {#if searching}<p class="msg" role="status">Searching…</p>{/if}
  {#if message}<p class="msg" role="status">{message}</p>{/if}

  {#if results.length}
    <ul class="list" aria-label="Search results">
      {#each results as r (`${r.latitude},${r.longitude}`)}
        <li>
          <button class="item" onclick={() => pick(r)}>
            <strong>{r.name}</strong>
            <span>{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
            <span class="coords"
              >{r.latitude.toFixed(2)}°, {r.longitude.toFixed(2)}°{r.elevation != null
                ? ` · ${Math.round(r.elevation)} m`
                : ''}</span
            >
          </button>
        </li>
      {/each}
    </ul>
    <p class="credit-line">Search: Open-Meteo geocoding (GeoNames, CC BY 4.0)</p>
  {/if}

  {#if saved.length}
    <h3>Saved places</h3>
    <ul class="list" aria-label="Saved places">
      {#each saved as p (`${p.lat},${p.lon}`)}
        <li class="saved">
          <button
            class="item"
            onclick={() => {
              onplace(p);
              onclose();
            }}
          >
            <strong>{p.name}</strong>
            {#if p.detail}<span>{p.detail}</span>{/if}
          </button>
          <button class="rm" onclick={() => remove(p)} aria-label={`Remove ${p.name}`}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="privacy">Locations are stored only on this device.</p>
</div>

<style>
  .picker {
    position: absolute;
    top: calc(100% + 6px);
    left: var(--gap);
    right: var(--gap);
    max-width: 460px;
    z-index: 20;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .actions {
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
  }
  input {
    width: 100%;
    font: inherit;
    color: inherit;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 10px;
    min-height: 38px;
  }
  .list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 4px;
    max-height: 45vh;
    overflow: auto;
  }
  .item {
    display: grid;
    width: 100%;
    text-align: left;
    gap: 1px;
  }
  .item span {
    font-size: 12px;
    color: var(--muted);
  }
  .coords {
    font-family: var(--mono);
  }
  .saved {
    display: flex;
    gap: 4px;
  }
  .rm {
    flex: none;
  }
  h3 {
    font-size: 13px;
    color: var(--muted);
    margin: 12px 0 0;
  }
  .msg,
  .privacy {
    font-size: 12px;
    color: var(--muted);
    margin: 8px 0 0;
  }
</style>
