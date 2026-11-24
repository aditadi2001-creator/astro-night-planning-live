<script lang="ts">
  /**
   * Ratings section: every condition rated 0–100 for the shown hour, each with what went
   * in and the calculation; the imaging score as the product of its five factors; tonight
   * hour by hour; the rule behind every rating; and sliders to try each rule yourself.
   * Picking an hour (strip or table) moves the whole site to that hour, like the Tonight timeline.
   */
  import { tick, untrack } from 'svelte';
  import type { ScoreParts } from '../lib/physics/score';
  import { band, RULES, type RateInput, type Rating, type RatingId } from '../lib/ratings';
  import { SIMS, simStart, type Values } from '../lib/ratingsim';
  import { fmtHour } from '../lib/time/format';

  interface Props {
    ratings: Rating[];
    /** The existing hourly imaging score, 0–100. */
    score: number | null;
    /** "100 × 0.76 × … = 53" for the shown hour. */
    scoreMath: string | null;
    hours: { t: number; ratings: Rating[]; score: number | null }[];
    tz: string | undefined;
    /** "now" or the shown date and time. */
    when: string;
    /** What the shown hour was rated from (start values for the sliders). */
    input: RateInput;
    /** The imaging score's five factors for the shown hour. */
    parts: ScoreParts | null;
    /** Start of the shown hour (ms); null while live. */
    selected: number | null;
    live: boolean;
    /** Move the site to this hour / back to now. */
    onpick: (t: number) => void;
    onnow: () => void;
  }
  let {
    ratings,
    score,
    scoreMath,
    hours,
    tz,
    when,
    input,
    parts,
    selected,
    live,
    onpick,
    onnow,
  }: Props = $props();

  // ---- try it yourself ----
  let simId = $state<RatingId>('clouds');
  let simVals = $state<Values>({});
  let simEl = $state<HTMLElement | null>(null);
  /** Start values from the shown hour; refilled when another rating or hour is picked. */
  function resetSim() {
    simVals = simStart(
      simId,
      untrack(() => input),
    );
  }
  $effect(() => {
    void simId;
    void selected;
    untrack(resetSim);
  });
  const sim = $derived(SIMS[simId].run(simVals));
  const simBand = $derived(band(sim.value));
  const simReal = $derived(ratings.find((r) => r.id === simId)?.value ?? null);
  const simInScore = $derived(RULES[simId] && ratings.find((r) => r.id === simId)?.inScore);
  /** The imaging score with this one factor swapped for the slider result. */
  const whatIf = $derived.by(() => {
    if (!parts || !simInScore) return null;
    const p: Record<string, number> = { ...parts, [simId]: sim.factor };
    return Math.round(
      100 *
        (p.clouds ?? 0) *
        (p.transparency ?? 0) *
        (p.moon ?? 0) *
        (p.darkness ?? 0) *
        (p.seeing ?? 0),
    );
  });
  async function tryIt(id: RatingId) {
    simId = id;
    await tick();
    simEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    simEl?.focus({ preventScroll: true });
  }
  const fmtVal = (v: number, step: number) =>
    step < 0.1 ? v.toFixed(2) : step < 1 ? v.toFixed(1) : Math.round(v).toString();

  const inScore = $derived(ratings.filter((r) => r.inScore));
  const guides = $derived(ratings.filter((r) => !r.inScore));
  const ORDER = Object.keys(RULES) as RatingId[];
  const SHORT: Record<RatingId, string> = {
    clouds: 'Clouds',
    transparency: 'Transp.',
    moon: 'Moon',
    darkness: 'Dark',
    seeing: 'Seeing',
    rain: 'Rain',
    wind: 'Wind',
    dew: 'Dew',
    skydark: 'Sky',
    air: 'Air',
    confidence: 'Conf.',
  };
  const sb = $derived(band(score));
</script>

{#snippet card(r: Rating)}
  {@const b = band(r.value)}
  <li class="card">
    <div class="top">
      <h3>{r.label}</h3>
      <p class="val {b.cls}">
        <span class="num">{r.value ?? '—'}</span><span class="of">/100</span>
      </p>
    </div>
    <span
      class="meter"
      role="meter"
      aria-label={`${r.label} rating`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={r.value ?? 0}
      aria-valuetext={r.value == null ? 'no data' : `${r.value} out of 100, ${b.word}`}
      ><span class={b.cls} style:width={`${r.value ?? 0}%`}></span></span
    >
    <p class="inputs">{r.inputs}</p>
    {#if r.math !== '—'}<p class="math">{r.math}</p>{/if}
    <details>
      <summary>How it's rated</summary>
      <p>{RULES[r.id].rule}</p>
      <p class="math">{RULES[r.id].formula}</p>
    </details>
    <button type="button" class="try" onclick={() => tryIt(r.id)}>
      Try it with sliders<span class="visually-hidden">: {r.label}</span>
    </button>
  </li>
{/snippet}

<div class="ratings">
  <div class="overall">
    <div>
      <h3>Imaging score for {when}</h3>
      <p class="val big {sb.cls}">
        <span class="num">{score ?? '—'}</span><span class="of">/100</span>
        <span class="word">{sb.word}</span>
      </p>
    </div>
    <div class="explain">
      <p>
        The same hourly score the rest of the site shows. It multiplies the five ratings marked “in
        the score”, each as a fraction of 1, because each one scales the signal-to-noise of a long
        exposure. One bad factor sinks the hour: clouds at 0 make the score 0 whatever the rest.
      </p>
      {#if scoreMath}
        <p class="math">
          Clouds × transparency × moonlight × darkness × seeing<br />{scoreMath}
        </p>
      {/if}
    </div>
  </div>

  {#if hours.length}
    <div class="strip" role="group" aria-label="Rate another hour">
      <span class="strip-label">Rate another hour:</span>
      <button type="button" class="hr now" aria-pressed={live} onclick={onnow}>Now</button>
      {#each hours as h (h.t)}
        {@const b = band(h.score)}
        <button
          type="button"
          class="hr"
          aria-pressed={!live && selected === h.t}
          aria-label={`${fmtHour(h.t, tz)}, imaging score ${h.score ?? 'unknown'}`}
          onclick={() => onpick(h.t)}
          ><span class="hr-t">{fmtHour(h.t, tz)}</span><span class="pill {b.cls}"
            >{h.score ?? '—'}</span
          ></button
        >
      {/each}
    </div>
  {/if}

  <h3 class="group">In the imaging score</h3>
  <ul class="grid">
    {#each inScore as r (r.id)}{@render card(r)}{/each}
  </ul>

  <h3 class="group">Also rated (planning guides, not in the score)</h3>
  <ul class="grid">
    {#each guides as r (r.id)}{@render card(r)}{/each}
  </ul>

  {#if hours.length}
    <h3 class="group">Tonight hour by hour</h3>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Tonight's ratings by hour" tabindex="0">
      <table>
        <caption class="visually-hidden">
          Every rating out of 100 for each hour of tonight, and the imaging score. Choose an hour to
          rate it above.
        </caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Score</th>
            {#each ORDER as id (id)}<th scope="col" title={RULES[id].label}>{SHORT[id]}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each hours as h (h.t)}
            <tr class:picked={!live && selected === h.t}>
              <th scope="row">
                <button
                  type="button"
                  class="rowpick"
                  aria-pressed={!live && selected === h.t}
                  title="Rate this hour"
                  onclick={() => onpick(h.t)}>{fmtHour(h.t, tz)}</button
                >
              </th>
              <td><span class="pill {band(h.score).cls}">{h.score ?? '—'}</span></td>
              {#each ORDER as id (id)}
                {@const v = h.ratings.find((r) => r.id === id)?.value ?? null}
                <td><span class="pill {band(v).cls}">{v ?? '—'}</span></td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <section class="sim" aria-labelledby="sim-h" bind:this={simEl} tabindex="-1">
    <h3 id="sim-h">Try it yourself</h3>
    <p class="sim-lede">
      Pick a rating and move the sliders to see how its number is made. They start at the values for
      {when}.
    </p>
    <div class="sim-pick" role="group" aria-label="Rating to try">
      {#each Object.keys(RULES) as RatingId[] as id (id)}
        <button type="button" class="hr" aria-pressed={simId === id} onclick={() => (simId = id)}
          >{RULES[id].label}</button
        >
      {/each}
    </div>
    <div class="sim-body">
      <div class="sliders">
        {#each SIMS[simId].sliders as sl (sl.key)}
          <label class="slider">
            <span class="sl-top">
              <span>{sl.label}</span>
              <output>{fmtVal(simVals[sl.key] ?? sl.min, sl.step)} {sl.unit}</output>
            </span>
            <input
              type="range"
              min={sl.min}
              max={sl.max}
              step={sl.step}
              value={simVals[sl.key] ?? sl.min}
              oninput={(e) =>
                (simVals = {
                  ...simVals,
                  [sl.key]: Number((e.currentTarget as HTMLInputElement).value),
                })}
            />
          </label>
        {/each}
        <button type="button" class="reset" onclick={resetSim}>Reset to {when}</button>
      </div>
      <div class="sim-out" aria-live="polite">
        <p class="val big {simBand.cls}">
          <span class="num">{sim.value}</span><span class="of">/100</span>
          <span class="word">{simBand.word}</span>
        </p>
        <p class="math">{sim.math}</p>
        <p class="muted">
          {RULES[simId].label} for {when}: {simReal ?? '—'}/100.
          {#if simInScore}
            {#if whatIf != null}
              With this change the imaging score would be <strong>{whatIf}</strong> (it is {score ??
                '—'}).
            {/if}
          {:else}
            Not part of the imaging score, so it does not change it.
          {/if}
        </p>
      </div>
    </div>
  </section>

  <p class="legend">
    <span class="pill great">80–100</span> great · <span class="pill ok">55–79</span> good ·
    <span class="pill meh">30–54</span> poor · <span class="pill bad">0–29</span> bad. Every rating is
    100 for ideal imaging conditions. The extra guides (rain, wind, dew, sky darkness, air quality, confidence)
    are simple straight-line rules of thumb, not physics; they help you decide whether to go out but leave
    the imaging score unchanged.
  </p>
</div>

<style>
  .strip,
  .sim-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s1) var(--s2);
  }
  .strip-label {
    color: var(--text-2);
    font-size: var(--fs-14);
    margin-right: var(--s1);
  }
  .hr {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-height: 36px;
    padding: 0 var(--s2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--ink-1);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-14);
    cursor: pointer;
  }
  .hr:hover {
    color: var(--text);
    border-color: var(--ui-line);
  }
  .hr[aria-pressed='true'] {
    color: var(--text);
    border-color: var(--brass);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .hr .pill {
    min-width: 2em;
    padding: 0 4px;
    font-size: var(--fs-12);
  }
  .try {
    justify-self: start;
    min-height: 32px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--brass);
    font: inherit;
    font-size: var(--fs-14);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  button.rowpick {
    min-height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--brass);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  tr.picked th,
  tr.picked td {
    background: var(--ink-2);
  }
  .sim {
    margin-top: var(--s3);
    background: var(--ink-1);
    border: 1px solid var(--brass);
    border-radius: var(--r-section);
    padding: var(--s4);
    display: grid;
    gap: var(--s3);
    scroll-margin-top: calc(var(--head-h, 110px) + 64px);
  }
  .sim:focus {
    outline: none;
  }
  .sim-lede,
  .muted {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-14);
  }
  .sim-body {
    display: grid;
    gap: var(--s4) var(--s6);
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 720px) {
    .sim-body {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    }
  }
  .sliders {
    display: grid;
    gap: var(--s3);
    align-content: start;
  }
  .slider {
    display: grid;
    gap: var(--s1);
    font-size: var(--fs-14);
  }
  .sl-top {
    display: flex;
    justify-content: space-between;
    gap: var(--s2);
  }
  .sl-top output {
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-weight: 600;
  }
  .slider input {
    width: 100%;
    min-height: 32px;
    accent-color: var(--brass);
  }
  .reset {
    justify-self: start;
    min-height: 36px;
    padding: 0 var(--s3);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-14);
    cursor: pointer;
  }
  .sim-out {
    display: grid;
    gap: var(--s2);
    align-content: start;
  }
  .ratings {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-16);
  }
  h3.group {
    margin-top: var(--s3);
    font-size: var(--fs-14);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-2);
  }
  .overall {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s3) var(--s5);
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    padding: var(--s4);
  }
  @media (min-width: 720px) {
    .overall {
      grid-template-columns: minmax(180px, auto) minmax(0, 1fr);
    }
  }
  .explain p {
    margin: 0 0 var(--s2);
    color: var(--text-2);
    max-width: var(--measure);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s3);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
  }
  .card {
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    padding: var(--s3) var(--s4);
    min-width: 0;
    display: grid;
    gap: var(--s2);
    align-content: start;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--s2);
  }
  .val {
    margin: 0;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .num {
    font-size: var(--fs-24);
    font-weight: 700;
  }
  .big .num {
    font-size: var(--fs-36);
  }
  .of {
    color: var(--text-2);
    font-size: var(--fs-14);
    margin-left: 2px;
  }
  .word {
    margin-left: var(--s2);
    color: var(--text-2);
  }
  .val.great .num {
    color: var(--go);
  }
  .val.ok .num {
    color: var(--brass);
  }
  .val.meh .num {
    color: var(--chart-warm);
  }
  .val.bad .num {
    color: var(--nogo);
  }
  .meter {
    display: block;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--ink-2);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--text-2);
  }
  .meter .great {
    background: var(--go);
  }
  .meter .ok {
    background: var(--brass);
  }
  .meter .meh {
    background: var(--chart-warm);
  }
  .meter .bad {
    background: var(--nogo);
  }
  .inputs {
    margin: 0;
    font-size: var(--fs-14);
  }
  .math {
    margin: 0;
    font-size: var(--fs-12);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    background: var(--ink-2);
    border-radius: var(--r-input);
    padding: var(--s1) var(--s2);
    overflow-wrap: anywhere;
  }
  details > summary {
    cursor: pointer;
    min-height: 32px;
    display: flex;
    align-items: center;
    color: var(--brass);
    font-size: var(--fs-14);
  }
  details p {
    margin: 0 0 var(--s2);
    font-size: var(--fs-14);
    color: var(--text-2);
  }
  .scroll {
    overflow-x: auto;
    min-width: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--fs-14);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 5px 6px 5px 0;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
  }
  thead th {
    font-size: var(--fs-12);
    color: var(--text-2);
    font-weight: 600;
  }
  .pill {
    display: inline-block;
    min-width: 2.4em;
    text-align: center;
    border-radius: var(--r-input);
    padding: 1px 5px;
    font-weight: 600;
    color: var(--brass-ink);
    background: var(--ink-2);
  }
  .pill.none {
    color: var(--text-2);
  }
  .pill.great {
    background: var(--go);
  }
  .pill.ok {
    background: var(--brass);
  }
  .pill.meh {
    background: var(--chart-warm);
  }
  .pill.bad {
    background: var(--nogo);
  }
  .legend {
    margin: var(--s2) 0 0;
    font-size: var(--fs-12);
    color: var(--text-2);
    max-width: var(--measure);
    line-height: 2;
  }
</style>
