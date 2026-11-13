<script lang="ts">
  /** Stellarium-style information block for the selected object, over the top-left of the sky. */
  import type { Place } from '../lib/astro/sky';
  import type { ObjectInfo } from '../lib/engine/stel';
  import { bodyFor, distanceFromParallax, targetVisibility } from '../lib/astro/target';
  import { airmassKastenYoung } from '../lib/physics/airmass';
  import {
    constellationOf,
    fmtDMS,
    fmtHours,
    fmtRA,
    galactic,
    hourAngle,
  } from '../lib/astro/skycoords';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    info: ObjectInfo;
    place: Place;
    time: Date;
    tz: string | undefined;
    onclose: () => void;
    ongoto: () => void;
  }
  let { info, place, time, tz, onclose, ongoto }: Props = $props();

  let more = $state(
    typeof matchMedia === 'function' ? !matchMedia('(max-width: 600px)').matches : true,
  );

  // Rise/transit/set change slowly: recompute once a minute of shown time.
  const minute = $derived(Math.floor(time.getTime() / 60_000));
  const vis = $derived.by(() => {
    void minute;
    try {
      return targetVisibility(
        {
          name: info.name,
          ra2000: info.ra2000,
          dec2000: info.dec2000,
          body: bodyFor([info.name, ...info.otherNames, ...info.ids]),
        },
        place,
        time,
        { start: null, end: null },
      );
    } catch {
      return null;
    }
  });
  const gal = $derived(galactic(info.ra2000, info.dec2000));
  const con = $derived(constellationOf(info.ra2000, info.dec2000));
  const ha = $derived(hourAngle(time, place.lon, info.ra));
  const airmass = $derived(info.alt > 0 ? airmassKastenYoung(info.alt) : null);
  const dist = $derived(distanceFromParallax(info.parallaxMas));
  const size = (am: number) =>
    am >= 60
      ? `${(am / 60).toFixed(2)}°`
      : am >= 1
        ? `${am.toFixed(1)}′`
        : `${(am * 60).toFixed(1)}″`;
  const t = (d: Date | null | undefined) => (d ? fmtTime(d, tz) : '—');
  const deg = (v: number, d = 2) => `${v.toFixed(d)}°`;
</script>

<div class="sinfo" aria-live="polite">
  <header>
    <div class="ttl">
      <h2 id="sinfo-name">{info.name}</h2>
      {#if info.type}<p class="type">{info.type}</p>{/if}
    </div>
    <button onclick={ongoto} title="Centre and track (space bar)">Go to</button>
    <button onclick={onclose} aria-label="Clear the selection">×</button>
  </header>
  <dl>
    {#if info.vmag != null}<dt>Magnitude</dt>
      <dd>{info.vmag.toFixed(2)}</dd>{/if}
    <dt>Az / Alt</dt>
    <dd>{deg(info.az)} / {deg(info.alt)}{info.alt < 0 ? ' (below horizon)' : ''}</dd>
    {#if more}
      <dt>RA/Dec J2000</dt>
      <dd>{fmtRA(info.ra2000)} / {fmtDMS(info.dec2000)}</dd>
      <dt>RA/Dec of date</dt>
      <dd>{fmtRA(info.ra)} / {fmtDMS(info.dec)}</dd>
      <dt>Hour angle</dt>
      <dd>{fmtHours(ha, true)} / {fmtDMS(info.dec)}</dd>
      <dt>Galactic</dt>
      <dd>l {deg(gal.l)} / b {deg(gal.b)}</dd>
      <dt>Constellation</dt>
      <dd>{con.name} ({con.abbr})</dd>
      {#if dist}
        <dt>Distance</dt>
        <dd>
          {dist.ly < 1000 ? dist.ly.toFixed(1) : Math.round(dist.ly).toLocaleString()} ly
        </dd>
      {:else if info.distanceAu != null}
        <dt>Distance</dt>
        <dd>
          {info.distanceAu < 0.01
            ? `${Math.round(info.distanceAu * 149_597_871).toLocaleString()} km`
            : `${info.distanceAu.toFixed(3)} AU`}
        </dd>
      {/if}
      {#if info.sizeMajor != null}
        <dt>Size</dt>
        <dd>
          {size(info.sizeMajor)}{info.sizeMinor != null &&
          Math.abs(info.sizeMinor - info.sizeMajor) > 0.05
            ? ` × ${size(info.sizeMinor)}`
            : ''}
        </dd>
      {/if}
      {#if vis}
        <dt>Rise/Transit/Set</dt>
        <dd>
          {#if vis.neverRises}never rises{:else if vis.circumpolar}circumpolar · transit {t(
              vis.transit,
            )}{:else}{t(vis.rise)} / {t(vis.transit)} / {t(vis.set)}{/if}
        </dd>
      {/if}
      <dt>Airmass</dt>
      <dd>{airmass != null ? airmass.toFixed(2) : '—'}</dd>
    {/if}
  </dl>
  <button class="more" aria-expanded={more} onclick={() => (more = !more)}
    >{more ? 'Less' : 'More'}</button
  >
</div>

<style>
  .sinfo {
    width: min(330px, calc(100vw - 32px));
    padding: 8px 10px;
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    backdrop-filter: blur(6px);
    font-size: 12px;
    pointer-events: auto;
  }
  header {
    display: flex;
    align-items: start;
    gap: 6px;
  }
  .ttl {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .type {
    margin: 1px 0 0;
    color: var(--accent);
  }
  header button,
  .more {
    font-size: 12px;
    min-height: 28px;
    padding: 2px 8px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 6px 0 0;
    font-variant-numeric: tabular-nums;
  }
  dt {
    color: var(--muted);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .more {
    margin-top: 6px;
    background: transparent;
  }
</style>
