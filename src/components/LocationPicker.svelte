<script lang="ts">
  import OfflinePanel from './OfflinePanel.svelte';
  import type { Place } from '../lib/astro/sky';
  import { loadSavedPlaces, locateMe, PRESETS, saveSavedPlaces } from '../lib/location';
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
  /** The 3D globe (MapLibre and its tiles load only when it is opened). */
  let globe = $state(false);
  const loadGlobe = () => import('./GlobePicker.svelte');
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

  // ---- elevation of each place (ground height, metres above sea level) ----
  /** Lowest and highest ground on Earth, rounded out: anything else is a typo. */
  const ELEV_MIN = -450;
  const ELEV_MAX = 8900;
  const validElev = (v: number) => Number.isFinite(v) && v >= ELEV_MIN && v <= ELEV_MAX;
  /** The field's number (Svelte binds number inputs as numbers; empty = null). */
  let elevInput = $state<number | null>(null);
  let elevMsg = $state('');
  let elevBusy = $state(false);
  // Follow the current place; the message is cleared only when another place is picked.
  let elevFor = '';
  $effect(() => {
    elevInput = place.needsElevation ? null : Math.round(place.elevation);
    const key = `${place.lat},${place.lon}`;
    if (key !== elevFor) {
      elevFor = key;
      elevMsg = '';
    }
  });
  const elevValue = $derived(elevInput == null ? Number.NaN : Number(elevInput));
  const elevChanged = $derived(
    validElev(elevValue) &&
      (place.needsElevation || Math.round(elevValue) !== Math.round(place.elevation)),
  );

  /** The same place with a new elevation. A built-in place becomes the visitor's own copy. */
  function withElevation(p: Place, m: number): Place {
    const next: Place = { ...p, elevation: Math.round(m), needsElevation: false };
    delete next.id;
    return next;
  }

  function applyElevation() {
    if (!validElev(elevValue)) {
      elevMsg = `Enter a height between ${ELEV_MIN} and ${ELEV_MAX} m.`;
      return;
    }
    const next = withElevation(place, elevValue);
    // Keep a saved copy of this place in step.
    if (saved.some((s) => same(s, place))) {
      saved = saved.map((s) => (same(s, place) ? withElevation(s, elevValue) : s));
      saveSavedPlaces(saved);
    }
    onplace(next);
    elevMsg = `Elevation set to ${Math.round(elevValue)} m: the sky, refraction, terrain horizon and forecasts use it.`;
  }

  async function elevationFromMap() {
    elevBusy = true;
    elevMsg = 'Looking up the ground height…';
    const sig = new AbortController();
    const timer = setTimeout(() => sig.abort(), 6000);
    try {
      const m = await elevationAt(place.lat, place.lon, sig.signal);
      if (m == null) elevMsg = 'The terrain map has no height here (n/a). Type it in instead.';
      else {
        elevInput = Math.round(m);
        elevMsg = `Terrain map: ${Math.round(m)} m. Press Set to use it.`;
      }
    } catch {
      elevMsg = 'The terrain map is unavailable right now. Type the height in instead.';
    } finally {
      clearTimeout(timer);
      elevBusy = false;
    }
  }

  /** Edit the elevation of a saved place in the list (and of the current place if it is that one). */
  function setSavedElevation(p: Place, text: string) {
    const v = Number(text);
    if (!validElev(v)) return;
    saved = saved.map((s) => (same(s, p) ? withElevation(s, v) : s));
    saveSavedPlaces(saved);
    if (same(p, place)) onplace(withElevation(place, v));
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
    <button class="globe-btn" onclick={() => (globe = true)} aria-haspopup="dialog">
      🌍 Pick on the 3D globe
    </button>
    <button onclick={gps}>Use my location (GPS)</button>
    <button onclick={toggleSave} aria-pressed={isSaved}>
      {isSaved ? '★ Saved' : '☆ Save this place'}
    </button>
  </div>

  <section class="here" aria-label="Elevation of this place">
    <p class="here-name">
      <strong>{place.name}</strong>
      <span class="coords">{place.lat.toFixed(4)}°, {place.lon.toFixed(4)}°</span>
    </p>
    <form
      class="elev-form"
      onsubmit={(e) => {
        e.preventDefault();
        applyElevation();
      }}
    >
      <label>
        Elevation (m above sea level)
        <input
          type="number"
          inputmode="numeric"
          step="1"
          min={ELEV_MIN}
          max={ELEV_MAX}
          bind:value={elevInput}
          placeholder="n/a"
        />
      </label>
      <button type="submit" disabled={!elevChanged}>Set</button>
      <button type="button" onclick={elevationFromMap} disabled={elevBusy}>From terrain map</button>
    </form>
    {#if elevMsg}<p class="msg" role="status">{elevMsg}</p>{/if}
  </section>

  <div class="presets" role="group" aria-label="Built-in places">
    {#each PRESETS as p (p.id)}
      <button
        class="preset"
        aria-pressed={place.id === p.id}
        onclick={() => {
          onplace(p);
          onclose();
        }}
      >
        <strong>{p.name}</strong>
        <span>{p.detail}</span>
        <span class="coords">{Math.round(p.elevation)} m</span>
      </button>
    {/each}
  </div>

  {#if globe}
    {#await loadGlobe()}
      <p class="msg" role="status">Opening the globe…</p>
    {:then { default: GlobePicker }}
      <GlobePicker
        {place}
        onplace={(p) => {
          globe = false;
          onplace(p);
          onclose();
        }}
        onclose={() => {
          globe = false;
          // Places saved on the globe show up in the list here.
          saved = loadSavedPlaces();
        }}
      />
    {:catch}
      <p class="msg" role="alert">The globe could not load. Check the connection and try again.</p>
    {/await}
  {/if}

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
          <label class="saved-elev">
            <span class="visually-hidden">Elevation of {p.name} in metres</span>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              min={ELEV_MIN}
              max={ELEV_MAX}
              value={p.needsElevation ? '' : Math.round(p.elevation)}
              placeholder="n/a"
              onchange={(e) => setSavedElevation(p, (e.currentTarget as HTMLInputElement).value)}
            />
            <span aria-hidden="true">m</span>
          </label>
          <button class="rm" onclick={() => remove(p)} aria-label={`Remove ${p.name}`}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="privacy">Locations are stored only on this device.</p>
  <OfflinePanel placeName={place.name} />
</div>

<style>
  .picker {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    /* Its own width: the location button it hangs from is narrow. */
    width: min(460px, calc(100vw - 24px));
    max-height: calc(100dvh - 120px);
    overflow-y: auto;
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
  .globe-btn {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
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
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
    gap: var(--s2);
  }
  .preset {
    display: grid;
    gap: 2px;
    text-align: left;
    min-height: var(--touch);
  }
  .preset span {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .preset[aria-pressed='true'] {
    border-color: var(--brass);
  }
  .saved {
    display: flex;
    gap: 4px;
  }
  .rm {
    flex: none;
  }
  .saved .item {
    flex: 1 1 auto;
    min-width: 0;
  }
  .saved-elev {
    flex: none;
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .saved-elev input {
    width: 5.5em;
  }
  .here {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .here-name {
    margin: 0 0 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
  }
  .elev-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: end;
  }
  .elev-form label {
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
  }
  .elev-form input {
    min-width: 0;
  }
  @media (max-width: 420px) {
    .elev-form {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .elev-form label {
      grid-column: 1 / -1;
    }
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
