<script lang="ts">
  import type { Place } from '../lib/astro/sky';
  import { HOUR, tonight } from '../lib/astro/time';

  interface Props {
    place: Place;
    /** Time currently shown. */
    time: Date;
    /** True when following the real clock. */
    live: boolean;
    onchange: (time: Date, live: boolean) => void;
  }
  let { place, time, live, onchange }: Props = $props();

  const step = (h: number) => onchange(new Date(time.getTime() + h * HOUR), false);

  const label = $derived(
    time.toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  function onInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) onchange(d, false);
  }

  // datetime-local wants local time without zone.
  const localValue = $derived.by(() => {
    const d = new Date(time.getTime() - time.getTimezoneOffset() * 60e3);
    return d.toISOString().slice(0, 16);
  });
</script>

<div class="time" role="group" aria-label="Time controls">
  <button onclick={() => step(-1)} aria-label="One hour earlier">−1 h</button>
  <button onclick={() => onchange(new Date(), true)} aria-pressed={live} class:on={live}>Now</button
  >
  <button onclick={() => step(1)} aria-label="One hour later">+1 h</button>
  <button onclick={() => onchange(tonight(place, new Date()), false)}>Tonight</button>
  <label class="picker">
    <span class="visually-hidden">Date and time to show</span>
    <input type="datetime-local" value={localValue} onchange={onInput} />
  </label>
  <span class="shown" aria-live="polite">{live ? 'Live' : label}</span>
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
