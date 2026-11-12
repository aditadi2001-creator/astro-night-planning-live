<script lang="ts">
  import type { HourRow } from '../lib/conditions';
  import { fmtHour } from '../lib/time/format';

  interface Props {
    rows: HourRow[];
    tz: string | undefined;
    /** Currently shown time, to highlight its column. */
    shown: number;
    onpick: (t: number) => void;
  }
  let { rows, tz, shown, onpick }: Props = $props();

  const best = $derived(
    rows.reduce<HourRow | null>(
      (b, r) => ((r.score?.score ?? -1) > (b?.score?.score ?? -1) ? r : b),
      null,
    ),
  );

  function scoreClass(s: number | undefined): string {
    if (s == null) return 'na';
    if (s >= 70) return 'great';
    if (s >= 45) return 'ok';
    if (s >= 20) return 'meh';
    return 'bad';
  }
  const isShown = (r: HourRow) => shown >= r.t && shown < r.t + 3600_000;
</script>

<section class="timeline" aria-labelledby="tl-title">
  <header>
    <h2 id="tl-title">Tonight</h2>
    {#if best?.score && best.score.score > 0}
      <p class="best">
        Best hour: <strong>{fmtHour(best.t, tz)}</strong> (score {best.score.score})
      </p>
    {:else if rows.length && rows.every((r) => !r.score)}
      <p class="best">
        Forecast unavailable right now. Darkness and Moon times are still exact; scores return when
        the weather data does.
      </p>
    {:else if rows.length}
      <p class="best">No good imaging hours forecast tonight.</p>
    {/if}
  </header>

  {#if rows.length}
    <!-- Scrollable regions must be keyboard-focusable (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Hourly forecast, scroll sideways" tabindex="0">
      <table>
        <caption class="visually-hidden">
          Hourly imaging score (0–100) with cloud cover, transparency, Moon and model agreement.
          Select an hour to show it in the sky.
        </caption>
        <thead>
          <tr>
            <th scope="row">Hour</th>
            {#each rows as r (r.t)}
              <th scope="col" class:now={isShown(r)}>
                <button
                  onclick={() => onpick(r.t + 1800_000)}
                  aria-label={`Show ${fmtHour(r.t, tz)}`}
                >
                  {fmtHour(r.t, tz)}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <tr class="score-row">
            <th scope="row">Score</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>
                <span
                  class="bar {scoreClass(r.score?.score)}"
                  style:--h={`${r.score?.score ?? 0}%`}
                >
                  <span>{r.score?.score ?? '—'}</span>
                </span>
              </td>
            {/each}
          </tr>
          <tr>
            <th scope="row">Clouds</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>{r.weather?.cloud ?? '—'}%</td>
            {/each}
          </tr>
          <tr>
            <th scope="row">Transp.</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>{r.extinction ? r.extinction.total.toFixed(2) : '—'}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row">Moon</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)} class="muted"
                >{r.moonAlt > 0 ? `${r.moonAlt.toFixed(0)}°` : 'down'}</td
              >
            {/each}
          </tr>
          <tr>
            <th scope="row">Models</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>
                <span class="dot {r.agreement}" title={`Model agreement: ${r.agreement}`}></span>
                <span class="visually-hidden">{r.agreement}</span>
              </td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>
    <p class="note">
      Score = clouds × transparency × Moon × darkness, each as a relative signal-to-noise factor for
      sky-limited imaging. Seeing joins the score in a later update. Cloud models (ECMWF, GFS, ICON,
      best match): <span class="dot high"></span> agree <span class="dot medium"></span> partly
      <span class="dot low"></span> disagree. Weather data by Open-Meteo.com.
    </p>
  {:else}
    <p class="note">The forecast for tonight will appear here.</p>
  {/if}
</section>

<style>
  .timeline {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
  h2 {
    font-size: 13px;
    margin: 0;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .best {
    margin: 0;
    font-size: 14px;
  }
  .scroll {
    overflow-x: auto;
    margin-top: 8px;
    -webkit-overflow-scrolling: touch;
  }
  table {
    border-collapse: separate;
    border-spacing: 2px 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th[scope='row'] {
    position: sticky;
    left: 0;
    background: var(--panel);
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    padding-right: 8px;
    z-index: 1;
  }
  td,
  thead th {
    text-align: center;
    min-width: 38px;
    padding: 3px 0;
  }
  .now {
    background: var(--panel-2);
  }
  thead button {
    min-height: 28px;
    padding: 2px 6px;
    font-size: 12px;
  }
  .score-row td {
    height: 64px;
    vertical-align: bottom;
  }
  .bar {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    margin: 0 auto;
    width: 26px;
    height: max(14px, var(--h));
    border-radius: 4px 4px 2px 2px;
    color: #000;
    font-weight: 600;
  }
  .bar span {
    padding-bottom: 1px;
  }
  .great {
    background: var(--good);
  }
  .ok {
    background: color-mix(in srgb, var(--good) 55%, var(--warn));
  }
  .meh {
    background: var(--warn);
  }
  .bad {
    background: var(--panel-2);
    color: var(--muted);
  }
  .na {
    background: transparent;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--line);
  }
  .dot.high {
    background: var(--good);
  }
  .dot.medium {
    background: var(--warn);
  }
  .dot.low {
    background: var(--bad);
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    margin: 8px 0 0;
  }
</style>
