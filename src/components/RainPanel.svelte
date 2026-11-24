<script lang="ts">
  /**
   * Rain section: what falls now and next, an interactive chart (amount and chance; hover,
   * tap or arrow keys read an hour, 24 h / 48 h / 7 days or one night), the seven-day outlook
   * with a 0–100 rain rating for each night, and how that rating works.
   */
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import { hourAt } from '../lib/data/openmeteo';
  import { weatherWord, type Rain, type RainHour } from '../lib/data/rain';
  import type { SourceStatus } from '../lib/data/live.svelte';
  import { band, rainFactor, RULES } from '../lib/ratings';
  import { fmtHour } from '../lib/time/format';

  interface Props {
    rain: Rain | null;
    status: SourceStatus;
    place: Place;
    tz: string | undefined;
    /** Current time, ms. */
    now: number;
    /** Show this hour across the site (Tonight, Ratings, the sky). */
    onpick?: (t: number) => void;
  }
  let { rain, status, place, tz, now, onpick }: Props = $props();

  const HOURS = 48;
  /** Chart window: the next 24 h / 48 h / 7 days, or one night (noon to noon) from the table. */
  let range = $state<24 | 48 | 168>(48);
  let nightOf = $state<number | null>(null);
  /** Hour read out under the chart: the one under the pointer, else the chosen one. */
  let hover = $state<number | null>(null);
  let chosen = $state<number | null>(null);
  let chartEl = $state<HTMLElement | null>(null);
  const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
  const rate = (h: RainHour | null) => {
    const f = h ? rainFactor(h.mm, h.prob) : null;
    return f == null ? null : Math.round(100 * f);
  };
  const wet = (h: RainHour) => (h.prob ?? 0) >= 40 || (h.mm ?? 0) >= 0.2;
  const day = (t: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz,
    }).format(t);

  function sunAltAt(t: number): number {
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    const d = new Date(t + 1800_000);
    const eq = Astronomy.Equator(Astronomy.Body.Sun, d, obs, true, true);
    return Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal').altitude;
  }
  /** Sun altitude at the middle of every forecast hour (computed once per forecast). */
  const sunByT = $derived(new Map((rain?.hours ?? []).map((h) => [h.t, sunAltAt(h.t)])));
  const sunAlt = (t: number) => sunByT.get(t) ?? sunAltAt(t);
  /** Local hour of day at the site (0–23). */
  const localHour = (t: number) =>
    ((Math.floor((t / 1000 + (rain?.utcOffsetSeconds ?? 0)) / 3600) % 24) + 24) % 24;

  /** The next 48 hours from the hour that contains now, with the Sun's altitude. */
  const ahead = $derived.by(() => {
    if (!rain) return [];
    const i0 = rain.hours.findIndex((h) => h.t + 3600_000 > now);
    if (i0 < 0) return [];
    return rain.hours.slice(i0, i0 + HOURS).map((h) => ({ ...h, sun: sunAlt(h.t) }));
  });
  const thisHour = $derived(rain ? hourAt(rain.hours, now) : null);
  const nextWet = $derived(ahead.find(wet) ?? null);
  const nextDry = $derived(
    thisHour && wet(thisHour) ? (ahead.find((h) => !wet(h) && h.t > now) ?? null) : null,
  );

  /** Rain rating for each night: mean over the hours with the Sun more than 12° down. */
  const days = $derived.by(() => {
    if (!rain) return [];
    return rain.days
      .filter((d) => d.t + 24 * 3600_000 > now - 12 * 3600_000)
      .slice(0, 7)
      .map((d) => {
        const night = rain.hours.filter(
          (h) => h.t >= d.t + 12 * 3600_000 && h.t < d.t + 36 * 3600_000 && sunAlt(h.t) < -12,
        );
        const rs = night.map(rate).filter((x): x is number => x != null);
        const nightMm = night.reduce((a, h) => a + Math.max(0, h.mm ?? 0), 0);
        const nightProb = night.reduce((a, h) => Math.max(a, h.prob ?? 0), 0);
        return {
          ...d,
          nightRating: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
          nightMm,
          nightProb,
          nightHours: night.length,
        };
      });
  });

  /** The hours the chart shows. */
  const shown = $derived.by(() => {
    if (!rain) return [];
    const start =
      nightOf != null
        ? nightOf + 12 * 3600_000
        : (rain.hours.find((h) => h.t + 3600_000 > now)?.t ?? now);
    const n = nightOf != null ? 24 : range;
    const i0 = rain.hours.findIndex((h) => h.t >= start);
    if (i0 < 0) return [];
    return rain.hours.slice(i0, i0 + n).map((h) => ({ ...h, sun: sunAlt(h.t) }));
  });
  const N = $derived(Math.max(1, shown.length));
  const readIdx = $derived.by(() => {
    if (hover != null) return hover;
    const i = chosen == null ? -1 : shown.findIndex((h) => h.t === chosen);
    return i >= 0 ? i : null;
  });
  const readHour = $derived(readIdx != null ? (shown[readIdx] ?? null) : null);
  // A new window clears the chosen hour if it is not in it.
  $effect(() => {
    if (chosen != null && !shown.some((h) => h.t === chosen)) chosen = null;
  });

  function idxAt(e: MouseEvent): number | null {
    const svg = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const vx = ((e.clientX - svg.left) / svg.width) * W;
    if (vx < PAD.l - 4 || vx > W - PAD.r + 4) return null;
    return Math.min(N - 1, Math.max(0, Math.floor(((vx - PAD.l) / iw) * N)));
  }
  function onKey(e: KeyboardEvent) {
    const i = readIdx ?? -1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(N - 1, i + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, i < 0 ? 0 : i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = N - 1;
    else if (e.key === 'Enter' && readHour && onpick) {
      onpick(readHour.t);
      e.preventDefault();
      return;
    } else if (e.key === 'Escape') {
      chosen = null;
      return;
    }
    if (next == null) return;
    e.preventDefault();
    hover = null;
    chosen = shown[next]?.t ?? null;
  }
  function pickNight(t: number) {
    nightOf = nightOf === t ? null : t;
    chosen = null;
    chartEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- chart geometry ----
  const W = 720;
  const H = 180;
  const PAD = { l: 34, r: 36, t: 12, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const maxMm = $derived(Math.max(2, ...shown.map((h) => h.mm ?? 0)));
  const x = (i: number) => PAD.l + (i / N) * iw;
  const nowX = $derived.by(() => {
    const t0 = shown[0]?.t;
    if (t0 == null || now < t0 || now >= t0 + N * 3600_000) return null;
    return x((now - t0) / 3600_000);
  });
  const weekday = (t: number) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(t);
  /** Axis label for an hour, or null: every 3 h (24 h), 6 h (48 h), or each midnight (7 days). */
  const tick = (t: number) => {
    const lh = localHour(t);
    if (N > 48) return lh === 0 ? weekday(t) : null;
    return lh % (N > 24 ? 6 : 3) === 0 ? fmtHour(t, tz) : null;
  };
  const yMm = (mm: number) => PAD.t + ih - (Math.min(mm, maxMm) / maxMm) * ih;
  const yP = (p: number) => PAD.t + ih - (p / 100) * ih;
  const probPath = $derived(
    shown
      .map((h, i) => (h.prob == null ? null : `${x(i + 0.5).toFixed(1)},${yP(h.prob).toFixed(1)}`))
      .filter(Boolean)
      .join(' '),
  );
  const windowName = $derived(
    nightOf != null
      ? `the night of ${day(nightOf)}`
      : range === 168
        ? 'the next 7 days'
        : `the next ${range} hours`,
  );
  const chartLabel = $derived.by(() => {
    if (!shown.length) return 'Rain chart';
    const total = shown.reduce((a, h) => a + Math.max(0, h.mm ?? 0), 0);
    const pmax = shown.reduce((a, h) => Math.max(a, h.prob ?? 0), 0);
    return `Rain over ${windowName}: ${r1(total)} mm in total, highest hourly chance ${pmax} %.`;
  });
  const readText = (h: RainHour) =>
    `${day(h.t)} ${fmtHour(h.t, tz)}: ${h.prob ?? '—'} % chance, ${r1(Math.max(0, h.mm ?? 0))} mm${
      weatherWord(h.code) ? `, ${weatherWord(h.code).toLowerCase()}` : ''
    }; rain rating ${rate(h) ?? '—'} out of 100`;
</script>

<div class="rain">
  {#if !rain}
    <p class="note">
      {status === 'error'
        ? 'The rain forecast could not be loaded. Check the connection; it retries on its own.'
        : 'Loading the rain forecast…'}
    </p>
  {:else}
    <div class="now" role="status">
      {#if thisHour && wet(thisHour)}
        <p class="big">
          Rain this hour: {r1(Math.max(0, thisHour.mm ?? 0))} mm, {thisHour.prob ?? '—'} % chance
          {#if thisHour.code != null && weatherWord(thisHour.code)}
            ({weatherWord(thisHour.code).toLowerCase()}){/if}.
        </p>
        <p class="sub">
          {nextDry
            ? `Likely dry again from ${fmtHour(nextDry.t, tz)}${nextDry.t - now > 20 * 3600_000 ? ` ${day(nextDry.t)}` : ''}.`
            : 'Wet for most of the next 48 hours.'}
        </p>
      {:else if nextWet}
        <p class="big">
          Dry now. Rain likely from {fmtHour(nextWet.t, tz)}{nextWet.t - now > 20 * 3600_000
            ? ` ${day(nextWet.t)}`
            : ''}.
        </p>
        <p class="sub">
          That hour: {nextWet.prob ?? '—'} % chance, {r1(Math.max(0, nextWet.mm ?? 0))} mm expected.
        </p>
      {:else}
        <p class="big">No rain expected in the next 48 hours.</p>
        <p class="sub">No hour has a 40 % chance or 0.2 mm of rain.</p>
      {/if}
      {#if days[0]}
        {@const b = band(days[0].nightRating)}
        <p class="tonight">
          Tonight's rain rating:
          <span class="pill {b.cls}">{days[0].nightRating ?? '—'}/100</span>
          <span class="muted">({b.word}; mean of the {days[0].nightHours} dark hours)</span>
        </p>
      {/if}
    </div>

    <figure class="chart">
      <div class="chart-bar">
        <div class="seg" role="group" aria-label="Chart range">
          {#each [24, 48, 168] as const as r (r)}
            <button
              type="button"
              aria-pressed={nightOf == null && range === r}
              onclick={() => {
                range = r;
                nightOf = null;
              }}>{r === 168 ? '7 days' : `${r} h`}</button
            >
          {/each}
        </div>
        {#if nightOf != null}
          <button type="button" class="chip" onclick={() => (nightOf = null)}>
            Night of {day(nightOf)} <span aria-hidden="true">✕</span><span class="visually-hidden"
              >: back to the next {range === 168 ? '7 days' : `${range} hours`}</span
            >
          </button>
        {/if}
      </div>
      <div
        class="chart-scroll"
        bind:this={chartEl}
        role="slider"
        tabindex="0"
        aria-label={`Rain chart for ${windowName}. Arrow keys move between hours${onpick ? '; Enter shows the hour across the site' : ''}.`}
        aria-valuemin={0}
        aria-valuemax={N - 1}
        aria-valuenow={readIdx ?? 0}
        aria-valuetext={readHour ? readText(readHour) : chartLabel}
        onkeydown={onKey}
      >
        <!-- The slider around the chart gives the keyboard the same: arrows, Enter, Escape. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={chartLabel}
          onpointermove={(e) => (hover = idxAt(e))}
          onpointerleave={() => (hover = null)}
          onclick={(e) => {
            const i = idxAt(e);
            const t = i != null ? (shown[i]?.t ?? null) : null;
            chosen = t === chosen ? null : t;
          }}
        >
          {#each shown as h, i (h.t)}
            {#if h.sun < -12}
              <rect class="night" x={x(i)} y={PAD.t} width={iw / N + 0.5} height={ih} />
            {/if}
          {/each}
          {#if readIdx != null}
            <rect class="hl" x={x(readIdx)} y={PAD.t} width={iw / N} height={ih} />
          {/if}
          {#each [0, 25, 50, 75, 100] as p (p)}
            <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={yP(p)} y2={yP(p)} />
            <text class="ax right" x={W - PAD.r + 4} y={yP(p) + 4}>{p}%</text>
          {/each}
          {#each [0, maxMm / 2, maxMm] as m (m)}
            <text class="ax" x={PAD.l - 4} y={yMm(m) + 4} text-anchor="end">{r1(m)}</text>
          {/each}
          {#each shown as h, i (h.t)}
            {@const lab = tick(h.t)}
            {#if (h.mm ?? 0) > 0}
              <rect
                class="bar"
                x={x(i) + (N > 48 ? 0.25 : 1)}
                y={yMm(h.mm ?? 0)}
                width={Math.max(1, iw / N - (N > 48 ? 0.5 : 2))}
                height={PAD.t + ih - yMm(h.mm ?? 0)}
              />
            {/if}
            {#if lab}
              <text class="ax" x={x(i)} y={H - 8} text-anchor="middle">{lab}</text>
            {/if}
          {/each}
          {#if probPath}<polyline class="prob" points={probPath} />{/if}
          {#if readHour && readIdx != null && readHour.prob != null}
            <circle class="dot" cx={x(readIdx + 0.5)} cy={yP(readHour.prob)} r="4" />
          {/if}
          {#if nowX != null}
            <line class="nowline" x1={nowX} x2={nowX} y1={PAD.t} y2={PAD.t + ih} />
          {/if}
        </svg>
      </div>
      <div class="readout" aria-live="polite">
        {#if readHour}
          {@const v = rate(readHour)}
          <p>
            <strong>{day(readHour.t)}, {fmtHour(readHour.t, tz)}</strong>
            · {readHour.prob ?? '—'} % chance · {r1(Math.max(0, readHour.mm ?? 0))} mm{weatherWord(
              readHour.code,
            )
              ? ` · ${weatherWord(readHour.code).toLowerCase()}`
              : ''}
            · rain rating <span class="pill {band(v).cls}">{v ?? '—'}</span>
          </p>
          <p class="math-line">
            100 × (1 − {((readHour.prob ?? 0) / 100).toFixed(2)}) × (1 − {Math.min(
              1,
              Math.max(0, readHour.mm ?? 0),
            ).toFixed(2)}) = {v ?? '—'}
          </p>
          {#if onpick}
            <button type="button" class="act" onclick={() => onpick(readHour.t)}>
              Show {fmtHour(readHour.t, tz)} across the site
            </button>
          {/if}
        {:else}
          <p class="muted">
            Hover or tap the chart to read an hour (arrow keys work too). Choose a day in the table
            below to zoom in on its night.
          </p>
        {/if}
      </div>
      <figcaption>
        <span class="key"><span class="sw bar"></span>Rain, mm per hour (left)</span>
        <span class="key"><span class="sw prob"></span>Chance of rain (right)</span>
        <span class="key"><span class="sw night"></span>Dark hours (Sun 12° or more down)</span>
      </figcaption>
    </figure>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Seven-day rain outlook" tabindex="0">
      <table>
        <caption class="visually-hidden">
          Rain each day and each night for the next seven days, with the night's rain rating out of
          100. Choose a day to show its night in the chart.
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Weather</th>
            <th scope="col">Rain (day)</th>
            <th scope="col">Wet hours</th>
            <th scope="col">Max chance</th>
            <th scope="col">Night rain</th>
            <th scope="col">Night rating</th>
          </tr>
        </thead>
        <tbody>
          {#each days as d (d.t)}
            {@const b = band(d.nightRating)}
            <tr class:picked={nightOf === d.t}>
              <th scope="row">
                <button
                  type="button"
                  class="day"
                  aria-pressed={nightOf === d.t}
                  title="Show this night in the chart"
                  onclick={() => pickNight(d.t)}>{day(d.t)}</button
                >
              </th>
              <td>{weatherWord(d.code) || '—'}</td>
              <td>
                {d.mm != null ? `${r1(d.mm)} mm` : '—'}{#if d.snow}<span class="muted">
                    + {r1(d.snow)} cm snow</span
                  >{/if}
              </td>
              <td>{d.hours != null ? `${Math.round(d.hours)} h` : '—'}</td>
              <td>{d.probMax != null ? `${d.probMax} %` : '—'}</td>
              <td class="muted">
                {d.nightHours ? `${r1(d.nightMm)} mm, up to ${d.nightProb} %` : '—'}
              </td>
              <td><span class="pill {b.cls}">{d.nightRating ?? '—'}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <details class="hours">
      <summary>Every hour for the next 48 hours</summary>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" role="region" aria-label="Hourly rain" tabindex="0">
        <table>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Chance</th>
              <th scope="col">Rain</th>
              <th scope="col">Weather</th>
              <th scope="col">Rating</th>
            </tr>
          </thead>
          <tbody>
            {#each ahead as h, i (h.t)}
              {@const v = rate(h)}
              {@const prev = ahead[i - 1]}
              <tr class:dark={h.sun < -12}>
                <th scope="row"
                  >{fmtHour(h.t, tz)}{#if !prev || day(prev.t) !== day(h.t)}<span class="muted">
                      {day(h.t)}</span
                    >{/if}</th
                >
                <td>{h.prob != null ? `${h.prob} %` : '—'}</td>
                <td>{h.mm != null ? `${r1(h.mm)} mm` : '—'}</td>
                <td class="muted">{weatherWord(h.code)}</td>
                <td><span class="pill {band(v).cls}">{v ?? '—'}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>

    <div class="how">
      <h3>How the rain rating is done</h3>
      <p>{RULES.rain.rule}</p>
      <p class="formula">{RULES.rain.formula}</p>
      <p>
        Example: a 30 % chance with 0.2 mm expected gives 100 × (1 − 0.30) × (1 − 0.20) = 56. A
        night's rating is the mean over its dark hours. 80 or more is great, 55–79 good, 30–54 poor,
        under 30 bad.
      </p>
    </div>
    <p class="credit">
      Rain forecast: Open-Meteo best-match model (CC BY 4.0), hourly, refreshed every 30 minutes.
      The chance is the share of ensemble model runs with at least 0.1 mm in the hour.
    </p>
  {/if}
</div>

<style>
  .rain {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s4);
    min-width: 0;
  }
  .now {
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    padding: var(--s4);
  }
  .big {
    margin: 0;
    font-size: var(--fs-21);
    line-height: var(--lh-head);
  }
  .sub,
  .tonight {
    margin: var(--s2) 0 0;
    color: var(--text-2);
  }
  .tonight {
    color: var(--text);
  }
  .muted {
    color: var(--text-2);
  }
  .chart {
    margin: 0;
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    padding: var(--s3);
    min-width: 0;
  }
  .chart-scroll {
    overflow-x: auto;
    border-radius: var(--r-input);
  }
  .chart-scroll:focus-visible {
    outline: 2px solid var(--brass);
    outline-offset: 2px;
  }
  svg {
    cursor: crosshair;
    touch-action: pan-y;
  }
  .hl {
    fill: var(--text);
    opacity: 0.12;
  }
  .dot {
    fill: var(--brass);
    stroke: var(--ink-1);
    stroke-width: 2;
  }
  .chart-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    margin-bottom: var(--s3);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
    overflow: hidden;
  }
  .seg button {
    min-height: 36px;
    padding: 0 var(--s3);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-14);
    cursor: pointer;
  }
  .seg button + button {
    border-left: 1px solid var(--ui-line);
  }
  .seg button[aria-pressed='true'] {
    background: var(--brass);
    color: var(--brass-ink);
    font-weight: 600;
  }
  .chip {
    min-height: 36px;
    padding: 0 var(--s3);
    border: 1px solid var(--brass);
    border-radius: var(--r-pill);
    background: var(--ink-2);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-14);
    cursor: pointer;
  }
  .readout {
    min-height: 3.5em;
    margin-top: var(--s2);
    font-size: var(--fs-14);
  }
  .readout p {
    margin: 0 0 var(--s1);
  }
  .math-line {
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
    font-size: var(--fs-12);
  }
  .act {
    min-height: 36px;
    margin-top: var(--s1);
    padding: 0 var(--s3);
    border: 1px solid var(--brass);
    border-radius: var(--r-input);
    background: transparent;
    color: var(--brass);
    font: inherit;
    font-size: var(--fs-14);
    cursor: pointer;
  }
  button.day {
    min-height: 32px;
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
  svg {
    width: 100%;
    min-width: 560px;
    height: auto;
    display: block;
  }
  .night {
    fill: var(--twilight-astro);
    opacity: 0.55;
  }
  .grid {
    stroke: var(--rule);
    stroke-width: 1;
  }
  .ax {
    fill: var(--text-2);
    font-size: 11px;
    font-family: var(--font-ui);
  }
  .bar {
    fill: var(--chart-cool);
  }
  .prob {
    fill: none;
    stroke: var(--brass);
    stroke-width: 2;
  }
  .nowline {
    stroke: var(--text);
    stroke-width: 1.5;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1) var(--s4);
    font-size: var(--fs-12);
    color: var(--text-2);
    margin-top: var(--s2);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 2px;
  }
  .sw.bar {
    background: var(--chart-cool);
  }
  .sw.prob {
    height: 3px;
    background: var(--brass);
  }
  .sw.night {
    background: var(--twilight-astro);
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
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
  }
  thead th {
    font-size: var(--fs-12);
    color: var(--text-2);
    font-weight: 600;
  }
  tr.dark th {
    color: var(--chart-cool);
  }
  .pill {
    display: inline-block;
    min-width: 2.6em;
    text-align: center;
    border-radius: var(--r-input);
    padding: 1px 6px;
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
  details.hours > summary {
    cursor: pointer;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    color: var(--brass);
  }
  .how {
    max-width: var(--measure);
  }
  .how h3 {
    margin: 0 0 var(--s2);
    font-size: var(--fs-16);
  }
  .how p {
    margin: 0 0 var(--s2);
    color: var(--text-2);
  }
  .formula {
    font-variant-numeric: tabular-nums;
    color: var(--text) !important;
    background: var(--ink-2);
    border-radius: var(--r-input);
    padding: var(--s2) var(--s3);
    display: inline-block;
  }
  .credit,
  .note {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .note {
    font-size: var(--fs-14);
  }
</style>
