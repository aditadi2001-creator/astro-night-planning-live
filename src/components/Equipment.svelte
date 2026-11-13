<script lang="ts">
  import {
    CAMERAS,
    fmtFov,
    saveSetups,
    SETUP_LABELS,
    setupStats,
    type Setup,
    type SetupKind,
  } from '../lib/equipment';

  interface Props {
    setups: Record<SetupKind, Setup>;
    /** Which setups draw their frame on the sky. */
    shown: Record<SetupKind, boolean>;
    /** Forecast seeing now (arcsec), for the sampling advice. */
    seeing: number | null;
    /** Where the frames are centred (from the sky view). */
    center: { ra: number; dec: number; target: string | null } | null;
  }
  let { setups = $bindable(), shown = $bindable(), seeing, center }: Props = $props();

  const KINDS: SetupKind[] = ['deepsky', 'planetary', 'lunarsolar'];
  let tab = $state<SetupKind>('deepsky');
  const s = $derived(setups[tab]);
  const st = $derived(setupStats(s, seeing));

  // Remember edits on this device.
  $effect(() => {
    saveSetups($state.snapshot(setups) as Record<SetupKind, Setup>);
  });

  function pickCamera(name: string) {
    const c = CAMERAS.find((x) => x.name === name);
    if (!c) {
      setups[tab].camera = 'Custom';
      return;
    }
    setups[tab] = {
      ...setups[tab],
      camera: c.name,
      widthPx: c.widthPx,
      heightPx: c.heightPx,
      pixelUm: c.pixelUm,
    };
  }

  const hms = (deg: number) => {
    const h = deg / 15;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    const ss = Math.round(((h - hh) * 60 - mm) * 60);
    return `${hh}h ${String(mm).padStart(2, '0')}m ${String(ss % 60).padStart(2, '0')}s`;
  };
  const dms = (deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const sec = Math.round(((a - d) * 60 - m) * 60);
    return `${deg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(sec % 60).padStart(2, '0')}″`;
  };
  const f = (v: number, d = 2) => v.toFixed(d);
</script>

<section class="equip" aria-labelledby="eq-title">
  <h2 id="eq-title">My equipment &amp; field of view</h2>
  <div class="tabs" role="tablist" aria-label="Imaging setups">
    {#each KINDS as k (k)}
      <button role="tab" aria-selected={tab === k} class:on={tab === k} onclick={() => (tab = k)}>
        {SETUP_LABELS[k]}
      </button>
    {/each}
  </div>

  <div class="grid" role="tabpanel" aria-label={SETUP_LABELS[tab]}>
    <fieldset>
      <legend>Telescope</legend>
      <label class="wide">Name <input bind:value={setups[tab].telescope} /></label>
      <label
        >Aperture (mm) <input
          type="number"
          min="10"
          max="2000"
          step="1"
          bind:value={setups[tab].apertureMm}
        /></label
      >
      <label
        >Focal length (mm) <input
          type="number"
          min="50"
          max="20000"
          step="1"
          bind:value={setups[tab].focalMm}
        /></label
      >
      <label
        >Reducer / Barlow ×
        <input type="number" min="0.3" max="5" step="0.05" bind:value={setups[tab].factor} /></label
      >
    </fieldset>
    <fieldset>
      <legend>Camera</legend>
      <label class="wide"
        >Model
        <select
          value={CAMERAS.some((c) => c.name === s.camera) ? s.camera : 'Custom'}
          onchange={(e) => pickCamera((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each CAMERAS as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          <option value="Custom">Custom sensor</option>
        </select>
      </label>
      <label
        >Width (px) <input
          type="number"
          min="100"
          max="20000"
          step="1"
          bind:value={setups[tab].widthPx}
          oninput={() => (setups[tab].camera = 'Custom')}
        /></label
      >
      <label
        >Height (px) <input
          type="number"
          min="100"
          max="20000"
          step="1"
          bind:value={setups[tab].heightPx}
          oninput={() => (setups[tab].camera = 'Custom')}
        /></label
      >
      <label
        >Pixel size (µm) <input
          type="number"
          min="0.8"
          max="20"
          step="0.01"
          bind:value={setups[tab].pixelUm}
          oninput={() => (setups[tab].camera = 'Custom')}
        /></label
      >
      <label
        >Frame rotation (°) <input
          type="number"
          min="-180"
          max="180"
          step="1"
          bind:value={setups[tab].rotationDeg}
        /></label
      >
    </fieldset>

    <div class="stats">
      <dl>
        <dt>Field of view</dt>
        <dd>{fmtFov(st)} <span class="sub">(diagonal {f(st.fovDiag)}°)</span></dd>
        <dt>Pixel scale</dt>
        <dd>{f(st.pixelScale, 3)}″ / pixel</dd>
        <dt>Focal length / ratio</dt>
        <dd>{Math.round(st.effFocalMm)} mm, f/{f(st.fRatio, 1)}</dd>
        <dt>Resolution (optics)</dt>
        <dd>Dawes {f(st.dawes)}″, Rayleigh {f(st.rayleigh)}″</dd>
        <dt>Sampling</dt>
        <dd>
          {#if st.sampling}
            {st.sampling}: {tab === 'deepsky' ? `${seeing?.toFixed(1)}″ seeing` : 'the Dawes limit'} spans
            {f(st.pxPerFwhm ?? 0, 1)} px (aim for about 2–3{tab === 'deepsky' ? '' : '+'})
          {:else}
            needs the seeing forecast
          {/if}
        </dd>
        {#if tab !== 'deepsky'}
          <dt>Ideal f-ratio</dt>
          <dd>
            f/{f(st.idealFRatio, 1)} for {s.pixelUm} µm pixels (critical sampling ≈ 5 × pixel size)
          </dd>
        {/if}
      </dl>
      <label class="show">
        <input type="checkbox" bind:checked={shown[tab]} /> Show this frame in the sky
      </label>
      {#if center && KINDS.some((k) => shown[k])}
        <p class="center">
          Frame centre{center.target ? ` (${center.target})` : ' (view centre)'}: RA {hms(
            center.ra,
          )}, Dec {dms(center.dec)} <span class="sub">J2000</span>
        </p>
        <p class="sub">
          Tap an object in the sky to centre the frames on it; drag the sky otherwise.
        </p>
      {/if}
      {#if tab === 'lunarsolar'}
        <p class="warn">
          Never point a telescope or camera at the Sun without a certified full-aperture solar
          filter (or a dedicated solar telescope).
        </p>
      {/if}
    </div>
  </div>
</section>

<style>
  .equip {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  h2 {
    font-size: 13px;
    margin: 0 0 8px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .tabs .on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 8px;
    margin: 0;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    min-width: 0;
  }
  legend {
    font-size: 12px;
    color: var(--muted);
    padding: 0 4px;
  }
  label {
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
    min-width: 0;
  }
  label.wide {
    grid-column: 1 / -1;
  }
  input,
  select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 7px;
    min-height: 34px;
    min-width: 0;
    width: 100%;
  }
  .stats dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 8px;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
  }
  label.show {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text);
    min-height: 32px;
  }
  label.show input {
    width: 18px;
    height: 18px;
    min-height: 0;
    accent-color: var(--accent);
  }
  .center {
    margin: 4px 0 2px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .warn {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--warn);
  }
</style>
