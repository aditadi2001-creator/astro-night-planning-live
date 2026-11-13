<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import type { ObjectInfo } from '../lib/engine/stel';
  import type { TwilightTimes } from '../lib/conditions';
  import {
    bodyFor,
    colourClass,
    distanceFromParallax,
    targetVisibility,
  } from '../lib/astro/target';
  import {
    frameFill,
    SETUP_LABELS,
    setupStats,
    type Setup,
    type SetupKind,
  } from '../lib/equipment';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    info: ObjectInfo;
    place: Place;
    time: Date;
    tw: TwilightTimes;
    tz: string | undefined;
    setups: Record<SetupKind, Setup>;
    onclose: () => void;
  }
  let { info, place, time, tw, tz, setups, onclose }: Props = $props();

  // Recompute at most once a minute of shown time.
  const minute = $derived(Math.floor(time.getTime() / 60_000));
  const vis = $derived.by(() => {
    void minute;
    return targetVisibility(
      {
        name: info.name,
        ra2000: info.ra2000,
        dec2000: info.dec2000,
        body: bodyFor([info.name, ...info.otherNames, ...info.ids]),
      },
      place,
      time,
      { start: tw.astroEnd ?? tw.nauticalEnd, end: tw.astroStart ?? tw.nauticalStart },
    );
  });
  const dist = $derived(distanceFromParallax(info.parallaxMas));
  const colour = $derived(info.model === 'star' ? colourClass(info.bv) : null);

  const hms = (deg: number) => {
    const h = (((deg / 15) % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    const ss = ((h - hh) * 60 - mm) * 60;
    return `${hh}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
  };
  const dms = (deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60);
    return `${deg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(s % 60).padStart(2, '0')}″`;
  };
  const size = (am: number) =>
    am >= 60
      ? `${(am / 60).toFixed(2)}°`
      : am >= 1
        ? `${am.toFixed(1)}′`
        : `${(am * 60).toFixed(1)}″`;
  const compass = (az: number) =>
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];
  const t = (d: Date | null) => (d ? fmtTime(d, tz) : '—');

  function fitText(k: SetupKind): string {
    if (info.sizeMajor == null) return '—';
    const fill = frameFill(info.sizeMajor, setupStats(setups[k]));
    const pct = Math.round(fill * 100);
    if (fill > 1)
      return `${pct}% of the short side: too big, needs a mosaic (~${Math.ceil(fill)}×${Math.ceil(fill)})`;
    if (fill > 0.6) return `${pct}% of the short side: fills the frame`;
    if (fill > 0.2) return `${pct}% of the short side: good framing`;
    return `${pct}% of the short side: small in this frame`;
  }
</script>

<section class="details" aria-labelledby="od-title">
  <header>
    <div>
      <h2 id="od-title">{info.name}</h2>
      {#if info.type}<p class="type">{info.type}</p>{/if}
    </div>
    <button onclick={onclose} aria-label="Close object details">×</button>
  </header>

  <div class="cols">
    <dl>
      <dt>Magnitude</dt>
      <dd>{info.vmag != null ? info.vmag.toFixed(2) : '—'}</dd>
      {#if info.sizeMajor != null}
        <dt>Apparent size</dt>
        <dd>
          {size(info.sizeMajor)}{info.sizeMinor != null &&
          Math.abs(info.sizeMinor - info.sizeMajor) > 0.05
            ? ` × ${size(info.sizeMinor)}`
            : ''}
        </dd>
      {/if}
      {#if dist}
        <dt>Distance</dt>
        <dd>
          {dist.ly < 1000 ? dist.ly.toFixed(1) : Math.round(dist.ly).toLocaleString()} light years ({dist.pc.toFixed(
            1,
          )} pc)
        </dd>
      {:else if info.distanceAu != null}
        <dt>Distance</dt>
        <dd>
          {info.distanceAu < 0.01
            ? `${Math.round(info.distanceAu * 149_597_871).toLocaleString()} km`
            : `${info.distanceAu.toFixed(3)} AU`}
        </dd>
      {/if}
      {#if colour}
        <dt>Colour</dt>
        <dd>
          B−V {info.bv?.toFixed(2)} · about {colour.tempK.toLocaleString()} K, class {colour.cls} (estimate)
        </dd>
      {/if}
      {#if info.phase != null}
        <dt>Illuminated</dt>
        <dd>{Math.round(info.phase * 100)}%</dd>
      {/if}
      <dt>RA / Dec (J2000)</dt>
      <dd>{hms(info.ra2000)} / {dms(info.dec2000)}</dd>
      <dt>RA / Dec (of date)</dt>
      <dd>{hms(info.ra)} / {dms(info.dec)}</dd>
    </dl>

    <dl>
      <dt>Now</dt>
      <dd>
        {vis.altNow.toFixed(1)}° high, {compass(vis.azNow)} ({vis.azNow.toFixed(1)}°){vis.airmassNow
          ? `, airmass ${vis.airmassNow.toFixed(2)}`
          : ' — below the horizon'}
      </dd>
      <dt>Rise / transit / set</dt>
      <dd>
        {#if vis.neverRises}Never rises here{:else if vis.circumpolar}Never sets (circumpolar),
          transits {t(vis.transit)}{:else}{t(vis.rise)} / {t(vis.transit)} / {t(vis.set)}{/if}
        {#if vis.transitAlt != null && !vis.neverRises}<span class="sub"
            >(highest {vis.transitAlt.toFixed(1)}°)</span
          >{/if}
      </dd>
      <dt>Tonight in darkness</dt>
      <dd>
        {#if vis.bestTonight && vis.bestTonight.alt > 0}
          highest {vis.bestTonight.alt.toFixed(1)}° at {t(vis.bestTonight.t)}; {vis.darkHoursAbove30}
          h above 30°
        {:else}
          not above the horizon during darkness
        {/if}
      </dd>
      {#if vis.moonSep != null}
        <dt>From the Moon</dt>
        <dd>
          {vis.moonSep.toFixed(1)}°{vis.moonSep < 30
            ? ' — close: moonlight will hurt contrast'
            : ''}
        </dd>
      {/if}
      {#if info.sizeMajor != null}
        {#each Object.keys(setups) as k (k)}
          <dt>{SETUP_LABELS[k as SetupKind]} frame</dt>
          <dd>{fitText(k as SetupKind)}</dd>
        {/each}
      {/if}
    </dl>
  </div>
  {#if info.otherNames.length || info.ids.length}
    <p class="aka">
      Also known as: {[...new Set([...info.otherNames, ...info.ids])]
        .filter((n) => n !== info.name)
        .slice(0, 10)
        .join(', ')}
    </p>
  {/if}
</section>

<style>
  .details {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .type {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .cols {
    display: grid;
    gap: 6px 24px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    margin-top: 8px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
  }
  .aka {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
