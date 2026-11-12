<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import { HOUR, tonight } from '../lib/astro/time';
  import { fmtDateTime, fromLocalInput, toLocalInput, zoneLabel } from '../lib/time/format';

  interface Props {
    place: Place;
    /** Time currently shown. */
    time: Date;
    /** True when following the real clock. */
    live: boolean;
    tz: string | undefined;
    onchange: (time: Date, live: boolean) => void;
  }
  let { place, time, live, tz, onchange }: Props = $props();

  const step = (h: number) => onchange(new Date(time.getTime() + h * HOUR), false);

  function onInput(e: Event) {
    const d = fromLocalInput((e.currentTarget as HTMLInputElement).value, tz);
    if (d) onchange(d, false);
  }
</script>

<div class="time" role="group" aria-label="Time controls">
  <button onclick={() => step(-1)} aria-label="One hour earlier">−1 h</button>
  <button onclick={() => onchange(new Date(), true)} aria-pressed={live} class:on={live}>Now</button
  >
  <button onclick={() => step(1)} aria-label="One hour later">+1 h</button>
  <button onclick={() => onchange(tonight(place, new Date()), false)}>Tonight</button>
  <label class="picker">
    <span class="visually-hidden">Date and time to show (site time)</span>
    <input type="datetime-local" value={toLocalInput(time, tz)} onchange={onInput} />
  </label>
  <span class="shown" aria-live="polite">
    {live ? 'Live' : fmtDateTime(time, tz)}
    {zoneLabel(time, tz)}
  </span>
</div>

<style>
  .time {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .on {
    border-color: var(--accent);
    color: var(--accent);
  }
  input {
    font: inherit;
    color: inherit;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 8px;
    min-height: 36px;
    color-scheme: dark;
  }
  .shown {
    font-size: 13px;
    color: var(--muted);
  }
</style>
