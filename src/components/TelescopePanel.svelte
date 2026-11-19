<script lang="ts">
  /**
   * Dock "Telescope" panel: the camera frame (rotation, align to the object, mosaic and its NINA
   * export) and the live telescope (simulator, NINA Advanced API, ASCOM Alpaca) with its HUD.
   * The connection is read-only by default; slew and sync need "Enable control" and a
   * confirmation every time (CLAUDE.md rule 8).
   */
  import type { Place } from '../lib/astro/sky';
  import type { ObjectInfo } from '../lib/engine/stel';
  import {
    mosaicPanes,
    mosaicSpan,
    normRotation,
    setupStats,
    type Setup,
    type SetupKind,
  } from '../lib/equipment';
  import { download, decDms, raHms, toMosaicCsv } from '../lib/plan/plan';
  import { alignFrame, mosaic, saveMosaic, upPaForMajorAxis } from '../lib/sky/frame.svelte';
  import {
    fmtHours,
    hourAngleH,
    hoursToHorizon,
    hoursToMeridian,
    localSiderealH,
    separation,
  } from '../lib/telescope/coords';
  import { defaultPort, telescope } from '../lib/telescope/session.svelte';
  import { TelescopeError, type AdapterKind } from '../lib/telescope/types';

  interface Props {
    place: Place;
    selected: ObjectInfo | null;
    setups: Record<SetupKind, Setup>;
    frameOn: boolean;
    frameCenter: { ra: number; dec: number; target: string | null; pa: number } | null;
    profileName: string;
    profileText: string;
    /** Planning horizon, 720 altitudes (0.5° steps), or null for flat. */
    horizon: ArrayLike<number> | null;
    ontoggleframe: () => void;
    oncentre: () => void;
  }
  let {
    place,
    selected,
    setups = $bindable(),
    frameOn,
    frameCenter,
    profileName,
    profileText,
    horizon,
    ontoggleframe,
    oncentre,
  }: Props = $props();

  const D2R = Math.PI / 180;
  const stats = $derived(setupStats(setups.deepsky));
  const span = $derived(
    mosaicSpan(stats.fovW, stats.fovH, mosaic.cols, mosaic.rows, mosaic.overlap),
  );
  const fmtDeg = (d: number) => (d >= 1 ? `${d.toFixed(2)}°` : `${(d * 60).toFixed(1)}′`);
  let msg = $state('');

  // ---- frame ----------------------------------------------------------------------
  /** The selected object's catalog position angle and size, when the catalog has them. */
  let shape = $state<{ pa: number; maj: number } | null>(null);
  $effect(() => {
    const s = selected;
    shape = null;
    if (!s) return;
    let gone = false;
    void import('../lib/search/client').then(async ({ lookupObject }) => {
      const e = await lookupObject([s.name, ...s.otherNames, ...s.ids]);
      if (gone) return;
      const pa = e?.info?.pa;
      shape = pa != null && Number.isFinite(pa) ? { pa, maj: (e?.sizeDeg ?? 0) * 60 } : null;
    });
    return () => {
      gone = true;
    };
  });
  function alignToObject() {
    if (!shape) return;
    if (!frameOn) ontoggleframe();
    alignFrame(upPaForMajorAxis(shape.pa, stats.fovW >= stats.fovH));
    msg = `Frame turned so its long side follows ${selected?.name ?? 'the object'} (PA ${shape.pa}°).`;
  }
  function exportMosaic() {
    const c = frameCenter;
    if (!c) return;
    const panes = mosaicPanes(
      c.ra * D2R,
      c.dec * D2R,
      stats.fovW,
      stats.fovH,
      mosaic.cols,
      mosaic.rows,
      mosaic.overlap,
      -c.pa,
    ).map((p) => ({ pane: p.pane, ra: (((p.ra / D2R) % 360) + 360) % 360, dec: p.dec / D2R }));
    const name = c.target ?? selected?.name ?? `Mosaic ${raHms(c.ra)}`;
    download(
      `${name.replace(/[^\w-]+/g, '_')}-mosaic.csv`,
      toMosaicCsv(name, panes, c.pa),
      'text/csv',
    );
    msg = `Saved ${panes.length} panes for NINA (Sequencer → Import targets → mosaic panes).`;
  }
  $effect(() => {
    void mosaic.cols;
    void mosaic.rows;
    void mosaic.overlap;
    saveMosaic();
  });

  // ---- telescope ------------------------------------------------------------------
  const st = $derived(telescope.state);
  const live = $derived(telescope.status === 'live' && st != null);
  function setKind(k: AdapterKind) {
    telescope.settings.kind = k;
    if (k !== 'simulator') telescope.settings.port = defaultPort(k);
  }
  function connect() {
    telescope.connect({ lat: place.lat, lon: place.lon });
  }
  const lst = $derived(st ? (st.lstH ?? localSiderealH(new Date(st.at), place.lon)) : null);
  const ha = $derived(st && lst != null ? hourAngleH(lst, st.raNow) : null);
  const horizonAt = $derived((az: number) =>
    horizon ? (horizon[Math.round((((az % 360) + 360) % 360) * 2) % 720] ?? 0) : 0,
  );
  const setsIn = $derived(
    st && lst != null ? hoursToHorizon(st.raNow, st.decNow, place.lat, lst, horizonAt) : null,
  );
  const offset = $derived(
    st && selected ? separation(st.ra2000, st.dec2000, selected.ra2000, selected.dec2000) : null,
  );
  const compass = (pa: number) =>
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(pa / 45) % 8];
  const fmtOffset = (d: number) =>
    d >= 1
      ? `${d.toFixed(2)}°`
      : d * 60 >= 1
        ? `${(d * 60).toFixed(1)}′`
        : `${(d * 3600).toFixed(0)}″`;
  const stateText = $derived(
    !st
      ? 'n/a'
      : st.slewing
        ? 'Slewing'
        : st.atPark
          ? 'Parked'
          : st.tracking === true
            ? 'Tracking'
            : st.tracking === false
              ? 'Not tracking'
              : 'n/a',
  );
  const pierText = (p: string) =>
    p === 'east' ? 'East (looking west)' : p === 'west' ? 'West (looking east)' : 'n/a';
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Follow the telescope: the App turns the sky whenever a new reading arrives.
  // Control: confirmation box for slew / sync.
  let pending = $state<{ kind: 'slew' | 'sync'; name: string; ra: number; dec: number } | null>(
    null,
  );
  let actError = $state('');
  function ask(kind: 'slew' | 'sync') {
    if (!selected) return;
    actError = '';
    pending = { kind, name: selected.name, ra: selected.ra2000, dec: selected.dec2000 };
  }
  async function confirmAct() {
    const p = pending;
    pending = null;
    if (!p) return;
    try {
      await telescope.act(p.kind, p.ra, p.dec);
      msg = p.kind === 'slew' ? `Slewing to ${p.name}.` : `Synced on ${p.name}.`;
    } catch (e) {
      actError = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    }
  }
  async function stop() {
    try {
      await telescope.act('stop');
    } catch (e) {
      actError = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    }
  }
  const belowHorizon = $derived(
    pending && selected ? selected.alt < horizonAt(selected.az) : false,
  );
</script>

<div class="tp">
  <section aria-labelledby="tp-frame">
    <h3 id="tp-frame">Camera frame</h3>
    <p><strong>{profileName}</strong><br /><span class="note">{profileText}</span></p>
    <div class="row">
      <button aria-pressed={frameOn} onclick={ontoggleframe}>Camera frame on the sky</button>
      <button onclick={oncentre} disabled={!selected}>Centre on selected</button>
    </div>
    <label class="rng">
      Rotation
      <input type="range" min="-180" max="180" step="1" bind:value={setups.deepsky.rotationDeg} />
      <output>{Math.round(setups.deepsky.rotationDeg)}°</output>
    </label>
    {#if frameCenter}
      <p class="note">
        Frame centre {raHms(frameCenter.ra)}
        {decDms(frameCenter.dec)} (J2000) · top edge at PA {normRotation(frameCenter.pa).toFixed(
          0,
        )}°
      </p>
    {/if}
    <div class="row">
      <button onclick={alignToObject} disabled={!shape}
        >Align to {selected ? selected.name : 'the object'}</button
      >
      {#if selected && !shape}<span class="note"
          >No position angle in the catalog for this object.</span
        >{/if}
    </div>

    <h4>Mosaic</h4>
    <div class="row">
      <label class="num"
        >Columns <select bind:value={mosaic.cols}>
          {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option>{/each}
        </select></label
      >
      <label class="num"
        >Rows <select bind:value={mosaic.rows}>
          {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option>{/each}
        </select></label
      >
    </div>
    <label class="rng">
      Overlap
      <input type="range" min="0.05" max="0.4" step="0.01" bind:value={mosaic.overlap} />
      <output>{Math.round(mosaic.overlap * 100)} %</output>
    </label>
    <p class="note">
      {mosaic.cols} × {mosaic.rows} panes cover {fmtDeg(span.w)} × {fmtDeg(span.h)} with the
      {profileName} frame ({fmtDeg(stats.fovW)} × {fmtDeg(stats.fovH)}).
    </p>
    <div class="row">
      <button onclick={exportMosaic} disabled={!frameCenter || mosaic.cols * mosaic.rows < 2}
        >Export mosaic for NINA (CSV)</button
      >
    </div>
    {#if !frameCenter}<p class="note">
        Turn the camera frame on to place the mosaic on the sky.
      </p>{/if}
    {#if msg}<p class="msg" role="status">{msg}</p>{/if}
  </section>

  <section aria-labelledby="tp-scope">
    <h3 id="tp-scope">Live telescope</h3>
    {#if telescope.status === 'off'}
      <div class="row" role="group" aria-label="Connect to">
        {#each [['simulator', 'Simulator'], ['nina', 'NINA'], ['alpaca', 'ASCOM Alpaca']] as [k, l] (k)}
          <button
            aria-pressed={telescope.settings.kind === k}
            onclick={() => setKind(k as AdapterKind)}>{l}</button
          >
        {/each}
      </div>
      {#if telescope.settings.kind !== 'simulator'}
        <label class="chk"
          ><input type="checkbox" bind:checked={telescope.settings.viaBridge} /> Through the bridge (this
          page is served by the bridge on your mini PC)</label
        >
        {#if !telescope.settings.viaBridge}
          <div class="row">
            <label class="num"
              >Computer <input
                type="text"
                bind:value={telescope.settings.host}
                autocomplete="off"
                spellcheck="false"
                placeholder="192.168.1.20"
              /></label
            >
            <label class="num"
              >Port <input
                type="number"
                min="1"
                max="65535"
                bind:value={telescope.settings.port}
              /></label
            >
            {#if telescope.settings.kind === 'alpaca'}
              <label class="num"
                >Device <input
                  type="number"
                  min="0"
                  max="99"
                  bind:value={telescope.settings.device}
                /></label
              >
            {/if}
          </div>
        {/if}
      {:else}
        <p class="note">A pretend mount at your site, for trying the HUD. It starts parked.</p>
      {/if}
      <div class="row"><button class="primary" onclick={connect}>Connect (read-only)</button></div>
      <details>
        <summary>How to connect</summary>
        <ol>
          <li>
            <strong>NINA:</strong> install the "Advanced API" plugin (Plugins → Available), switch
            it on and keep port 1888. <strong>ASCOM:</strong> start ASCOM Remote (port 11111) and allow
            cross-origin requests in its settings.
          </li>
          <li>Connect your mount in NINA or the ASCOM driver as usual.</li>
          <li>
            Find the computer's address (Windows: <code>ipconfig</code>, e.g. 192.168.1.20). Your
            phone or laptop must be on the same Wi-Fi.
          </li>
          <li>
            Chrome or Edge: pick NINA or Alpaca above, type the address and press Connect; allow the
            "local network" prompt.
          </li>
          <li>
            Safari, iPhone or Firefox: run the bridge on the mini PC (<code
              >node tools/bridge/bridge.mjs --dist dist</code
            >), open
            <code>http://&lt;address&gt;:8080</code> and tick "Through the bridge".
          </li>
        </ol>
        <p class="note">
          The app only reads the position unless you switch on control. Never forward port 1888,
          11111 or 8080 to the internet: they have no password.
        </p>
      </details>
    {:else}
      <p class="status" role="status">
        {#if telescope.status === 'connecting'}Connecting to {telescope.label}…
        {:else if live && st}<span class="dot live" aria-hidden="true"></span>Live from {telescope.label}{telescope
            .settings.kind === 'simulator'
            ? ' (not a real mount)'
            : ''} · {time(st.at)}
        {:else}<span class="dot lost" aria-hidden="true"></span>No reading from {telescope.label}{/if}
      </p>
      {#if telescope.error}
        <p class="warn" role="alert">{telescope.error.message} {telescope.error.hint}</p>
      {/if}
      {#if live && st}
        <dl class="hud">
          <dt>Altitude / azimuth</dt>
          <dd>
            {st.alt != null ? `${st.alt.toFixed(1)}°` : 'n/a'} / {st.az != null
              ? `${st.az.toFixed(1)}°`
              : 'n/a'}
          </dd>
          <dt>RA / Dec J2000</dt>
          <dd>{raHms(st.ra2000)} {decDms(st.dec2000)}</dd>
          <dt>RA / Dec of date</dt>
          <dd>{raHms(st.raNow)} {decDms(st.decNow)}</dd>
          <dt>Hour angle</dt>
          <dd>{ha != null ? `${ha >= 0 ? '+' : ''}${ha.toFixed(2)} h` : 'n/a'}</dd>
          <dt>Pier side</dt>
          <dd>{pierText(st.pier)}</dd>
          <dt>State</dt>
          <dd>{stateText}</dd>
          <dt>To the meridian</dt>
          <dd>{ha != null && !st.atPark ? fmtHours(hoursToMeridian(ha)) : 'n/a'}</dd>
          {#if st.flipInH != null}<dt>Meridian flip in</dt>
            <dd>
              {fmtHours(st.flipInH)} ({telescope.settings.kind === 'nina' ? 'NINA' : 'estimate'})
            </dd>{/if}
          <dt>Below your horizon in</dt>
          <dd>
            {st.atPark
              ? 'n/a'
              : setsIn != null
                ? fmtHours(setsIn)
                : st.alt != null && st.alt < horizonAt(st.az ?? 0)
                  ? 'already below'
                  : 'stays up 12 h+'}
          </dd>
          {#if st.rotatorDeg != null}<dt>Rotator</dt>
            <dd>{st.rotatorDeg.toFixed(1)}°</dd>{/if}
          {#if offset && selected}<dt>Off {selected.name}</dt>
            <dd>{fmtOffset(offset.sepDeg)} towards {compass(offset.paDeg)}</dd>{/if}
          <dt>Mount reports</dt>
          <dd>{st.epoch === 'unknown' ? 'unknown epoch (treated as date)' : st.epoch}</dd>
        </dl>
        <label class="chk"
          ><input type="checkbox" bind:checked={telescope.follow} /> Follow the telescope on the sky</label
        >
      {/if}

      <div class="ctl" class:on={telescope.control}>
        <label class="chk"
          ><input type="checkbox" bind:checked={telescope.control} disabled={!live} />
          <span><strong>Enable control</strong> (slew and sync; off again on every visit)</span
          ></label
        >
        {#if telescope.control}
          <p class="note">
            Before every slew, check that cables, dew heaters and people are clear of the telescope.
          </p>
          <div class="row">
            <button onclick={() => ask('slew')} disabled={!selected || !live}
              >Slew to {selected?.name ?? 'selected'}</button
            >
            <button onclick={() => ask('sync')} disabled={!selected || !live}
              >Sync on {selected?.name ?? 'selected'}</button
            >
            <button class="stop" onclick={stop} disabled={!live}>Stop</button>
          </div>
        {/if}
        {#if pending}
          <div class="confirm" role="alertdialog" aria-labelledby="tp-confirm">
            <p id="tp-confirm">
              {pending.kind === 'slew' ? 'Slew the mount to' : 'Sync the mount on'}
              <strong>{pending.name}</strong> ({raHms(pending.ra)}
              {decDms(pending.dec)})?
            </p>
            {#if pending.kind === 'slew' && belowHorizon}
              <p class="warn">It is below your horizon right now.</p>
            {/if}
            {#if pending.kind === 'sync'}
              <p class="note">
                Only sync when the telescope is really centred on it (after a plate solve).
              </p>
            {/if}
            <div class="row">
              <button class="primary" onclick={confirmAct}
                >{pending.kind === 'slew' ? 'Slew now' : 'Sync now'}</button
              >
              <button onclick={() => (pending = null)}>Cancel</button>
            </div>
          </div>
        {/if}
        {#if actError}<p class="warn" role="alert">{actError}</p>{/if}
      </div>
      <div class="row"><button onclick={() => telescope.disconnect()}>Disconnect</button></div>
    {/if}
  </section>
</div>

<style>
  .tp {
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
  h4 {
    margin: var(--s2) 0 0;
    font-size: var(--fs-14);
    font-weight: 600;
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
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
    align-items: center;
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
  .num input[type='text'] {
    width: 9.5em;
  }
  .num input[type='number'] {
    width: 5em;
  }
  output {
    min-width: 3.5em;
    text-align: right;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  button[aria-pressed='true'] {
    border-color: var(--brass);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .primary {
    border-color: var(--brass);
    color: var(--brass);
  }
  .stop {
    border-color: var(--nogo);
    color: var(--nogo);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--fs-12);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .live {
    background: var(--go);
  }
  .lost {
    background: var(--nogo);
  }
  .hud {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 2px var(--s3);
    margin: 0;
    font-size: var(--fs-12);
    font-variant-numeric: tabular-nums;
  }
  .hud dt {
    color: var(--text-2);
  }
  .hud dd {
    margin: 0;
  }
  .ctl {
    display: grid;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--r-input);
  }
  .ctl.on {
    border-color: var(--nogo);
  }
  .confirm {
    display: grid;
    gap: var(--s2);
    padding: var(--s3);
    border: 1px solid var(--brass);
    border-radius: var(--r-input);
  }
  details {
    font-size: var(--fs-12);
  }
  ol {
    margin: var(--s2) 0;
    padding-left: 1.3em;
    display: grid;
    gap: var(--s1);
  }
  code {
    font-size: var(--fs-12);
  }
</style>
