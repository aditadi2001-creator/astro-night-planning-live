<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import { altAz } from '../lib/astro/target';
  import {
    alphaFromCompass,
    enu,
    lookAzAlt,
    poseFromOrientation,
    project,
    type Pose,
  } from '../lib/sky/arview';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    place: Place;
    time: Date;
    tz: string | undefined;
    /** Selected object (J2000 degrees, or a Solar-system body), or null. */
    target: { name: string; ra2000: number; dec2000: number; body?: string | null } | null;
    /** Modelled terrain horizon (apparent altitude per 0.5° of azimuth), if loaded. */
    horizon: Float32Array | null;
    onclose: () => void;
  }
  let { place, time, tz, target, horizon, onclose }: Props = $props();

  let video: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let started = $state(false);
  let error = $state('');
  let sensorOk = $state(false);
  let pose = $state<Pose | null>(null);
  let w = $state(360);
  let h = $state(640);
  let hfov = $state(55);
  let compass = $state(0);

  // ---- sensors -------------------------------------------------------------------
  let sm: { a: number; b: number; g: number } | null = null;
  function onOrient(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
    let a: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') a = alphaFromCompass(e.webkitCompassHeading);
    else if (e.absolute && e.alpha != null) a = e.alpha;
    if (a == null || e.beta == null || e.gamma == null) return;
    sensorOk = true;
    // Light smoothing (alpha wraps at 360°).
    if (!sm) sm = { a, b: e.beta, g: e.gamma };
    else {
      const da = ((a - sm.a + 540) % 360) - 180;
      sm = {
        a: (sm.a + 0.3 * da + 360) % 360,
        b: sm.b + 0.3 * (e.beta - sm.b),
        g: sm.g + 0.3 * (e.gamma - sm.g),
      };
    }
    const angle = screen.orientation?.angle ?? 0;
    pose = poseFromOrientation((sm.a - compass + 360) % 360, sm.b, sm.g, angle);
  }

  async function start() {
    error = '';
    try {
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      if (typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') throw new Error('Motion and orientation access was not allowed.');
      }
      addEventListener('deviceorientationabsolute', onOrient as EventListener);
      addEventListener('deviceorientation', onOrient as EventListener);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      started = true;
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : 'The camera could not be opened. Allow camera access in the browser settings.';
    }
  }

  function stop() {
    removeEventListener('deviceorientationabsolute', onOrient as EventListener);
    removeEventListener('deviceorientation', onOrient as EventListener);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  onDestroy(stop);

  // ---- what to draw --------------------------------------------------------------
  const obs = $derived(new Astronomy.Observer(place.lat, place.lon, place.elevation));
  const BODIES: Record<string, Astronomy.Body> = {
    Moon: Astronomy.Body.Moon,
    Venus: Astronomy.Body.Venus,
    Mars: Astronomy.Body.Mars,
    Jupiter: Astronomy.Body.Jupiter,
    Saturn: Astronomy.Body.Saturn,
  };
  const minute = $derived(Math.floor(time.getTime() / 60_000));
  const bright = $derived.by(() => {
    void minute;
    return Object.entries(BODIES).map(([name, b]) => ({ name, ...altAz(b, obs, time) }));
  });
  /** Target path over the next 12 hours, every 15 minutes. */
  const path = $derived.by(() => {
    void minute;
    if (!target) return [];
    let body: Astronomy.Body;
    if (target.body && target.body in BODIES) body = BODIES[target.body] as Astronomy.Body;
    else {
      Astronomy.DefineStar(Astronomy.Body.Star3, target.ra2000 / 15, target.dec2000, 1000);
      body = Astronomy.Body.Star3;
    }
    const out: { t: number; az: number; alt: number }[] = [];
    for (let k = 0; k <= 48; k++) {
      const t = time.getTime() + k * 15 * 60_000;
      out.push({ t, ...altAz(body, obs, new Date(t)) });
    }
    return out;
  });

  const P = (az: number, alt: number) => (pose ? project(pose, enu(az, alt), w, h, hfov) : null);
  function line(points: ([number, number] | null)[]): string {
    let d = '';
    let pen = false;
    for (const p of points) {
      if (!p || p[0] < -w || p[0] > 2 * w || p[1] < -h || p[1] > 2 * h) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      pen = true;
    }
    return d;
  }
  const altLines = $derived(
    pose
      ? [0, 10, 20, 30, 45].map((alt) => ({
          alt,
          d: line(Array.from({ length: 181 }, (_, i) => P(i * 2, alt))),
        }))
      : [],
  );
  const terrain = $derived(
    pose && horizon
      ? line(Array.from({ length: 361 }, (_, i) => P(i, horizon[(i * 2) % horizon.length] ?? 0)))
      : '',
  );
  const ticks = $derived(
    pose
      ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((label, i) => ({ label, p: P(i * 45, 0) }))
      : [],
  );
  const looking = $derived(pose ? lookAzAlt(pose) : null);
  const targetNow = $derived(path[0] ?? null);
</script>

<div
  class="cam"
  role="dialog"
  aria-modal="true"
  aria-label="Camera horizon view"
  bind:clientWidth={w}
  bind:clientHeight={h}
>
  <video bind:this={video} playsinline muted autoplay></video>

  {#if pose}
    <svg class="overlay" width={w} height={h} aria-hidden="true">
      {#each altLines as l (l.alt)}
        <path d={l.d} class:horizon={l.alt === 0} class="alt" />
      {/each}
      {#if terrain}<path d={terrain} class="terrain" />{/if}
      {#each ticks as t (t.label)}
        {#if t.p}<text x={t.p[0]} y={t.p[1] + 18} class="tick">{t.label}</text>{/if}
      {/each}
      {#each altLines as l (l.alt)}
        {#if l.alt > 0 && looking}
          {@const p = P(looking.az, l.alt)}
          {#if p}<text x={p[0] + 6} y={p[1] - 4} class="altlabel">{l.alt}°</text>{/if}
        {/if}
      {/each}
      {#if path.length}
        <path d={line(path.map((s) => P(s.az, s.alt)))} class="path" />
        {#each path as s, i (s.t)}
          {#if i % 4 === 0}
            {@const p = P(s.az, s.alt)}
            {#if p}
              <circle cx={p[0]} cy={p[1]} r="3" class="hour" />
              <text x={p[0] + 6} y={p[1] + 4} class="hourlabel">{fmtTime(s.t, tz)}</text>
            {/if}
          {/if}
        {/each}
      {/if}
      {#each bright as b (b.name)}
        {@const p = P(b.az, b.alt)}
        {#if p && b.alt > -2}
          <circle cx={p[0]} cy={p[1]} r="6" class="body" />
          <text x={p[0] + 9} y={p[1] + 4} class="bodylabel">{b.name}</text>
        {/if}
      {/each}
      {#if target && targetNow}
        {@const p = P(targetNow.az, targetNow.alt)}
        {#if p}
          <circle cx={p[0]} cy={p[1]} r="12" class="target" />
          <text x={p[0] + 15} y={p[1] - 10} class="targetlabel">{target.name}</text>
        {/if}
      {/if}
    </svg>
  {/if}

  <div class="panel">
    <div class="row">
      <strong>Horizon check</strong>
      <button
        onclick={() => {
          stop();
          onclose();
        }}
        aria-label="Close camera view">Close</button
      >
    </div>
    {#if !started}
      <p>
        Point your phone at the sky to see the horizon, altitude lines and
        {target ? `the path of ${target.name} tonight` : 'the Moon and planets'} over the camera picture,
        to check what trees or buildings hide. The picture stays on your phone; nothing is recorded or
        uploaded.
      </p>
      <button class="primary" onclick={start}>Start camera</button>
    {:else if !sensorOk}
      <p>Waiting for the compass… This needs a phone or tablet with motion sensors.</p>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if started}
      {#if looking}
        <p class="status">
          Looking {Math.round(looking.az)}° azimuth, {Math.round(looking.alt)}° up{targetNow
            ? ` · ${target?.name} now ${targetNow.alt.toFixed(0)}° up at ${Math.round(targetNow.az)}°`
            : ''}
        </p>
      {/if}
      <label
        >Camera field of view {hfov}°
        <input type="range" min="35" max="90" step="1" bind:value={hfov} /></label
      >
      <label
        >Compass correction {compass > 0 ? '+' : ''}{compass}°
        <input type="range" min="-40" max="40" step="1" bind:value={compass} /></label
      >
      <p class="hint">
        Phone compasses are often off by 5–20°: line the Moon or a planet up with its marker using
        the correction. Dashed line: terrain horizon from elevation data.
      </p>
    {/if}
  </div>
</div>

<style>
  .cam {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000;
    color: #fff;
    overflow: hidden;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .alt {
    fill: none;
    stroke: rgb(255 255 255 / 0.45);
    stroke-width: 1;
    stroke-dasharray: 6 6;
  }
  .alt.horizon {
    stroke: #7fd1ff;
    stroke-width: 2;
    stroke-dasharray: none;
  }
  .terrain {
    fill: none;
    stroke: #b8f28a;
    stroke-width: 2;
    stroke-dasharray: 3 4;
  }
  text {
    font:
      13px system-ui,
      sans-serif;
    paint-order: stroke;
    stroke: #000;
    stroke-width: 3px;
  }
  .tick {
    fill: #7fd1ff;
    font-weight: 700;
    text-anchor: middle;
  }
  .altlabel {
    fill: rgb(255 255 255 / 0.8);
    font-size: 11px;
  }
  .path {
    fill: none;
    stroke: #ffd27f;
    stroke-width: 2;
  }
  .hour {
    fill: #ffd27f;
  }
  .hourlabel {
    fill: #ffd27f;
    font-size: 11px;
  }
  .body {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .bodylabel {
    fill: #fff;
  }
  .target {
    fill: none;
    stroke: #ff6b6b;
    stroke-width: 2.5;
  }
  .targetlabel {
    fill: #ff6b6b;
    font-weight: 700;
  }
  .panel {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    background: rgb(0 0 0 / 0.65);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14px;
    max-width: 520px;
    margin: 0 auto;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel p {
    margin: 6px 0;
  }
  .primary {
    border-color: #7fd1ff;
    color: #7fd1ff;
  }
  label {
    display: grid;
    gap: 2px;
    font-size: 12px;
    margin-top: 6px;
  }
  input[type='range'] {
    width: 100%;
    accent-color: #7fd1ff;
  }
  .status {
    font-variant-numeric: tabular-nums;
  }
  .hint {
    font-size: 12px;
    opacity: 0.8;
  }
  .err {
    color: #ff8a8a;
  }
</style>
