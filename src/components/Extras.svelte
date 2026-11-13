<script lang="ts">
  import { onMount } from 'svelte';
  import Card from './Card.svelte';
  import type { Place } from '../lib/astro/sky';
  import { fmtTime } from '../lib/time/format';
  import {
    AURORA_MIN_LAT,
    kpSummary,
    kpWord,
    type AuroraSite,
    type KpPoint,
  } from '../lib/space/aurora';
  import type { Orbits } from '../lib/space/orbits';
  import { compass16, STATIONS, type Pass } from '../lib/space/passes';
  import type { PassJob, PassResult } from '../lib/space/passes.worker';
  import PassWorker from '../lib/space/passes.worker.ts?worker';

  interface Props {
    place: Place;
    tz: string | undefined;
    now: Date;
    aurora: AuroraSite | null;
    kp: KpPoint[] | null;
    orbits: Orbits | null;
    /** No orbit data can be had (no data Worker, or it failed with nothing cached). */
    orbitsMissing?: boolean;
  }
  let { place, tz, now, aurora, kp, orbits, orbitsMissing = false }: Props = $props();

  // ---- passes: recomputed in a worker when the site or orbit data change, and every 15 min
  let result = $state<PassResult | null>(null);
  let computing = $state(false);
  let worker: Worker | null = null;
  let jobId = 0;
  const slot = $derived(Math.floor(now.getTime() / 900_000));

  $effect(() => {
    const o = orbits;
    const site = { lat: place.lat, lon: place.lon, elevation: place.elevation };
    void slot;
    if (!o || (!o.stations.length && !o.bright.length)) return;
    try {
      worker ??= new PassWorker();
    } catch {
      return; // no workers: skip the pass list rather than block the page
    }
    const id = ++jobId;
    computing = true;
    worker.onmessage = (e: MessageEvent<PassResult>) => {
      if (e.data.id !== jobId) return;
      result = e.data;
      computing = false;
    };
    const job: PassJob = {
      id,
      stations: $state.snapshot(o.stations) as PassJob['stations'],
      bright: $state.snapshot(o.bright) as PassJob['bright'],
      site,
      now: Date.now(),
    };
    worker.postMessage(job);
  });
  onMount(() => () => worker?.terminate());

  const t = (ms: number) => fmtTime(ms, tz);
  const day = (ms: number) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(ms);
  const dir = (p: { az: number; alt: number }) => `${compass16(p.az)} ${Math.round(p.alt)}°`;
  const stationName = (p: Pass) => STATIONS[p.norad] ?? p.name;

  const nowMs = $derived(now.getTime());
  const stationPasses = $derived((result?.stations ?? []).filter((p) => p.set.t > nowMs));
  const visibleStation = $derived(stationPasses.filter((p) => p.visible).slice(0, 4));
  const nextAny = $derived(stationPasses.find((p) => !p.visible));
  const bright = $derived((result?.bright ?? []).filter((p) => p.set.t > nowMs).slice(0, 8));

  // ---- aurora
  const kpNow = $derived(kp ? kpSummary(kp, nowMs) : null);
  const highLat = $derived(Math.abs(place.lat) >= AURORA_MIN_LAT);
  const pole = $derived(place.lat >= 0 ? 'north' : 'south');
</script>

<section class="grid" aria-label="Aurora and satellite passes">
  <Card title="Aurora" tag="forecast" credit="NOAA SWPC OVATION and Kp (public domain)">
    {#if kpNow?.now}
      <p class="big">
        Kp {kpNow.now.kp.toFixed(1)} <span class="sub">{kpWord(kpNow.now.kp)} now</span>
      </p>
      {#if kpNow.max24}
        <p class="kv">
          <span
            >Next 24 h: up to Kp {kpNow.max24.kp.toFixed(1)} ({kpWord(kpNow.max24.kp)}) around
            {day(kpNow.max24.t)}
            {t(kpNow.max24.t)}</span
          >
        </p>
      {/if}
    {:else}
      <p class="muted">Loading the geomagnetic index…</p>
    {/if}

    {#if highLat}
      {#if aurora}
        <p class="kv">
          <span>Overhead: <strong>{aurora.overhead}%</strong></span>
          {#if aurora.best && aurora.best.chance > aurora.overhead}
            <span
              >In view: <strong>{aurora.best.chance}%</strong>, low in the
              {compass16(aurora.best.bearing)} (~{Math.round(aurora.best.elevation)}° up, {Math.round(
                aurora.best.distanceKm / 10,
              ) * 10} km away)</span
            >
          {:else if !aurora.best}
            <span>Nothing expected in view</span>
          {/if}
        </p>
        <p class="muted small">
          OVATION forecast for {t(aurora.forecast)}, 30–90 minutes ahead. Chance of aurora bright
          enough to see in a dark, clear sky; cameras pick up fainter displays.
        </p>
      {:else}
        <p class="muted">Loading the aurora forecast…</p>
      {/if}
    {:else}
      <p class="muted small">
        At {Math.abs(place.lat).toFixed(0)}° from the equator aurora is only seen in severe storms
        (about Kp 8 or more), low in the {pole}.
        {#if kpNow?.max24 && kpNow.max24.kp >= 7}
          <strong>A strong storm is forecast: watch the {pole}ern horizon after dark.</strong>
        {/if}
      </p>
    {/if}
  </Card>

  <Card
    title="ISS & satellite passes"
    tag="prediction"
    credit="Orbits: CelesTrak · SGP4: satellite.js"
  >
    {#if !orbits}
      <p class="muted">
        {orbitsMissing ? 'Orbit data is not available right now.' : 'Loading orbit data…'}
      </p>
    {:else if !result}
      <p class="muted">{computing ? 'Working out passes…' : 'No passes computed yet.'}</p>
    {:else}
      <h3>Space stations, next 3 days</h3>
      {#if visibleStation.length}
        <ul class="passes">
          {#each visibleStation as p (p.norad + ':' + p.rise.t)}
            <li>
              <strong>{stationName(p)}</strong>
              {day(p.visibleFrom?.t ?? p.rise.t)}
              {t(p.visibleFrom?.t ?? p.rise.t)}–{t(p.visibleTo?.t ?? p.set.t)}
              <span class="sub"
                >from {dir(p.visibleFrom ?? p.rise)}, highest {dir(p.peak)}, to {dir(
                  p.visibleTo ?? p.set,
                )}</span
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">
          No visible pass (sunlit station, dark sky, above 10°) in the next 3 days.
          {#if nextAny}Next pass overhead, unseen: {stationName(nextAny)}
            {day(nextAny.rise.t)}
            {t(nextAny.rise.t)}.{/if}
        </p>
      {/if}

      <h3>Bright satellites, next 24 h</h3>
      {#if bright.length}
        <ul class="passes">
          {#each bright as p (p.norad + ':' + p.rise.t)}
            <li>
              {p.name}
              <span class="sub"
                >{t(p.visibleFrom?.t ?? p.rise.t)}, highest {dir(p.peak)} at {t(p.peak.t)}</span
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">None passing above 30° in a dark sky.</p>
      {/if}
      <p class="muted small">
        Times are when the satellite is sunlit against a dark sky. Each pass can leave a streak
        across long exposures.
      </p>
    {/if}
  </Card>
</section>

<style>
  .grid {
    display: grid;
    gap: var(--gap);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  }
  .big {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 6px;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    margin: 0 0 6px;
  }
  .small {
    font-size: 12px;
  }
  .kv {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0 0 6px;
    font-size: 14px;
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    margin: 8px 0 4px;
  }
  .passes {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .passes .sub {
    display: block;
  }
</style>
