<script lang="ts">
  import Card from './Card.svelte';
  import { airmassKastenYoung } from '../lib/physics/airmass';
  import type { ExtinctionParts } from '../lib/physics/extinction';
  import type { SkyBrightness } from '../lib/physics/skybrightness';

  interface Props {
    extinction: ExtinctionParts;
    dbv: number;
    sky: SkyBrightness;
    /** Naked-eye limit of the sky background, before extinction. */
    limitMag: number;
    cursor: { alt: number; az: number } | null;
    pressure: number | null;
    temperature: number | null;
    horizonSource: string;
    /** Offered when terrain was skipped to save data. */
    onloadterrain?: (() => void) | undefined;
  }
  let {
    extinction,
    dbv,
    sky,
    limitMag,
    cursor,
    pressure,
    temperature,
    horizonSource,
    onloadterrain,
  }: Props = $props();

  const X = $derived(cursor && cursor.alt > 0 ? airmassKastenYoung(cursor.alt) : null);
  const zenithLimit = $derived(limitMag - extinction.total * airmassKastenYoung(90));
  const share = (v: number) => `${Math.round((100 * v) / sky.nl)}%`;
</script>

<Card title="Physics" tag="live values">
  <dl>
    <dt>Extinction k</dt>
    <dd>
      {extinction.total.toFixed(3)} mag/airmass
      <span class="sub"
        >air {extinction.rayleigh.toFixed(3)} · aerosol {extinction.aerosol.toFixed(3)} · ozone {extinction.ozone.toFixed(
          3,
        )}</span
      >
    </dd>
    <dt>Reddening</dt>
    <dd>E(B−V) {dbv.toFixed(3)} per airmass</dd>
    <dt>Zenith sky</dt>
    <dd>
      {sky.mag.toFixed(2)} mag/arcsec²
      <span class="sub"
        >natural {share(sky.parts.base)} · twilight {share(sky.parts.twilight)} · Moon {share(
          sky.parts.moon,
        )}</span
      >
    </dd>
    <dt>Limiting mag</dt>
    <dd>{zenithLimit.toFixed(2)} at the zenith (naked eye)</dd>
    <dt>Refraction</dt>
    <dd>
      {pressure != null ? `${pressure.toFixed(0)} hPa` : 'pressure from elevation'},
      {temperature != null ? `${temperature.toFixed(1)} °C` : '15 °C'}
    </dd>
    <dt>Cursor</dt>
    <dd>
      {#if cursor}
        alt {cursor.alt.toFixed(1)}°, az {cursor.az.toFixed(1)}°
        {#if X != null}
          · airmass {X.toFixed(2)} · stars dimmed {(extinction.total * X).toFixed(2)} mag · limit
          {(limitMag - extinction.total * X).toFixed(1)}
        {:else}
          · below the horizon
        {/if}
      {:else}
        <span class="sub">point at the sky</span>
      {/if}
    </dd>
    <dt>Horizon</dt>
    <dd>
      {horizonSource}
      {#if onloadterrain}<button class="small" onclick={onloadterrain}>Load terrain anyway</button
        >{/if}
    </dd>
  </dl>
  <p class="note">
    Sky brightness assumes a natural 22.0 mag/arcsec² sky until the light-pollution map is added.
    Methods: Kasten &amp; Young airmass, Hansen &amp; Travis Rayleigh + CAMS aerosol, Krisciunas
    &amp; Schaefer moonlight, Schaefer twilight and limiting magnitude.
  </p>
</Card>

<style>
  .small {
    margin-top: 4px;
    min-height: 30px;
    font-size: 12px;
  }
  .sub {
    display: block;
    font-size: 12px;
    color: var(--muted);
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
  }
</style>
