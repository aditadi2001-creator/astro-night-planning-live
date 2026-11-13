<script lang="ts">
  /**
   * Satellite cloud map (off by default; this file and MapLibre load only when
   * it is switched on). Thermal infrared: cold cloud tops are white, warm
   * ground is dark, by day and by night alike.
   *
   * Layers, bottom to top: NASA Black Marble night lights · NOAA GMGSI hourly
   * global mosaic (our pipeline, via the data Worker; the only one covering
   * Europe, Africa and India) · GIBS GOES-West, GOES-East and Himawari every
   * 10 minutes · coastlines. Animation over the last ~2.5 hours, frames are
   * fetched only when you play or scrub to them.
   */
  import { onDestroy, onMount } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
  import type { Place } from '../lib/astro/sky';
  import {
    BASE_TILES,
    COAST_TILES,
    GEO_LAYERS,
    floorSlot,
    frameTimes,
    geoTiles,
    gibsTime,
    latestTime,
    type GeoLayer,
  } from '../lib/sat/gibs';
  import { GMGSI_INDEX_URL, gmgsiTiles, loadGmgsiIndex } from '../lib/sat/gmgsi';
  import { clipUrl, loadClipped } from '../lib/sat/mask';
  import { fmtTime } from '../lib/time/format';

  let { place, tz }: { place: Place; tz: string | undefined } = $props();

  interface Frame {
    t: number;
    geo: { layer: GeoLayer; t: number }[];
    gmgsi: { hour: string; t: number } | null;
  }

  let container: HTMLDivElement;
  let wrap: HTMLElement;
  let full = $state(false);
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap?.requestFullscreen?.().catch(() => undefined);
  }
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFull();
    }
  }
  onMount(() => {
    const onFs = () => {
      full = document.fullscreenElement === wrap;
      // MapLibre must measure its new size after entering or leaving full screen.
      requestAnimationFrame(() => map?.resize());
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  });
  let map: MlMap | null = null;
  let marker: MlMarker | null = null;
  let frames = $state<Frame[]>([]);
  let index = $state(0);
  let playing = $state(false);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  /** True once the map style has loaded; sources can't be added before. */
  let styleReady = $state(false);
  let message = $state('');
  let timer: ReturnType<typeof setInterval> | null = null;
  const ctrl = new AbortController();

  const OPACITY = 0.9;
  /** Layer ids currently drawn (bookkeeping only, not UI state). */
  let shown: string[] = [];

  const geoId = (g: { layer: GeoLayer; t: number }) => `geo-${g.layer.label}-${g.t}`;
  const gmgsiId = (hour: string) => `gmgsi-${hour}`;

  /** Add the frame's layers (transparent) so their tiles start loading. */
  function ensureFrame(f: Frame | undefined): void {
    if (!map || !f) return;
    if (f.gmgsi && !map.getLayer(gmgsiId(f.gmgsi.hour))) {
      const id = gmgsiId(f.gmgsi.hour);
      map.addSource(id, {
        type: 'raster',
        tiles: [gmgsiTiles(f.gmgsi.hour)],
        tileSize: 256,
        maxzoom: 5,
        attribution: 'NOAA/NESDIS GMGSI',
      });
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
        },
        'slot-gmgsi',
      );
    }
    for (const g of f.geo) {
      const id = geoId(g);
      if (map.getLayer(id)) continue;
      map.addSource(id, {
        type: 'raster',
        // Clipped to the region this satellite sees well (pixel-exact, see mask.ts).
        tiles: [clipUrl(geoTiles(g.layer.id, g.t), g.layer.bounds[0], g.layer.bounds[2])],
        tileSize: 256,
        maxzoom: 6,
        bounds: g.layer.bounds,
        attribution: 'NASA GIBS',
      });
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
        },
        'slot-geo',
      );
    }
  }

  function show(i: number): void {
    const f = frames[i];
    if (!map || !f) return;
    ensureFrame(f);
    const want = new Set([...f.geo.map(geoId), ...(f.gmgsi ? [gmgsiId(f.gmgsi.hour)] : [])]);
    for (const id of [...shown, ...want]) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, 'raster-opacity', want.has(id) ? OPACITY : 0);
    }
    shown = [...want];
  }

  function play(): void {
    if (!styleReady) return;
    if (playing) {
      playing = false;
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    playing = true;
    if (index >= frames.length - 1) index = 0;
    ensureFrame(frames[index + 1]);
    timer = setInterval(() => {
      index = (index + 1) % frames.length;
      ensureFrame(frames[(index + 1) % frames.length]); // preload the next one
    }, 1100);
  }

  $effect(() => {
    if (styleReady) show(index);
  });

  // Keep the marker on the site when the location changes.
  $effect(() => {
    const lngLat: [number, number] = [place.lon, place.lat];
    marker?.setLngLat(lngLat);
    map?.easeTo({ center: lngLat });
  });

  onMount(async () => {
    try {
      const ml = await import('maplibre-gl');
      ml.setWorkerUrl(workerUrl);
      ml.removeProtocol('gibsclip');
      ml.addProtocol('gibsclip', async (params, abort) => ({
        data: await loadClipped(params.url, abort.signal),
      }));
      const now = Date.now();
      const [latest, idx] = await Promise.all([
        Promise.all(GEO_LAYERS.map((l) => latestTime(l, now, ctrl.signal))),
        GMGSI_INDEX_URL ? loadGmgsiIndex(ctrl.signal).catch(() => null) : Promise.resolve(null),
      ]);
      if (ctrl.signal.aborted) return;
      const hours = (idx?.data.hours ?? []).map((h) => ({ hour: h.hour, t: Date.parse(h.time) }));
      const newestGeo = Math.max(...latest.filter((t): t is number => t != null));
      const end = Number.isFinite(newestGeo) ? newestGeo : (hours[0]?.t ?? null);
      if (end == null) throw new Error('No recent satellite images are available right now.');
      frames = frameTimes(end, 6, 30).map((t) => ({
        t,
        geo: GEO_LAYERS.flatMap((layer, i) => {
          const last = latest[i];
          if (last == null) return [];
          const lt = Math.min(floorSlot(t), last);
          return t - lt <= 60 * 60_000 ? [{ layer, t: lt }] : [];
        }),
        // Newest GMGSI hour not after the frame, if under 3 hours older.
        gmgsi: hours.find((h) => h.t <= t && t - h.t <= 3 * 3600_000) ?? null,
      }));
      index = frames.length - 1;

      const mobile = matchMedia('(max-width: 600px)').matches;
      map = new ml.Map({
        container,
        center: [place.lon, place.lat],
        zoom: mobile ? 2.4 : 3,
        minZoom: 1,
        maxZoom: 7,
        renderWorldCopies: true,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            base: {
              type: 'raster',
              tiles: [BASE_TILES],
              tileSize: 256,
              maxzoom: 8,
              attribution: 'NASA Black Marble',
            },
            coast: { type: 'raster', tiles: [COAST_TILES], tileSize: 256, maxzoom: 9 },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
            { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.8 } },
            // Empty placeholders that keep GMGSI under the 10-minute GIBS layers.
            { id: 'slot-gmgsi', type: 'background', paint: { 'background-opacity': 0 } },
            { id: 'slot-geo', type: 'background', paint: { 'background-opacity': 0 } },
            { id: 'coast', type: 'raster', source: 'coast', paint: { 'raster-opacity': 0.7 } },
          ],
        },
      });
      const dot = document.createElement('div');
      dot.className = 'site-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'Your location');
      marker = new ml.Marker({ element: dot }).setLngLat([place.lon, place.lat]).addTo(map);
      map.on('load', () => {
        styleReady = true;
        status = 'ready';
      });
      map.on('error', (e) => {
        // A missing tile is normal (time not published, outside a disk); keep quiet.
        if (!String(e.error?.message ?? '').includes('404')) console.warn('map:', e.error);
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      status = 'error';
      message = e instanceof Error ? e.message : String(e);
    }
  });

  onDestroy(() => {
    ctrl.abort();
    if (timer) clearInterval(timer);
    marker?.remove();
    map?.remove();
  });

  const frame = $derived(frames[index]);
  const sourcesLine = $derived(
    frame
      ? [
          ...frame.geo.map((g) => `${g.layer.label} ${gibsTime(g.t).slice(11, 16)}`),
          ...(frame.gmgsi ? [`GMGSI ${gibsTime(frame.gmgsi.t).slice(11, 16)}`] : []),
        ].join(' · ') + ' UTC'
      : '',
  );
  const ageLine = $derived(
    frame ? `${Math.max(0, Math.round((Date.now() - frame.t) / 60_000))} min ago` : '',
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="card" class:full bind:this={wrap} aria-labelledby="satmap-title" onkeydown={onKey}>
  <header>
    <h2 id="satmap-title">Satellite clouds <span class="tag">infrared · observed</span></h2>
    <button
      class="fs"
      onclick={toggleFull}
      aria-pressed={full}
      title="Full screen (F when the map has focus)"
      >{full ? 'Exit full screen' : 'Full screen'}</button
    >
  </header>
  <div class="map" bind:this={container} role="region" aria-label="Satellite cloud map"></div>

  {#if status === 'error'}
    <p class="muted">Satellite map unavailable: {message}</p>
  {:else if frames.length}
    <div class="controls">
      <button type="button" onclick={play} aria-pressed={playing}>
        {playing ? 'Pause' : 'Play last 2.5 h'}
      </button>
      <label class="slider">
        <span class="sr">Image time</span>
        <input
          type="range"
          min="0"
          max={frames.length - 1}
          step="1"
          bind:value={index}
          aria-valuetext={frame ? fmtTime(frame.t, tz) : ''}
        />
      </label>
      <span class="time">
        <strong>{frame ? fmtTime(frame.t, tz) : ''}</strong>
        <span class="muted">{ageLine}</span>
      </span>
    </div>
    <p class="muted small">{sourcesLine}</p>
  {:else}
    <p class="muted">Finding the newest satellite images…</p>
  {/if}
  <p class="muted small">
    White = cold cloud tops, dark = warm ground; infrared works day and night but cannot tell low
    fog from the ground. Over the Americas and the Pacific (GOES, Himawari, new image every 10
    minutes, ~20–40 minutes old) NASA colours the coldest tops: yellow, red and purple mark
    thunderstorms and thick high cloud. Europe, Africa and India come from the hourly GMGSI mosaic
    (Meteosat), in grey, ~1–1.5 hours old.
  </p>
  <p class="credit-line">
    Imagery: NASA GIBS (GOES-East/West: NOAA; Himawari: JMA) · NOAA/NESDIS GMGSI · base: NASA Black
    Marble · map: MapLibre GL JS
  </p>
</section>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .card.full {
    display: flex;
    flex-direction: column;
    border: none;
    border-radius: 0;
    height: 100%;
    overflow-y: auto;
  }
  .full .map {
    flex: 1 0 300px;
    height: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 8px;
  }
  h2 {
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
  button.fs {
    font-size: 13px;
    min-height: 32px;
  }
  .tag {
    margin-left: 8px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .map {
    height: 380px;
    border-radius: 8px;
    overflow: hidden;
    background: #000;
    filter: var(--sky-filter);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 10px;
  }
  button {
    min-height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .slider {
    flex: 1 1 160px;
    display: flex;
  }
  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }
  .time {
    display: flex;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--muted);
    margin: 6px 0 0;
  }
  .small {
    font-size: 12px;
  }
  .credit-line {
    font-size: 11px;
    color: var(--muted);
    margin: 6px 0 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  :global(.site-dot) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ff4a3a;
    border: 2px solid var(--text);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
  }
  @media (max-width: 600px) {
    .map {
      height: 300px;
    }
  }
</style>
