<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import { loadSavedPlaces, locateMe, saveSavedPlaces } from '../lib/location';
  import { searchPlaces, type GeoResult } from '../lib/data/openmeteo';
  import { formatLatLon, parseCoordinates, type LatLon } from '../lib/geo/coords';
  import { elevationAt, reverseOsm, searchOsm, type OsmPlace } from '../lib/geo/places';

  interface Props {
    place: Place;
    onplace: (p: Place) => void;
    onclose: () => void;
    /** Inside another window (the sky's location window): no drop-down positioning. */
    embedded?: boolean;
  }
  let { place, onplace, onclose, embedded = false }: Props = $props();

  let query = $state('');
  let results = $state<GeoResult[]>([]);
  let searching = $state(false);
  let message = $state('');
  let saved = $state<Place[]>(loadSavedPlaces());
  let osm = $state<OsmPlace[]>([]);
  let osmState = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
  let latText = $state('');
  let lonText = $state('');
  let busy = $state(false);
  const typed = $derived(parseCoordinates(query));
  const fields = $derived(latText && lonText ? parseCoordinates(`${latText}, ${lonText}`) : null);
  let input: HTMLInputElement;
  let ctrl: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    input?.focus();
  });

  function onInput() {
    if (debounce) clearTimeout(debounce);
    const q = query.trim();
    osm = [];
    osmState = 'idle';
    if (q.length < 2 || parseCoordinates(q)) {
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

  async function moreOsm() {
    const q = query.trim();
    if (q.length < 2) return;
    ctrl?.abort();
    ctrl = new AbortController();
    osmState = 'loading';
    try {
      osm = await searchOsm(q, ctrl.signal);
      osmState = 'done';
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) osmState = 'error';
    }
  }

  /** Coordinates → place, with the exact ground height and a nearby name when available. */
  async function useCoords(c: LatLon, known?: OsmPlace) {
    busy = true;
    message = 'Looking up the ground height…';
    const sig = new AbortController();
    const timer = setTimeout(() => sig.abort(), 6000);
    try {
      const [elev, near] = await Promise.all([
        elevationAt(c.lat, c.lon, sig.signal),
        known ? Promise.resolve(known) : reverseOsm(c.lat, c.lon, sig.signal),
      ]);
      const nearText = near ? [near.name, near.detail].filter(Boolean).join(', ') : '';
      onplace({
        name: known?.name ?? formatLatLon(c, 4),
        detail: known ? known.detail : nearText ? `near ${nearText}` : '',
        lat: c.lat,
        lon: c.lon,
        elevation: Math.round(elev ?? 0),
        ...(elev == null ? { needsElevation: true } : {}),
      });
      onclose();
    } finally {
      clearTimeout(timer);
      busy = false;
    }
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
  class:embedded
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

  {#if typed}
    <ul class="list" aria-label="Coordinates">
      <li>
        <button class="item" onclick={() => typed && useCoords(typed)} disabled={busy}>
          <strong>Use these coordinates</strong>
          <span class="coords">{formatLatLon(typed, 5)}</span>
        </button>
      </li>
    </ul>
  {/if}

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

  {#if query.trim().length >= 2 && !typed}
    <div class="row actions">
      <button onclick={moreOsm} disabled={osmState === 'loading'}>
        {osmState === 'loading'
          ? 'Searching OpenStreetMap…'
          : 'Search more places (villages, peaks, observatories)'}
      </button>
    </div>
    {#if osmState === 'error'}
      <p class="msg" role="status">OpenStreetMap search is unavailable right now.</p>
    {/if}
    {#if osmState === 'done' && !osm.length}
      <p class="msg" role="status">OpenStreetMap found nothing either.</p>
    {/if}
    {#if osm.length}
      <ul class="list" aria-label="OpenStreetMap results">
        {#each osm as r (`${r.lat},${r.lon}`)}
          <li>
            <button
              class="item"
              onclick={() => useCoords({ lat: r.lat, lon: r.lon }, r)}
              disabled={busy}
            >
              <strong>{r.name}</strong>
              <span>{[r.kind, r.detail].filter(Boolean).join(' · ')}</span>
              <span class="coords">{r.lat.toFixed(4)}°, {r.lon.toFixed(4)}°</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="credit-line">Places: © OpenStreetMap contributors (ODbL), via Nominatim</p>
    {/if}
  {/if}

  <details class="coord-box">
    <summary>Enter coordinates</summary>
    <form
      class="coord-form"
      onsubmit={(e) => {
        e.preventDefault();
        if (fields) void useCoords(fields);
      }}
    >
      <label>
        Latitude
        <input bind:value={latText} placeholder="12.9716 or 12°58′18″N" autocomplete="off" />
      </label>
      <label>
        Longitude
        <input bind:value={lonText} placeholder="77.5946 or 77°35′41″E" autocomplete="off" />
      </label>
      <button type="submit" disabled={!fields || busy}>Go</button>
    </form>
    <p class="msg">
      {#if latText && lonText && !fields}
        Not a valid latitude/longitude.
      {:else}
        Decimal degrees (south and west negative) or degrees, minutes, seconds with N/S/E/W. You can
        also paste "lat, lon" (for example from a map app) into the search box.
      {/if}
    </p>
  </details>

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
  .picker.embedded {
    position: static;
    max-width: none;
    padding: 0;
    border: none;
    box-shadow: none;
    background: transparent;
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
  .coord-box {
    margin-top: 10px;
    font-size: 14px;
  }
  .coord-box summary {
    cursor: pointer;
    color: var(--muted);
  }
  .coord-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 6px;
    align-items: end;
    margin-top: 6px;
  }
  .coord-form label {
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-width: 420px) {
    .coord-form {
      grid-template-columns: 1fr;
    }
  }
  .msg,
  .privacy {
    font-size: 12px;
    color: var(--muted);
    margin: 8px 0 0;
  }
</style>
