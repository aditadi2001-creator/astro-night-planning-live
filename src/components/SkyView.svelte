<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import type { Setup, SetupKind } from '../lib/equipment';
  import Oculars from './Oculars.svelte';
  import SkyInfo from './SkyInfo.svelte';
  import SkySearch, { type SearchHit } from './SkySearch.svelte';
  import {
    altAzAt,
    describe,
    setAtmosphere,
    setObserver,
    setSkyLayer,
    setSurvey,
    SKY_LAYER,
    startEngine,
    type EngineAtmosphere,
    type EngineSurvey,
    type ObjectInfo,
    type Stel,
  } from '../lib/engine/stel';
  import { renderClouds, type CloudInput } from '../lib/sky/clouds';
  import CloudWorker from '../lib/sky/clouds.worker.ts?worker';
  import { renderTerrain, type DomeGlow, type Rgb } from '../lib/sky/horizon';

  interface Props {
    /** Equipment setups (rotation changes from the ocular toolbar are written back). */
    setups: Record<SetupKind, Setup>;
    /** Which setups' frames are shown (the ocular view is on when any is). */
    shownFrames: Record<SetupKind, boolean>;
    /** Reports the frame centre (RA/Dec degrees, J2000/ICRF) for display elsewhere. */
    onframecenter?: (c: { ra: number; dec: number; target: string | null } | null) => void;
    /** Reports the tapped object (null when cleared). */
    onselect?: (info: ObjectInfo | null) => void;
    /** Point the view at J2000 coordinates (degrees); `n` changes to repeat the same target. */
    goto?: { ra: number; dec: number; fovDeg: number; n: number } | null;
    /** Changing this number clears the selection. */
    clearSignal?: number;
    place: Place;
    /** The time the sky should show. */
    time: Date;
    /** Following the real clock (sky runs) or a chosen moment (sky frozen). */
    live: boolean;
    constellations: boolean;
    /** Live atmosphere for extinction, refraction and the visual limit (null = engine defaults). */
    atmosphere: EngineAtmosphere | null;
    /** Cloud field inputs without the texture size (null = no clouds layer). */
    clouds: Omit<CloudInput, 'width' | 'height'> | null;
    /** Apparent horizon altitude per azimuth bin (null = flat horizon). */
    horizon: Float32Array | null;
    groundColor: Rgb;
    /** Light domes from the light-pollution map (null = none). */
    glow?: DomeGlow | null;
    /** Optional image survey (null = off). */
    survey?: EngineSurvey | null;
    /** DSS server URL for deep-sky photos that fade in when zoomed in (null = off). */
    deepSky?: string | null;
    /** Camera-like rendering: higher exposure, smaller bright-star blobs. */
    longExposure?: boolean;
    oncursor?: (p: { alt: number; az: number } | null) => void;
    /** Site time zone for rise/set times in the info overlay. */
    tz?: string | undefined;
    /** Layer switches and time controls shown inside the sky in full screen. */
    fullControls?: Snippet;
  }
  let {
    place,
    time,
    live,
    constellations,
    atmosphere,
    clouds,
    horizon,
    groundColor,
    glow = null,
    survey = null,
    setups = $bindable(),
    shownFrames = $bindable(),
    onframecenter,
    onselect,
    goto = null,
    clearSignal = 0,
    deepSky = null,
    longExposure = false,
    oncursor,
    tz = undefined,
    fullControls,
  }: Props = $props();
  // Phones: the full-screen panel starts folded so the sky stays visible.
  let panelOpen = $state(
    typeof matchMedia !== 'function' || !matchMedia('(max-width: 640px)').matches,
  );

  let canvas = $state<HTMLCanvasElement>() as HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let full = $state(false);

  // ---- fullscreen ---------------------------------------------------------------
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap?.requestFullscreen?.().catch(() => undefined);
  }
  onMount(() => {
    const on = () => (full = document.fullscreenElement === wrap);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  });

  // ---- zoom on the centre of the screen (as in Stellarium), not on the cursor -----
  onMount(() => {
    const zoomBy = (f: number) => {
      if (!stel) return;
      const fov = Math.min(185 * stel.D2R, Math.max((0.2 / 60) * stel.D2R, stel.core.fov * f));
      stel.zoomTo(fov, 0.1);
    };
    const onWheel = (e: Event) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      e.stopPropagation();
      const dy = e instanceof WheelEvent ? e.deltaY * (e.deltaMode === 1 ? 33 : 1) : 0;
      zoomBy(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015));
    };
    // Two-finger pinch: zoom about the centre too (one finger still drags the sky).
    let pinch = 0;
    const dist = (t: TouchList) =>
      Math.hypot(
        (t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0),
        (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0),
      );
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinch = 0;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const d = dist(e.touches);
      if (e.type === 'touchmove' && pinch > 0 && d > 0) zoomBy(pinch / d);
      pinch = d;
    };
    const opt = { capture: true, passive: false } as const;
    wrap.addEventListener('wheel', onWheel, opt);
    wrap.addEventListener('mousewheel', onWheel, opt);
    wrap.addEventListener('touchstart', onTouch, opt);
    wrap.addEventListener('touchmove', onTouch, opt);
    return () => {
      wrap.removeEventListener('wheel', onWheel, opt);
      wrap.removeEventListener('mousewheel', onWheel, opt);
      wrap.removeEventListener('touchstart', onTouch, opt);
      wrap.removeEventListener('touchmove', onTouch, opt);
    };
  });

  /** Centre the view on the selected object and keep it there (Stellarium "go to"). */
  function gotoSelected() {
    if (stel?.core.selection) stel.pointAndLock(stel.core.selection, 1);
  }
  let stel = $state<Stel | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMsg = $state('');
  let selected = $state<ObjectInfo | null>(null);

  onMount(() => {
    let disposed = false;
    const resize = () => {
      // Cap the backing store at 2× for mid-range phones.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    startEngine(canvas)
      .then((s) => {
        if (disposed) return;
        const c = s.core;
        c.time_speed = 1;
        c.fov = 120 * s.D2R;
        c.observer.yaw = 180 * s.D2R; // look south
        c.observer.pitch = 25 * s.D2R;
        c.atmosphere.visible = true;
        c.milkyway.visible = true;
        c.dsos.visible = true;
        c.cardinals.visible = true;
        // Keep the engine's flat "zero" ground on: it makes the engine hide stars
        // and labels below 0 deg. Our terrain layer (drawn after it) adds the
        // real silhouette above that and covers the flat ground's colour.
        c.landscapes.visible = true;
        s.change((_obj, attr) => {
          if (attr === 'selection') {
            selected = c.selection ? describe(s, c.selection) : null;
          }
        });
        stel = s;
        status = 'ready';
        // Engine handle for debugging: dev builds, or any build opened with ?debug.
        if (import.meta.env.DEV || location.search.includes('debug'))
          (window as unknown as { __stel: Stel }).__stel = s;
      })
      .catch((e: unknown) => {
        status = 'error';
        errorMsg = e instanceof Error ? e.message : String(e);
      });

    return () => {
      disposed = true;
      ro.disconnect();
    };
  });

  // Keep the engine's observer in step with the chosen place and time.
  $effect(() => {
    if (!stel) return;
    stel.core.time_speed = live ? 1 : 0;
    setObserver(stel, place, time);
  });

  $effect(() => {
    if (!stel) return;
    const cons = stel.core.constellations as typeof stel.core.constellations & {
      show_only_pointed: boolean;
    };
    // Engine default draws only the constellation at the view centre.
    cons.show_only_pointed = false;
    cons.lines_visible = constellations;
    cons.labels_visible = constellations;
  });

  // Field of view in degrees, polled (the engine animates zooms itself).
  let fovDeg = $state(120);
  onMount(() => {
    const t = setInterval(() => {
      if (stel) fovDeg = Math.round(stel.core.fov * stel.R2D * 10) / 10;
    }, 250);
    return () => clearInterval(t);
  });
  /** Deep-sky photo opacity: none above 28°, full (0.9) below 12°. */
  const deepOpacity = $derived.by(() => {
    if (!deepSky) return 0;
    const t = Math.min(1, Math.max(0, (28 - fovDeg) / 16));
    return Math.round(t * t * (3 - 2 * t) * 0.9 * 20) / 20;
  });

  $effect(() => {
    if (!stel) return;
    if (survey) setSurvey(stel, { ...survey });
    else if (deepSky && deepOpacity > 0)
      setSurvey(stel, { url: deepSky, galactic: false, opacity: deepOpacity });
    else setSurvey(stel, null);
  });

  // Star rendering: the naked-eye view with slightly larger stars than the engine
  // default; the long exposure raises the exposure like a camera would.
  $effect(() => {
    if (!stel) return;
    const c = stel.core as typeof stel.core & Record<string, number>;
    c.exposure_scale = longExposure ? 7 : 2;
    c.star_linear_scale = longExposure ? 1.0 : 1.25;
    c.star_relative_scale = longExposure ? 1.1 : 1.15;
  });

  $effect(() => {
    if (!stel) return;
    if (atmosphere) {
      setAtmosphere(stel, atmosphere);
    } else {
      setAtmosphere(stel, {
        pressure: null,
        temperature: null,
        k: 0,
        dbv: 0,
        limitMag: Number.NaN,
      });
    }
  });

  const ocularOn = $derived(Object.values(shownFrames).some(Boolean));
  let oculars = $state<ReturnType<typeof Oculars>>();
  let bottomEl = $state<HTMLDivElement>();
  /** Move a node into another element (the ocular toolbar joins the bottom stack). */
  function portal(node: HTMLElement, target: HTMLElement | undefined) {
    target?.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // ---- view options (Stellarium-style toolbar) -------------------------------------
  const VIEW_KEY = 'anp.view.v1';
  const VIEW_ITEMS = [
    { key: 'eqGrid', label: 'Equatorial grid' },
    { key: 'azGrid', label: 'Azimuthal grid' },
    { key: 'meridian', label: 'Meridian' },
    { key: 'ecliptic', label: 'Ecliptic' },
    { key: 'dsos', label: 'Deep-sky markers' },
    { key: 'cardinals', label: 'Cardinal points' },
    { key: 'atmosphere', label: 'Atmosphere' },
    { key: 'ground', label: 'Ground' },
  ] as const;
  type ViewKey = (typeof VIEW_ITEMS)[number]['key'];
  function loadView(): Record<ViewKey, boolean> {
    const d: Record<ViewKey, boolean> = {
      eqGrid: false,
      azGrid: false,
      meridian: false,
      ecliptic: false,
      dsos: true,
      cardinals: true,
      atmosphere: true,
      ground: true,
    };
    try {
      return { ...d, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as object) };
    } catch {
      return d;
    }
  }
  let view = $state(loadView());
  let viewOpen = $state(false);
  $effect(() => {
    const v = $state.snapshot(view);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch {
      /* not remembered */
    }
    if (!stel) return;
    const c = stel.core;
    c.lines.equatorial.visible = v.eqGrid;
    c.lines.azimuthal.visible = v.azGrid;
    c.lines.meridian.visible = v.meridian;
    c.lines.ecliptic.visible = v.ecliptic;
    c.dsos.visible = v.dsos;
    c.cardinals.visible = v.cardinals;
    c.atmosphere.visible = v.atmosphere;
    c.landscapes.visible = v.ground;
  });

  // ---- search ------------------------------------------------------------------
  function lookAtRaDec(raDeg: number, decDeg: number, fovDeg: number) {
    if (!stel) return;
    const v = stel.convertFrame(
      stel.core.observer,
      'ICRF',
      'MOUNT',
      stel.s2c(raDeg * stel.D2R, decDeg * stel.D2R),
    );
    stel.lookAt(v, 0.8);
    stel.zoomTo(fovDeg * stel.D2R, 0.8);
  }
  function onSearch(h: SearchHit): boolean {
    const s = stel;
    if (!s) return false;
    if (h.kind === 'dso') {
      s.core.selection = null;
      selected = null;
      lookAtRaDec(h.ra, h.dec, Math.min(60, Math.max(1, h.sizeDeg * 4)));
      return true;
    }
    let obj: ReturnType<Stel['getObj']>;
    try {
      obj = s.getObj(h.id) ?? (h.id.startsWith('NAME ') ? null : s.getObj(`NAME ${h.id}`));
    } catch {
      obj = null;
    }
    if (!obj) return false;
    s.core.selection = obj;
    s.pointAndLock(obj, 1);
    if (s.core.fov * s.R2D > 90) s.zoomTo(40 * s.D2R, 1);
    return true;
  }

  // Cloud texture: regenerate only when its inputs change (drift time is
  // quantised by the caller), in a Web Worker so dragging the sky stays smooth.
  const CW = 512;
  const CH = 128;
  let worker: Worker | null = null;
  let jobId = 0;
  function cloudWorker(): Worker | null {
    if (worker) return worker;
    try {
      worker = new CloudWorker();
      worker.onmessage = (e: MessageEvent<{ id: number; img: Uint8ClampedArray }>) => {
        // Only the newest job counts; older results are dropped.
        if (e.data.id === jobId && stel && clouds) {
          setSkyLayer(stel, SKY_LAYER.clouds, e.data.img, CW, CH, 0, 90);
        }
      };
    } catch {
      worker = null; // very old browser: fall back to the main thread
    }
    return worker;
  }
  $effect(() => {
    if (!stel) return;
    const s = stel;
    if (!clouds) {
      jobId++;
      setSkyLayer(s, SKY_LAYER.clouds, null, 0, 0, 0, 0);
      return;
    }
    const input = $state.snapshot({ ...clouds, width: CW, height: CH }) as CloudInput;
    const id = ++jobId;
    const w = cloudWorker();
    if (w) {
      w.postMessage({ id, input });
    } else {
      setSkyLayer(s, SKY_LAYER.clouds, renderClouds(input), CW, CH, 0, 90);
    }
  });
  onMount(() => () => worker?.terminate());

  $effect(() => {
    if (!stel) return;
    if (!view.ground) {
      setSkyLayer(stel, SKY_LAYER.terrain, null, 0, 0, 0, 0);
      return;
    }
    const profile = horizon ?? new Float32Array(720);
    const img = renderTerrain(profile, groundColor, 2048, 512, -90, 30, glow);
    setSkyLayer(stel, SKY_LAYER.terrain, img, 2048, 512, -90, 30);
  });

  let raf = 0;
  function onPointerMove(e: PointerEvent) {
    if (!stel || !oncursor) return;
    const x = e.offsetX;
    const y = e.offsetY;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (stel) oncursor?.(altAzAt(stel, x, y));
    });
  }

  // Refresh the info panel while an object is selected (it moves with time).
  $effect(() => {
    void time;
    if (stel?.core.selection) selected = describe(stel, stel.core.selection);
  });

  // Report the selection to the page (for the detailed panel).
  $effect(() => {
    onselect?.(selected);
  });
  // Point at coordinates requested by the page (best-targets list).
  let lastGoto = -1;
  $effect(() => {
    const g = goto;
    if (!stel || !g || g.n === lastGoto) return;
    lastGoto = g.n;
    stel.core.selection = null;
    selected = null;
    lookAtRaDec(g.ra, g.dec, g.fovDeg);
  });
  let lastClear = 0;
  $effect(() => {
    if (clearSignal !== lastClear) {
      lastClear = clearSignal;
      clearSelection();
    }
  });

  function clearSelection() {
    if (stel) stel.core.selection = null;
    selected = null;
  }

  // Keyboard navigation: arrows look around, +/- zoom, Esc clears selection.
  function onKey(e: KeyboardEvent) {
    if (!stel) return;
    const o = stel.core.observer;
    const step = Math.max(1, (stel.core.fov * stel.R2D) / 12) * stel.D2R;
    const limit = (Math.PI / 2) * 0.999;
    switch (e.key) {
      case 'ArrowLeft':
        o.yaw -= step;
        break;
      case 'ArrowRight':
        o.yaw += step;
        break;
      case 'ArrowUp':
        o.pitch = Math.min(limit, o.pitch + step);
        break;
      case 'ArrowDown':
        o.pitch = Math.max(-limit, o.pitch - step);
        break;
      case '+':
      case '=':
        stel.zoomTo(Math.max(0.5 * stel.D2R, stel.core.fov / 1.4), 0.2);
        break;
      case '-':
        stel.zoomTo(Math.min(185 * stel.D2R, stel.core.fov * 1.4), 0.2);
        break;
      case 'Escape':
        clearSelection();
        break;
      case ' ':
        gotoSelected();
        break;
      case 'f':
      case 'F':
        toggleFull();
        break;
      case '[':
      case ']':
      case '{':
      case '}':
        if (!oculars) return;
        oculars.rotate(e.key === '[' ? -1 : e.key === ']' ? 1 : e.key === '{' ? -15 : 15);
        break;
      case 'z':
      case 'Z':
        if (!oculars) return;
        oculars.zoomToFit();
        break;
      case 'o':
      case 'O':
        if (!oculars) return;
        oculars.cycleMode();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<div class="wrap" class:full bind:this={wrap}>
  <div class="tools">
    <button
      aria-expanded={viewOpen}
      aria-controls="sky-view-menu"
      onclick={() => (viewOpen = !viewOpen)}
      title="Grids, markers, atmosphere and ground">View {viewOpen ? '▴' : '▾'}</button
    >
    {#if selected}<button
        onclick={gotoSelected}
        title="Centre and track the selected object (space bar)">Go to</button
      >{/if}
    <button onclick={toggleFull} aria-pressed={full} title="Full screen (F)"
      >{full ? 'Exit full screen' : 'Full screen'}</button
    >
  </div>
  {#if viewOpen}
    <div id="sky-view-menu" class="view-menu" role="group" aria-label="View options">
      {#each VIEW_ITEMS as it (it.key)}
        <label><input type="checkbox" bind:checked={view[it.key]} /> {it.label}</label>
      {/each}
    </div>
  {/if}
  <canvas
    bind:this={canvas}
    class="sky"
    tabindex="0"
    onkeydown={onKey}
    onpointermove={onPointerMove}
    onpointerleave={() => oncursor?.(null)}
    aria-label="Interactive 3D sky. Drag or use arrow keys to look around; scroll, pinch or +/- to zoom; tap an object for details."
  ></canvas>

  {#if status === 'loading'}
    <p class="overlay" role="status">Loading the sky…</p>
  {:else if status === 'error'}
    <p class="overlay error" role="alert">
      The 3D sky could not start ({errorMsg}). Your browser needs WebGL 2. Conditions below still
      work.
    </p>
  {/if}

  <div class="topleft">
    <SkySearch onpick={onSearch} />
    {#if selected}
      <SkyInfo info={selected} {place} {time} {tz} onclose={clearSelection} ongoto={gotoSelected} />
    {/if}
  </div>

  {#if ocularOn}
    <Oculars
      bind:this={oculars}
      {stel}
      {canvas}
      bind:setups
      bind:shown={shownFrames}
      selectedName={selected?.name ?? null}
      {onframecenter}
      {portal}
      {bottomEl}
    />
  {/if}

  <div class="bottom" bind:this={bottomEl}>
    {#if full && fullControls}
      <div class="fs-panel" class:open={panelOpen}>
        <button
          class="fs-toggle"
          aria-expanded={panelOpen}
          aria-controls="fs-controls"
          onclick={() => (panelOpen = !panelOpen)}
          >{panelOpen ? 'Hide layers & time ▾' : 'Layers & time ▴'}</button
        >
        <div id="fs-controls" class="fs-body" hidden={!panelOpen}>
          {@render fullControls()}
        </div>
      </div>
    {/if}
  </div>

  <p class="credit-line credit">
    Stellarium Web Engine (AGPL) · ESA/Hipparcos · ESA/Gaia/DPAC · OpenNGC ·
    <a href="#/credits">credits</a>
  </p>
</div>

<style>
  .tools {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 3;
    display: flex;
    gap: 6px;
  }
  .tools button {
    background: rgb(13 18 32 / 0.8);
    font-size: 13px;
    min-height: 32px;
    padding: 4px 10px;
  }
  .wrap.full {
    border-radius: 0;
    border: none;
  }
  /* Full screen: layer switches and time controls float over the bottom of the sky. */
  .fs-panel {
    display: grid;
    justify-items: start;
    gap: 6px;
    pointer-events: none;
  }
  .fs-panel > * {
    pointer-events: auto;
  }
  .fs-toggle {
    background: color-mix(in srgb, var(--panel) 82%, transparent);
    font-size: 13px;
    min-height: 34px;
    backdrop-filter: blur(6px);
  }
  .fs-body {
    width: 100%;
    max-height: min(48vh, 420px);
    overflow-y: auto;
    display: grid;
    gap: 8px;
    padding: 8px;
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    backdrop-filter: blur(8px);
  }
  .fs-body[hidden] {
    display: none;
  }
  .wrap {
    position: relative;
    height: 100%;
    min-height: inherit;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--line);
    background: #000;
  }
  .sky {
    display: block;
    width: 100%;
    height: 100%;
    min-height: inherit;
    touch-action: none;
    filter: var(--sky-filter);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 24px;
    text-align: center;
    color: var(--muted);
  }
  .overlay.error {
    color: var(--bad);
  }
  .topleft {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 4;
    display: grid;
    gap: 6px;
    justify-items: start;
    max-height: calc(100% - 90px);
    overflow-y: auto;
    scrollbar-width: none;
    pointer-events: none;
  }
  .view-menu {
    position: absolute;
    top: 46px;
    right: 8px;
    z-index: 5;
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    font-size: 13px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    backdrop-filter: blur(6px);
  }
  .view-menu label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    cursor: pointer;
  }
  .view-menu input {
    accent-color: var(--accent);
  }
  .bottom {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 22px;
    z-index: 4;
    display: grid;
    gap: 6px;
    pointer-events: none;
  }
  .bottom > :global(*) {
    pointer-events: auto;
  }
  .credit {
    position: absolute;
    right: 8px;
    bottom: 4px;
    margin: 0;
    font-size: 11px;
    opacity: 0.8;
    pointer-events: none;
    left: 8px;
    text-align: right;
  }
  .credit a {
    pointer-events: auto;
  }
</style>
