<script lang="ts">
  /**
   * The Sky page's timeline, always on screen: go back or forward by any number of hours, days,
   * months, years, decades or centuries and watch the sky move. Pick a step size, then step,
   * play (one step per second, either way), drag the scrubber (finer near the middle) or type a
   * date. "Now" returns to the live sky.
   */
  import { addUnits, describeOffset, UNIT_LABEL, UNIT_MS, type TimeUnit } from '../lib/time/shift';
  import { fromLocalInput, toLocalInput, zoneLabel } from '../lib/time/format';

  interface Props {
    time: Date;
    live: boolean;
    /** Clock rate while not live (time multiplier; 0 = stopped). */
    rate: number;
    tz: string | undefined;
    onchange: (t: Date, live: boolean) => void;
    onrate: (r: number) => void;
  }
  let { time, live, rate, tz, onchange, onrate }: Props = $props();

  const UNITS: TimeUnit[] = ['minute', 'hour', 'day', 'week', 'month', 'year', 'decade', 'century'];
  const KEY = 'anp.timeline.unit';
  let unit = $state<TimeUnit>(
    (() => {
      try {
        const v = localStorage.getItem(KEY) as TimeUnit | null;
        return v && UNITS.includes(v) ? v : 'day';
      } catch {
        return 'day';
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem(KEY, unit);
    } catch {
      /* not remembered */
    }
  });

  const step = (n: number) => onchange(addUnits(time, unit, n), false);
  /** Playing: one step per second, forwards or backwards. */
  const playRate = $derived(UNIT_MS[unit] / 1000);
  const playing = $derived(!live && rate !== 0);
  function play(dir: 1 | -1) {
    if (playing && Math.sign(rate) === dir) onrate(0);
    else onrate(dir * playRate);
  }
  // A new step size while playing: keep playing at the new speed.
  $effect(() => {
    void unit;
    if (playing) onrate(Math.sign(rate) * playRate);
  });

  // ---- scrubber: ±50 steps, quadratic so small moves are fine-grained ---------------------
  const SPAN = 50;
  let scrub = $state(0);
  let anchor: Date | null = null;
  function onScrub(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    scrub = v;
    anchor ??= time;
    const n = Math.sign(v) * (v / 100) ** 2 * SPAN;
    onchange(addUnits(anchor, unit, n), false);
  }
  function endScrub() {
    anchor = null;
    scrub = 0;
  }
  const scrubText = $derived(
    scrub === 0 ? '' : describeOffset(Math.sign(scrub) * (scrub / 100) ** 2 * SPAN * UNIT_MS[unit]),
  );

  const dateText = $derived(
    time.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    }),
  );
  let editing = $state(false);
  function onDate(e: Event) {
    const d = fromLocalInput((e.currentTarget as HTMLInputElement).value, tz);
    if (d) onchange(d, false);
  }
  const unitWord = $derived(UNIT_LABEL[unit][0]);
</script>

<div class="tl" role="group" aria-label="Timeline: move the sky's time">
  <div class="row">
    <label class="unit"
      ><span class="visually-hidden">Step size</span>
      <select bind:value={unit} title="Step size">
        {#each UNITS as u (u)}<option value={u}>1 {UNIT_LABEL[u][0]}</option>{/each}
      </select></label
    >
    <button
      onclick={() => play(-1)}
      aria-pressed={playing && rate < 0}
      title={`Play backwards, one ${unitWord} per second`}
      >◀◀<span class="visually-hidden"> play backwards</span></button
    >
    <button onclick={() => step(-1)} title={`One ${unitWord} earlier`}
      >−1<span class="visually-hidden"> {unitWord} earlier</span></button
    >
    {#if editing}
      <input
        class="date"
        type="datetime-local"
        value={toLocalInput(time, tz)}
        onchange={onDate}
        onblur={() => (editing = false)}
        aria-label="Date and time to show (site time)"
      />
    {:else}
      <button class="date" onclick={() => (editing = true)} title="Type a date and time">
        <span class:live>{live ? 'Live · ' : ''}{dateText}</span>
        <small>{zoneLabel(time, tz)}</small>
      </button>
    {/if}
    <button onclick={() => step(1)} title={`One ${unitWord} later`}
      >+1<span class="visually-hidden"> {unitWord} later</span></button
    >
    <button
      onclick={() => play(1)}
      aria-pressed={playing && rate > 0}
      title={`Play forwards, one ${unitWord} per second`}
      >▶▶<span class="visually-hidden"> play forwards</span></button
    >
    {#if playing}<button onclick={() => onrate(0)} title="Pause"
        >❚❚<span class="visually-hidden"> pause</span></button
      >{/if}
    <button class="now" onclick={() => onchange(new Date(), true)} aria-pressed={live}>Now</button>
  </div>
  <div class="row scrubrow">
    <span class="end" aria-hidden="true">−{SPAN} {UNIT_LABEL[unit][1]}</span>
    <input
      class="scrub"
      type="range"
      min="-100"
      max="100"
      step="1"
      value={scrub}
      oninput={onScrub}
      onchange={endScrub}
      onpointerup={endScrub}
      aria-label={`Scrub the time up to ${SPAN} ${UNIT_LABEL[unit][1]} either way`}
      aria-valuetext={scrubText || 'no change'}
    />
    <span class="end" aria-hidden="true">+{SPAN} {UNIT_LABEL[unit][1]}</span>
    {#if scrubText}<output class="off">{scrubText}</output>{/if}
  </div>
</div>

<style>
  .tl {
    position: absolute;
    left: 50%;
    bottom: var(--tl-bottom, 30px);
    transform: translateX(-50%);
    z-index: 6;
    width: min(720px, calc(100% - 84px));
    display: grid;
    gap: 2px;
    padding: 4px 6px;
    background: color-mix(in srgb, var(--ink-1) 86%, transparent);
    border: 1px solid var(--rule);
    border-radius: 12px;
    backdrop-filter: blur(6px);
    font-size: var(--fs-12);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  button {
    min-height: 34px;
    min-width: 34px;
    padding: 2px 6px;
    font-size: var(--fs-12);
  }
  button[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  .date {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    justify-items: center;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }
  .date span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-14);
  }
  .date .live {
    color: var(--go);
  }
  .date small {
    color: var(--text-2);
    font-size: 10px;
  }
  input.date {
    font: inherit;
    color: var(--text);
    background: var(--ink-0);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
    padding: 4px;
  }
  select {
    font: inherit;
    font-size: var(--fs-12);
    color: var(--text);
    background: var(--ink-0);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
    padding: 4px;
    min-height: 34px;
  }
  .scrubrow {
    position: relative;
  }
  .scrub {
    flex: 1 1 auto;
    min-width: 0;
    accent-color: var(--brass);
    filter: var(--media-filter);
  }
  .end {
    color: var(--text-2);
    font-size: 10px;
    white-space: nowrap;
  }
  .off {
    position: absolute;
    left: 50%;
    top: -18px;
    transform: translateX(-50%);
    padding: 0 6px;
    border-radius: 6px;
    background: var(--ink-1);
    color: var(--brass);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 599px) {
    .tl {
      width: calc(100% - 66px);
      left: 62px;
      transform: none;
      padding: 3px 4px;
    }
    .end {
      display: none;
    }
    button {
      min-width: 30px;
      padding: 2px 4px;
    }
    /* The date gets its own line; the buttons share the next one. */
    .row:first-child {
      flex-wrap: wrap;
    }
    .date {
      order: -1;
      flex-basis: 100%;
      min-height: 30px;
    }
    .unit {
      flex: 1 1 auto;
    }
    .unit select {
      width: 100%;
    }
  }
</style>
