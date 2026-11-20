<script lang="ts" module>
  export type SkyPanel = 'location' | 'time' | 'layers' | 'config' | 'calc' | 'help';
  /** Dock panels the sky's keyboard shortcuts can open. */
  export type DockPanel = 'targets' | 'info' | 'layers' | 'telescope' | 'horizon' | 'time' | 'more';
  export type TimeCmd = 'slower' | 'real' | 'faster' | 'now' | 'pause' | 'back' | 'fwd';
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
  import { onMount, tick, type Snippet } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import type { Setup, SetupKind } from '../lib/equipment';
  import type { LayerState } from './LayerBar.svelte';
  import Oculars from './Oculars.svelte';
  import {
    altAzAt,
    clearEngineSelection,
    describe,
    icrfToScreen,
    screenToIcrf,
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
  import { EYE_FOV_DEG, skyView, VIEW_KEY, type BoolKey } from '../lib/sky/view.svelte';
  import ScopeReticle from './ScopeReticle.svelte';
  import { nextGoodTime, pinInfo, type Pin } from '../lib/astro/pin';
  import CloudWorker from '../lib/sky/clouds.worker.ts?worker';
  import { renderTerrain, type DomeGlow, type Rgb } from '../lib/sky/horizon';
  import { fmtDateTime, fmtTime } from '../lib/time/format';

  interface Props {
    setups: Record<SetupKind, Setup>;
    shownFrames: Record<SetupKind, boolean>;
    onframecenter?: (
      c: { ra: number; dec: number; target: string | null; pa: number } | null,
    ) => void;
    /** Live telescope position (J2000 degrees) for the reticle, or null. */
    scope?: { ra: number; dec: number; label: string; slewing: boolean } | null;
    onselect?: (info: ObjectInfo | null) => void;
    /** Point at J2000 coordinates; with `id`, also select that object when the engine knows it. */
    goto?: {
      ra: number;
      dec: number;
      fovDeg: number;
      n: number;
      id?: string;
      /** For objects the engine may not know: pinned and described instead. */
      pin?: Pin;
    } | null;
    /** Jump the sky's clock (the "show it when it is up" button). */
    onjumptime?: (t: Date) => void;
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
    /** Run the clock at a rate (time-lapse preview); 0 = back to now. */
    onrate?: (rate: number) => void;
    /** Keyboard shortcuts (F1–F10) open these dock panels. */
    onopen?: (p: DockPanel) => void;
    /** F3 / Ctrl+F: open the search. */
    onsearch?: () => void;
    /** Drawn inside the sky's frame (so it stays visible in full screen): the dock. */
    overlay?: Snippet;
    /** Drawn inside the visible sky area (beside / above an open panel): the timeline. */
    stageOverlay?: Snippet;
    /** Expert: pointer coordinates in the status line. */
    expert?: boolean;
    /** Whether the sky is full screen (read by the page's quick switches). */
    fullscreen?: boolean;
    /** Part of the frame an open panel covers: the sky itself shrinks to stay in view. */
    inset?: { right: number; bottom: number };
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
    scope = null,
    onselect,
    goto = null,
    onjumptime,
    clearSignal = 0,
    deepSky = null,
    longExposure = false,
    oncursor,
    tz = undefined,
    layers = $bindable(),
    night = $bindable(false),
    ontime,
    onrate,
    onopen,
    onsearch,
    overlay,
    stageOverlay,
    inset = { right: 0, bottom: 0 },
    fullscreen = $bindable(false),
    expert = false,
  }: Props = $props();

  let canvas = $state<HTMLCanvasElement>() as HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let full = $state(false);
  // Raw: a deep proxy would cache the engine's memory views (HEAPU8…), which go stale when
  // the WebAssembly memory grows, and texture uploads would then fail.
  let stel = $state.raw<Stel | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMsg = $state('');
  let selected = $state<ObjectInfo | null>(null);
  /** A searched object the engine has no entry for: marked on the sky and described. */
  let pin = $state<Pin | null>(null);

  // ---- fullscreen ---------------------------------------------------------------
  /** Full screen without the Fullscreen API (iPhone Safari): the sky covers the page. */
  let pseudo = $state(false);
  function toggleFull() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (pseudo) {
      pseudo = false;
      full = false;
      return;
    }
    const el = wrap as HTMLDivElement & { webkitRequestFullscreen?: () => void };
    const req = el?.requestFullscreen?.bind(el) ?? el?.webkitRequestFullscreen?.bind(el);
    const fallback = () => {
      pseudo = true;
      full = true;
    };
    if (!req) fallback();
    else
      void Promise.resolve()
        .then(() => req())
        .catch(fallback);
  }
  $effect(() => {
    fullscreen = full;
  });
  onMount(() => {
    const on = () => (full = document.fullscreenElement === wrap || pseudo);
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
  /** "Reduce motion" in the system settings: the sky jumps instead of gliding. */
  const calm =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glide = (sec: number) => (calm ? 0 : sec);
  function zoomStep() {
    const s = stel;
    if (!s || !fovTarget) {
      zoomRaf = 0;
      return;
    }
    const cur = s.core.fov * s.R2D;
    // Ease in log space: 22 % of the remaining ratio per frame (~150 ms to settle).
    const next = calm
      ? fovTarget
      : Math.exp(Math.log(cur) + (Math.log(fovTarget) - Math.log(cur)) * 0.22);
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
    if (stel?.core.selection) stel.pointAndLock(stel.core.selection, glide(1));
    else if (pin) lookAtRaDec(pin.ra, pin.dec, stel ? stel.core.fov * stel.R2D : 10);
  }
  /** Stellarium "/": centre and zoom in on the selected object. */
  function autoZoomSelected() {
    if (!stel?.core.selection || !selected) return;
    stel.pointAndLock(stel.core.selection, glide(1));
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
        c.fov = EYE_FOV_DEG * s.D2R;
        c.observer.yaw = 180 * s.D2R; // look south
        c.observer.pitch = 25 * s.D2R;
        c.milkyway.visible = true;
        // The engine simulates random meteors (not real events) and draws a burst of streaks
        // after loading; keep them off so nothing on the sky is invented (CLAUDE.md rule 7).
        if (c.meteors) c.meteors.visible = false;
        // Keep the engine's flat "zero" ground on with the Ground switch: it hides
        // stars and labels below 0°. Our terrain layer adds the real silhouette.
        s.change((_obj, attr) => {
          if (attr === 'selection') {
            if (c.selection) pin = null;
            const info = c.selection ? describe(s, c.selection) : null;
            if (info && unnamed(info)) {
              clearEngineSelection(s);
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
  // the clock itself between updates (live: real time; otherwise the chosen rate), so the
  // page's periodic clock updates (every second live, every 0.1–0.25 s while playing) must not
  // reset it: the two clocks differ by a few hundredths of a second, and each reset made the
  // stars jump by the sky's rotation in that time. Invisible at wide fields, but several pixels
  // when zoomed in (the "shaking" in the equatorial view). Only real jumps are applied.
  $effect(() => {
    if (!stel) return;
    const s = stel;
    const speed = live ? 1 : rate;
    const o = s.core.observer;
    const target = s.date2MJD(time.getTime());
    const cur = clock.t0 ? clockNow() : o.utc;
    const tolDays = Math.max(1.5, Math.abs(speed) * 0.6) / 86400;
    const moved =
      Math.abs(o.latitude - place.lat * s.D2R) > 1e-9 ||
      Math.abs(o.longitude - place.lon * s.D2R) > 1e-9 ||
      o.elevation !== place.elevation;
    if (moved || !(Math.abs(cur - target) <= tolDays)) {
      setObserver(s, place, time);
      clock = { utc0: target, t0: performance.now(), speed };
    } else if (speed !== clock.speed) clock = { utc0: cur, t0: performance.now(), speed };
    // While the view tracks the stars (equatorial view, or after a go-to), mountStep runs the
    // clock itself so time and pointing change together; otherwise the engine runs it.
    s.core.time_speed = mountRaf ? 0 : speed;
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
  // Shared with the dock's layers sheet (src/lib/sky/view.svelte.ts).
  const view = skyView;
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
    cx.mount_frame = 5;
    setMount(v.eqMount);
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

  /**
   * Equatorial mount, done on our side: the engine's own mount setting does not
   * change its drawing. Every frame, while it is on:
   *  - the view is rolled so celestial north points straight up at the centre
   *    (the horizon then tilts away from the meridian, as through a real
   *    equatorial mount or in Stellarium);
   *  - while time runs, the view follows the stars (a tracking mount), so the
   *    sky stays still and the ground turns instead.
   * Dragging, keys, zooms and go-to keep working: when the centre moves by more
   * than the sky's own rotation, the new centre is adopted as the tracked one.
   */
  let mountRaf = 0;
  /**
   * The sky's clock: MJD at a moment (performance.now()) and its rate. The engine runs it itself
   * normally; while tracking, mountStep advances it in the same step that re-points the view,
   * because the engine draws before our frame callback and a one-frame lag that varies with the
   * frame time made the view shake at high zoom.
   */
  let clock = { utc0: 0, t0: 0, speed: 1 };
  const clockNow = () => clock.utc0 + ((performance.now() - clock.t0) / 86_400_000) * clock.speed;
  /** Follow the stars after a go-to by coordinates (no object to lock on), until a drag. */
  let trackOnly = false;
  let tracked: number[] | null = null;
  let trackUtc = 0;
  let dragging = false;
  /** Where the view points, in ICRF, from the engine's own yaw/pitch (exactly invertible). */
  function centreIcrf(s: Stel): number[] | null {
    const o = s.core.observer;
    return s.convertFrame(o, 'MOUNT', 'ICRF', s.s2c(o.yaw, o.pitch));
  }
  function angle(a: number[], b: number[]): number {
    const d = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }
  /** Hand the clock back to the engine when tracking stops. */
  function releaseClock(s: Stel) {
    if (clock.t0) s.core.observer.utc = clockNow();
    s.core.time_speed = clock.speed;
  }
  function mountStep() {
    const s = stel;
    if (!s || (!view.eqMount && !trackOnly)) {
      mountRaf = 0;
      if (s) releaseClock(s);
      return;
    }
    // In the alt-azimuth view, dragging or panning ends the coordinate tracking.
    if (!view.eqMount && (dragging || held.size)) {
      trackOnly = false;
      mountRaf = 0;
      releaseClock(s);
      return;
    }
    const o = s.core.observer;
    // Our clock, in step with the pointing below (see `clock`).
    if (clock.t0) {
      s.core.time_speed = 0;
      o.utc = clockNow();
    }
    const now = centreIcrf(s);
    if (now) {
      const utc = o.utc;
      const dtDays = Math.abs(utc - trackUtc);
      // Largest motion the sky's rotation alone can cause since the last frame.
      const skyTurn = Math.min(Math.PI, dtDays * 2 * Math.PI * 1.0028) * 1.5 + 2e-5;
      const locked = !!s.core.selection && !!(s.core as unknown as { lock: unknown }).lock;
      if (!tracked || dragging || held.size || locked || angle(now, tracked) > skyTurn) {
        tracked = now; // the user (or a go-to) moved the view
      } else if (dtDays > 0) {
        // Follow the stars: point back at the tracked sky position.
        const [yaw, pitch] = s.c2s(s.convertFrame(o, 'ICRF', 'MOUNT', tracked));
        o.yaw = yaw;
        o.pitch = pitch;
      }
      trackUtc = utc;
      if (!view.eqMount) {
        mountRaf = requestAnimationFrame(mountStep);
        return;
      }
      // Roll so that celestial north is up at the centre.
      const c = tracked;
      const [ra, dec] = s.c2s(c);
      // A fixed 0.5° step towards north: tiny steps at high zoom made the screen angle noisy
      // (float precision in the projection) and the view twitched in roll.
      const step = 0.5 * s.D2R;
      const nDec = Math.min(Math.PI / 2 - 1e-6, dec + step);
      const pn = icrfToScreen(s, s.s2c(ra, nDec));
      if (pn) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const a = Math.atan2(pn[1] - h / 2, pn[0] - w / 2);
        // roll +x turns north's screen angle by −x; target angle −90° (up).
        let err = a + Math.PI / 2;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        // A quarter of the error per frame: averages the measurement noise away (smooth roll)
        // and eases into place when the view first turns north-up.
        if (Math.abs(err) > 1e-5)
          o.roll = (o.roll ?? 0) + (Math.abs(err) > 0.05 ? err : err * 0.25);
      }
    }
    mountRaf = requestAnimationFrame(mountStep);
  }
  function setMount(eq: boolean) {
    const s = stel;
    if (!s) return;
    if (eq) {
      tracked = null;
      trackUtc = s.core.observer.utc;
      if (!mountRaf) mountRaf = requestAnimationFrame(mountStep);
    } else {
      if (!trackOnly) {
        cancelAnimationFrame(mountRaf);
        mountRaf = 0;
        releaseClock(s);
      }
      (s.core.observer as unknown as { roll: number }).roll = 0;
    }
  }
  onMount(() => () => cancelAnimationFrame(mountRaf));
  // Before the first time sync, start the clock from the engine's own time.
  $effect(() => {
    if (stel && !clock.t0)
      clock = { utc0: stel.core.observer.utc, t0: performance.now(), speed: live ? 1 : rate };
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
  // Closing the camera frame returns to the human-eye field of view (it zoomed in to the frame).
  let wasOcular = false;
  $effect(() => {
    const on = ocularOn;
    if (wasOcular && !on && stel) zoomToDeg(EYE_FOV_DEG);
    wasOcular = on;
  });
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
    stel.lookAt(v, glide(0.8));
    zoomToDeg(fov);
    // Keep the field in view as the sky turns (the go-to animation is adopted as it moves).
    trackOnly = true;
    tracked = null;
    trackUtc = stel.core.observer.utc;
    if (!mountRaf) mountRaf = requestAnimationFrame(mountStep);
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
  async function selectOrPoint(id: string, ra: number, dec: number, fov: number, fallback?: Pin) {
    const s = stel;
    if (!s) return;
    pin = null;
    // Look there first: the engine loads the object's data tile once it is in view.
    clearEngineSelection(s);
    selected = null;
    lookAtRaDec(ra, dec, fov);
    let obj = findObj(id);
    // The deep-sky tile can take a few seconds to arrive from the data Worker.
    for (let i = 0; !obj && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      obj = findObj(id);
    }
    if (!obj) {
      if (fallback) setPin(fallback);
      return;
    }
    s.core.selection = obj;
    s.pointAndLock(obj, glide(0.6));
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

  /** Double-click: centre and follow the object under the pointer (it is selected by the first click). */
  function onDblClick(e: MouseEvent) {
    e.preventDefault();
    setTimeout(gotoSelected, 30);
  }
  /**
   * Middle button: select the object under the pointer and go to it. The engine
   * selects on a left click, so the click is passed to it as one.
   */
  function onCanvasPointerDown(e: PointerEvent) {
    canvas.focus();
    dragging = true;
    const up = () => {
      dragging = false;
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    if (e.button !== 1 || !stel) return;
    e.preventDefault(); // no auto-scroll
    const m = stel as unknown as {
      _core_on_mouse: (id: number, state: number, x: number, y: number, b: number) => void;
    };
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // The engine needs a rendered frame between press and release to see a click.
    m._core_on_mouse(0, 1, x, y, 1);
    setTimeout(() => {
      m._core_on_mouse(0, 0, x, y, 1);
      setTimeout(gotoSelected, 80);
    }, 60);
  }

  let raf = 0;
  /** Under the pointer (Expert status line): alt/az and J2000 RA/Dec, degrees. */
  let pointer = $state<{ alt: number; az: number; ra: number; dec: number } | null>(null);
  function onPointerMove(e: PointerEvent) {
    if (!stel) return;
    const x = e.offsetX;
    const y = e.offsetY;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!stel) return;
      const aa = altAzAt(stel, x, y);
      oncursor?.(aa);
      if (!expert || !aa) {
        pointer = null;
        return;
      }
      const c = screenToIcrf(stel, x, y);
      if (!c) return;
      const [ra, dec] = stel.c2s(c);
      pointer = {
        alt: aa.alt,
        az: aa.az,
        ra: (((stel.anp(ra) * stel.R2D) % 360) + 360) % 360,
        dec: stel.anpm(dec) * stel.R2D,
      };
    });
  }
  const hms = (deg: number) => {
    const h = deg / 15;
    const m = (h % 1) * 60;
    return `${Math.floor(h)}h${String(Math.floor(m)).padStart(2, '0')}m${String(Math.round((m % 1) * 60) % 60).padStart(2, '0')}s`;
  };
  const dms = (deg: number) => {
    const a = Math.abs(deg);
    return `${deg < 0 ? '−' : '+'}${Math.floor(a)}°${String(Math.floor((a % 1) * 60)).padStart(2, '0')}′`;
  };

  // Refresh the info while an object is selected (it moves with time).
  $effect(() => {
    void time;
    if (stel?.core.selection) selected = describe(stel, stel.core.selection);
    else if (pin) selected = pinInfo(pin, place, time);
  });
  function setPin(p: Pin) {
    if (stel) clearEngineSelection(stel);
    pin = p;
    selected = pinInfo(p, place, time);
  }
  /** Below the horizon now: when to look instead (recomputed when the object changes). */
  const below = $derived.by(() => {
    const s = selected;
    if (!s || s.alt >= 0 || !s.name) return null;
    return {
      name: s.name,
      alt: s.alt,
      next: nextGoodTime(s.ra2000, s.dec2000, place, time),
    };
  });
  let belowHidden = $state('');
  $effect(() => {
    onselect?.(selected);
  });
  let lastGoto = -1;
  $effect(() => {
    const g = goto;
    if (!stel || !g || g.n === lastGoto) return;
    lastGoto = g.n;
    belowHidden = '';
    if (g.id) void selectOrPoint(g.id, g.ra, g.dec, g.fovDeg, g.pin);
    else {
      lookAtRaDec(g.ra, g.dec, g.fovDeg);
      if (g.pin) setPin(g.pin);
      else {
        clearEngineSelection(stel);
        pin = null;
        selected = null;
      }
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
    if (stel) clearEngineSelection(stel);
    pin = null;
    selected = null;
  }

  // ---- keyboard: Stellarium's default shortcuts --------------------------------------
  const toggle = (k: BoolKey) => (view[k] = !view[k]);
  const PANEL_TO_DOCK: Record<SkyPanel, DockPanel> = {
    location: 'more',
    time: 'time',
    layers: 'layers',
    config: 'more',
    calc: 'more',
    help: 'more',
  };
  function panel_(p: SkyPanel) {
    onopen?.(PANEL_TO_DOCK[p]);
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
        // The overlay mounts on the next update when it was off.
        void tick().then(() => oculars?.setMode('telrad'));
      } else if (k === 'm' || k === 'M') toggle('eqMount');
      else if (k === 'n' || k === 'N') night = !night;
      else if (k === 'f' || k === 'F') onsearch?.();
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
        clearSelection();
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
        onsearch?.();
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

  const fmtFovLine = (d: number) =>
    d >= 1
      ? `${d.toFixed(1)}°`
      : d * 60 >= 1
        ? `${(d * 60).toFixed(1)}′`
        : `${(d * 3600).toFixed(0)}″`;
  const rateText = $derived(
    live
      ? 'live'
      : rate === 0
        ? 'paused'
        : rate === 1
          ? 'real speed'
          : rate < 0
            ? `reverse ×${(-rate).toLocaleString()}`
            : `×${rate.toLocaleString()}`,
  );
  /** Dock actions. */
  export function centreSelected() {
    gotoSelected();
  }
  export function fullScreen() {
    toggleFull();
  }
  export function frame() {
    toggleOcular();
  }
  export function zoomTo(deg: number) {
    zoomToDeg(deg);
  }
  /** Turn the view to a J2000 position without zooming ("Follow telescope"). */
  export function pointAt(raDeg: number, decDeg: number) {
    if (!stel) return;
    const v = stel.convertFrame(
      stel.core.observer,
      'ICRF',
      'MOUNT',
      stel.s2c(raDeg * stel.D2R, decDeg * stel.D2R),
    );
    unlock();
    stel.lookAt(v, glide(0.5));
  }
  export const isFull = () => full;
  /** Centre of the view (J2000 degrees) and the field of view, for "objects around here". */
  export function viewCentre(): { ra: number; dec: number; fovDeg: number } | null {
    if (!stel || !canvas) return null;
    const c = screenToIcrf(stel, canvas.clientWidth / 2, canvas.clientHeight / 2);
    if (!c) return null;
    const [ra, dec] = stel.c2s(c);
    return {
      ra: (((stel.anp(ra) * stel.R2D) % 360) + 360) % 360,
      dec: stel.anpm(dec) * stel.R2D,
      fovDeg: stel.core.fov * stel.R2D,
    };
  }
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="wrap"
  class:full
  class:pseudo
  class:idle={full && view.autoHideBars && idle}
  bind:this={wrap}
  onkeydown={onKey}
  onkeyup={onKeyUp}
  onpointermove={wake}
  onpointerdown={wake}
>
  <div
    class="stage"
    class:sheet={inset.bottom > 0}
    style:right={`${inset.right}px`}
    style:bottom={`${inset.bottom}px`}
  >
    <canvas
      bind:this={canvas}
      class="sky"
      tabindex="0"
      onpointermove={onPointerMove}
      onpointerleave={() => oncursor?.(null)}
      onpointerdown={onCanvasPointerDown}
      ondblclick={onDblClick}
      onauxclick={(e) => e.button === 1 && e.preventDefault()}
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
        The 3D sky could not start ({errorMsg}). It needs WebGL: turn on hardware acceleration in
        the browser settings, or try another browser. Everything else on this site still works.
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
        onpreview={onrate}
      />
    {/if}

    {#if scope}
      <ScopeReticle
        {stel}
        {canvas}
        ra={scope.ra}
        dec={scope.dec}
        label={scope.label}
        slewing={scope.slewing}
      />
    {/if}
    {#if pin}
      <ScopeReticle
        {stel}
        {canvas}
        ra={pin.ra}
        dec={pin.dec}
        label={pin.label}
        slewing={false}
        tone="target"
      />
    {/if}
    {#if below && belowHidden !== below.name}
      <div class="below" role="status">
        <p>
          <strong>{below.name}</strong> is {Math.round(-below.alt)}° below the horizon now{below.next
            ? `; ${below.next.dark ? 'best in the dark' : 'highest'} at ${fmtTime(below.next.t, tz)} (${Math.round(below.next.alt)}° up).`
            : ': it never rises here.'}
        </p>
        <div class="below-row">
          {#if below.next}
            <button onclick={() => below.next && onjumptime?.(below.next.t)}>Show it then</button>
          {/if}
          <button onclick={() => (view.ground = false)} aria-pressed={!view.ground}
            >See through the ground</button
          >
          <button onclick={() => (belowHidden = below.name)} aria-label="Hide this note">×</button>
        </div>
      </div>
    {/if}
    {@render stageOverlay?.()}
  </div>

  {@render overlay?.()}

  <div class="bottom">
    <p class="status" aria-live="off">
      <span>{place.name}</span>
      <span>FOV {fmtFovLine(fovDeg)}</span>
      {#if expert && pointer}<span
          >Pointer alt {pointer.alt.toFixed(1)}° az {pointer.az.toFixed(1)}° · RA {hms(pointer.ra)} Dec
          {dms(pointer.dec)} (J2000)</span
        >{/if}
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
  .wrap.pseudo {
    position: fixed;
    inset: 0;
    z-index: 80;
    height: 100dvh;
  }
  .wrap.full {
    border-radius: 0;
    border: none;
  }
  .below {
    position: absolute;
    left: 50%;
    top: 64px;
    transform: translateX(-50%);
    z-index: 5;
    width: min(460px, calc(100% - 24px));
    padding: 8px 12px;
    font-size: var(--fs-14);
    background: color-mix(in srgb, var(--ink-1) 92%, transparent);
    border: 1px solid var(--brass);
    border-radius: 12px;
    box-shadow: var(--shadow-float);
  }
  .below p {
    margin: 0 0 6px;
  }
  .below-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .below-row button {
    min-height: 36px;
    font-size: var(--fs-14);
  }
  .stage {
    --tl-bottom: 30px;
    position: absolute;
    inset: 0;
    container: sky-stage / size;
    transition:
      right 0.18s ease,
      bottom 0.18s ease;
  }
  /* Phones: above the dock's tab bar, or just above an open sheet. */
  @media (max-width: 899px) {
    .stage {
      --tl-bottom: calc(var(--touch) + 26px);
    }
    .stage.sheet {
      --tl-bottom: 6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stage {
      transition: none;
    }
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
    stroke: var(--text);
    stroke-opacity: 0.75;
    stroke-width: 1.2;
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
  /* Phones and tablets: the dock's tab bar owns the bottom edge. */
  @media (max-width: 899px) {
    .bottom {
      display: none;
    }
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
  .bottom {
    transition: opacity 0.4s;
  }
  .wrap.idle .bottom {
    opacity: 0;
  }
  .wrap.idle {
    cursor: none;
  }
  @media (max-width: 640px) {
    .status .credit {
      margin-left: 0;
    }
  }
</style>
