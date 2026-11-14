<script lang="ts" module>
  export type SkyPanel = 'location' | 'time' | 'layers' | 'config' | 'calc' | 'help';
  export type TimeCmd = 'slower' | 'real' | 'faster' | 'now' | 'back' | 'fwd';
</script>

<script lang="ts">
  /**
   * The 3D sky, laid out like the Stellarium desktop program: a left tool bar
   * that opens windows (location, date & time, sky and viewing options, ocular,
   * help), a bottom button bar with the display toggles and time-rate buttons,
   * a status line, object information at the top left, search, a centre
   * crosshair and Stellarium's keyboard shortcuts. Everything stays inside the
   * element that goes full screen, so full screen and normal view are the same.
   */
  import { onMount, type Snippet } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import type { Setup, SetupKind } from '../lib/equipment';
  import type { LayerState } from './LayerBar.svelte';
  import Oculars from './Oculars.svelte';
  import SkyInfo from './SkyInfo.svelte';
  import SkySearch, { type SearchHit } from './SkySearch.svelte';
  import SkyEphem from './SkyEphem.svelte';
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
  import { fmtDateTime } from '../lib/time/format';

  interface Props {
    setups: Record<SetupKind, Setup>;
    shownFrames: Record<SetupKind, boolean>;
    onframecenter?: (c: { ra: number; dec: number; target: string | null } | null) => void;
    onselect?: (info: ObjectInfo | null) => void;
    /** Point at J2000 coordinates; with `id`, also select that object when the engine knows it. */
    goto?: { ra: number; dec: number; fovDeg: number; n: number; id?: string } | null;
    clearSignal?: number;
    place: Place;
    time: Date;
    live: boolean;
    /** Time-rate multiplier while not live (0 = stopped). */
    rate?: number;
    atmosphere: EngineAtmosphere | null;
    clouds: Omit<CloudInput, 'width' | 'height'> | null;
    horizon: Float32Array | null;
    groundColor: Rgb;
    glow?: DomeGlow | null;
    survey?: EngineSurvey | null;
    deepSky?: string | null;
    longExposure?: boolean;
    oncursor?: (p: { alt: number; az: number } | null) => void;
    tz?: string | undefined;
    /** The page's layer switches (shown in the bottom bar). */
    layers: LayerState;
    night?: boolean;
    ontime?: (cmd: TimeCmd) => void;
    oncamera?: () => void;
    /** Window contents supplied by the page (location picker, time controls, layer options). */
    panel?: Snippet<[SkyPanel, () => void]>;
  }
  let {
    place,
    time,
    live,
    rate = 0,
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
    layers = $bindable(),
    night = $bindable(false),
    ontime,
    oncamera,
    panel,
  }: Props = $props();

  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
  let canvas = $state<HTMLCanvasElement>() as HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let full = $state(false);
  // Raw: a deep proxy would cache the engine's memory views (HEAPU8…), which go stale when
  // the WebAssembly memory grows, and texture uploads would then fail.
  let stel = $state.raw<Stel | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMsg = $state('');
  let selected = $state<ObjectInfo | null>(null);
  let openPanel = $state<SkyPanel | null>(null);
  let search = $state<ReturnType<typeof SkySearch>>();

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

  // ---- smooth zoom about the screen centre (as in Stellarium) ---------------------
  const FOV_MIN = 0.2 / 60;
  const FOV_MAX = 185;
  // Perspective cannot show more than ~150° without extreme stretching.
  const fovMax = () => (view.projection === 1 ? 150 : FOV_MAX);
  let fovTarget = 0; // degrees; 0 = no zoom animation running
  let zoomRaf = 0;
  function zoomStep() {
    const s = stel;
    if (!s || !fovTarget) {
      zoomRaf = 0;
      return;
    }
    const cur = s.core.fov * s.R2D;
    // Ease in log space: 22 % of the remaining ratio per frame (~150 ms to settle).
    const next = Math.exp(Math.log(cur) + (Math.log(fovTarget) - Math.log(cur)) * 0.22);
    if (Math.abs(Math.log(next / fovTarget)) < 0.002) {
      s.core.fov = fovTarget * s.D2R;
      fovTarget = 0;
      zoomRaf = 0;
      return;
    }
    s.core.fov = next * s.D2R;
    zoomRaf = requestAnimationFrame(zoomStep);
  }
  /** Multiply the field of view by `f`, smoothly; repeated calls accumulate. */
  function zoomBy(f: number) {
    const s = stel;
    if (!s) return;
    const base = fovTarget || s.core.fov * s.R2D;
    fovTarget = Math.min(fovMax(), Math.max(FOV_MIN, base * f));
    if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
  }
  function zoomToDeg(deg: number) {
    const s = stel;
    if (!s) return;
    fovTarget = Math.min(fovMax(), Math.max(FOV_MIN, deg));
    if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
  }
  onMount(() => {
    const onWheel = (e: Event) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      e.stopPropagation();
      const dy = e instanceof WheelEvent ? e.deltaY * (e.deltaMode === 1 ? 33 : 1) : 0;
      zoomBy(Math.exp(Math.max(-240, Math.min(240, dy)) * 0.0016));
    };
    // Two-finger pinch: zoom about the centre too (one finger still drags the sky).
    let pinch = 0;
    const dist = (t: TouchList) =>
      Math.hypot(
        (t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0),
        (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0),
      );
    const onTouch = (e: TouchEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
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
    wrap.addEventListener('touchstart', onTouch, opt);
    wrap.addEventListener('touchmove', onTouch, opt);
    return () => {
      wrap.removeEventListener('wheel', onWheel, opt);
      wrap.removeEventListener('touchstart', onTouch, opt);
      wrap.removeEventListener('touchmove', onTouch, opt);
      cancelAnimationFrame(zoomRaf);
    };
  });

  /** Centre the view on the selected object and keep it there (Stellarium "centre on selected"). */
  function gotoSelected() {
    if (stel?.core.selection) stel.pointAndLock(stel.core.selection, 1);
  }
  /** Stellarium "/": centre and zoom in on the selected object. */
  function autoZoomSelected() {
    if (!stel?.core.selection || !selected) return;
    stel.pointAndLock(stel.core.selection, 1);
    const size = selected.sizeMajor != null ? selected.sizeMajor / 60 : 0;
    zoomToDeg(size > 0 ? Math.max(size * 4, 0.05) : 10);
  }

  /** Objects the engine can select but that have no name or type (drawing helpers). */
  const unnamed = (i: ObjectInfo) => !i.type && i.name === 'Unnamed object' && !i.ids.length;

  onMount(() => {
    let disposed = false;
    const resize = () => {
      // Cap the backing store at 2× for mid-range phones; never 0 (WebGL needs a size).
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
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
        c.milkyway.visible = true;
        // Keep the engine's flat "zero" ground on with the Ground switch: it hides
        // stars and labels below 0°. Our terrain layer adds the real silhouette.
        s.change((_obj, attr) => {
          if (attr === 'selection') {
            const info = c.selection ? describe(s, c.selection) : null;
            if (info && unnamed(info)) {
              c.selection = null;
              selected = null;
            } else selected = info;
          }
        });
        stel = s;
        status = 'ready';
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

  // Keep the engine's observer in step with the place and time. The engine runs
  // the clock itself between updates (live: real time; otherwise the chosen rate).
  $effect(() => {
    if (!stel) return;
    stel.core.time_speed = live ? 1 : rate;
    setObserver(stel, place, time);
  });
  // A new place: the selection belonged to the old sky, and its info is stale.
  let lastPlace = '';
  $effect(() => {
    const key = `${place.lat},${place.lon}`;
    if (!stel) return;
    if (lastPlace && key !== lastPlace) {
      fovTarget = 0;
      clearSelection();
    }
    lastPlace = key;
  });

  // ---- display options (Stellarium bottom bar) --------------------------------------
  const VIEW_KEY = 'anp.view.v2';
  interface View {
    conLines: boolean;
    conLabels: boolean;
    conBounds: boolean;
    eqGrid: boolean;
    azGrid: boolean;
    meridian: boolean;
    ecliptic: boolean;
    ground: boolean;
    cardinals: boolean;
    atmosphere: boolean;
    dsos: boolean;
    planetLabels: boolean;
    starLabels: boolean;
    eqMount: boolean;
    crosshair: boolean;
    /** Configuration window (F2). */
    projection: 1 | 2;
    starBrightness: number;
    starSize: number;
    starLabelAmount: number;
    dsoLabelAmount: number;
    milkyWay: boolean;
    scaleMoon: boolean;
    flipH: boolean;
    flipV: boolean;
    info: 'all' | 'short' | 'none';
    autoHide: boolean;
  }
  function loadView(): View {
    try {
      return {
        ...loadDefaults(),
        ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<View>),
      };
    } catch {
      return loadDefaults();
    }
  }
  function loadDefaults(): View {
    const d: View = {
      conLines: true,
      conLabels: true,
      conBounds: false,
      eqGrid: false,
      azGrid: false,
      meridian: false,
      ecliptic: false,
      ground: true,
      cardinals: true,
      atmosphere: true,
      dsos: true,
      planetLabels: true,
      starLabels: true,
      eqMount: false,
      crosshair: true,
      projection: 2,
      starBrightness: 1,
      starSize: 1,
      starLabelAmount: 0,
      dsoLabelAmount: 0,
      milkyWay: true,
      scaleMoon: false,
      flipH: false,
      flipV: false,
      info: 'all',
      autoHide: true,
    };
    return d;
  }
  let view = $state(loadView());
  $effect(() => {
    const v = $state.snapshot(view);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch {
      /* not remembered */
    }
    if (!stel) return;
    const c = stel.core;
    const cons = c.constellations as typeof c.constellations & { show_only_pointed: boolean };
    // Engine default draws only the constellation at the view centre.
    cons.show_only_pointed = false;
    cons.lines_visible = v.conLines;
    cons.labels_visible = v.conLabels;
    (cons as unknown as { bounds_visible: boolean }).bounds_visible = v.conBounds;
    c.lines.equatorial.visible = v.eqGrid;
    c.lines.azimuthal.visible = v.azGrid;
    c.lines.meridian.visible = v.meridian;
    c.lines.ecliptic.visible = v.ecliptic;
    c.dsos.visible = v.dsos;
    c.cardinals.visible = v.cardinals;
    c.atmosphere.visible = v.atmosphere;
    c.landscapes.visible = v.ground;
    c.planets.hints_visible = v.planetLabels;
    c.stars.hints_visible = v.starLabels;
    // Mount: alt-azimuth (observed frame, 5) or equatorial (of date, 3).
    const cx = c as unknown as Record<string, unknown> & {
      stars: Record<string, unknown>;
      dsos: Record<string, unknown>;
      planets: Record<string, unknown>;
    };
    cx.mount_frame = v.eqMount ? 3 : 5;
    // Only stereographic (2) and perspective (1) are compiled into the engine.
    cx.projection = v.projection === 1 ? 1 : 2;
    cx.flip_view_horizontal = v.flipH;
    cx.flip_view_vertical = v.flipV;
    c.milkyway.visible = v.milkyWay;
    cx.stars.hints_mag_offset = v.starLabelAmount;
    cx.dsos.hints_mag_offset = v.dsoLabelAmount;
    cx.planets.scale_moon = v.scaleMoon;
    if (v.projection === 1 && c.fov * stel.R2D > 150) zoomToDeg(120);
  });

  // Field of view in degrees, polled (zoom animations run every frame).
  let fovDeg = $state(120);
  onMount(() => {
    const t = setInterval(() => {
      if (stel) fovDeg = Math.round(stel.core.fov * stel.R2D * 100) / 100;
    }, 200);
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
    c.exposure_scale = (longExposure ? 7 : 2) * view.starBrightness;
    c.star_linear_scale = (longExposure ? 1.0 : 1.25) * view.starSize;
    c.star_relative_scale = longExposure ? 1.1 : 1.15;
  });

  $effect(() => {
    if (!stel) return;
    setAtmosphere(
      stel,
      atmosphere ?? { pressure: null, temperature: null, k: 0, dbv: 0, limitMag: Number.NaN },
    );
  });

  // ---- ocular view -----------------------------------------------------------------
  const ocularOn = $derived(Object.values(shownFrames).some(Boolean));
  let oculars = $state<ReturnType<typeof Oculars>>();
  let lastFrames: Record<SetupKind, boolean> = {
    deepsky: true,
    planetary: false,
    lunarsolar: false,
  };
  function toggleOcular() {
    if (ocularOn) {
      lastFrames = { ...shownFrames };
      shownFrames = { deepsky: false, planetary: false, lunarsolar: false };
    } else {
      shownFrames = Object.values(lastFrames).some(Boolean)
        ? { ...lastFrames }
        : { deepsky: true, planetary: false, lunarsolar: false };
    }
  }

  // ---- search ------------------------------------------------------------------
  function lookAtRaDec(raDeg: number, decDeg: number, fov: number) {
    if (!stel) return;
    const v = stel.convertFrame(
      stel.core.observer,
      'ICRF',
      'MOUNT',
      stel.s2c(raDeg * stel.D2R, decDeg * stel.D2R),
    );
    unlock();
    stel.lookAt(v, 0.8);
    zoomToDeg(fov);
  }
  /** Stop following a locked object (after "centre on selected"), so the view can move. */
  function unlock() {
    try {
      (stel?.core as unknown as { lock: unknown }).lock = 0;
    } catch {
      /* engine without a lock attribute */
    }
  }
  function findObj(id: string): ReturnType<Stel['getObj']> {
    try {
      return stel?.getObj(id) ?? null;
    } catch {
      return null;
    }
  }
  /** Select a catalogue object and centre it; if the engine does not know it, point at its coordinates. */
  async function selectOrPoint(id: string, ra: number, dec: number, fov: number) {
    const s = stel;
    if (!s) return;
    // Look there first: the engine loads the object's data tile once it is in view.
    s.core.selection = null;
    selected = null;
    lookAtRaDec(ra, dec, fov);
    let obj = findObj(id);
    for (let i = 0; !obj && i < 12; i++) {
      await new Promise((r) => setTimeout(r, 150));
      obj = findObj(id);
    }
    if (!obj) return;
    s.core.selection = obj;
    s.pointAndLock(obj, 0.6);
  }
  async function onSearch(h: SearchHit): Promise<boolean> {
    const s = stel;
    if (!s) return false;
    if (h.kind === 'dso') {
      await selectOrPoint(h.id, h.ra, h.dec, Math.min(60, Math.max(0.5, h.sizeDeg * 4)));
      return true;
    }
    // Star tiles load on demand: the first lookup can miss while the tile arrives.
    let obj = findObj(h.id);
    for (let i = 0; !obj && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 150));
      obj = findObj(h.id);
    }
    if (!obj) return false;
    s.core.selection = obj;
    s.pointAndLock(obj, 1);
    if (s.core.fov * s.R2D > 90) zoomToDeg(40);
    return true;
  }

  // ---- cloud texture (Web Worker) --------------------------------------------------
  const CW = 512;
  const CH = 128;
  let worker: Worker | null = null;
  let jobId = 0;
  function cloudWorker(): Worker | null {
    if (worker) return worker;
    try {
      worker = new CloudWorker();
      worker.onmessage = (e: MessageEvent<{ id: number; img: Uint8ClampedArray }>) => {
        if (e.data.id === jobId && stel && clouds) {
          setSkyLayer(stel, SKY_LAYER.clouds, e.data.img, CW, CH, 0, 90);
        }
      };
    } catch {
      worker = null;
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
    if (w) w.postMessage({ id, input });
    else setSkyLayer(s, SKY_LAYER.clouds, renderClouds(input), CW, CH, 0, 90);
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

  // Refresh the info while an object is selected (it moves with time).
  $effect(() => {
    void time;
    if (stel?.core.selection) selected = describe(stel, stel.core.selection);
  });
  $effect(() => {
    onselect?.(selected);
  });
  let lastGoto = -1;
  $effect(() => {
    const g = goto;
    if (!stel || !g || g.n === lastGoto) return;
    lastGoto = g.n;
    if (g.id) void selectOrPoint(g.id, g.ra, g.dec, g.fovDeg);
    else {
      stel.core.selection = null;
      selected = null;
      lookAtRaDec(g.ra, g.dec, g.fovDeg);
    }
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

  // ---- keyboard: Stellarium's default shortcuts --------------------------------------
  type BoolKey = { [K in keyof View]: View[K] extends boolean ? K : never }[keyof View];
  const toggle = (k: BoolKey) => (view[k] = !view[k]);
  function panel_(p: SkyPanel) {
    openPanel = openPanel === p ? null : p;
  }
  // Arrow keys pan smoothly while held.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- key state for the pan loop, not UI
  const held = new Set<string>();
  let panRaf = 0;
  function panStep() {
    const s = stel;
    if (!s || !held.size) {
      panRaf = 0;
      return;
    }
    const o = s.core.observer;
    const step = (s.core.fov / 60) * 1.2;
    const limit = (Math.PI / 2) * 0.999;
    if (held.has('ArrowLeft')) o.yaw -= step;
    if (held.has('ArrowRight')) o.yaw += step;
    if (held.has('ArrowUp')) o.pitch = Math.min(limit, o.pitch + step);
    if (held.has('ArrowDown')) o.pitch = Math.max(-limit, o.pitch - step);
    if (held.has('PageUp')) zoomBy(0.97);
    if (held.has('PageDown')) zoomBy(1.03);
    panRaf = requestAnimationFrame(panStep);
  }
  function onKeyUp(e: KeyboardEvent) {
    held.delete(e.key);
  }
  function onKey(e: KeyboardEvent) {
    if (!stel) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(k)) {
      if (t?.tagName === 'BUTTON' && !k.startsWith('Page')) return;
      held.add(k);
      if (!panRaf) panRaf = requestAnimationFrame(panStep);
      e.preventDefault();
      return;
    }
    if (ctrl) {
      if (k === 'o' || k === 'O') toggleOcular();
      else if (k === 'b' || k === 'B') {
        if (!ocularOn) toggleOcular();
        oculars?.setMode('telrad');
      } else if (k === 'm' || k === 'M') toggle('eqMount');
      else if (k === 'n' || k === 'N') night = !night;
      else if (k === 'f' || k === 'F') search?.focus();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) {
      if (k === 'c' || k === 'C') toggle('crosshair');
      else if (k === 'z' || k === 'Z') oculars?.zoomToFit();
      else if (k === 'o' || k === 'O') oculars?.cycleMode();
      else if (k === 'i' || k === 'I') oculars?.toggleInfo();
      else return;
      e.preventDefault();
      return;
    }
    switch (k) {
      case 'c':
      case 'C':
        toggle('conLines');
        break;
      case 'v':
      case 'V':
        toggle('conLabels');
        break;
      case 'b':
      case 'B':
        toggle('conBounds');
        break;
      case 'e':
      case 'E':
        toggle('eqGrid');
        break;
      case 'z':
      case 'Z':
        toggle('azGrid');
        break;
      case ';':
        toggle('meridian');
        break;
      case ',':
        toggle('ecliptic');
        break;
      case 'g':
      case 'G':
        toggle('ground');
        break;
      case 'q':
      case 'Q':
        toggle('cardinals');
        break;
      case 'a':
      case 'A':
        toggle('atmosphere');
        break;
      case 'd':
      case 'D':
        toggle('dsos');
        break;
      case 'p':
      case 'P':
        toggle('planetLabels');
        break;
      case 'j':
      case 'J':
        ontime?.('slower');
        break;
      case 'k':
      case 'K':
        ontime?.('real');
        break;
      case 'l':
      case 'L':
        ontime?.('faster');
        break;
      case '8':
        ontime?.('now');
        break;
      case '+':
      case '=':
        zoomBy(1 / 1.5);
        break;
      case '-':
        zoomBy(1.5);
        break;
      case '/':
        autoZoomSelected();
        break;
      case '\\':
        zoomToDeg(120);
        break;
      case ' ':
        gotoSelected();
        break;
      case 'Escape':
        if (openPanel) openPanel = null;
        else clearSelection();
        break;
      case 'f':
      case 'F':
      case 'F11':
        toggleFull();
        break;
      case 'F2':
        panel_('config');
        break;
      case 'F10':
        panel_('calc');
        break;
      case 'F1':
      case '?':
        panel_('help');
        break;
      case 'F3':
        search?.focus();
        break;
      case 'F4':
        panel_('layers');
        break;
      case 'F5':
        panel_('time');
        break;
      case 'F6':
        panel_('location');
        break;
      case '[':
      case ']':
      case '{':
      case '}':
        if (!oculars) return;
        oculars.rotate(k === '[' ? -1 : k === ']' ? 1 : k === '{' ? -15 : 15);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ---- bottom bar ----------------------------------------------------------------
  type Btn = { id: string; label: string; key: string; on: boolean; act: () => void; icon: string };
  const viewBtn = (id: BoolKey, label: string, key: string, icon: string): Btn => ({
    id,
    label,
    key,
    on: view[id],
    act: () => toggle(id),
    icon,
  });
  // SVG path data (24×24, stroked) for the bottom-bar icons.
  const I = {
    lines: 'M4 18l5-9 6 4 5-9',
    labels: 'M5 18h3M9 6l-4 12M9 6l4 12M7 13h5M15 10h5M15 14h4',
    bounds: 'M4 5h7v5h9v9H9v-5H4z',
    eq: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c-4 5-4 13 0 18M12 3c4 5 4 13 0 18',
    az: 'M3 17h18M5 13h14M8 9h8M12 5v12',
    meridian: 'M12 3v18M7 5h10',
    ecliptic: 'M3 15c5-7 13-7 18 0M3 9h3M18 9h3',
    ground: 'M3 16l5-5 4 3 4-4 5 6v4H3z',
    cardinals: 'M12 3v4M12 17v4M3 12h4M17 12h4M10 12h4',
    atmosphere: 'M3 15a9 9 0 0 1 18 0M6 15a6 6 0 0 1 12 0M3 18h18',
    dsos: 'M12 12m-7 0a7 4 0 1 0 14 0a7 4 0 1 0-14 0M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    planets: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 14c4 3 14 1 18-5',
    stars: 'M12 4l2 5 5 .5-4 3.5 1.5 5L12 15l-4.5 3 1.5-5-4-3.5 5-.5z',
    mount: 'M12 4v8l6 6M12 12L6 18M4 21h16',
    center: 'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 2v5M12 17v5M2 12h5M17 12h5',
    cross: 'M12 4v6M12 14v6M4 12h6M14 12h6',
    ocular: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    night: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    slower: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
    real: 'M7 5l12 7-12 7z',
    faster: 'M4 6l7 6-7 6zM13 6l7 6-7 6z',
    now: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 7v5l3 3',
  };
  const mainBtns = $derived<Btn[][]>([
    [
      viewBtn('conLines', 'Constellation lines', 'C', I.lines),
      viewBtn('conLabels', 'Constellation names', 'V', I.labels),
      viewBtn('conBounds', 'Constellation boundaries', 'B', I.bounds),
    ],
    [
      viewBtn('eqGrid', 'Equatorial grid', 'E', I.eq),
      viewBtn('azGrid', 'Azimuthal grid', 'Z', I.az),
      viewBtn('meridian', 'Meridian line', ';', I.meridian),
      viewBtn('ecliptic', 'Ecliptic', ',', I.ecliptic),
    ],
    [
      viewBtn('ground', 'Ground', 'G', I.ground),
      viewBtn('cardinals', 'Cardinal points', 'Q', I.cardinals),
      viewBtn('atmosphere', 'Atmosphere', 'A', I.atmosphere),
    ],
    [
      viewBtn('dsos', 'Deep-sky objects', 'D', I.dsos),
      viewBtn('planetLabels', 'Planet labels', 'P', I.planets),
      viewBtn('starLabels', 'Star labels', '', I.stars),
    ],
    [
      viewBtn('eqMount', 'Equatorial mount', 'Ctrl+M', I.mount),
      {
        id: 'center',
        label: 'Centre on selected object',
        key: 'Space',
        on: false,
        act: gotoSelected,
        icon: I.center,
      },
      viewBtn('crosshair', 'Centre crosshair', 'Alt+C', I.cross),
      {
        id: 'ocular',
        label: 'Ocular view (sensor, eyepiece, Telrad)',
        key: 'Ctrl+O',
        on: ocularOn,
        act: toggleOcular,
        icon: I.ocular,
      },
    ],
    [
      {
        id: 'night',
        label: 'Night mode',
        key: 'Ctrl+N',
        on: night,
        act: () => (night = !night),
        icon: I.night,
      },
      {
        id: 'full',
        label: full ? 'Exit full screen' : 'Full screen',
        key: 'F',
        on: full,
        act: toggleFull,
        icon: I.full,
      },
    ],
    [
      {
        id: 'slower',
        label: 'Decrease time speed',
        key: 'J',
        on: rate < 0,
        act: () => ontime?.('slower'),
        icon: I.slower,
      },
      {
        id: 'real',
        label: 'Normal time speed',
        key: 'K',
        on: live || rate === 1,
        act: () => ontime?.('real'),
        icon: I.real,
      },
      {
        id: 'faster',
        label: 'Increase time speed',
        key: 'L',
        on: rate > 1,
        act: () => ontime?.('faster'),
        icon: I.faster,
      },
      {
        id: 'now',
        label: 'Set time to now',
        key: '8',
        on: live,
        act: () => ontime?.('now'),
        icon: I.now,
      },
    ],
  ]);
  type LayerKey =
    | 'clouds'
    | 'lightpollution'
    | 'haze'
    | 'terrain'
    | 'longExposure'
    | 'deepSky'
    | 'surveys'
    | 'satmap';
  const LAYER_CHIPS: { key: LayerKey; label: string; hint: string }[] = [
    { key: 'clouds', label: 'Clouds', hint: 'Live clouds (forecast + satellite)' },
    { key: 'lightpollution', label: 'Light pollution', hint: 'Yearly sky-glow model, light domes' },
    {
      key: 'haze',
      label: 'Haze',
      hint: 'Extinction and sky brightness from humidity and aerosols',
    },
    { key: 'terrain', label: 'Terrain', hint: 'Real horizon from elevation data' },
    { key: 'longExposure', label: 'Long exposure', hint: 'Camera-like view ~4 mag deeper' },
    { key: 'deepSky', label: 'Deep-sky photos', hint: 'Survey photos fade in when zoomed in' },
    { key: 'surveys', label: 'Sky surveys', hint: 'Archival survey images (options in F4)' },
    { key: 'satmap', label: 'Satellite map', hint: 'Opens the satellite cloud map (Maps tab)' },
  ];

  const SIDE: { id: SkyPanel; label: string; key: string; icon: string }[] = [
    {
      id: 'location',
      label: 'Location',
      key: 'F6',
      icon: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 9m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
    },
    { id: 'time', label: 'Date and time', key: 'F5', icon: I.now },
    {
      id: 'layers',
      label: 'Sky and viewing options',
      key: 'F4',
      icon: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
    },
    {
      id: 'calc',
      label: 'Astronomical calculations',
      key: 'F10',
      icon: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2M16 15v3',
    },
    {
      id: 'config',
      label: 'Configuration',
      key: 'F2',
      icon: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.4H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.6 4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    },
    {
      id: 'help',
      label: 'Help and keyboard shortcuts',
      key: 'F1',
      icon: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17v.5',
    },
  ];
  const PANEL_TITLES: Record<SkyPanel, string> = {
    location: 'Location',
    time: 'Date and time',
    layers: 'Sky and viewing options',
    config: 'Configuration',
    calc: 'Astronomical calculations',
    help: 'Keyboard shortcuts',
  };
  const fmtFovLine = (d: number) =>
    d >= 1
      ? `${d.toFixed(1)}°`
      : d * 60 >= 1
        ? `${(d * 60).toFixed(1)}′`
        : `${(d * 3600).toFixed(0)}″`;
  const rateText = $derived(
    live ? 'live' : rate === 0 ? 'paused' : rate === 1 ? 'real speed' : `×${rate.toLocaleString()}`,
  );
  let barOpen = $state(!phone);
  // Full screen: the bars fade after 3 s without mouse or touch (Stellarium auto-hide).
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function wake() {
    idle = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), 3000);
  }
  onMount(() => () => {
    if (idleTimer) clearTimeout(idleTimer);
  });
  const closePanel = () => (openPanel = null);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="wrap"
  class:full
  class:idle={full && view.autoHide && idle && !openPanel}
  bind:this={wrap}
  onkeydown={onKey}
  onkeyup={onKeyUp}
  onpointermove={wake}
  onpointerdown={wake}
>
  <canvas
    bind:this={canvas}
    class="sky"
    tabindex="0"
    onpointermove={onPointerMove}
    onpointerleave={() => oncursor?.(null)}
    onpointerdown={() => canvas.focus()}
    aria-label="Interactive 3D sky. Drag or use the arrow keys to look around; scroll, pinch, Page Up/Down or +/- to zoom; tap an object for details. Press F1 for all shortcuts."
  ></canvas>

  {#if view.crosshair && !ocularOn}
    <svg class="crosshair" aria-hidden="true" viewBox="-20 -20 40 40">
      <path d="M-14 0H-4M4 0H14M0 -14V-4M0 4V14" />
      <circle r="1" />
    </svg>
  {/if}

  {#if status === 'loading'}
    <p class="overlay" role="status">Loading the sky…</p>
  {:else if status === 'error'}
    <p class="overlay error" role="alert">
      The 3D sky could not start ({errorMsg}). Your browser needs WebGL 2. The other tabs still
      work.
    </p>
  {/if}

  {#if ocularOn}
    <Oculars
      bind:this={oculars}
      {stel}
      {canvas}
      bind:setups
      bind:shown={shownFrames}
      selectedName={selected?.name ?? null}
      {onframecenter}
      onzoom={zoomToDeg}
    />
  {/if}

  <div class="topleft">
    <SkySearch bind:this={search} onpick={onSearch} />
    {#if selected && view.info !== 'none'}
      {#key view.info}
        <SkyInfo
          info={selected}
          {place}
          {time}
          {tz}
          short={view.info === 'short'}
          onclose={clearSelection}
          ongoto={gotoSelected}
        />
      {/key}
    {/if}
  </div>

  <!-- Left tool bar (Stellarium's windows) -->
  <nav class="side" aria-label="Sky windows">
    {#each SIDE as b (b.id)}
      <button
        class="ico"
        aria-pressed={openPanel === b.id}
        aria-label={`${b.label} (${b.key})`}
        title={`${b.label} [${b.key}]`}
        onclick={() => panel_(b.id)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={b.icon} /></svg>
      </button>
    {/each}
  </nav>

  {#if openPanel}
    <section class="win" aria-labelledby="sky-win-title">
      <header>
        <h2 id="sky-win-title">{PANEL_TITLES[openPanel]}</h2>
        <button class="x" onclick={closePanel} aria-label="Close window">×</button>
      </header>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="win-body" tabindex="0">
        {#if openPanel === 'help'}
          <dl class="keys">
            <dt>Drag / arrows</dt>
            <dd>look around (hold to pan)</dd>
            <dt>Wheel, pinch, Page Up/Down, + / −</dt>
            <dd>zoom on the centre</dd>
            <dt>/ and \</dt>
            <dd>zoom in on the selection / zoom out</dd>
            <dt>Space</dt>
            <dd>centre on the selected object</dd>
            <dt>C V B</dt>
            <dd>constellation lines, names, boundaries</dd>
            <dt>E Z ; ,</dt>
            <dd>equatorial grid, azimuthal grid, meridian, ecliptic</dd>
            <dt>G Q A</dt>
            <dd>ground, cardinal points, atmosphere</dd>
            <dt>D P</dt>
            <dd>deep-sky objects, planet labels</dd>
            <dt>J K L 8</dt>
            <dd>slower, normal speed, faster, now</dd>
            <dt>Ctrl+M</dt>
            <dd>equatorial / alt-azimuth mount</dd>
            <dt>Ctrl+O, Ctrl+B</dt>
            <dd>ocular view, Telrad</dd>
            <dt>Alt+O, Alt+Z, Alt+I</dt>
            <dd>ocular mode, zoom to frame, ocular info</dd>
            <dt>[ ] (Shift: 15°)</dt>
            <dd>rotate the sensor frame 1°</dd>
            <dt>Alt+C</dt>
            <dd>centre crosshair</dd>
            <dt>Ctrl+N, F</dt>
            <dd>night mode, full screen</dd>
            <dt>F3 / Ctrl+F, F4, F5, F6</dt>
            <dd>search, sky options, date and time, location</dd>
            <dt>F2, F10</dt>
            <dd>configuration, astronomical calculations</dd>
            <dt>Esc</dt>
            <dd>close the window, then clear the selection</dd>
          </dl>
          <p class="note">Shortcuts work while the sky has focus (click it once).</p>
        {:else if openPanel === 'calc'}
          <SkyEphem
            {place}
            {time}
            {tz}
            onpick={(n) => void onSearch({ kind: 'engine', label: n, sub: '', id: `NAME ${n}` })}
          />
        {:else if openPanel === 'config'}
          <fieldset>
            <legend>Projection</legend>
            <label
              ><input type="radio" bind:group={view.projection} value={2} /> Stereographic (default)</label
            >
            <label><input type="radio" bind:group={view.projection} value={1} /> Perspective</label>
          </fieldset>
          <fieldset>
            <legend>Stars</legend>
            <label class="rng"
              >Brightness <input
                type="range"
                min="0.4"
                max="3"
                step="0.05"
                bind:value={view.starBrightness}
              /><output>{view.starBrightness.toFixed(2)}×</output></label
            >
            <label class="rng"
              >Size <input
                type="range"
                min="0.6"
                max="1.6"
                step="0.05"
                bind:value={view.starSize}
              /><output>{view.starSize.toFixed(2)}×</output></label
            >
          </fieldset>
          <fieldset>
            <legend>Labels and markers</legend>
            <label class="rng"
              >Star labels <input
                type="range"
                min="-3"
                max="3"
                step="0.5"
                bind:value={view.starLabelAmount}
              /><output>{view.starLabelAmount > 0 ? '+' : ''}{view.starLabelAmount}</output></label
            >
            <label class="rng"
              >Deep-sky labels <input
                type="range"
                min="-3"
                max="3"
                step="0.5"
                bind:value={view.dsoLabelAmount}
              /><output>{view.dsoLabelAmount > 0 ? '+' : ''}{view.dsoLabelAmount}</output></label
            >
          </fieldset>
          <fieldset>
            <legend>Display</legend>
            <label><input type="checkbox" bind:checked={view.milkyWay} /> Milky Way</label>
            <label><input type="checkbox" bind:checked={view.scaleMoon} /> Enlarge the Moon</label>
            <label
              ><input type="checkbox" bind:checked={view.flipH} /> Mirror left–right (diagonal)</label
            >
            <label><input type="checkbox" bind:checked={view.flipV} /> Flip upside down</label>
            <label><input type="checkbox" bind:checked={view.crosshair} /> Centre crosshair</label>
            <label
              ><input type="checkbox" bind:checked={view.autoHide} /> Hide the bars in full screen when
              the mouse is still</label
            >
          </fieldset>
          <fieldset>
            <legend>Selected object information</legend>
            <label><input type="radio" bind:group={view.info} value="all" /> All</label>
            <label><input type="radio" bind:group={view.info} value="short" /> Short</label>
            <label><input type="radio" bind:group={view.info} value="none" /> None</label>
          </fieldset>
          <button
            onclick={() => {
              const keep = { ...view };
              view = {
                ...loadDefaults(),
                conLines: keep.conLines,
                conLabels: keep.conLabels,
              };
            }}>Restore defaults</button
          >
        {:else}
          {@render panel?.(openPanel, closePanel)}
        {/if}
      </div>
    </section>
  {/if}

  <!-- Bottom button bar and status line -->
  <div class="bottom">
    <button
      class="bar-toggle"
      aria-expanded={barOpen}
      aria-controls="sky-bar"
      onclick={() => (barOpen = !barOpen)}
      title="Show or hide the button bar">{barOpen ? '▾' : '▴ Buttons'}</button
    >
    <div id="sky-bar" class="bar" hidden={!barOpen} role="toolbar" aria-label="Sky display">
      {#each mainBtns as group, gi (gi)}
        <div class="grp">
          {#each group as b (b.id)}
            <button
              class="ico"
              aria-pressed={b.id === 'center' ? undefined : b.on}
              aria-label={b.key ? `${b.label} (${b.key})` : b.label}
              title={b.key ? `${b.label} [${b.key}]` : b.label}
              onclick={b.act}
              disabled={b.id === 'center' && !selected}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={b.icon} /></svg>
            </button>
          {/each}
        </div>
      {/each}
      <div class="grp chips">
        {#each LAYER_CHIPS as c (c.key)}
          <button
            class="chip"
            aria-pressed={layers[c.key]}
            title={c.hint}
            onclick={() => (layers[c.key] = !layers[c.key])}>{c.label}</button
          >
        {/each}
        {#if oncamera}
          <button
            class="chip"
            title="Phone camera with the horizon and your target's path"
            onclick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              oncamera?.();
            }}>Camera view</button
          >
        {/if}
      </div>
    </div>
    <p class="status" aria-live="off">
      <span>{place.name}</span>
      <span>FOV {fmtFovLine(fovDeg)}</span>
      <span>{fmtDateTime(time, tz)}</span>
      <span class:hot={!live}>{rateText}</span>
      <span class="credit"
        >Stellarium Web Engine (AGPL) · ESA/Hipparcos · ESA/Gaia/DPAC · OpenNGC · <a
          href="#/credits">credits</a
        ></span
      >
    </p>
  </div>
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
  .wrap.full {
    border-radius: 0;
    border: none;
  }
  .sky {
    display: block;
    width: 100%;
    height: 100%;
    min-height: inherit;
    touch-action: none;
    filter: var(--sky-filter);
  }
  .sky:focus-visible {
    outline-offset: -3px;
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
    pointer-events: none;
  }
  .overlay.error {
    color: var(--bad);
  }
  .crosshair {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    pointer-events: none;
    filter: var(--sky-filter);
  }
  .crosshair path,
  .crosshair circle {
    fill: none;
    stroke: rgb(255 255 255 / 0.75);
    stroke-width: 1.2;
  }
  .topleft {
    position: absolute;
    top: 8px;
    left: 56px;
    z-index: 4;
    display: grid;
    gap: 6px;
    justify-items: start;
    max-height: calc(100% - 110px);
    overflow-y: auto;
    scrollbar-width: none;
    pointer-events: none;
  }
  .topleft > :global(*) {
    pointer-events: auto;
  }
  /* ---- glassy controls ---- */
  .ico,
  .chip,
  .bar-toggle,
  .x {
    background: color-mix(in srgb, var(--panel) 78%, transparent);
    backdrop-filter: blur(6px);
  }
  .ico {
    width: 38px;
    height: 38px;
    min-height: 38px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 9px;
    color: var(--muted);
  }
  .ico svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ico[aria-pressed='true'],
  .chip[aria-pressed='true'] {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 24%, var(--panel));
  }
  .ico:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .side {
    position: absolute;
    left: 8px;
    top: 8px;
    z-index: 5;
    display: grid;
    gap: 6px;
  }
  .win {
    position: absolute;
    left: 56px;
    top: 8px;
    z-index: 7;
    width: min(440px, calc(100% - 64px));
    max-height: calc(100% - 100px);
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border: 1px solid var(--line);
    border-radius: 12px;
    backdrop-filter: blur(10px);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
  }
  .win header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 8px 14px;
    border-bottom: 1px solid var(--line);
  }
  .win h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .x {
    min-height: 30px;
    padding: 0 10px;
  }
  .win-body {
    padding: 10px 12px;
    overflow-y: auto;
    display: grid;
    gap: 10px;
    /* Pickers built to drop down (location) stay inside the window. */
    position: relative;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0;
    font-size: 13px;
  }
  .keys dt {
    font-family: var(--mono);
    color: var(--accent);
    white-space: nowrap;
  }
  .keys dd {
    margin: 0;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    display: grid;
    gap: 4px;
    padding: 0 8px 4px;
    pointer-events: none;
  }
  .bottom > * {
    pointer-events: auto;
  }
  .bar-toggle {
    justify-self: start;
    font-size: 12px;
    min-height: 28px;
    padding: 2px 10px;
  }
  .bar {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: thin;
    padding: 2px 0;
  }
  .bar[hidden] {
    display: none;
  }
  .grp {
    display: flex;
    gap: 3px;
    flex: none;
    padding-right: 8px;
    border-right: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  }
  .grp:last-child {
    border-right: none;
  }
  .chip {
    flex: none;
    min-height: 38px;
    padding: 2px 11px;
    border-radius: 999px;
    font-size: 13px;
    white-space: nowrap;
    color: var(--muted);
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 0;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 3px #000;
  }
  .status .hot {
    color: var(--warn);
  }
  .status .credit {
    margin-left: auto;
  }
  .status a {
    color: inherit;
  }
  .side,
  .bottom,
  .topleft {
    transition: opacity 0.4s;
  }
  .wrap.idle .side,
  .wrap.idle .bottom,
  .wrap.idle .topleft {
    opacity: 0;
  }
  .wrap.idle {
    cursor: none;
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 8px;
    margin: 0;
    padding: 6px 10px 8px;
    display: grid;
    gap: 4px;
    font-size: 13px;
  }
  legend {
    color: var(--muted);
    font-size: 12px;
    padding: 0 4px;
  }
  fieldset label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .rng input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .rng output {
    width: 46px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 640px) {
    .topleft {
      left: 52px;
    }
    .ico {
      width: 36px;
      height: 36px;
      min-height: 36px;
    }
    .side {
      top: 8px;
      left: 6px;
      gap: 4px;
    }
    .win {
      left: 6px;
      width: calc(100% - 12px);
      top: 52px;
      max-height: calc(100% - 140px);
    }
    .status .credit {
      margin-left: 0;
    }
  }
</style>
