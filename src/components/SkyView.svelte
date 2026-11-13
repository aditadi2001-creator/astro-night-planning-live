<script lang="ts">
  import { onMount } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import { framePolygon, type SkyFrame } from '../lib/equipment';
  import {
    altAzAt,
    describe,
    icrfToScreen,
    screenToIcrf,
    selectionIcrf,
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
    /** Camera frames to draw, centred on the selected object (or the view centre). */
    frames?: SkyFrame[];
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
    frames = [],
    onframecenter,
    onselect,
    goto = null,
    clearSignal = 0,
    deepSky = null,
    longExposure = false,
    oncursor,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
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

  // ---- equipment frames: projected every ~70 ms while any is shown ----------------
  let frameShapes = $state<
    { id: string; label: string; color: string; d: string; lx: number; ly: number }[]
  >([]);
  let frameCross = $state('');
  let lastCenterKey = '';
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const s = stel;
      if (!s || !frames.length || !canvas) {
        if (frameShapes.length) frameShapes = [];
        frameCross = '';
        if (lastCenterKey) {
          lastCenterKey = '';
          onframecenter?.(null);
        }
        return;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const sel = selectionIcrf(s);
      const c = sel ?? screenToIcrf(s, w / 2, h / 2);
      if (!c) return;
      const [ra0, dec0] = s.c2s(c);
      const shapes = [];
      for (const f of frames) {
        const pts = framePolygon(ra0, dec0, f.fovW, f.fovH, f.rotationDeg, 10).map(([ra, dec]) =>
          icrfToScreen(s, [
            Math.cos(dec) * Math.cos(ra),
            Math.cos(dec) * Math.sin(ra),
            Math.sin(dec),
          ]),
        );
        if (pts.some((p) => !p)) continue;
        const xy = pts as [number, number][];
        const d = `M${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
        // Label at the frame's top-most corner.
        const top = xy.reduce((a, b) => (b[1] < a[1] ? b : a));
        shapes.push({
          id: f.id,
          label: f.label,
          color: f.color,
          d,
          lx: top[0] + 4,
          ly: Math.max(14, top[1] - 6),
        });
      }
      frameShapes = shapes;
      const cp = icrfToScreen(s, c);
      frameCross = cp
        ? `M${cp[0] - 8},${cp[1]}L${cp[0] + 8},${cp[1]}M${cp[0]},${cp[1] - 8}L${cp[0]},${cp[1] + 8}`
        : '';
      const ra = (((s.anp(ra0) * s.R2D) % 360) + 360) % 360;
      const dec = s.anpm(dec0) * s.R2D;
      const target = sel ? (selected?.name ?? null) : null;
      const key = `${ra.toFixed(3)},${dec.toFixed(3)},${target}`;
      if (key !== lastCenterKey) {
        lastCenterKey = key;
        onframecenter?.({ ra, dec, target });
      }
    };
    timer = setInterval(tick, 70);
    return () => {
      if (timer) clearInterval(timer);
    };
  });

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

  const fmt = (v: number, d = 1) => `${v.toFixed(d)}°`;
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
    const ra = g.ra * stel.D2R;
    const dec = g.dec * stel.D2R;
    const v = stel.convertFrame(stel.core.observer, 'ICRF', 'MOUNT', stel.s2c(ra, dec));
    stel.lookAt(v, 0.8);
    stel.zoomTo(g.fovDeg * stel.D2R, 0.8);
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
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<div class="wrap">
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

  {#if selected}
    <section class="info" aria-live="polite" aria-label="Selected object">
      <header>
        <h3>{selected.name}</h3>
        <button class="close" onclick={clearSelection} aria-label="Close details">×</button>
      </header>
      {#if selected.type}<p class="type">{selected.type}</p>{/if}
      <dl>
        {#if selected.vmag !== null}<dt>Magnitude</dt>
          <dd>{selected.vmag.toFixed(2)}</dd>{/if}
        <dt>Altitude</dt>
        <dd>{fmt(selected.alt)}{selected.alt < 0 ? ' (below horizon)' : ''}</dd>
        <dt>Azimuth</dt>
        <dd>{fmt(selected.az)}</dd>
        <dt>RA / Dec</dt>
        <dd>{(selected.ra / 15).toFixed(3)} h / {fmt(selected.dec, 2)}</dd>
      </dl>
      {#if selected.otherNames.length}<p class="aka">Also: {selected.otherNames.join(', ')}</p>{/if}
    </section>
  {/if}

  {#if frameShapes.length}
    <svg class="frames" aria-hidden="true">
      {#each frameShapes as f (f.id)}
        <path d={f.d} stroke={f.color} />
        <text x={f.lx} y={f.ly} fill={f.color}>{f.label}</text>
      {/each}
      {#if frameCross}
        <path class="cross" d={frameCross} />
      {/if}
    </svg>
  {/if}

  <p class="credit-line credit">
    Stellarium Web Engine (AGPL) · ESA/Hipparcos · ESA/Gaia/DPAC · OpenNGC ·
    <a href="#/credits">credits</a>
  </p>
</div>

<style>
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
  .frames {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .frames path {
    fill: none;
    stroke-width: 1.6;
  }
  .frames .cross {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .frames text {
    font-size: 12px;
    paint-order: stroke;
    stroke: #000;
    stroke-width: 3px;
  }
  .info {
    position: absolute;
    left: 8px;
    bottom: 48px;
    max-width: min(320px, calc(100% - 16px));
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 12px;
    backdrop-filter: blur(6px);
  }
  .info header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 16px;
  }
  .close {
    min-height: 28px;
    padding: 0 8px;
    line-height: 1;
  }
  .type {
    margin: 2px 0 6px;
    color: var(--accent);
    font-size: 13px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .aka {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
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
