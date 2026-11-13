<script lang="ts">
  import type { HourRow } from '../lib/conditions';
  import { fmtHour } from '../lib/time/format';
  import { seeingClassText, type SevenTimer } from '../lib/data/seventimer';

  interface Props {
    rows: HourRow[];
    tz: string | undefined;
    /** Currently shown time, to highlight its column. */
    shown: number;
    /** 7Timer! second opinion (3-hourly), if loaded. */
    sevenTimer?: SevenTimer | null;
    /** The real clock: earlier hours are shown as recorded. */
    now?: number;
    onpick: (t: number) => void;
  }
  let { rows, tz, shown, sevenTimer = null, now = Date.now(), onpick }: Props = $props();
  const isPast = (r: HourRow) => r.t + 3600_000 <= now;
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);
  const kindLabel = (r: HourRow) =>
    r.cloud?.kind === 'observed'
      ? 'recorded by satellite'
      : r.cloud?.kind === 'nowcast'
        ? `forecast corrected by the satellite (${Math.round((r.cloud.satWeight ?? 0) * 100)}% satellite)`
        : 'median of the forecast models';

  /** 7Timer! point that falls inside this hour (they come every 3 hours). */
  const stIn = (r: HourRow) =>
    sevenTimer?.points.find((p) => p.t >= r.t && p.t < r.t + 3600_000) ?? null;

  const best = $derived(
    rows
      .filter((r) => !isPast(r))
      .reduce<HourRow | null>(
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
    <h2 id="tl-title">Last 3 hours → 5 AM</h2>
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
          Hourly imaging score (0–100) with cloud cover, transparency, forecast seeing, Moon and
          model agreement. Select an hour to show it in the sky.
        </caption>
        <thead>
          <tr>
            <th scope="row">Hour</th>
            {#each rows as r (r.t)}
              <th scope="col" class:now={isShown(r)} class:past={isPast(r)}>
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
              <td class:now={isShown(r)} class:past={isPast(r)}>
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
              <td class:now={isShown(r)} class:past={isPast(r)} title={kindLabel(r)}>
                <strong>{pct(r.weather?.cloud)}</strong>
                {#if r.cloud?.kind === 'observed'}<span class="kind">rec.</span>
                {:else if r.cloud?.kind === 'nowcast'}<span class="kind">sat.</span>{/if}
              </td>
            {/each}
          </tr>
          <tr class="layer">
            <th scope="row">Low</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)} class:past={isPast(r)}>{pct(r.weather?.cloudLow)}</td>
            {/each}
          </tr>
          <tr class="layer">
            <th scope="row">Mid</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)} class:past={isPast(r)}>{pct(r.weather?.cloudMid)}</td>
            {/each}
          </tr>
          <tr class="layer">
            <th scope="row" title="High cloud is mostly thin cirrus: stars often show through it">
              High (thin)
            </th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)} class:past={isPast(r)}>{pct(r.weather?.cloudHigh)}</td>
            {/each}
          </tr>
          <tr class="layer">
            <th scope="row" title="Lowest and highest total cloud among the 8 models">Range</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)} class:past={isPast(r)} class="muted">
                {r.cloud?.min != null && r.cloud?.max != null
                  ? `${Math.round(r.cloud.min)}–${Math.round(r.cloud.max)}`
                  : '—'}
              </td>
            {/each}
          </tr>
          <tr>
            <th scope="row">Transp.</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>{r.extinction ? r.extinction.total.toFixed(2) : '—'}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row">Seeing</th>
            {#each rows as r (r.t)}
              <td class:now={isShown(r)}>
                {#if r.seeing}
                  <span class="see s{r.seeing.rating}" title={`${r.seeing.label} (estimate)`}
                    >{r.seeing.arcsec.toFixed(1)}″</span
                  >
                {:else}—{/if}
              </td>
            {/each}
          </tr>
          {#if sevenTimer}
            <tr>
              <th scope="row">7Timer!</th>
              {#each rows as r (r.t)}
                {@const p = stIn(r)}
                <td class:now={isShown(r)} class="muted"
                  >{p?.seeing ? seeingClassText(p.seeing) : ''}</td
                >
              {/each}
            </tr>
          {/if}
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
      Score = clouds × transparency × Moon × darkness × seeing, each as a relative signal-to-noise
      factor for sky-limited imaging. Seeing is a forecast estimate from upper-air winds (our model;
      7Timer! every 3 h as a second opinion), never a measurement. Scores rate each hour for this
      site; its light pollution is in the Sky quality card. Clouds: the median of 8 global models
      (ECMWF, GFS, ICON, JMA, Météo-France, UK Met Office, GEM, CMA), pulled towards the newest
      satellite image for the next few hours (<em>sat.</em>); earlier hours are what the satellite
      recorded (<em>rec.</em>). High cloud is mostly thin cirrus and counts as 60 % in the score.
      Models: <span class="dot high"></span> agree <span class="dot medium"></span> partly
      <span class="dot low"></span> disagree. Weather data by Open-Meteo.com; satellite NOAA GMGSI.
    </p>
  {:else}
    <p class="note">The forecast for tonight will appear here.</p>
  {/if}
</section>

<style>
  .past {
    opacity: 0.55;
  }
  .kind {
    display: block;
    font-size: 10px;
    color: var(--muted);
    font-style: normal;
  }
  .layer td,
  .layer th {
    font-size: 12px;
    color: var(--muted);
  }
  .see {
    font-variant-numeric: tabular-nums;
    border-bottom: 2px solid transparent;
  }
  .see.s5,
  .see.s4 {
    border-color: var(--good);
  }
  .see.s3 {
    border-color: var(--warn);
  }
  .see.s2,
  .see.s1 {
    border-color: var(--bad);
  }
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
