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
  import { untrack } from 'svelte';
  import * as Astronomy from 'astronomy-engine';
  import { j2000ToNow } from '../lib/telescope/coords';
  import { gotoCheck, type GotoCheck } from '../lib/telescope/safety';
  import { serialSupported } from '../lib/telescope/serial';
  import { MOUNTS } from '../lib/telescope/mounts';
  import { defaultPort, telescope } from '../lib/telescope/session.svelte';
  import { TelescopeError, type AdapterKind, type SequenceTarget } from '../lib/telescope/types';

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
  // ---- "What mount do you have?" -------------------------------------------------------
  const MKEY = 'anp.telescope.mount';
  let mountId = $state(
    (() => {
      try {
        return localStorage.getItem(MKEY) ?? '';
      } catch {
        return '';
      }
    })(),
  );
  let routeI = $state(0);
  const family = $derived(MOUNTS.find((m) => m.id === mountId) ?? null);
  const route = $derived(family?.routes[routeI] ?? null);
  function useRoute(i: number) {
    routeI = i;
    const r = family?.routes[i];
    if (!r) return;
    setKind(r.kind);
    if (r.protocol) telescope.settings.protocol = r.protocol;
  }
  // On first show keep the connection already chosen (and remembered); a newly picked mount
  // switches to its recommended route.
  let seenMount = untrack(() => mountId);
  $effect(() => {
    const id = mountId;
    try {
      localStorage.setItem(MKEY, id);
    } catch {
      /* not remembered */
    }
    if (id === seenMount) {
      const i = family?.routes.findIndex((r) => r.kind === telescope.settings.kind) ?? -1;
      if (i >= 0) routeI = i;
      return;
    }
    seenMount = id;
    if (family) useRoute(0);
  });
  function connect() {
    void telescope.connect({ lat: place.lat, lon: place.lon });
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

  // ---- control: every action goes through one confirmation (CLAUDE.md rule 8) -----------
  const caps = $derived(telescope.caps);
  /** How a GoTo finishes: plain slew, plate-solve centre (NINA), or centre and rotate. */
  let finish = $state<'slew' | 'centre' | 'rotate'>('slew');
  $effect(() => {
    if (!caps.centre && finish !== 'slew') finish = 'slew';
  });
  /** The frame's position angle, for "rotate" and for NINA targets. */
  const framePa = $derived(frameCenter ? normRotation(frameCenter.pa) : 0);
  let solarFilter = $state(false);
  interface Pending {
    title: string;
    detail: string;
    go: string;
    run: () => Promise<string>;
    /** A GoTo target (J2000 degrees): checked for the Sun, the horizon and the meridian. */
    at?: { ra: number; dec: number };
  }
  let pending = $state<Pending | null>(null);
  /** Re-evaluated when the solar-filter tick changes. */
  const check = $derived<GotoCheck | null>(
    pending?.at ? checkFor(pending.at.ra, pending.at.dec) : null,
  );
  let actError = $state('');
  let busy = $state(false);

  /** Safety and timing facts for a target now (J2000 degrees). */
  function checkFor(ra: number, dec: number): GotoCheck {
    const now = new Date();
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    const p = j2000ToNow(ra, dec, now);
    const hor = Astronomy.Horizon(now, obs, p.ra / 15, p.dec, undefined);
    const sunEq = Astronomy.Equator(Astronomy.Body.Sun, now, obs, false, true);
    const sunHor = Astronomy.Horizon(now, obs, sunEq.ra, sunEq.dec, undefined);
    const sep = separation(ra, dec, sunEq.ra * 15, sunEq.dec).sepDeg;
    const lstH = localSiderealH(now, place.lon);
    return gotoCheck({
      alt: hor.altitude,
      horizonAlt: horizonAt(hor.azimuth),
      sunSepDeg: sep,
      sunAlt: sunHor.altitude,
      haH: hourAngleH(lstH, p.ra),
      solarFilter,
    });
  }

  function askGoto() {
    const t = selected;
    if (!t) return;
    actError = '';
    const how =
      finish === 'rotate'
        ? `then NINA plate-solves, centres and turns the rotator to PA ${framePa.toFixed(0)}°`
        : finish === 'centre'
          ? 'then NINA plate-solves and re-slews until it is centred'
          : 'a plain slew (the mount’s own pointing)';
    const ra = t.ra2000;
    const dec = t.dec2000;
    pending = {
      title: `Slew the mount to ${t.name}`,
      detail: `${raHms(ra)} ${decDms(dec)} (J2000): ${how}.`,
      go: finish === 'slew' ? 'Slew now' : 'Slew and centre now',
      at: { ra, dec },
      run: async () => {
        await telescope.act('slew', ra, dec, {
          centre: finish !== 'slew',
          rotatePa: finish === 'rotate' ? framePa : null,
        });
        return finish === 'slew'
          ? `Slewing to ${t.name}.`
          : `Slewing to ${t.name}; NINA will plate-solve and centre it (watch NINA for progress).`;
      },
    };
  }

  function askSync() {
    const t = selected;
    if (!t) return;
    actError = '';
    pending = {
      title: `Sync the mount on ${t.name}`,
      detail:
        'Only sync when the telescope is really centred on it (after a plate solve, or by eye in a crosshair eyepiece): a wrong sync spoils every later GoTo.',
      go: 'Sync now',
      run: async () => {
        await telescope.act('sync', t.ra2000, t.dec2000);
        return `Synced on ${t.name}.`;
      },
    };
  }
  function askSimple(kind: 'park' | 'unpark' | 'track' | 'untrack') {
    actError = '';
    const WORDS: Record<typeof kind, [string, string, string]> = {
      park: ['Park the mount', 'It slews to its park position and stops tracking.', 'Park now'],
      unpark: ['Unpark the mount', 'It can then slew and track again.', 'Unpark now'],
      track: ['Start tracking', 'The mount follows the sky at the sidereal rate.', 'Track'],
      untrack: ['Stop tracking', 'Stars will drift out of the field.', 'Stop tracking'],
    };
    const words = WORDS[kind];
    pending = {
      title: words[0],
      detail: words[1],
      go: words[2],
      run: async () => {
        await telescope.act(kind);
        return `${words[0]}: sent.`;
      },
    };
  }
  async function confirmAct() {
    const p = pending;
    if (!p || check?.blocked) return;
    pending = null;
    busy = true;
    try {
      msg = await p.run();
    } catch (e) {
      actError = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    } finally {
      busy = false;
    }
  }
  async function stop() {
    pending = null;
    try {
      await telescope.act('stop');
      msg = 'Stop sent.';
    } catch (e) {
      actError = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    }
  }

  // ---- NINA: the loaded sequence, saved sequences, framing assistant -------------------
  let seqTargets = $state<SequenceTarget[] | null>(null);
  let seqIndex = $state(0);
  let seqNames = $state<string[] | null>(null);
  let seqPick = $state('');
  let seqNote = $state('');
  async function readSequence() {
    seqNote = '';
    try {
      seqTargets = (await telescope.link?.sequenceTargets?.()) ?? [];
      if (!seqTargets.length)
        seqNote =
          'No target containers found in the loaded sequence. Load a sequence (or add a "Deep Sky Object" container in NINA\'s Advanced Sequencer), then read it again; or type the container number below.';
      seqIndex = Math.min(seqIndex, Math.max(0, seqTargets.length - 1));
    } catch (e) {
      seqTargets = [];
      seqNote = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    }
  }
  async function readSaved() {
    seqNote = '';
    try {
      seqNames = (await telescope.link?.listSequences?.()) ?? [];
      seqPick = seqNames[0] ?? '';
    } catch (e) {
      seqNote = e instanceof TelescopeError ? `${e.message} ${e.hint}` : String(e);
    }
  }
  function askSetTarget() {
    const t = selected;
    const link = telescope.link;
    if (!t || !link?.setSequenceTarget) return;
    actError = '';
    const idx = seqIndex;
    const into = seqTargets?.find((x) => x.index === idx)?.name ?? `container ${idx + 1}`;
    const name = t.name;
    pending = {
      title: `Put ${name} into NINA's sequence`,
      detail: `Replaces the target of "${into}" with ${name}, ${raHms(t.ra2000)} ${decDms(t.dec2000)} (J2000), position angle ${framePa.toFixed(0)}°${frameCenter ? ' (the frame on the sky)' : ''}. The mount does not move.`,
      go: 'Set target',
      run: async () => {
        await link.setSequenceTarget?.(idx, name, t.ra2000, t.dec2000, framePa);
        await readSequence();
        return `${name} is now the target of "${into}" in NINA. Start the sequence in NINA when ready.`;
      },
    };
  }
  function askLoad() {
    const link = telescope.link;
    const n = seqPick;
    if (!n || !link?.loadSequence) return;
    actError = '';
    pending = {
      title: `Load "${n}" in NINA`,
      detail: 'It replaces the sequence open in NINA (only when no sequence is running).',
      go: 'Load',
      run: async () => {
        await link.loadSequence?.(n);
        await readSequence();
        return `Loaded "${n}" in NINA.`;
      },
    };
  }
  function askFraming() {
    const t = selected;
    const link = telescope.link;
    if (!t || !link?.toFraming) return;
    actError = '';
    pending = {
      title: `Send ${t.name} to NINA's framing assistant`,
      detail: `${raHms(t.ra2000)} ${decDms(t.dec2000)}, rotation ${framePa.toFixed(0)}°. NINA's framing assistant must have been opened once this session.`,
      go: 'Send',
      run: async () => {
        await link.toFraming?.(t.ra2000, t.dec2000, framePa);
        return `Sent ${t.name} to NINA's framing assistant.`;
      },
    };
  }
</script>

<div class="tp">
  <section aria-labelledby="tp-scope">
    <h3 id="tp-scope">Live telescope</h3>
    {#if telescope.status === 'off'}
      <label class="num pick"
        >What mount do you have?
        <select bind:value={mountId}>
          <option value="">Choose your mount…</option>
          {#each MOUNTS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
        </select></label
      >
      {#if family}
        <div class="routes" role="radiogroup" aria-label="How to connect it">
          {#each family.routes as r, i (r.label)}
            <label class="route"
              ><input
                type="radio"
                name="route"
                checked={routeI === i}
                onchange={() => useRoute(i)}
              />
              <span>{r.label}{i === 0 ? ' · recommended' : ''}</span></label
            >
          {/each}
        </div>
        {#if route}
          <ol class="steps">
            {#each route.steps as st (st)}<li>{st}</li>{/each}
          </ol>
        {/if}
        {#if family.note}<p class="note">{family.note}</p>{/if}
      {/if}
      <p class="note">Or choose the connection yourself:</p>
      <div class="row" role="group" aria-label="Connect to">
        {#each [['simulator', 'Simulator'], ['nina', 'NINA'], ['alpaca', 'ASCOM Alpaca'], ['indi', 'INDI'], ['serial', 'USB cable'], ['network', 'Network mount']] as [k, l] (k)}
          <button
            aria-pressed={telescope.settings.kind === k}
            onclick={() => setKind(k as AdapterKind)}>{l}</button
          >
        {/each}
      </div>
      {#if telescope.settings.kind === 'serial'}
        <div class="row">
          <label class="num"
            >Hand controller <select bind:value={telescope.settings.protocol}>
              <option value="lx200">LX200 (Meade, OnStep, iOptron in LX200 mode…)</option>
              <option value="nexstar">NexStar / SynScan (Celestron, Sky-Watcher)</option>
            </select></label
          >
        </div>
        <label class="chk"
          ><input type="checkbox" bind:checked={telescope.settings.serialJ2000} /> The mount is set to
          J2000 (most hand controllers use the position of date; leave this off)</label
        >
        {#if !serialSupported()}
          <p class="warn">
            This browser cannot open USB/serial ports. Use Chrome or Edge on a computer, or connect
            through NINA or ASCOM Alpaca.
          </p>
        {:else}
          <p class="note">
            Plug the mount's USB (or USB-serial) cable into this computer; Connect asks which port.
            Close other programs using the port first.
          </p>
        {/if}
      {:else if telescope.settings.kind !== 'simulator'}
        {#if telescope.settings.kind === 'network'}
          <div class="row">
            <label class="num"
              >Protocol <select bind:value={telescope.settings.protocol}>
                <option value="lx200">LX200 (ZWO AM, OnStep, 10Micron, Meade)</option>
                <option value="nexstar">NexStar / SynScan</option>
              </select></label
            >
          </div>
          <p class="note">
            The bridge holds the connection to the mount (start it with --tcp &lt;mount
            address&gt;:&lt;port&gt; --tcp-protocol {telescope.settings.protocol}).
          </p>
        {:else if telescope.settings.kind === 'indi'}
          <p class="note">
            The bridge holds the connection to indiserver (start it with --indi 127.0.0.1:7624 on
            the INDI computer).
          </p>
        {/if}
        <label class="chk"
          ><input type="checkbox" bind:checked={telescope.settings.viaBridge} /> Through the bridge (this
          page is served by the bridge on the computer next to the telescope)</label
        >
        {#if !telescope.settings.viaBridge}
          <div class="row">
            <label class="num"
              >{telescope.settings.kind === 'indi' || telescope.settings.kind === 'network'
                ? 'Bridge computer'
                : 'Computer'}
              <input
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
            Safari, iPhone or Firefox: run the bridge on the computer next to the telescope (<code
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
          <span
            ><strong>Enable control</strong> (GoTo, sync, park, tracking{caps.sequence
              ? ', NINA sequence'
              : ''}; off again on every visit)</span
          ></label
        >
        {#if telescope.control}
          <p class="note">
            Before every slew, check that cables, dew heaters and people are clear of the telescope.
          </p>
          <button class="stop big" onclick={stop} disabled={!live}>Stop the mount</button>

          <h4>GoTo {selected ? selected.name : ''}</h4>
          {#if !selected}
            <p class="note">Tap an object in the sky (or search for one) to choose the target.</p>
          {/if}
          {#if caps.centre}
            <div class="seg" role="radiogroup" aria-label="How the GoTo finishes">
              <label><input type="radio" bind:group={finish} value="slew" /> Slew only</label>
              <label
                ><input type="radio" bind:group={finish} value="centre" /> Slew and centre (plate solve)</label
              >
              <label
                ><input type="radio" bind:group={finish} value="rotate" disabled={!caps.rotate} />
                Centre and rotate to the frame (PA {framePa.toFixed(0)}°)</label
              >
            </div>
            <p class="note">
              Centring uses NINA's own plate solver and camera, repeating until the target is within
              NINA's centring tolerance: the most exact way to land on an object.
            </p>
          {:else if telescope.settings.kind !== 'simulator'}
            <p class="note">
              Plate-solve centring needs NINA. Here: slew, then use "Off {selected?.name ??
                'target'}" below and sync once it is centred.
            </p>
          {/if}
          <div class="row">
            <button class="primary" onclick={askGoto} disabled={!selected || !live || busy}
              >GoTo {selected?.name ?? 'selected'}</button
            >
            <button onclick={askSync} disabled={!selected || !live || busy}
              >Sync on {selected?.name ?? 'selected'}</button
            >
          </div>
          {#if caps.park || caps.tracking}
            <div class="row">
              {#if caps.park}
                <button onclick={() => askSimple(st?.atPark ? 'unpark' : 'park')} disabled={!live}
                  >{st?.atPark ? 'Unpark' : 'Park'}</button
                >
              {/if}
              {#if caps.tracking}
                <button
                  onclick={() => askSimple(st?.tracking ? 'untrack' : 'track')}
                  disabled={!live || st?.atPark === true}
                  >{st?.tracking ? 'Stop tracking' : 'Start tracking'}</button
                >
              {/if}
            </div>
          {/if}

          {#if caps.sequence}
            <h4>NINA sequence</h4>
            <p class="note">
              Put the selected object into a target container of the sequence open in NINA's
              Advanced Sequencer (with the frame's position angle), load a saved sequence, or send
              it to the framing assistant. The mount does not move.
            </p>
            <div class="row">
              <button onclick={readSequence}>Read NINA's sequence</button>
              <button onclick={readSaved}>Saved sequences</button>
            </div>
            {#if seqNames}
              {#if seqNames.length}
                <div class="row">
                  <label class="num"
                    >Sequence <select bind:value={seqPick}>
                      {#each seqNames as n (n)}<option value={n}>{n}</option>{/each}
                    </select></label
                  >
                  <button onclick={askLoad} disabled={!seqPick}>Load in NINA</button>
                </div>
              {:else}
                <p class="note">NINA lists no saved sequences in its default sequence folder.</p>
              {/if}
            {/if}
            {#if seqTargets}
              <div class="row">
                {#if seqTargets.length}
                  <label class="num"
                    >Container <select bind:value={seqIndex}>
                      {#each seqTargets as t (t.index)}<option value={t.index}
                          >{t.index + 1}. {t.name}{t.ra != null && t.dec != null
                            ? ` (${raHms(t.ra)} ${decDms(t.dec)})`
                            : ''}</option
                        >{/each}
                    </select></label
                  >
                {:else}
                  <label class="num"
                    >Container number <input
                      type="number"
                      min="1"
                      max="50"
                      value={seqIndex + 1}
                      oninput={(e) =>
                        (seqIndex = Math.max(
                          0,
                          Number((e.currentTarget as HTMLInputElement).value) - 1,
                        ))}
                    /></label
                  >
                {/if}
              </div>
            {/if}
            <div class="row">
              <button onclick={askSetTarget} disabled={!selected || seqTargets == null}
                >Set {selected?.name ?? 'selected'} as the target</button
              >
              <button onclick={askFraming} disabled={!selected}>Send to framing assistant</button>
            </div>
            {#if seqNote}<p class="note" role="status">{seqNote}</p>{/if}
          {/if}
        {/if}
        {#if pending}
          <div class="confirm" role="alertdialog" aria-labelledby="tp-confirm">
            <p id="tp-confirm"><strong>{pending.title}?</strong></p>
            <p class="note">{pending.detail}</p>
            {#if check}
              {#if check.needsSolarFilter}
                <p class="warn">
                  Never observe or image the Sun without a certified full-aperture solar filter.
                </p>
                <label class="chk"
                  ><input type="checkbox" bind:checked={solarFilter} /> A certified full-aperture solar
                  filter is fitted on the front of the telescope (and the finder is capped)</label
                >
              {/if}
              {#if check.blocked}<p class="warn">{check.blocked}</p>{/if}
              {#each check.warnings as w (w)}<p class="warn soft">{w}</p>{/each}
            {/if}
            <div class="row">
              <button class="primary" onclick={confirmAct} disabled={!!check?.blocked}
                >{pending.go}</button
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
  .pick {
    display: grid;
    gap: 4px;
  }
  .pick select {
    width: 100%;
  }
  .routes {
    display: grid;
    gap: 4px;
    font-size: var(--fs-14);
  }
  .route {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .route input {
    margin-top: 3px;
  }
  .steps {
    margin: 0;
    padding-left: 1.3em;
    display: grid;
    gap: 4px;
    font-size: var(--fs-14);
  }
  .stop.big {
    width: 100%;
    min-height: var(--touch);
    font-weight: 700;
  }
  .warn.soft {
    color: var(--maybe);
  }
  h4 {
    margin: var(--s2) 0 0;
    font-size: var(--fs-14);
  }
  .seg {
    display: grid;
    gap: 4px;
    font-size: var(--fs-14);
  }
  .seg label {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 32px;
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
