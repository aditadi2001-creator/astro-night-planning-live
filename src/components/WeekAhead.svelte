<script lang="ts">
  import type { NightOutlook } from '../lib/clouds/week';
  import { fmtHour } from '../lib/time/format';

  let { nights, tz }: { nights: NightOutlook[]; tz: string | undefined } = $props();

  const day = (t: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz,
    }).format(t);
  const r = (v: number) => Math.round(v);
  const cls = (q: number) => (q >= 70 ? 'great' : q >= 45 ? 'ok' : q >= 20 ? 'meh' : 'bad');
</script>

<section class="week" aria-labelledby="wk-title">
  <h2 id="wk-title">Week ahead: clouds at night</h2>
  {#if nights.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Seven-night cloud outlook" tabindex="0">
      <table>
        <caption class="visually-hidden">
          Mean cloud cover over the dark hours of each night, the clearest three hours, the Moon and
          an overall rating.
        </caption>
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col">Clouds</th>
            <th scope="col">Low / mid / high</th>
            <th scope="col">Clearest 3 h</th>
            <th scope="col">Moon</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {#each nights as n, i (n.date)}
            <tr>
              <th scope="row">{i === 0 ? 'Tonight' : day(n.date)}</th>
              <td>
                <span class="bar" aria-hidden="true"
                  ><span style:width={`${r(n.total)}%`}></span></span
                >
                {r(n.total)}%
                {#if n.spread != null && n.spread > 50}<span
                    class="unsure"
                    title="The models disagree a lot">uncertain</span
                  >{/if}
              </td>
              <td class="muted">{r(n.low)} / {r(n.mid)} / {r(n.high)}</td>
              <td>
                {#if n.best}{fmtHour(n.best.start, tz)}–{fmtHour(n.best.end, tz)}
                  <span class="muted">({r(n.best.total)}%)</span>{:else}—{/if}
              </td>
              <td class="muted"
                >{r(n.moonIllum * 100)}%{n.moonUp > 0.05
                  ? `, up ${r(n.moonUp * 100)}%`
                  : ', down'}</td
              >
              <td><span class="q {cls(n.quality)}">{n.quality}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="note">
      Dark hours = Sun more than 12° below the horizon. Clouds are the median of 8 forecast models
      (tonight also corrected by the satellite); high cloud is mostly thin cirrus. Rating combines
      clouds (high counting 60 %) and moonlight. Forecasts beyond about 3 days are rough.
    </p>
  {:else}
    <p class="note">The week-ahead outlook appears once the forecast models have loaded.</p>
  {/if}
</section>

<style>
  .week {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  h2 {
    font-size: 13px;
    margin: 0 0 8px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  thead th {
    font-size: 12px;
    color: var(--muted);
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
  }
  .bar {
    display: inline-block;
    width: 60px;
    height: 8px;
    border-radius: 4px;
    background: var(--panel-2);
    overflow: hidden;
    vertical-align: middle;
    margin-right: 6px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--muted);
  }
  .unsure {
    font-size: 11px;
    color: var(--warn);
    margin-left: 4px;
  }
  .q {
    display: inline-block;
    min-width: 2.5em;
    text-align: center;
    border-radius: 6px;
    padding: 1px 6px;
    color: #000;
    font-weight: 600;
  }
  .q.great {
    background: var(--good);
  }
  .q.ok {
    background: var(--accent);
  }
  .q.meh {
    background: var(--warn);
  }
  .q.bad {
    background: var(--bad);
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    margin: 8px 0 0;
  }
</style>
