<script lang="ts" module>
  export const FRAME_COLORS: Record<SetupKind, string> = {
    deepsky: '#7fd1ff',
    planetary: '#ffd27f',
    lunarsolar: '#b8f28a',
  };
</script>

<script lang="ts">
  /**
   * Field-of-view overlay in the manner of Stellarium's Oculars plugin: the
   * sensor frame (or eyepiece circle, or Telrad rings) stays fixed at the centre
   * of the screen while the sky moves under it, drawn at its true angular size.
   */
  import { onMount } from 'svelte';
  import { icrfToScreen, screenToIcrf, selectionIcrf, type Stel } from '../lib/engine/stel';
  import {
    EYEPIECES,
    LENSES_MM,
    nightscapeStats,
    SENSORS,
    timelapseStats,
    eyepieceStats,
    fitFov,
    fmtFov,
    framePolygon,
    normRotation,
    plateScale,
    SETUP_LABELS,
    setupStats,
    TELRAD_RINGS,
    type OcularMode,
    type Setup,
    type SetupKind,
  } from '../lib/equipment';

  interface Props {
    stel: Stel | null;
    canvas: HTMLCanvasElement | undefined;
    setups: Record<SetupKind, Setup>;
    shown: Record<SetupKind, boolean>;
    /** Name of the selected object, for the frame-centre report. */
    selectedName: string | null;
    onframecenter?: (c: { ra: number; dec: number; target: string | null } | null) => void;
    /** Smooth zoom to a field of view in degrees (the sky view's own animation). */
    onzoom?: (deg: number) => void;
    /** Time-lapse preview: run the sky clock at this rate (0 = stop). */
    onpreview?: (rate: number) => void;
  }
  let {
    stel,
    canvas,
    setups = $bindable(),
    shown = $bindable(),
    selectedName,
    onframecenter,
    onzoom,
    onpreview,
  }: Props = $props();

  const KINDS: SetupKind[] = ['deepsky', 'planetary', 'lunarsolar'];
  const KEY = 'anp.oculars.v1';
  interface Saved {
    mode: OcularMode;
    active: SetupKind;
    northUp: boolean;
    epFocal: number;
    epAfov: number;
    binning: number;
    showInfo: boolean;
    nsSensor: number;
    nsLens: number;
    nsF: number;
    nsPortrait: boolean;
    tlInterval: number;
    tlFrames: number;
  }
  function load(): Saved {
    const d: Saved = {
      mode: 'sensor',
      active: 'deepsky',
      northUp: false,
      epFocal: 25,
      epAfov: 52,
      binning: 1,
      showInfo: typeof matchMedia !== 'function' || !matchMedia('(max-width: 600px)').matches,
      nsSensor: 0,
      nsLens: 14,
      nsF: 2.8,
      nsPortrait: false,
      tlInterval: 20,
      tlFrames: 300,
    };
    try {
      return { ...d, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) };
    } catch {
      return d;
    }
  }
  const saved = load();
  let mode = $state<OcularMode>(saved.mode);
  let active = $state<SetupKind>(saved.active);
  let northUp = $state(saved.northUp);
  let epFocal = $state(saved.epFocal);
  let epAfov = $state(saved.epAfov);
  let binning = $state(saved.binning);
  let showInfo = $state(saved.showInfo);
  let nsSensor = $state(saved.nsSensor);
  let nsLens = $state(saved.nsLens);
  let nsF = $state(saved.nsF);
  let nsPortrait = $state(saved.nsPortrait);
  let tlInterval = $state(saved.tlInterval);
  let tlFrames = $state(saved.tlFrames);
  let previewing = $state(false);
  const FULL_FRAME = { name: 'Full frame (36 × 24 mm)', widthMm: 36, heightMm: 24, pixelUm: 5.9 };
  const sensor = $derived(SENSORS[nsSensor] ?? FULL_FRAME);
  const ns = $derived(nightscapeStats(sensor, nsLens, nsF, nsPortrait));
  const tl = $derived(timelapseStats(tlInterval, tlFrames));
  /** Play the time-lapse's duration in about 12 seconds of sky time. */
  function preview() {
    previewing = !previewing;
    onpreview?.(previewing ? Math.max(1, Math.round(tl.durationS / 12)) : 0);
  }
  /** Nightscape frame: level with the horizon, exact projection (wide lenses). */
  let nsPath = $state('');
  let open = $state(typeof matchMedia !== 'function' || !matchMedia('(max-width: 640px)').matches);
  $effect(() => {
    const s: Saved = {
      mode,
      active,
      northUp,
      epFocal,
      epAfov,
      binning,
      showInfo,
      nsSensor,
      nsLens,
      nsF,
      nsPortrait,
      tlInterval,
      tlFrames,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* not remembered */
    }
  });
  // The active setup is always one of those shown.
  $effect(() => {
    if (!shown[active]) {
      const first = KINDS.find((k) => shown[k]);
      if (first) active = first;
    }
  });

  const setup = $derived(setups[active]);
  const stats = $derived(setupStats(setup));
  const ep = $derived(eyepieceStats(setup, { focalMm: epFocal, afovDeg: epAfov }));
  const epPreset = $derived(
    EYEPIECES.findIndex((e) => e.focalMm === epFocal && e.afovDeg === epAfov),
  );

  // ---- geometry at the screen centre, refreshed while visible -----------------------
  let w = $state(0);
  let h = $state(0);
  let pxPerDeg = $state(0);
  /** Screen angle (radians, from +x, y down) of celestial north and east at the centre. */
  let northA = $state(-Math.PI / 2);
  let eastA = $state(Math.PI);
  let polys = $state<{ id: SetupKind; d: string }[]>([]);
  let lastKey = '';

  function tick() {
    const s = stel;
    if (!s || !canvas) return;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    const c = screenToIcrf(s, w / 2, h / 2);
    if (!c) return;
    const [ra0, dec0] = s.c2s(c);
    const fovDeg = s.core.fov * s.R2D;
    const step = Math.min(0.5, fovDeg / 40) * s.D2R;
    const toScreen = (ra: number, dec: number) =>
      icrfToScreen(s, [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
    const up = dec0 + step < Math.PI / 2;
    const pn = toScreen(ra0, dec0 + (up ? step : -step));
    const pe = toScreen(ra0 + step / Math.max(0.05, Math.cos(dec0)), dec0);
    if (pn) {
      const dx = (pn[0] - w / 2) * (up ? 1 : -1);
      const dy = (pn[1] - h / 2) * (up ? 1 : -1);
      pxPerDeg = Math.hypot(dx, dy) / (step * s.R2D);
      northA = Math.atan2(dy, dx);
    }
    if (pe) eastA = Math.atan2(pe[1] - h / 2, pe[0] - w / 2);
    // North-up frames: exact projection of the frame's corners on the sky.
    if (northUp && mode === 'sensor') {
      const out: { id: SetupKind; d: string }[] = [];
      for (const k of KINDS) {
        if (!shown[k]) continue;
        const st = setupStats(setups[k]);
        const pts = framePolygon(ra0, dec0, st.fovW, st.fovH, setups[k].rotationDeg, 10).map(
          ([ra, dec]) => toScreen(ra, dec),
        );
        if (pts.some((p) => !p)) continue;
        const xy = pts as [number, number][];
        out.push({
          id: k,
          d: `M${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`,
        });
      }
      polys = out;
    } else if (polys.length) polys = [];
    if (mode === 'nightscape') nsPath = nightscapePath(s, c);
    else if (nsPath) nsPath = '';
    // Report the frame centre (J2000) for the Equipment tab.
    const ra = (((s.anp(ra0) * s.R2D) % 360) + 360) % 360;
    const dec = s.anpm(dec0) * s.R2D;
    const sel = selectionIcrf(s);
    const sp = sel ? icrfToScreen(s, sel) : null;
    const target =
      sp && Math.hypot(sp[0] - w / 2, sp[1] - h / 2) < 6 ? (selectedName ?? null) : null;
    const key = `${ra.toFixed(3)},${dec.toFixed(3)},${target}`;
    if (key !== lastKey) {
      lastKey = key;
      onframecenter?.({ ra, dec, target });
    }
  }
  // Redrawn every frame, so the frame never lags behind the sky while panning or zooming.
  onMount(() => {
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Like Stellarium: switching the ocular view on zooms to the frame.
    const z = setTimeout(() => zoomToFit(), 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(z);
      onframecenter?.(null);
    };
  });

  // ---- actions (also bound to keys by the sky view) --------------------------------
  export function rotate(by: number) {
    setups[active].rotationDeg = normRotation(setups[active].rotationDeg + by);
  }
  /**
   * Corners of a camera frame held level (a tripod): gnomonic projection around the
   * view centre in the horizontal frame, with "up" towards the zenith, then each edge
   * point projected to the screen. Exact for wide lenses.
   */
  function nightscapePath(s: Stel, cIcrf: number[]): string {
    const o = s.core.observer;
    const c = s.convertFrame(o, 'ICRF', 'OBSERVED', cIcrf);
    const len = Math.hypot(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0) || 1;
    const C = [(c[0] ?? 0) / len, (c[1] ?? 0) / len, (c[2] ?? 0) / len];
    // Horizontal axis = zenith × centre; vertical = centre × horizontal.
    let U = [-(C[1] ?? 0), C[0] ?? 0, 0];
    const ul = Math.hypot(U[0] ?? 0, U[1] ?? 0) || 1;
    U = [(U[0] ?? 0) / ul, (U[1] ?? 0) / ul, 0];
    const V = [
      (C[1] ?? 0) * (U[2] ?? 0) - (C[2] ?? 0) * (U[1] ?? 0),
      (C[2] ?? 0) * (U[0] ?? 0) - (C[0] ?? 0) * (U[2] ?? 0),
      (C[0] ?? 0) * (U[1] ?? 0) - (C[1] ?? 0) * (U[0] ?? 0),
    ];
    const hw = Math.tan(((ns.fovW / 2) * Math.PI) / 180);
    const hh = Math.tan(((ns.fovH / 2) * Math.PI) / 180);
    const corners: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    const pts: string[] = [];
    const N = 16;
    for (let k = 0; k < 4; k++) {
      const [x0, y0] = corners[k] ?? [0, 0];
      const [x1, y1] = corners[(k + 1) % 4] ?? [0, 0];
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        const d = [0, 1, 2].map((j) => (C[j] ?? 0) + x * (U[j] ?? 0) + y * (V[j] ?? 0));
        const icrf = s.convertFrame(o, 'OBSERVED', 'ICRF', d);
        const p = icrfToScreen(s, icrf);
        if (!p) return '';
        pts.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`);
      }
    }
    return `M${pts.join('L')}Z`;
  }

  export function zoomToFit(pass = 0) {
    const s = stel;
    if (!s || !pxPerDeg || !w || !h) return;
    const fovNow = s.core.fov * s.R2D;
    let fov: number;
    if (mode === 'eyepiece') fov = fitFov(fovNow, pxPerDeg, ep.trueFovDeg, Math.min(w, h), 0.92);
    else if (mode === 'telrad') fov = fitFov(fovNow, pxPerDeg, 4, Math.min(w, h), 0.85);
    else if (mode === 'nightscape')
      // Wide lenses: the view needs some margin around the frame.
      fov = Math.min(185, Math.max(ns.fovW, (ns.fovH * w) / Math.max(1, h)) * 1.25);
    else {
      // Rotated frame: fit its bounding box.
      const th = (setup.rotationDeg * Math.PI) / 180;
      const bw = Math.abs(stats.fovW * Math.cos(th)) + Math.abs(stats.fovH * Math.sin(th));
      const bh = Math.abs(stats.fovW * Math.sin(th)) + Math.abs(stats.fovH * Math.cos(th));
      fov = Math.max(fitFov(fovNow, pxPerDeg, bw, w, 0.85), fitFov(fovNow, pxPerDeg, bh, h, 0.85));
    }
    const deg = Math.min(185, Math.max(0.01, fov));
    if (onzoom) onzoom(deg);
    else s.zoomTo(deg * s.D2R, 0.5);
    // Wide fields are not linear in the field of view: correct once the zoom has settled.
    if (pass < 3 && Math.abs(fov / fovNow - 1) > 0.02) setTimeout(() => zoomToFit(pass + 1), 450);
  }
  export function setMode(m: OcularMode) {
    mode = m;
  }
  export function toggleInfo() {
    showInfo = !showInfo;
  }
  export function cycleMode() {
    mode =
      mode === 'sensor'
        ? 'eyepiece'
        : mode === 'eyepiece'
          ? 'telrad'
          : mode === 'telrad'
            ? 'nightscape'
            : 'sensor';
  }
  function pick(k: SetupKind) {
    active = k;
    if (!shown[k]) shown = { ...shown, [k]: true };
  }
  function setEyepiece(i: number) {
    const e = EYEPIECES[i];
    if (e) {
      epFocal = e.focalMm;
      epAfov = e.afovDeg;
    }
  }

  // ---- drawing ------------------------------------------------------------------
  const cx = $derived(w / 2);
  const cy = $derived(h / 2);
  /** Screen-aligned frame of a setup (rotation relative to the screen). */
  function rect(k: SetupKind) {
    const st = setupStats(setups[k]);
    const rw = st.fovW * pxPerDeg;
    const rh = st.fovH * pxPerDeg;
    return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh, rot: -setups[k].rotationDeg };
  }
  /** Position angle of the active frame's "up" side, measured from north through east. */
  const pa = $derived.by(() => {
    if (northUp) return normRotation(-setup.rotationDeg);
    const th = (-setup.rotationDeg * Math.PI) / 180;
    const ux = Math.sin(th);
    const uy = -Math.cos(th);
    const n = ux * Math.cos(northA) + uy * Math.sin(northA);
    const e = ux * Math.cos(eastA) + uy * Math.sin(eastA);
    return normRotation((Math.atan2(e, n) * 180) / Math.PI);
  });
  const epR = $derived((ep.trueFovDeg / 2) * pxPerDeg);
  const cross = $derived(
    `M${cx - 10},${cy}H${cx - 3}M${cx + 3},${cy}H${cx + 10}M${cx},${cy - 10}V${cy - 3}M${cx},${cy + 3}V${cy + 10}`,
  );
  const fmtAngle = (deg: number) =>
    deg >= 1
      ? `${deg.toFixed(2)}°`
      : deg * 60 >= 1
        ? `${(deg * 60).toFixed(1)}′`
        : `${(deg * 3600).toFixed(0)}″`;
</script>

{#if w > 0 && pxPerDeg > 0}
  <svg class="ocular" aria-hidden="true" viewBox={`0 0 ${w} ${h}`}>
    {#if mode === 'sensor'}
      {#if northUp}
        {#each polys as p (p.id)}
          <path d={p.d} stroke={FRAME_COLORS[p.id]} class:main={p.id === active} />
        {/each}
      {:else}
        {#each KINDS.filter((k) => shown[k]) as k (k)}
          {@const r = rect(k)}
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            stroke={FRAME_COLORS[k]}
            class:main={k === active}
            transform={`rotate(${r.rot} ${cx} ${cy})`}
          />
        {/each}
      {/if}
      <path class="cross" d={cross} />
    {:else if mode === 'eyepiece'}
      <path
        class="mask"
        fill-rule="evenodd"
        d={`M0,0H${w}V${h}H0Z M${cx - epR},${cy}a${epR},${epR} 0 1,0 ${2 * epR},0a${epR},${epR} 0 1,0 ${-2 * epR},0Z`}
      />
      <circle {cx} {cy} r={epR} class="ring" />
      <path class="cross" d={cross} />
    {:else if mode === 'nightscape'}
      {#if nsPath}<path d={nsPath} class="ns main" />{/if}
      <path class="cross" d={cross} />
    {:else}
      {#each TELRAD_RINGS as d (d)}
        <circle {cx} {cy} r={(d / 2) * pxPerDeg} class="telrad" />
      {/each}
    {/if}
  </svg>
{/if}

<div class="oc-right">
  <div class="oc-bar" role="toolbar" aria-label="Ocular controls">
    <button class="t" aria-expanded={open} onclick={() => (open = !open)} title="Ocular controls"
      >Ocular {open ? '▾' : '▴'}</button
    >
    {#if open}
      <div class="grp" role="group" aria-label="Mode">
        <button aria-pressed={mode === 'sensor'} onclick={() => (mode = 'sensor')}>Sensor</button>
        <button aria-pressed={mode === 'eyepiece'} onclick={() => (mode = 'eyepiece')}
          >Eyepiece</button
        >
        <button aria-pressed={mode === 'telrad'} onclick={() => (mode = 'telrad')}>Telrad</button>
        <button
          aria-pressed={mode === 'nightscape'}
          onclick={() => (mode = 'nightscape')}
          title="Camera and lens on a tripod: nightscape framing and time-lapse planning"
          >Nightscape</button
        >
      </div>
      {#if mode !== 'telrad' && mode !== 'nightscape'}
        <div class="grp" role="group" aria-label="Setup">
          {#each KINDS as k (k)}
            <button aria-pressed={active === k} onclick={() => pick(k)} title={setups[k].telescope}
              ><span class="dot" style:background={FRAME_COLORS[k]} aria-hidden="true"
              ></span>{SETUP_LABELS[k]}</button
            >
          {/each}
        </div>
      {/if}
      {#if mode === 'sensor'}
        <div class="grp" role="group" aria-label="Rotate the frame">
          <button onclick={() => rotate(-15)} title="Rotate −15° (Shift+[ )">−15°</button>
          <button onclick={() => rotate(-1)} title="Rotate −1° ([)">−1°</button>
          <button onclick={() => rotate(1)} title="Rotate +1° (])">+1°</button>
          <button onclick={() => rotate(15)} title="Rotate +15° (Shift+])">+15°</button>
        </div>
        <button
          aria-pressed={northUp}
          onclick={() => (northUp = !northUp)}
          title="Keep the frame at its true position angle (follows celestial north) instead of the screen"
          >True PA</button
        >
        <label class="sel"
          >Bin <select bind:value={binning}>
            {#each [1, 2, 3, 4] as b (b)}<option value={b}>{b}×{b}</option>{/each}
          </select></label
        >
      {:else if mode === 'nightscape'}
        <label class="sel"
          >Camera <select bind:value={nsSensor}>
            {#each SENSORS as s, i (s.name)}<option value={i}>{s.name}</option>{/each}
          </select></label
        >
        <label class="sel"
          >Lens <select bind:value={nsLens}>
            {#each LENSES_MM as l (l)}<option value={l}>{l} mm</option>{/each}
          </select></label
        >
        <label class="sel num"
          >f/<input type="number" min="0.95" max="16" step="0.1" bind:value={nsF} /></label
        >
        <button aria-pressed={nsPortrait} onclick={() => (nsPortrait = !nsPortrait)}
          >Portrait</button
        >
        <label class="sel num"
          >Every <input type="number" min="1" max="3600" step="1" bind:value={tlInterval} /> s</label
        >
        <label class="sel num"
          >× <input type="number" min="2" max="10000" step="10" bind:value={tlFrames} /> frames</label
        >
        <button aria-pressed={previewing} onclick={preview}
          >{previewing ? 'Stop preview' : 'Preview time-lapse'}</button
        >
      {:else if mode === 'eyepiece'}
        <label class="sel"
          >Eyepiece <select
            value={epPreset}
            onchange={(e) => setEyepiece(Number((e.currentTarget as HTMLSelectElement).value))}
          >
            {#if epPreset < 0}<option value={-1}>Custom</option>{/if}
            {#each EYEPIECES as e, i (e.name)}<option value={i}>{e.name}</option>{/each}
          </select></label
        >
        <label class="sel num"
          >Focal <input type="number" min="1" max="100" step="0.5" bind:value={epFocal} /> mm</label
        >
        <label class="sel num"
          >AFOV <input type="number" min="20" max="120" step="1" bind:value={epAfov} />°</label
        >
      {/if}
      <button
        onclick={() => zoomToFit()}
        title="Zoom so the {mode === 'sensor'
          ? 'frame'
          : mode === 'eyepiece'
            ? 'eyepiece field'
            : 'rings'} fill the view (Alt+Z)"
        >Zoom to {mode === 'sensor' || mode === 'nightscape'
          ? 'frame'
          : mode === 'eyepiece'
            ? 'eyepiece'
            : 'Telrad'}</button
      >
      <button aria-pressed={showInfo} onclick={() => (showInfo = !showInfo)}>Info</button>
    {/if}
  </div>
  {#if showInfo}
    <section class="oc-info" aria-label="Ocular information">
      {#if mode === 'sensor'}
        <p class="oc-title" style:color={FRAME_COLORS[active]}>{SETUP_LABELS[active]} · sensor</p>
        <dl>
          <dt>Telescope</dt>
          <dd>{setup.telescope} ({setup.focalMm} mm)</dd>
          <dt>Camera</dt>
          <dd>{setup.camera}</dd>
          {#if setup.factor !== 1}
            <dt>{setup.factor < 1 ? 'Reducer' : 'Barlow'}</dt>
            <dd>{setup.factor}× → {Math.round(stats.effFocalMm)} mm f/{stats.fRatio.toFixed(1)}</dd>
          {/if}
          <dt>Field</dt>
          <dd>{fmtFov(stats)}</dd>
          <dt>Pixel scale</dt>
          <dd>
            {(stats.pixelScale * binning).toFixed(2)}″/px{binning > 1
              ? ` (bin ${binning}×${binning})`
              : ''}
          </dd>
          <dt>Image scale</dt>
          <dd>{plateScale(setup).toFixed(1)}″/mm</dd>
          <dt>Resolution</dt>
          <dd>{Math.floor(setup.widthPx / binning)} × {Math.floor(setup.heightPx / binning)} px</dd>
          <dt>Rotation</dt>
          <dd>
            {setup.rotationDeg.toFixed(0)}° {northUp ? '(to north)' : '(to screen)'} · PA {(
              ((pa % 360) + 360) %
              360
            ).toFixed(0)}°
          </dd>
        </dl>
      {:else if mode === 'eyepiece'}
        <p class="oc-title">{SETUP_LABELS[active]} · eyepiece</p>
        <dl>
          <dt>Telescope</dt>
          <dd>{setup.telescope}{setup.factor !== 1 ? ` + ${setup.factor}×` : ''}</dd>
          <dt>Eyepiece</dt>
          <dd>{epFocal} mm, {epAfov}° apparent</dd>
          <dt>Magnification</dt>
          <dd>{ep.magnification.toFixed(0)}×</dd>
          <dt>True field</dt>
          <dd>{fmtAngle(ep.trueFovDeg)}</dd>
          <dt>Exit pupil</dt>
          <dd>{ep.exitPupilMm.toFixed(1)} mm</dd>
        </dl>
      {:else if mode === 'nightscape'}
        <p class="oc-title">Nightscape · {nsLens} mm f/{nsF}</p>
        <dl>
          <dt>Camera</dt>
          <dd>{sensor.name}{nsPortrait ? ', portrait' : ''}</dd>
          <dt>Field</dt>
          <dd>
            {ns.fovW.toFixed(1)}° × {ns.fovH.toFixed(1)}° (diagonal {ns.fovDiag.toFixed(0)}°)
          </dd>
          <dt>Sharp stars</dt>
          <dd>
            NPF {ns.npf.toFixed(1)} s · 500 rule {ns.rule500.toFixed(0)} s (untracked)
          </dd>
          <dt>Time-lapse</dt>
          <dd>
            {Math.floor(tl.durationS / 3600)} h {Math.round((tl.durationS % 3600) / 60)} min of shooting
            → {tl.clipS.toFixed(0)} s clip at 25 fps
          </dd>
          <dt>Sky turns</dt>
          <dd>{tl.skyRotationDeg.toFixed(1)}° about the pole</dd>
        </dl>
      {:else}
        <p class="oc-title telrad-t">Telrad</p>
        <dl>
          <dt>Rings</dt>
          <dd>0.5°, 2°, 4°</dd>
        </dl>
      {/if}
    </section>
  {/if}
</div>

<style>
  .ocular {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  /* Night mode: frame colours lose their blue and green like the sky does. */
  .ocular,
  .dot,
  .oc-title {
    filter: var(--sky-filter);
  }
  .ocular rect,
  .ocular path {
    fill: none;
    stroke-width: 1.2;
    opacity: 0.75;
  }
  .ocular .main {
    stroke-width: 1.8;
    opacity: 1;
  }
  .ocular .cross {
    stroke: #ffffff;
    opacity: 0.7;
    stroke-width: 1;
  }
  .ocular .mask {
    fill: rgb(0 0 0 / 0.93);
    stroke: none;
    opacity: 1;
  }
  .ocular .ring {
    fill: none;
    stroke: #8a8a8a;
    stroke-width: 1.5;
  }
  .ocular .ns {
    fill: none;
    stroke: #c8a2ff;
    stroke-width: 1.8;
  }
  .ocular .telrad {
    fill: none;
    stroke: #ff3b30;
    stroke-width: 1.6;
  }
  .oc-right {
    position: absolute;
    /* Below the search row; the left tool bar and search keep the top-left corner. */
    top: 52px;
    right: 8px;
    z-index: 4;
    display: grid;
    justify-items: end;
    gap: 6px;
    max-width: min(560px, calc(100% - 120px));
  }
  .oc-info {
    max-width: 300px;
    padding: 8px 10px;
    font-size: 12px;
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    backdrop-filter: blur(6px);
    pointer-events: none;
  }
  .oc-title {
    margin: 0 0 4px;
    font-weight: 600;
    font-size: 13px;
  }
  .telrad-t {
    color: #ff6a60;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .oc-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    pointer-events: auto;
  }
  .oc-bar button,
  .sel {
    font-size: 12px;
    min-height: 30px;
    padding: 2px 9px;
    background: color-mix(in srgb, var(--panel) 82%, transparent);
    backdrop-filter: blur(6px);
  }
  .oc-bar button[aria-pressed='true'] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, var(--panel));
  }
  .grp {
    display: inline-flex;
  }
  .grp button {
    border-radius: 0;
    margin-left: -1px;
  }
  .grp button:first-child {
    border-radius: 8px 0 0 8px;
    margin-left: 0;
  }
  .grp button:last-child {
    border-radius: 0 8px 8px 0;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 5px;
  }
  .sel {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--muted);
  }
  .sel select,
  .sel input {
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1px 4px;
    max-width: 150px;
  }
  .num input {
    width: 54px;
  }
  @media (max-width: 640px) {
    .oc-info {
      max-width: 220px;
      font-size: 11px;
      padding: 6px 8px;
    }
  }
</style>
