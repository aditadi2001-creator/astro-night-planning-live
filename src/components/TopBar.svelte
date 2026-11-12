<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import { locateMe } from '../lib/location';

  interface Props {
    place: Place;
    now: Date;
    night: boolean;
    onplace: (p: Place) => void;
  }
  let { place, now, night = $bindable(), onplace }: Props = $props();

  let busy = $state(false);
  let error = $state('');

  async function useMyLocation() {
    busy = true;
    error = '';
    try {
      onplace(await locateMe());
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtCoord = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;
</script>

<header>
  <div class="brand">
    <img src="/favicon.svg" alt="" width="28" height="28" />
    <span>Astro Night Planning</span>
  </div>

  <div class="loc">
    <span class="name">{place.name}</span>
    <span class="coords">
      {fmtCoord(place.lat, 'N', 'S')}, {fmtCoord(place.lon, 'E', 'W')} · {place.elevation} m
    </span>
  </div>

  <div class="actions">
    <time datetime={now.toISOString()} aria-label="Local time">{fmtTime(now)}</time>
    <button onclick={useMyLocation} disabled={busy} aria-busy={busy}>
      {busy ? 'Locating…' : 'Use my location'}
    </button>
    <button
      onclick={() => (night = !night)}
      aria-pressed={night}
      title="Dark red night-vision mode"
    >
      Night mode
    </button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 10px var(--gap);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .loc {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 200px;
  }
  .name {
    font-weight: 500;
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
    flex-wrap: wrap;
  }
  time {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .error {
    flex-basis: 100%;
    margin: 0;
    color: var(--bad);
    font-size: 13px;
  }
  @media (max-width: 480px) {
    .brand span {
      display: none;
    }
  }
</style>
