<script lang="ts">
  /**
   * Dock "Horizon": the foreground drawn in the sky (looks only) and your custom horizon
   * (drives planning). Custom horizons stay on this device: import NINA .hrz / CSV / JSON,
   * export .hrz, draw points, trace a 360° panorama, or survey the skyline with the phone's
   * compass and tilt sensors, calibrated on the Sun or Moon.
   */
  import { onDestroy } from 'svelte';
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import {
    FOREGROUNDS,
    foregroundProfile,
    saveForeground,
    thumbPath,
    type ForegroundState,
  } from '../lib/sky/foreground';
  import {
    normalisePoints,
    parseHorizonFile,
    saveCustomHorizon,
    toHrz,
    type CustomHorizon,
    type HorizonSource,
  } from '../lib/sky/customHorizon';
  import { download } from '../lib/plan/plan';

  interface Props {
    place: Place;
    shown: number;
    foreground: ForegroundState;
    customHorizon: CustomHorizon | null;
    terrainOn: boolean;
    ontoggleterrain: (v: boolean) => void;
    /** Real terrain profile (720 steps), for "start from terrain". */
    terrain?: ArrayLike<number> | null;
  }
  let {
    place,
    shown,
    foreground = $bindable(),
    customHorizon = $bindable(),
    terrainOn,
    ontoggleterrain,
    terrain = null,
  }: Props = $props();

  const thumbs = FOREGROUNDS.map((f) => ({ ...f, d: thumbPath(foregroundProfile(f.id)) }));
  function setForeground(patch: Partial<ForegroundState>) {
    foreground = { ...foreground, ...patch };
    saveForeground(foreground);
  }

  // ---- custom horizon ------------------------------------------------------------------
  let message = $state('');
  function setPoints(raw: [number, number][], source: HorizonSource, name?: string) {
    const pts = normalisePoints(raw);
    if (!pts) {
      customHorizon = null;
      saveCustomHorizon(place, null);
      return;
    }
    customHorizon = {
      name: name ?? customHorizon?.name ?? `${place.name} horizon`,
      points: pts,
      source,
      updated: Date.now(),
    };
    saveCustomHorizon(place, customHorizon);
  }
  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 2_000_000) {
      message = 'That file is too large for a horizon (over 2 MB).';
      return;
    }
    const r = parseHorizonFile(file.name, await file.text());
    if (!r) {
      message = `No horizon found in ${file.name}. Expected "azimuth altitude" lines (NINA .hrz), CSV or JSON.`;
      return;
    }
    setPoints(r.points, r.source, file.name.replace(/\.[^.]+$/, ''));
    message = `Imported ${r.points.length} points from ${file.name}.`;
  }
  function exportHrz() {
    if (customHorizon)
      download(
        `${customHorizon.name.replace(/[^\w-]+/g, '_')}.hrz`,
        toHrz(customHorizon),
        'text/plain',
      );
  }

  let tool = $state<'draw' | 'panorama' | 'phone'>('draw');

  // Draw: azimuth 0–360 across, altitude 0–60 up.
  const DW = 360;
  const DH = 60;
  function drawClick(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const az = ((e.clientX - r.left) / r.width) * DW;
    const alt = (1 - (e.clientY - r.top) / r.height) * DH;
    const pts = customHorizon?.points ?? [];
    const near = pts.findIndex(([a, h]) => Math.abs(a - az) < 4 && Math.abs(h - alt) < 3);
    if (near >= 0)
      setPoints(
        pts.filter((_, i) => i !== near),
        'drawn',
      );
    else setPoints([...pts, [az, alt]], 'drawn');
  }
  let typedAz = $state(0);
  let typedAlt = $state(10);
  function addTyped() {
    setPoints([...(customHorizon?.points ?? []), [Number(typedAz), Number(typedAlt)]], 'drawn');
  }
  function fromTerrain() {
    if (!terrain) return;
    const pts: [number, number][] = [];
    for (let az = 0; az < 360; az += 10)
      pts.push([az, Math.max(0, Number(terrain[Math.round(az * 2) % 720] ?? 0))]);
    setPoints(pts, 'drawn');
  }
  const linePts = $derived(
    (customHorizon?.points ?? [])
      .map(([az, alt]) => `${az.toFixed(1)},${(DH - Math.min(DH, alt)).toFixed(1)}`)
      .join(' '),
  );

  // Panorama: an equirectangular 360° image, left edge at `panoAz0`, horizon at mid-height.
  let panoUrl = $state<string | null>(null);
  let panoW = 0;
  let panoH = 0;
  let panoAz0 = $state(0);
  let panoCanvas: HTMLCanvasElement | null = null;
  async function loadPano(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 4096 / bmp.width);
    panoW = Math.round(bmp.width * scale);
    panoH = Math.round(bmp.height * scale);
    panoCanvas = document.createElement('canvas');
    panoCanvas.width = panoW;
    panoCanvas.height = panoH;
    const ctx = panoCanvas.getContext('2d', { willReadFrequently: true });
    ctx?.drawImage(bmp, 0, 0, panoW, panoH);
    bmp.close();
    if (panoUrl) URL.revokeObjectURL(panoUrl);
    const blob = await new Promise<Blob | null>((res) =>
      panoCanvas?.toBlob(res, 'image/jpeg', 0.85),
    );
    panoUrl = blob ? URL.createObjectURL(blob) : null;
    message = `Panorama loaded (${panoW} × ${panoH} px, kept on this device). Click along the skyline, or try auto-trace.`;
  }
  const degPerPx = () => 360 / Math.max(1, panoW);
  function panoClick(e: MouseEvent) {
    const img = e.currentTarget as HTMLElement;
    const r = img.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * panoW;
    const y = ((e.clientY - r.top) / r.height) * panoH;
    const az = panoAz0 + x * degPerPx();
    const alt = (panoH / 2 - y) * degPerPx();
    setPoints([...(customHorizon?.points ?? []), [az, alt]], 'panorama');
  }
  /** Auto-trace: per 5° column, the first row from the top that is much darker than the sky. */
  function autoTrace() {
    const ctx = panoCanvas?.getContext('2d', { willReadFrequently: true });
    if (!ctx || !panoW) return;
    const data = ctx.getImageData(0, 0, panoW, panoH).data;
    const lum = (x: number, y: number) => {
      const i = (y * panoW + x) * 4;
      return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    };
    const pts: [number, number][] = [];
    for (let az = 0; az < 360; az += 5) {
      const x = Math.min(panoW - 1, Math.round(az / degPerPx()));
      let sky = 0;
      const top = Math.max(1, Math.round(panoH * 0.05));
      for (let y = 0; y < top; y++) sky += lum(x, y);
      sky /= top;
      let hit = Math.round(panoH / 2);
      for (let y = top; y < panoH - 3; y++) {
        if (lum(x, y) < sky * 0.6 && lum(x, y + 1) < sky * 0.6 && lum(x, y + 2) < sky * 0.6) {
          hit = y;
          break;
        }
      }
      pts.push([panoAz0 + az, (panoH / 2 - hit) * degPerPx()]);
    }
    setPoints(pts, 'panorama');
    message =
      'Traced 72 points. Check them in the sky and fix any in Draw (click a point to remove it).';
  }
  onDestroy(() => {
    if (panoUrl) URL.revokeObjectURL(panoUrl);
    stopPhone();
  });

  // Phone survey: back camera pointed at the skyline; compass heading → azimuth, tilt → altitude.
  let phone = $state<'off' | 'on' | 'denied' | 'unsupported'>('off');
  let heading = $state<number | null>(null);
  let tilt = $state<number | null>(null);
  let azOffset = $state(0);
  let altOffset = $state(0);
  let calBody = $state<'Sun' | 'Moon'>('Moon');
  function onOrient(e: DeviceOrientationEvent) {
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading;
    if (typeof ios === 'number') heading = ios;
    else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
    if (e.beta != null) tilt = e.beta - 90;
  }
  async function startPhone() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      phone = 'unsupported';
      return;
    }
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission;
    if (req) {
      try {
        if ((await req()) !== 'granted') {
          phone = 'denied';
          return;
        }
      } catch {
        phone = 'denied';
        return;
      }
    }
    addEventListener('deviceorientationabsolute', onOrient as EventListener);
    addEventListener('deviceorientation', onOrient as EventListener);
    phone = 'on';
  }
  function stopPhone() {
    removeEventListener('deviceorientationabsolute', onOrient as EventListener);
    removeEventListener('deviceorientation', onOrient as EventListener);
  }
  const bodyPos = $derived.by(() => {
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    const d = new Date(shown);
    const b = calBody === 'Sun' ? Astronomy.Body.Sun : Astronomy.Body.Moon;
    const eq = Astronomy.Equator(b, d, obs, true, true);
    return Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
  });
  function calibrate() {
    if (heading == null || tilt == null) return;
    azOffset = ((((bodyPos.azimuth - heading) % 360) + 540) % 360) - 180;
    altOffset = bodyPos.altitude - tilt;
    message = `Calibrated on the ${calBody}: compass corrected by ${azOffset.toFixed(1)}°, tilt by ${altOffset.toFixed(1)}°.`;
  }
  function mark() {
    if (heading == null || tilt == null) return;
    setPoints([...(customHorizon?.points ?? []), [heading + azOffset, tilt + altOffset]], 'survey');
  }
</script>

<div class="hz">
  <section>
    <h3>Foreground in the sky</h3>
    <p class="note">
      For looks and practice only. Planning uses your custom horizon below, or the real terrain if
      you have none.
    </p>
    <div class="fg">
      {#each thumbs as f (f.id)}
        <button
          aria-pressed={foreground.id === f.id}
          title={f.hint}
          onclick={() => setForeground({ id: f.id })}
        >
          <svg viewBox="0 0 120 40" aria-hidden="true"
            ><rect width="120" height="40" class="skyb" /><path d={f.d} class="land" /></svg
          >
          <span>{f.label}</span>
        </button>
      {/each}
    </div>
    <label class="rng"
      >Brightness <input
        type="range"
        min="0.2"
        max="1.6"
        step="0.05"
        value={foreground.brightness}
        oninput={(e) =>
          setForeground({ brightness: Number((e.currentTarget as HTMLInputElement).value) })}
      /><output>{Math.round(foreground.brightness * 100)} %</output></label
    >
    <label class="rng"
      >Fog <input
        type="range"
        min="0"
        max="0.9"
        step="0.05"
        value={foreground.fog}
        oninput={(e) => setForeground({ fog: Number((e.currentTarget as HTMLInputElement).value) })}
      /><output>{Math.round(foreground.fog * 100)} %</output></label
    >
    <label class="chk"
      ><input
        type="checkbox"
        checked={terrainOn}
        onchange={(e) => ontoggleterrain((e.currentTarget as HTMLInputElement).checked)}
      /> Use the real terrain for planning when there is no custom horizon</label
    >
  </section>

  <section>
    <h3>Your horizon</h3>
    {#if customHorizon}
      <p>
        <strong>{customHorizon.name}</strong> · {customHorizon.points.length} points · {customHorizon.source}
        · saved on this device for {place.name}
      </p>
    {:else}
      <p class="note">
        No custom horizon for {place.name} yet. Add buildings, trees or your parapet so target hours and
        charts know what you can really see.
      </p>
    {/if}
    <div class="row">
      <label class="file"
        >Import .hrz / CSV / JSON<input
          type="file"
          accept=".hrz,.txt,.csv,.json,text/plain,application/json"
          onchange={importFile}
        /></label
      >
      <button onclick={exportHrz} disabled={!customHorizon}>Export NINA .hrz</button>
      <button onclick={() => setPoints([], 'drawn')} disabled={!customHorizon}>Clear</button>
    </div>
    {#if message}<p class="msg" role="status">{message}</p>{/if}

    <div class="tools" role="tablist" aria-label="Build a horizon">
      <button role="tab" aria-selected={tool === 'draw'} onclick={() => (tool = 'draw')}
        >Draw</button
      >
      <button role="tab" aria-selected={tool === 'panorama'} onclick={() => (tool = 'panorama')}
        >Panorama</button
      >
      <button role="tab" aria-selected={tool === 'phone'} onclick={() => (tool = 'phone')}
        >Phone survey</button
      >
    </div>

    {#if tool === 'draw'}
      <!-- Mouse/touch editor; keyboard users add points with the form below. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <svg
        class="draw"
        viewBox={`0 0 ${DW} ${DH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Horizon editor: click to add a point, click a point to remove it"
        onclick={drawClick}
      >
        {#each [0, 90, 180, 270] as a (a)}<line x1={a} x2={a} y1="0" y2={DH} class="gl" />{/each}
        {#each [15, 30, 45] as h (h)}<line
            x1="0"
            x2={DW}
            y1={DH - h}
            y2={DH - h}
            class="gl"
          />{/each}
        {#if customHorizon}
          <polygon points={`0,${DH} ${linePts} ${DW},${DH}`} class="fill" />
          {#each customHorizon.points as [az, alt] (az)}<circle
              cx={az}
              cy={DH - Math.min(DH, alt)}
              r="1.6"
              class="pt"
            />{/each}
        {/if}
      </svg>
      <p class="axis">
        <span>N 0°</span><span>E 90°</span><span>S 180°</span><span>W 270°</span><span>360°</span>
      </p>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          addTyped();
        }}
      >
        <label class="num"
          >Azimuth <input type="number" min="0" max="360" step="0.5" bind:value={typedAz} />°</label
        >
        <label class="num"
          >Altitude <input
            type="number"
            min="-5"
            max="90"
            step="0.5"
            bind:value={typedAlt}
          />°</label
        >
        <button type="submit">Add point</button>
      </form>
      <div class="row">
        <button onclick={fromTerrain} disabled={!terrain}>Start from the real terrain</button>
      </div>
      <p class="note">
        Click to add a point (azimuth across, altitude up to 60°); click a point to remove it.
      </p>
    {:else if tool === 'panorama'}
      <div class="row">
        <label class="file"
          >Load a 360° panorama<input type="file" accept="image/*" onchange={loadPano} /></label
        >
        <label class="num"
          >Left edge azimuth <input type="number" min="0" max="359" bind:value={panoAz0} />°</label
        >
        <button onclick={autoTrace} disabled={!panoUrl}>Auto-trace skyline</button>
      </div>
      {#if panoUrl}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <img
          class="pano"
          src={panoUrl}
          alt="Your panorama: click along the skyline to add horizon points"
          onclick={panoClick}
        />
      {/if}
      <p class="note">
        Equirectangular 360° image, horizon at mid-height; downscaled to at most 4,096 px and never
        uploaded.
      </p>
    {:else}
      <div class="row">
        <button onclick={startPhone} disabled={phone === 'on'}
          >{phone === 'on' ? 'Sensors on' : 'Start sensors'}</button
        >
        <span class="read"
          >Azimuth {heading == null ? '—' : ((heading + azOffset + 360) % 360).toFixed(1)}° ·
          altitude {tilt == null ? '—' : (tilt + altOffset).toFixed(1)}°</span
        >
      </div>
      {#if phone === 'denied'}<p class="msg">
          Motion sensors were not allowed. Allow motion and orientation access for this site and try
          again.
        </p>{/if}
      {#if phone === 'unsupported'}<p class="msg">
          This device or browser has no orientation sensors.
        </p>{/if}
      <div class="row">
        <label class="num"
          >Calibrate on
          <select bind:value={calBody}><option>Moon</option><option>Sun</option></select>
        </label>
        <button onclick={calibrate} disabled={heading == null || bodyPos.altitude < 0}
          >Point at it, then tap here</button
        >
        <span class="read"
          >{calBody} now: az {bodyPos.azimuth.toFixed(1)}°, alt {bodyPos.altitude.toFixed(1)}°</span
        >
      </div>
      {#if calBody === 'Sun'}<p class="warn">
          Never look at the Sun. Hold the phone so its shadow is a dot, or calibrate on the Moon.
        </p>{/if}
      <button class="big" onclick={mark} disabled={heading == null}>Mark this skyline point</button>
      <p class="note">
        Phone compasses are often 5–45° off: always calibrate first. Hold the phone upright, back
        camera towards the skyline. Needs a phone with a compass (check on a real phone).
      </p>
    {/if}
  </section>
</div>

<style>
  .hz {
    display: grid;
    gap: var(--s5);
  }
  section {
    display: grid;
    gap: var(--s2);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-14);
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: var(--fs-14);
  }
  .note {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .msg {
    font-size: var(--fs-12);
    color: var(--brass);
  }
  .warn {
    font-size: var(--fs-12);
    color: var(--nogo);
  }
  .fg {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: var(--s2);
  }
  .fg button {
    display: grid;
    gap: 4px;
    padding: 6px;
    font-size: var(--fs-12);
  }
  .fg button[aria-pressed='true'] {
    border-color: var(--brass);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .fg svg {
    width: 100%;
    height: auto;
    border-radius: 4px;
  }
  .skyb {
    fill: var(--twilight-astro);
  }
  .land {
    fill: var(--ink-0);
    stroke: var(--text-2);
    stroke-width: 0.6;
  }
  .rng,
  .num,
  .chk {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--fs-14);
  }
  .rng input {
    flex: 1;
    accent-color: var(--brass);
  }
  output {
    min-width: 3.5em;
    text-align: right;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
    align-items: center;
  }
  .file {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--ink-2);
    cursor: pointer;
    font-size: var(--fs-14);
  }
  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .file:focus-within {
    outline: 2px solid var(--brass);
  }
  .num input,
  .num select {
    width: 5em;
    font: inherit;
    color: var(--text);
    background: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 4px 6px;
  }
  .tools {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
  }
  .tools button[aria-selected='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  .draw {
    width: 100%;
    height: 140px;
    background: var(--ink-0);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    cursor: crosshair;
  }
  .gl {
    stroke: var(--rule);
    stroke-width: 0.3;
  }
  .fill {
    fill: var(--ink-2);
    stroke: var(--brass);
    stroke-width: 0.5;
  }
  .pt {
    fill: var(--brass);
  }
  .axis {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-2);
  }
  .pano {
    width: 100%;
    height: auto;
    cursor: crosshair;
    border-radius: var(--r-input);
    filter: var(--media-filter);
  }
  .read {
    font-size: var(--fs-14);
    font-variant-numeric: tabular-nums;
  }
  .big {
    min-height: 52px;
    font-size: var(--fs-16);
    border-color: var(--brass);
  }
</style>
