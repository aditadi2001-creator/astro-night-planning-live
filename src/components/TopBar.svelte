<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import LocationPicker from './LocationPicker.svelte';
  import { fmtTime, zoneLabel } from '../lib/time/format';

  interface Props {
    place: Place;
    now: Date;
    tz: string | undefined;
    night: boolean;
    onplace: (p: Place) => void;
  }
  let { place, now, tz, night = $bindable(), onplace }: Props = $props();

  let picking = $state(false);

  const fmtCoord = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;
</script>

<header>
  <div class="brand">
    <img src="/favicon.svg" alt="" width="28" height="28" />
    <h1>Astro Night Planning</h1>
  </div>

  <button
    class="loc"
    onclick={() => (picking = !picking)}
    aria-expanded={picking}
    aria-haspopup="dialog"
    title="Change location"
  >
    <span class="name">{place.name}{place.detail ? `, ${place.detail}` : ''} ▾</span>
    <span class="coords">
      {fmtCoord(place.lat, 'N', 'S')}, {fmtCoord(place.lon, 'E', 'W')} · {place.elevation} m
    </span>
  </button>

  <div class="actions">
    <time datetime={now.toISOString()} aria-label="Local time at the site">
      {fmtTime(now, tz, true)} <span class="zone">{zoneLabel(now, tz)}</span>
    </time>
    <button
      onclick={() => (night = !night)}
      aria-pressed={night}
      title="Dark red night-vision mode"
    >
      Night mode
    </button>
  </div>

  {#if picking}
    <LocationPicker {place} {onplace} onclose={() => (picking = false)} />
  {/if}
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 8px var(--gap);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .brand h1 {
    font-size: inherit;
    font-weight: inherit;
    margin: 0;
  }
  .loc {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    flex: 1 1 200px;
    background: transparent;
    border-color: transparent;
    text-align: left;
    padding: 4px 8px;
  }
  .loc:hover {
    border-color: var(--line);
  }
  .name {
    font-weight: 500;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coords {
    font-size: 12px;
    color: var(--muted);
    font-family: var(--mono);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  time {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .zone {
    font-size: 11px;
    color: var(--muted);
  }
  @media (max-width: 480px) {
    /* Small screens: the logo alone; the heading stays for screen readers. */
    .brand h1 {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  }
</style>
