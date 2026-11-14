<script lang="ts">
  /**
   * Light-pollution map from our own yearly model (pipelines/lightpollution:
   * NASA Black Marble VNP46A4 night lights → sky-glow kernel calibrated on Globe
   * at Night). The grey sky-brightness tiles from the data Worker are recoloured
   * in the browser (lpcolor:// protocol) to a Bortle-style palette. Loaded only
   * when the Maps tab opens.
   */
  import { onDestroy, onMount } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
  import type { Place } from '../lib/astro/sky';
  import CoordGo from './CoordGo.svelte';
  import { DATA_BASE } from '../lib/config';
  import { BASE_TILES } from '../lib/sat/gibs';
  import { decodeTile, pixelFor } from '../lib/data/tiles';
  import {
    fetchRetry,
    reloadRasterSources,
    watchTiles,
    type TileStatus,
  } from '../lib/data/maptiles';
  import {
    BORTLE_LABELS,
    LP_INFO_URL,
    loadLpInfo,
    type LpInfo,
    type SiteLight,
  } from '../lib/lp/lightpollution';
  import { bortle, LEGEND, paletteTable, recolor, sqmFromGrey } from '../lib/lp/lpmap';

  interface Props {
    place: Place;
    /** Light pollution at the current site (marker readout), or null. */
    site: SiteLight | null;
    onplace: (p: Place) => void;
  }
  let { place, site, onplace }: Props = $props();

  let wrap: HTMLElement;
  let container = $state<HTMLDivElement>();
  let map: MlMap | null = null;
  let marker: MlMarker | null = null;
  let pick: MlMarker | null = null;
  let status = $state<'loading' | 'ready' | 'error' | 'off'>(LP_INFO_URL ? 'loading' : 'off');
  let message = $state('');
  let info = $state<LpInfo | null>(null);
  let full = $state(false);
  let opacity = $state(0.75);
  let point = $state<{
    lat: number;
    lon: number;
    sqm: number | null;
    loading: boolean;
  } | null>(null);
  const ctrl = new AbortController();
  let tiles = $state<TileStatus>({ pending: false, slow: false });
  let stopWatch: (() => void) | null = null;
  function retryTiles() {
    if (map) reloadRasterSources(map);
  }

  const tileUrl = (tpl: string, z: number, x: number, y: number) =>
    DATA_BASE + tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

  // ---- recolouring protocol ------------------------------------------------------
  let table: Uint8ClampedArray | null = null;
  let emptyTile: Promise<ArrayBuffer> | null = null;
  function newCanvas(w: number, h: number) {
    return typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  }
  async function toPng(c: OffscreenCanvas | HTMLCanvasElement): Promise<ArrayBuffer> {
    const blob =
      c instanceof HTMLCanvasElement
        ? await new Promise<Blob>((ok, no) =>
            c.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'),
          )
        : await c.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }
  async function colouredTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const res = await fetchRetry(url, signal);
    if (res.status === 404) {
      // No tile: natural sky everywhere in it.
      emptyTile ??= toPng(newCanvas(256, 256));
      return emptyTile;
    }
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = newCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2D canvas');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = ctx.getImageData(0, 0, c.width, c.height);
    recolor(img.data, table ?? paletteTable());
    ctx.putImageData(img, 0, 0);
    return toPng(c);
  }

  // ---- 10-year history player ----------------------------------------------------
  // data/lphistory.json lists the years built by the history workflow (same model
  // every year, zoom 0–6). "Change" colours each year against the first one.
  let histYears = $state<number[]>([]);
  let histOn = $state(false);
  let histDiff = $state(false);
  let histIdx = $state(0);
  let histPlaying = $state(false);
  let histTimer: ReturnType<typeof setInterval> | null = null;
  const histYear = $derived(histYears[histIdx] ?? null);
  async function greyTile(url: string, signal: AbortSignal): Promise<Uint8ClampedArray | null> {
    const res = await fetchRetry(url, signal);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = newCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2D canvas');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, c.width, c.height).data;
  }
  /** Change of zenith brightness, year vs first year: red brighter, blue darker (±1 mag full). */
  async function diffTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const [cur, base] = url.split('|');
    const [a, b] = await Promise.all([greyTile(cur ?? '', signal), greyTile(base ?? '', signal)]);
    const c = newCanvas(256, 256);
    const ctx = c.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2D canvas');
    const img = ctx.createImageData(256, 256);
    const step = info?.lp.magPerStep ?? 0.025;
    for (let i = 0; i < img.data.length; i += 4) {
      const d = (((a?.[i] ?? 0) - (b?.[i] ?? 0)) * step) as number; // mag brighter than the first year
      const m = Math.min(1, Math.abs(d));
      if (m < 0.05) continue;
      img.data[i] = d > 0 ? 255 : 40;
      img.data[i + 1] = d > 0 ? 70 : 120;
      img.data[i + 2] = d > 0 ? 40 : 255;
      img.data[i + 3] = Math.round(60 + 180 * m);
    }
    ctx.putImageData(img, 0, 0);
    return toPng(c);
  }
  const histUrl = (y: number) => `${DATA_BASE}/tiles/lphist-${y}/{z}/{x}/{y}.webp`;
  function histLayers() {
    if (!map) return;
    for (const y of histYears) {
      for (const kind of ['h', 'd'] as const) {
        const id = `${kind}${y}`;
        if (map.getSource(id)) continue;
        const first = histYears[0] ?? y;
        const tiles =
          kind === 'h'
            ? histUrl(y).replace(/^https:\/\//, 'lpcolor://')
            : `lpdiff://${histUrl(y).replace(/^https:\/\//, '')}|${histUrl(first).replace(/^https:\/\//, '')}`;
        map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 6 });
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        });
      }
    }
  }
  $effect(() => {
    const on = histOn;
    const y = histYear;
    const diff = histDiff;
    const o = opacity;
    if (status !== 'ready' || !map) return;
    if (on) histLayers();
    map.setPaintProperty('lp', 'raster-opacity', on ? 0 : o);
    for (const yy of histYears) {
      for (const kind of ['h', 'd'] as const) {
        const id = `${kind}${yy}`;
        if (!map.getLayer(id)) continue;
        const show = on && yy === y && (kind === 'd') === diff;
        map.setPaintProperty(id, 'raster-opacity', show ? o : 0);
      }
    }
  });
  function histPlay() {
    if (histPlaying) {
      histPlaying = false;
      if (histTimer) clearInterval(histTimer);
      histTimer = null;
      return;
    }
    histOn = true;
    histPlaying = true;
    if (histIdx >= histYears.length - 1) histIdx = 0;
    histTimer = setInterval(() => {
      histIdx = (histIdx + 1) % histYears.length;
    }, 1300);
  }

  // ---- clicked point readout -----------------------------------------------------
  async function readPoint(lat: number, lon: number) {
    if (!info) return;
    point = { lat, lon, sqm: null, loading: true };
    const z = info.lp.maxzoom;
    const c = pixelFor(lat, lon, z);
    try {
      const img = await decodeTile(tileUrl(info.lp.tiles, z, c.tx, c.ty), ctrl.signal);
      const v = img ? (img.data[(c.py * 256 + c.px) * 4] ?? 0) : 0;
      if (point?.lat === lat && point.lon === lon)
        point = {
          lat,
          lon,
          sqm: sqmFromGrey(v, info.lp.magPerStep, info.naturalSqm),
          loading: false,
        };
    } catch {
      if (point?.lat === lat && point.lon === lon) point = { lat, lon, sqm: null, loading: false };
    }
  }

  let makePick: (() => MlMarker) | null = null;
  /** Mark a point and read its sky brightness (click, tap or typed coordinates). */
  function pickAt(lat: number, lon: number, fly = false) {
    if (!map) return;
    pick ??= makePick?.() ?? null;
    pick?.setLngLat([lon, lat]).addTo(map);
    if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8) });
    void readPoint(lat, lon);
  }

  function useHere() {
    if (!point) return;
    onplace({
      lat: Math.round(point.lat * 10000) / 10000,
      lon: Math.round(point.lon * 10000) / 10000,
      elevation: 0,
      needsElevation: true,
      name: `${Math.abs(point.lat).toFixed(3)}° ${point.lat >= 0 ? 'N' : 'S'}, ${Math.abs(point.lon).toFixed(3)}° ${point.lon >= 0 ? 'E' : 'W'}`,
      detail: 'picked on the light-pollution map',
    });
    point = null;
    pick?.remove();
    pick = null;
  }

  // ---- full screen ---------------------------------------------------------------
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

  // Keep the site marker on the current place.
  $effect(() => {
    const ll: [number, number] = [place.lon, place.lat];
    marker?.setLngLat(ll);
    map?.easeTo({ center: ll });
  });
  $effect(() => {
    const o = opacity;
    if (status === 'ready' && !histOn && map?.getLayer('lp'))
      map.setPaintProperty('lp', 'raster-opacity', o);
  });

  onMount(() => {
    const onFs = () => {
      full = document.fullscreenElement === wrap;
      // MapLibre must measure its new size after entering or leaving full screen.
      requestAnimationFrame(() => map?.resize());
    };
    document.addEventListener('fullscreenchange', onFs);
    void start();
    return () => document.removeEventListener('fullscreenchange', onFs);
  });

  async function start() {
    if (!LP_INFO_URL) return;
    try {
      const [ml, lp] = await Promise.all([import('maplibre-gl'), loadLpInfo(ctrl.signal)]);
      if (ctrl.signal.aborted) return;
      info = lp.data;
      table = paletteTable(lp.data.lp.magPerStep, lp.data.naturalSqm);
      ml.setWorkerUrl(workerUrl);
      ml.removeProtocol('lpcolor');
      ml.addProtocol('lpcolor', async (params, abort) => ({
        data: await colouredTile(params.url.replace(/^lpcolor:\/\//, 'https://'), abort.signal),
      }));
      ml.removeProtocol('lpdiff');
      ml.addProtocol('lpdiff', async (params, abort) => ({
        data: await diffTile(
          params.url
            .replace(/^lpdiff:\/\//, 'https://')
            .split('|')
            .map((u, i) => (i ? `https://${u}` : u))
            .join('|'),
          abort.signal,
        ),
      }));
      // Years of the history player (published by the history workflow).
      void fetch(`${DATA_BASE}/data/lphistory.json`)
        .then((r) => (r.ok ? (r.json() as Promise<{ years?: number[] }>) : null))
        .then((h) => {
          if (h?.years?.length) {
            histYears = h.years;
            histIdx = h.years.length - 1;
          }
        })
        .catch(() => undefined);
      const lpTiles = tileUrl(lp.data.lp.tiles, 0, 0, 0)
        .replace('/0/0/0.', '/{z}/{x}/{y}.')
        .replace(/^https:\/\//, 'lpcolor://');
      const mobile = matchMedia('(max-width: 600px)').matches;
      if (!container) return;
      map = new ml.Map({
        container,
        center: [place.lon, place.lat],
        zoom: mobile ? 5 : 6,
        minZoom: 1,
        maxZoom: 11,
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
            lp: {
              type: 'raster',
              tiles: [lpTiles],
              tileSize: 256,
              maxzoom: lp.data.lp.maxzoom,
              attribution: `Sky brightness ${lp.data.year}: our model from NASA Black Marble VNP46A4`,
            },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
            { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.55 } },
            {
              id: 'lp',
              type: 'raster',
              source: 'lp',
              paint: { 'raster-opacity': opacity, 'raster-resampling': 'linear' },
            },
          ],
        },
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      // Two maps on one page: give each canvas its own accessible name.
      map
        .getCanvas()
        .setAttribute('aria-label', 'Light-pollution map (drag to pan, scroll to zoom)');
      const dot = document.createElement('div');
      dot.className = 'site-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'Your location');
      marker = new ml.Marker({ element: dot }).setLngLat([place.lon, place.lat]).addTo(map);
      makePick = () => {
        const el = document.createElement('div');
        el.className = 'pick-dot';
        return new ml.Marker({ element: el });
      };
      map.on('click', (e) => {
        const { lat, lng } = e.lngLat.wrap();
        pickAt(lat, lng);
      });
      // Usable as soon as the style is in; tiles keep arriving (slow links show a notice).
      map.once('style.load', () => (status = 'ready'));
      map.once('load', () => (status = 'ready'));
      stopWatch = watchTiles(map, (t) => (tiles = t));
      map.on('error', (e) => {
        if (!String(e.error?.message ?? '').includes('404')) console.warn('lp map:', e.error);
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      status = 'error';
      message = e instanceof Error ? e.message : String(e);
    }
  }

  onDestroy(() => {
    ctrl.abort();
    stopWatch?.();
    if (histTimer) clearInterval(histTimer);
    marker?.remove();
    pick?.remove();
    map?.remove();
  });

  const pointBortle = $derived(point?.sqm != null ? bortle(point.sqm) : null);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="lp" class:full bind:this={wrap} aria-labelledby="lpmap-title" onkeydown={onKey}>
  <header>
    <h2 id="lpmap-title">
      Light pollution <span class="tag">yearly model · {info?.year ?? ''}</span>
    </h2>
    <button onclick={toggleFull} aria-pressed={full} title="Full screen (F when the map has focus)"
      >{full ? 'Exit full screen' : 'Full screen'}</button
    >
  </header>
  <CoordGo id="lp" ongo={(lat, lon) => pickAt(lat, lon, true)} />

  {#if status === 'off'}
    <p class="muted">
      The light-pollution map needs the site's data service, which is not set up here.
    </p>
  {:else}
    <div class="stage">
      <div
        class="map"
        bind:this={container}
        role="region"
        aria-label="Light-pollution map. Click or tap a point to read its sky brightness."
      ></div>

      <div class="legend" aria-label="Legend">
        <p class="lg-title">Zenith sky · mag/arcsec² · Bortle</p>
        <ul>
          {#each LEGEND as l (l.bortle)}
            <li><span class="sw" style:background={l.color}></span>{l.sqm} · {l.bortle}</li>
          {/each}
        </ul>
        {#if histOn && histDiff}
          <p class="lg-title">Change since {histYears[0]}</p>
          <p class="chg">
            <span class="sw" style:background="rgb(40 120 255)"></span>darker ·
            <span class="sw" style:background="rgb(255 70 40)"></span>brighter (full colour = 1 mag)
          </p>
        {/if}
        <label class="op">
          Opacity
          <input type="range" min="0.2" max="1" step="0.05" bind:value={opacity} />
        </label>
      </div>

      <div class="readout" aria-live="polite">
        {#if point}
          <p class="coords">
            {point.lat.toFixed(3)}°, {point.lon.toFixed(3)}°
          </p>
          {#if point.loading}
            <p>Reading…</p>
          {:else if point.sqm != null && pointBortle != null}
            <p>
              <strong>{point.sqm.toFixed(2)}</strong> mag/arcsec² · Bortle {pointBortle}
            </p>
            <p class="muted small">{BORTLE_LABELS[pointBortle]} (model, moonless zenith)</p>
          {:else}
            <p class="muted">No value here right now.</p>
          {/if}
          <div class="row">
            <button onclick={useHere}>Use this location</button>
            <button
              onclick={() => {
                point = null;
                pick?.remove();
              }}
              aria-label="Close the point readout">×</button
            >
          </div>
        {:else if site}
          <p class="muted small">Your site</p>
          <p>
            <strong>{site.sqm.toFixed(2)}</strong> mag/arcsec² · Bortle {site.bortle}
          </p>
          <p class="muted small">Click or tap the map to read another point.</p>
        {:else}
          <p class="muted small">Click or tap the map to read a point.</p>
        {/if}
      </div>

      {#if status === 'loading'}<p class="loading" role="status">Loading the map…</p>{/if}
      {#if tiles.pending}
        <p class="tiles-chip" role="status">
          {tiles.slow
            ? 'Map tiles are downloading slowly on this connection…'
            : 'Loading map tiles…'}
          {#if tiles.slow}<button onclick={retryTiles}>Retry</button>{/if}
        </p>
      {/if}
      {#if status === 'error'}<p class="loading error" role="alert">
          Map unavailable: {message}
        </p>{/if}
    </div>
  {/if}

  {#if histYears.length > 1}
    <div class="hist" role="group" aria-label="Light pollution through the years">
      <button onclick={histPlay} aria-pressed={histPlaying}
        >{histPlaying ? 'Pause' : `Play ${histYears[0]}–${histYears[histYears.length - 1]}`}</button
      >
      <label class="yr"
        ><span class="visually-hidden">Year</span>
        <input
          type="range"
          min="0"
          max={histYears.length - 1}
          step="1"
          bind:value={histIdx}
          oninput={() => (histOn = true)}
          aria-valuetext={String(histYear ?? '')}
        /></label
      >
      <strong class="yv">{histOn ? histYear : `${info?.year ?? ''} (current)`}</strong>
      <label class="ck"
        ><input type="checkbox" bind:checked={histDiff} /> Change since {histYears[0]}</label
      >
      {#if histOn}<button
          onclick={() => {
            if (histPlaying) histPlay();
            histOn = false;
          }}>Back to {info?.year}</button
        >{/if}
    </div>
  {:else}
    <p class="muted small note">
      The 10-year history (2015 onwards) appears here once it has been published.
    </p>
  {/if}
  <p class="muted small note">
    A yearly model of the artificial sky glow (moonless, zenith), not a measurement. Satellites
    under-count blue/white LED light, so real skies can be brighter; typical error vs. Globe at
    Night readings about {info?.validation?.best?.median_abs_mag?.toFixed(2) ?? '0.35'} mag.
  </p>
  <p class="credit-line">
    Sky brightness: our model from NASA Black Marble VNP46A4 (NASA LAADS DAAC), calibrated on Globe
    at Night · base: NASA Black Marble via GIBS · map: MapLibre GL JS ·
    <a href="#/credits">credits</a>
  </p>
</section>

<style>
  .lp {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .lp.full {
    display: flex;
    flex-direction: column;
    border-radius: 0;
    border: none;
    height: 100%;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
  .tag {
    margin-left: 8px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  header button {
    font-size: 13px;
    min-height: 32px;
  }
  .stage {
    position: relative;
    height: min(62vh, 560px);
    min-height: 320px;
    border-radius: 8px;
    overflow: hidden;
    background: #000;
  }
  .full .stage {
    flex: 1;
    height: auto;
  }
  .map {
    position: absolute;
    inset: 0;
    filter: var(--sky-filter);
  }
  .legend,
  .readout {
    position: absolute;
    z-index: 2;
    background: color-mix(in srgb, var(--panel) 86%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 12px;
    backdrop-filter: blur(6px);
  }
  .legend {
    left: 8px;
    bottom: 26px;
  }
  .lg-title {
    margin: 0 0 4px;
    color: var(--muted);
  }
  .legend ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1px;
    font-variant-numeric: tabular-nums;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 14px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid var(--line);
    filter: var(--sky-filter);
  }
  .op {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: var(--muted);
  }
  .op input {
    width: 90px;
    accent-color: var(--accent);
  }
  .readout {
    left: 8px;
    top: 8px;
    max-width: min(260px, calc(100% - 70px));
    font-size: 13px;
  }
  .readout p {
    margin: 0 0 2px;
  }
  .coords {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .row button {
    font-size: 13px;
    min-height: 32px;
    padding: 2px 10px;
  }
  .tiles-chip {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 140px);
    z-index: 3;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    font-size: 12px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
  }
  .tiles-chip button {
    min-height: 26px;
    padding: 0 10px;
    font-size: 12px;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    color: var(--muted);
    pointer-events: none;
  }
  .error {
    color: var(--bad);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12px;
  }
  .note {
    margin: 8px 0 0;
  }
  .hist {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-top: 8px;
    font-size: 13px;
  }
  .hist button {
    font-size: 13px;
    min-height: 32px;
  }
  .yr {
    flex: 1 1 160px;
    display: flex;
  }
  .yr input {
    width: 100%;
    accent-color: var(--accent);
  }
  .yv {
    font-variant-numeric: tabular-nums;
    min-width: 4ch;
  }
  .ck {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .chg {
    margin: 0 0 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .credit-line {
    font-size: 11px;
    color: var(--muted);
    margin: 4px 0 0;
  }
  :global(.pick-dot) {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 0.7);
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
    .stage {
      height: 62vh;
    }
    .legend {
      font-size: 11px;
      padding: 6px 8px;
    }
    .legend ul {
      grid-template-columns: 1fr 1fr;
      column-gap: 8px;
    }
  }
</style>
