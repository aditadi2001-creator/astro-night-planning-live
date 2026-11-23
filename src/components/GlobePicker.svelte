<script lang="ts">
  /**
   * 3D globe for choosing an observing site: spin the Earth, zoom in on the
   * satellite picture (3D mountains when tilted), click or tap a spot, then use
   * it or save it to the visitor's saved places (this device only).
   *
   * Free, keyless sources (no billing anywhere):
   * - Sentinel-2 cloudless 2024 by EOX (CC BY-NC-SA 4.0) for the satellite picture,
   * - EOX "overlay bright" labels (© OpenStreetMap contributors),
   * - Mapterhorn terrain tiles (Terrarium encoding, open data) for 3D relief.
   * Loaded only when the globe is opened.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
  import type { Place } from '../lib/astro/sky';
  import { loadSavedPlaces, saveSavedPlaces } from '../lib/location';
  import { searchPlaces, type GeoResult } from '../lib/data/openmeteo';
  import { formatLatLon, parseCoordinates } from '../lib/geo/coords';
  import { elevationAt, reverseOsm } from '../lib/geo/places';
  import { reloadRasterSources, watchTiles, type TileStatus } from '../lib/data/maptiles';

  interface Props {
    place: Place;
    /** The visitor chose a place to observe from. */
    onplace: (p: Place) => void;
    onclose: () => void;
  }
  let { place, onplace, onclose }: Props = $props();

  const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0';
  const SAT_TILES = `${EOX}/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`;
  const LABEL_TILES = `${EOX}/overlay_bright_3857/default/g/{z}/{y}/{x}.png`;
  const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';

  let container = $state<HTMLDivElement>();
  let searchInput = $state<HTMLInputElement>();
  let map: MlMap | null = null;
  let siteMarker: MlMarker | null = null;
  let pin: MlMarker | null = null;
  let savedMarkers: MlMarker[] = [];
  let Marker: typeof MlMarker | null = null;
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorText = $state('');
  let tiles = $state<TileStatus>({ pending: false, slow: false });
  let stopWatch: (() => void) | null = null;
  const life = new AbortController();

  let terrainOn = $state(true);
  let labelsOn = $state(true);
  let saved = $state<Place[]>(loadSavedPlaces());

  // ---- the chosen spot --------------------------------------------------------------
  interface Spot {
    lat: number;
    lon: number;
    name: string;
    detail: string;
    elevation: number | null;
    timezone?: string;
    loading: boolean;
  }
  let spot = $state<Spot | null>(null);
  let spotCtrl: AbortController | null = null;

  const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
  const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
  const spotSaved = $derived.by(() => {
    const here = spot;
    return here ? saved.some((s) => same(s, here)) : false;
  });

  /** Mark a point; look up its ground height and a nearby name unless already known. */
  function choose(lat: number, lon: number, known?: Partial<Spot>, fly = false) {
    if (!map || !Marker) return;
    lat = round5(lat);
    lon = round5(lon);
    if (!pin) {
      const el = document.createElement('div');
      el.className = 'globe-pin';
      el.setAttribute('aria-hidden', 'true');
      pin = new Marker({ element: el, anchor: 'bottom' });
    }
    pin.setLngLat([lon, lat]).addTo(map);
    if (fly)
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 11), pitch: 50, speed: 1.6 });

    const s: Spot = {
      lat,
      lon,
      name: known?.name ?? formatLatLon({ lat, lon }, 4),
      detail: known?.detail ?? '',
      elevation: known?.elevation ?? null,
      ...(known?.timezone ? { timezone: known.timezone } : {}),
      loading: true,
    };
    spot = s;
    spotCtrl?.abort();
    const ctrl = new AbortController();
    spotCtrl = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 8000);
    void Promise.all([
      s.elevation == null ? elevationAt(lat, lon, ctrl.signal) : Promise.resolve(s.elevation),
      known?.name ? Promise.resolve(null) : reverseOsm(lat, lon, ctrl.signal),
    ])
      .then(([elev, near]) => {
        if (!spot || !same(spot, s)) return;
        const nearText = near ? [near.name, near.detail].filter(Boolean).join(', ') : '';
        // Keep a name the visitor already started typing.
        const typedName = spot.name !== s.name;
        const fromNear = !typedName && !!near?.name;
        spot = {
          ...s,
          name: typedName ? spot.name : fromNear && near ? near.name : s.name,
          detail:
            s.detail || (fromNear ? (near?.detail ?? '') : nearText ? `near ${nearText}` : ''),
          elevation: elev == null ? null : Math.round(elev),
          loading: false,
        };
      })
      .catch(() => {
        if (spot && same(spot, s)) spot = { ...spot, loading: false };
      })
      .finally(() => clearTimeout(timer));
  }

  function spotPlace(s: Spot): Place {
    return {
      name: s.name.trim() || formatLatLon(s, 4),
      ...(s.detail ? { detail: s.detail } : {}),
      lat: s.lat,
      lon: s.lon,
      elevation: s.elevation ?? 0,
      ...(s.elevation == null ? { needsElevation: true } : {}),
      ...(s.timezone ? { timezone: s.timezone } : {}),
    };
  }

  function useSpot() {
    if (!spot) return;
    onplace(spotPlace(spot));
  }

  function toggleSave() {
    if (!spot) return;
    const s = spot;
    saved = spotSaved ? saved.filter((p) => !same(p, s)) : [spotPlace(s), ...saved];
    saveSavedPlaces(saved);
  }

  function clearSpot() {
    spotCtrl?.abort();
    spot = null;
    pin?.remove();
  }

  // ---- saved places on the globe --------------------------------------------------
  $effect(() => {
    const list = saved;
    const m0 = map;
    const Mk = Marker;
    if (status !== 'ready' || !m0 || !Mk) return;
    for (const m of savedMarkers) m.remove();
    savedMarkers = list.map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'globe-star';
      el.textContent = '★';
      el.title = p.name;
      el.setAttribute('aria-label', `Saved place: ${p.name}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(p.lat, p.lon, known(p));
      });
      return new Mk({ element: el }).setLngLat([p.lon, p.lat]).addTo(m0);
    });
  });

  /** What a saved place already tells us (no lookups needed). */
  function known(p: Place): Partial<Spot> {
    return {
      name: p.name,
      detail: p.detail ?? '',
      elevation: p.needsElevation ? null : p.elevation,
      ...(p.timezone ? { timezone: p.timezone } : {}),
    };
  }

  function flyToSaved(p: Place) {
    choose(p.lat, p.lon, known(p), true);
  }

  function removeSaved(p: Place) {
    saved = saved.filter((s) => !same(s, p));
    saveSavedPlaces(saved);
  }

  // ---- search ---------------------------------------------------------------------
  let query = $state('');
  let results = $state<GeoResult[]>([]);
  let searchMsg = $state('');
  let searchCtrl: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const typed = $derived(parseCoordinates(query));

  function onInput() {
    if (debounce) clearTimeout(debounce);
    searchMsg = '';
    const q = query.trim();
    if (q.length < 2 || parseCoordinates(q)) {
      results = [];
      return;
    }
    debounce = setTimeout(() => void runSearch(q), 350);
  }

  async function runSearch(q: string) {
    searchCtrl?.abort();
    searchCtrl = new AbortController();
    try {
      results = await searchPlaces(q, searchCtrl.signal);
      if (!results.length) searchMsg = 'No places found. Try a bigger town nearby, then click.';
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        searchMsg = 'Search is unavailable right now. You can still click the globe.';
    }
  }

  function pickResult(r: GeoResult) {
    results = [];
    query = '';
    choose(
      r.latitude,
      r.longitude,
      {
        name: r.name,
        detail: [r.admin1, r.country].filter(Boolean).join(', '),
        elevation: r.elevation != null ? Math.round(r.elevation) : null,
        ...(r.timezone ? { timezone: r.timezone } : {}),
      },
      true,
    );
  }

  function goTyped() {
    // Read before clearing the box: `typed` is derived from it.
    const t = typed;
    if (!t) return;
    query = '';
    choose(t.lat, t.lon, undefined, true);
  }

  // ---- view controls --------------------------------------------------------------
  $effect(() => {
    const on = terrainOn;
    if (status !== 'ready' || !map) return;
    map.setTerrain(on ? { source: 'terrain', exaggeration: 1.3 } : null);
    if (map.getLayer('hillshade'))
      map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
  });
  $effect(() => {
    const on = labelsOn;
    if (status !== 'ready' || !map?.getLayer('labels')) return;
    map.setLayoutProperty('labels', 'visibility', on ? 'visible' : 'none');
  });

  function home() {
    map?.flyTo({ center: [place.lon, place.lat], zoom: 2.2, pitch: 0, bearing: 0, speed: 1.4 });
  }
  function tilt() {
    if (!map) return;
    const flat = map.getPitch() < 20;
    map.easeTo({ pitch: flat ? 60 : 0, zoom: flat ? Math.max(map.getZoom(), 10) : map.getZoom() });
  }

  // ---- lifecycle ------------------------------------------------------------------
  /** Show above everything, inside the full-screen element when there is one. */
  function lift(node: HTMLElement) {
    (document.fullscreenElement ?? document.body).appendChild(node);
    return { destroy: () => node.remove() };
  }

  let before: Element | null = null;
  onMount(() => {
    before = document.activeElement;
    void start();
    void tick().then(() => searchInput?.focus());
  });

  async function start() {
    try {
      const ml = await import('maplibre-gl');
      if (life.signal.aborted || !container) return;
      ml.setWorkerUrl(workerUrl);
      Marker = ml.Marker;
      map = new ml.Map({
        container,
        center: [place.lon, place.lat],
        zoom: 1.6,
        minZoom: 0.6,
        maxZoom: 17,
        maxPitch: 80,
        attributionControl: { compact: true },
        style: {
          version: 8,
          projection: { type: 'globe' },
          sky: {
            'sky-color': '#05070d',
            'horizon-color': '#4b7bd8',
            'fog-color': '#a9c4ff',
            'sky-horizon-blend': 0.5,
            'horizon-fog-blend': 0.6,
            'fog-ground-blend': 0.85,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 10, 0],
          },
          sources: {
            sat: {
              type: 'raster',
              tiles: [SAT_TILES],
              tileSize: 256,
              maxzoom: 15,
              attribution:
                '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2024</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024, CC BY-NC-SA 4.0)',
            },
            labels: {
              type: 'raster',
              tiles: [LABEL_TILES],
              tileSize: 256,
              maxzoom: 16,
              attribution:
                'Labels: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, rendering EOX',
            },
            terrain: {
              type: 'raster-dem',
              tiles: [TERRAIN_TILES],
              tileSize: 512,
              maxzoom: 12,
              encoding: 'terrarium',
              attribution:
                'Terrain: <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>',
            },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#05070d' } },
            { id: 'sat', type: 'raster', source: 'sat' },
            {
              id: 'hillshade',
              type: 'hillshade',
              source: 'terrain',
              minzoom: 6,
              paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#000' },
            },
            { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
          ],
        },
      });
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
      map
        .getCanvas()
        .setAttribute('aria-label', '3D globe (drag to spin, scroll or pinch to zoom)');

      const dot = document.createElement('div');
      dot.className = 'globe-site';
      dot.title = `Current site: ${place.name}`;
      siteMarker = new ml.Marker({ element: dot }).setLngLat([place.lon, place.lat]).addTo(map);

      map.on('click', (e) => {
        const { lat, lng } = e.lngLat.wrap();
        choose(lat, lng);
      });
      map.once('style.load', () => (status = 'ready'));
      map.once('load', () => {
        status = 'ready';
        // Start with the credits folded into the (i) button so they do not cover the panel.
        container
          ?.querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show');
      });
      stopWatch = watchTiles(map, (t) => (tiles = t));
      map.on('error', (e) => {
        if (!String(e.error?.message ?? '').includes('404')) console.warn('globe:', e.error);
      });
    } catch (e) {
      if (life.signal.aborted) return;
      status = 'error';
      errorText = e instanceof Error ? e.message : String(e);
    }
  }

  onDestroy(() => {
    life.abort();
    spotCtrl?.abort();
    searchCtrl?.abort();
    if (debounce) clearTimeout(debounce);
    stopWatch?.();
    for (const m of savedMarkers) m.remove();
    siteMarker?.remove();
    pin?.remove();
    map?.remove();
    if (before instanceof HTMLElement) before.focus();
  });

  function onKey(e: KeyboardEvent) {
    // Keep keys away from the sky view behind (arrow keys pan the sky there).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (results.length) results = [];
      else if (spot) clearSpot();
      else onclose();
    }
  }
</script>

<div class="host" hidden>
  <div
    class="globe"
    use:lift
    role="dialog"
    aria-modal="true"
    aria-label="Choose a location on the 3D globe"
    tabindex="-1"
    onkeydown={onKey}
  >
    <div class="map" bind:this={container}></div>

    <div class="top">
      <div class="search">
        <label>
          <span class="visually-hidden">Search a place or type coordinates</span>
          <input
            bind:this={searchInput}
            bind:value={query}
            oninput={onInput}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                if (typed) goTyped();
                else if (results[0]) pickResult(results[0]);
              }
            }}
            type="search"
            placeholder="Find a place, or type lat, lon"
            autocomplete="off"
          />
        </label>
        {#if typed}
          <ul class="results" aria-label="Coordinates">
            <li>
              <button onclick={goTyped}>
                <strong>Go to these coordinates</strong>
                <span class="mono">{formatLatLon(typed, 5)}</span>
              </button>
            </li>
          </ul>
        {:else if results.length}
          <ul class="results" aria-label="Search results">
            {#each results as r (`${r.latitude},${r.longitude}`)}
              <li>
                <button onclick={() => pickResult(r)}>
                  <strong>{r.name}</strong>
                  <span>{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if searchMsg}
          <p class="note" role="status">{searchMsg}</p>
        {/if}
      </div>
      <button class="close" onclick={onclose} aria-label="Close the globe">×</button>
    </div>

    <div class="tools" role="group" aria-label="Globe view">
      <button onclick={home} title="Back to the whole globe at your site">Globe</button>
      <button onclick={tilt} title="Tilt to see mountains in 3D">Tilt 3D</button>
      <button
        onclick={() => (terrainOn = !terrainOn)}
        aria-pressed={terrainOn}
        title="Raise mountains and valleys">Terrain</button
      >
      <button onclick={() => (labelsOn = !labelsOn)} aria-pressed={labelsOn}>Labels</button>
    </div>

    <div class="panel" aria-live="polite">
      {#if spot}
        <label class="name">
          <span class="visually-hidden">Name for this place</span>
          <input bind:value={spot.name} maxlength="80" aria-label="Name for this place" />
        </label>
        {#if spot.detail}<p class="muted">{spot.detail}</p>{/if}
        <p class="mono">
          {formatLatLon(spot, 5)} ·
          {#if spot.elevation != null}{spot.elevation} m{:else if spot.loading}height…{:else}height
            unknown{/if}
        </p>
        <div class="row">
          <button class="primary" onclick={useSpot}>Use this location</button>
          <button onclick={toggleSave} aria-pressed={spotSaved}>
            {spotSaved ? '★ Saved' : '☆ Save'}
          </button>
          <button onclick={clearSpot} aria-label="Clear the chosen point">×</button>
        </div>
      {:else}
        <p class="hint">
          <strong>Click or tap anywhere on the globe</strong> to choose a spot. Drag to spin, scroll or
          pinch to zoom, right-drag (or two fingers) to tilt.
        </p>
      {/if}

      {#if saved.length}
        <details class="saved" open={!spot}>
          <summary>Saved places ({saved.length})</summary>
          <ul>
            {#each saved as p (`${p.lat},${p.lon}`)}
              <li>
                <button class="item" onclick={() => flyToSaved(p)}>
                  <strong>★ {p.name}</strong>
                  {#if p.detail}<span>{p.detail}</span>{/if}
                </button>
                <button class="rm" onclick={() => removeSaved(p)} aria-label={`Remove ${p.name}`}
                  >×</button
                >
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <p class="privacy">Saved places stay on this device only.</p>
    </div>

    {#if status === 'loading'}<p class="chip" role="status">Loading the globe…</p>{/if}
    {#if status === 'error'}<p class="chip error" role="alert">
        The globe could not start: {errorText}
      </p>{/if}
    {#if status === 'ready' && tiles.pending && tiles.slow}
      <p class="chip" role="status">
        Satellite pictures are downloading slowly…
        <button onclick={() => map && reloadRasterSources(map)}>Retry</button>
      </p>
    {/if}
  </div>
</div>

<style>
  .globe {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #05070d;
    color: var(--text);
  }
  .map {
    position: absolute;
    inset: 0;
  }
  /* Night mode: the satellite picture in red only, like the sky. */
  :global(:root[data-night='true']) .map :global(canvas) {
    filter: var(--sky-filter);
  }
  .top {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 60px;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    pointer-events: none;
    /* Search results open over the tool buttons. */
    z-index: 2;
  }
  .top > * {
    pointer-events: auto;
  }
  .search {
    flex: 1;
    max-width: 420px;
    min-width: 0;
  }
  input {
    width: 100%;
    font: inherit;
    color: inherit;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 10px;
    min-height: 40px;
  }
  .close {
    min-width: 40px;
    min-height: 40px;
    font-size: 20px;
    line-height: 1;
    background: var(--panel);
  }
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 4px;
    display: grid;
    gap: 2px;
    max-height: 45vh;
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .results button,
  .saved .item {
    display: grid;
    width: 100%;
    text-align: left;
    gap: 1px;
    border-color: transparent;
  }
  .results span,
  .saved .item span {
    font-size: 12px;
    color: var(--muted);
  }
  .note {
    margin: 4px 0 0;
    padding: 6px 10px;
    font-size: 13px;
    background: var(--panel);
    border-radius: 8px;
  }
  .tools {
    position: absolute;
    left: 10px;
    top: 60px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools button {
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    font-size: 13px;
    padding: 5px 10px;
  }
  .tools button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .panel {
    position: absolute;
    left: 10px;
    bottom: 34px;
    width: min(380px, calc(100% - 20px));
    max-height: 55vh;
    overflow: auto;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
  }
  .panel p {
    margin: 4px 0 0;
    font-size: 13px;
  }
  .name input {
    font-weight: 600;
    min-height: 36px;
  }
  .hint {
    margin-top: 0;
  }
  .muted,
  .privacy {
    color: var(--muted);
  }
  .privacy {
    font-size: 12px !important;
  }
  .mono {
    font-family: var(--mono);
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .primary {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .saved {
    margin-top: 10px;
    font-size: 14px;
  }
  .saved summary {
    cursor: pointer;
    color: var(--muted);
  }
  .saved ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .saved li {
    display: flex;
    gap: 4px;
  }
  .rm {
    flex: none;
  }
  .chip {
    position: absolute;
    left: 50%;
    top: 60px;
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 12px;
    font-size: 13px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .chip.error {
    color: var(--bad);
  }
  /* Markers live inside the MapLibre canvas container, outside this component's scope. */
  .globe :global(.globe-site) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #fff;
    box-shadow: 0 0 0 3px rgb(0 0 0 / 0.4);
  }
  .globe :global(.globe-pin) {
    width: 22px;
    height: 30px;
    background: #ff5a48;
    clip-path: path('M11 30 C11 30 0 17 0 11 A11 11 0 0 1 22 11 C22 17 11 30 11 30 Z');
    pointer-events: none;
  }
  .globe :global(.globe-pin)::after {
    content: '';
    position: absolute;
    left: 7px;
    top: 7px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
  }
  .globe :global(.globe-star) {
    padding: 0;
    width: 24px;
    height: 24px;
    line-height: 22px;
    font-size: 16px;
    border-radius: 50%;
    color: #ffd54a;
    background: rgb(0 0 0 / 0.55);
    border: 1px solid #ffd54a;
    cursor: pointer;
  }
  @media (max-width: 600px) {
    .tools {
      top: 58px;
    }
    .panel {
      left: 6px;
      right: 6px;
      width: auto;
      bottom: 28px;
      max-height: 45vh;
    }
  }
</style>
