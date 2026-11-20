<script lang="ts" module>
  export interface TimeEvent {
    label: string;
    t: number;
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import { tonight } from '../lib/astro/time';
  import {
    fmtDateTime,
    fmtTime,
    fromLocalInput,
    toLocalInput,
    zoneLabel,
  } from '../lib/time/format';

  interface Props {
    place: Place;
    /** Time currently shown. */
    time: Date;
    /** True when following the real clock. */
    live: boolean;
    tz: string | undefined;
    /** Night milestones (sunset, twilights, Moon…) for the slider and jump buttons. */
    events?: TimeEvent[];
    onchange: (time: Date, live: boolean) => void;
  }
  let { place, time, live, tz, events = [], onchange }: Props = $props();

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const step = (ms: number) => onchange(new Date(time.getTime() + ms), false);
  /** Calendar steps (same clock time): months and years for trip planning. */
  function shiftMonths(n: number) {
    const t = new Date(time.getTime());
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth() + n;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const ms = t.getTime() - Date.UTC(y, t.getUTCMonth(), t.getUTCDate());
    onchange(new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), last)) + ms), false);
  }

  function onInput(e: Event) {
    const d = fromLocalInput((e.currentTarget as HTMLInputElement).value, tz);
    if (d) onchange(d, false);
  }

  // ---- slider across the night: an hour before the first event to an hour after the last
  const sorted = $derived(
    [...events].filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t),
  );
  const range = $derived.by(() => {
    if (sorted.length >= 2) {
      return { from: (sorted[0]?.t ?? 0) - HOUR, to: (sorted[sorted.length - 1]?.t ?? 0) + HOUR };
    }
    const t = time.getTime();
    return { from: t - 12 * HOUR, to: t + 12 * HOUR };
  });
  const inRange = $derived(time.getTime() >= range.from && time.getTime() <= range.to);
  const pos = (t: number) => ((t - range.from) / (range.to - range.from)) * 100;

  function onSlide(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    onchange(new Date(range.from + v * MIN), false);
  }

  // ---- play: advance the shown time at a chosen speed
  const SPEEDS = [
    { v: 1, label: 'real time' },
    { v: 60, label: '1 min/s' },
    { v: 600, label: '10 min/s' },
    { v: 3600, label: '1 h/s' },
  ];
  let speed = $state(600);
  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0;
  let cur = 0;

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    playing = false;
  }
  function play() {
    if (playing) return stop();
    playing = true;
    cur = time.getTime();
    last = performance.now();
    timer = setInterval(() => {
      const n = performance.now();
      cur += (n - last) * speed;
      last = n;
      onchange(new Date(cur), false);
    }, 200);
  }
  // Any other change of time (buttons, picker, live) takes over from playback.
  $effect(() => {
    const t = time.getTime();
    if (playing && Math.abs(t - cur) > 2000 * speed) stop();
  });
  onDestroy(stop);
</script>

<div class="time" role="group" aria-label="Time controls">
  <div class="row">
    <button onclick={() => step(-DAY)} title="One day earlier"
      >−1 d<span class="visually-hidden"> (one day earlier)</span></button
    >
    <button onclick={() => step(-HOUR)} title="One hour earlier"
      >−1 h<span class="visually-hidden"> (one hour earlier)</span></button
    >
    <button onclick={() => step(-10 * MIN)} title="Ten minutes earlier"
      >−10 m<span class="visually-hidden"> (ten minutes earlier)</span></button
    >
    <button onclick={() => step(-MIN)} title="One minute earlier"
      >−1 m<span class="visually-hidden"> (one minute earlier)</span></button
    >
    <button
      onclick={() => {
        stop();
        onchange(new Date(), true);
      }}
      aria-pressed={live}
      class:on={live}>Now</button
    >
    <button onclick={() => step(MIN)} title="One minute later"
      >+1 m<span class="visually-hidden"> (one minute later)</span></button
    >
    <button onclick={() => step(10 * MIN)} title="Ten minutes later"
      >+10 m<span class="visually-hidden"> (ten minutes later)</span></button
    >
    <button onclick={() => step(HOUR)} title="One hour later"
      >+1 h<span class="visually-hidden"> (one hour later)</span></button
    >
    <button onclick={() => step(DAY)} title="One day later"
      >+1 d<span class="visually-hidden"> (one day later)</span></button
    >
  </div>

  <div class="row" role="group" aria-label="Jump by weeks, months and years">
    <button onclick={() => shiftMonths(-12)} title="One year earlier">−1 yr</button>
    <button onclick={() => shiftMonths(-1)} title="One month earlier">−1 mo</button>
    <button onclick={() => step(-7 * DAY)} title="One week earlier">−7 d</button>
    <button onclick={() => step(7 * DAY)} title="One week later">+7 d</button>
    <button onclick={() => shiftMonths(1)} title="One month later">+1 mo</button>
    <button onclick={() => shiftMonths(12)} title="One year later">+1 yr</button>
  </div>

  <div class="row">
    <label class="picker">
      <span class="visually-hidden">Date and time to show (site time)</span>
      <input type="datetime-local" value={toLocalInput(time, tz)} onchange={onInput} />
    </label>
    <button onclick={play} aria-pressed={playing} class:on={playing}>
      {playing ? 'Pause' : 'Play'}
    </button>
    <label class="speed">
      <span class="visually-hidden">Playback speed</span>
      <select bind:value={speed}>
        {#each SPEEDS as s (s.v)}<option value={s.v}>{s.label}</option>{/each}
      </select>
    </label>
    <button onclick={() => onchange(tonight(place, new Date()), false)}>Tonight</button>
    <span class="shown" aria-live="polite">
      {live ? 'Live' : fmtDateTime(time, tz)}
      {zoneLabel(time, tz)}
    </span>
  </div>

  {#if sorted.length >= 2}
    <div class="night">
      <input
        class="slider"
        type="range"
        min="0"
        max={Math.round((range.to - range.from) / MIN)}
        step="1"
        value={inRange ? Math.round((time.getTime() - range.from) / MIN) : 0}
        oninput={onSlide}
        aria-label="Scrub through the night"
        aria-valuetext={fmtDateTime(time, tz)}
      />
      <div class="ticks" aria-hidden="true">
        {#each sorted as e (e.label + e.t)}
          <span class="tick" style:left={`${pos(e.t)}%`} title={`${e.label} ${fmtTime(e.t, tz)}`}
          ></span>
        {/each}
      </div>
      <div class="jumps" role="group" aria-label="Jump to an event">
        {#each sorted as e (e.label + e.t)}
          <button class="jump" onclick={() => onchange(new Date(e.t), false)}>
            {e.label} <span>{fmtTime(e.t, tz)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .time {
    display: grid;
    gap: 6px;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .row button {
    min-width: 44px;
    padding: 6px 10px;
  }
  .on {
    border-color: var(--accent);
    color: var(--accent);
  }
  input[type='datetime-local'],
  select {
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
  .night {
    position: relative;
  }
  .slider {
    width: 100%;
    accent-color: var(--accent);
    min-height: 28px;
    margin: 0;
  }
  .ticks {
    position: relative;
    height: 6px;
    margin: -4px 8px 2px;
  }
  .tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 6px;
    background: var(--muted);
  }
  .jumps {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .jump {
    flex: none;
    font-size: 12px;
    min-height: 30px;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .jump span {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
