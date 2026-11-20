<script lang="ts">
  /**
   * Trip planner: any year from last year to 15 years ahead, night by night. Each day shows the
   * moonless dark hours (or, with a target, the hours it is above the chosen altitude in moonless
   * darkness); each month shows how often its nights were clear over ten past years (ERA5).
   * The best nights of the year, weighted by that clear-night chance, are listed for trips, with
   * the year's new moons, eclipses, oppositions and meteor showers. Tap a night to see it.
   */
  import { onMount } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import type { NightRow, YearEvent, YearTarget } from '../lib/plan/year';
  import type { YearAsk, YearReply } from '../lib/plan/year.worker';
  import YearWorker from '../lib/plan/year.worker?worker';
  import { loadClimate, type Climate } from '../lib/data/climate';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    place: Place;
    tz: string | undefined;
    /** Targets to choose from (the plan, the selected object). */
    targets: YearTarget[];
    /** Show this night (time = start of darkness) in the app. */
    onnight: (t: Date) => void;
  }
  let { place, tz, targets, onnight }: Props = $props();

  const THIS_YEAR = new Date().getUTCFullYear();
  const YEARS = Array.from({ length: 17 }, (_, i) => THIS_YEAR - 1 + i);
  const MW: YearTarget = { name: 'Milky Way core', ra: 266.42, dec: -29.0 };
  let year = $state(THIS_YEAR);
  let targetName = $state('');
  let minAlt = $state(30);
  const choices = $derived([MW, ...targets.filter((t) => t.name !== MW.name)]);
  const target = $derived(choices.find((t) => t.name === targetName) ?? null);

  let nights = $state<NightRow[]>([]);
  let events = $state<YearEvent[]>([]);
  let busy = $state(false);
  let picked = $state<NightRow | null>(null);
  let worker: Worker | null = null;
  let seq = 0;
  onMount(() => () => worker?.terminate());
  $effect(() => {
    const ask: YearAsk = {
      id: ++seq,
      year,
      site: { lat: place.lat, lon: place.lon, elevation: place.elevation },
      target: target ? { name: target.name, ra: target.ra, dec: target.dec } : null,
      minAlt,
    };
    busy = true;
    worker ??= new YearWorker();
    worker.onmessage = (e: MessageEvent<YearReply>) => {
      if (e.data.id !== seq) return;
      nights = e.data.nights;
      events = e.data.events;
      busy = false;
      if (picked) picked = nights.find((n) => n.date === picked?.date) ?? null;
    };
    worker.postMessage(ask);
  });

  // ---- climate (ten past years of night cloud) -------------------------------------------
  let climate = $state<Climate | null>(null);
  let climateState = $state<'loading' | 'ok' | 'error'>('loading');
  $effect(() => {
    const ctrl = new AbortController();
    climateState = 'loading';
    loadClimate(place.lat, place.lon, ctrl.signal)
      .then((c) => {
        climate = c;
        climateState = 'ok';
      })
      .catch(() => {
        if (!ctrl.signal.aborted) climateState = 'error';
      });
    return () => ctrl.abort();
  });

  // ---- layout -----------------------------------------------------------------------------
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const value = (n: NightRow) => (target ? (n.targetMoonlessH ?? 0) : n.moonlessH);
  /** 10 h of usable darkness fills a cell (at most 50 % brass: day numbers keep 4.5:1). */
  const shade = (h: number) => Math.round(Math.min(1, h / 10) * 50);
  const months = $derived(
    MONTHS.map((name, m) => {
      const list = nights.filter((n) => Number(n.date.slice(5, 7)) === m + 1);
      // Monday-first offset of the 1st.
      const first = (new Date(Date.UTC(year, m, 1)).getUTCDay() + 6) % 7;
      const avg = list.length ? list.reduce((a, n) => a + value(n), 0) / list.length : 0;
      return { name, m, list, first, avg };
    }),
  );
  const phaseDays = $derived(
    new Map(
      events
        .filter((e) => e.kind === 'new-moon' || e.kind === 'full-moon')
        .map((e) => [
          new Date(e.t + (place.lon / 15) * 3600_000 - 12 * 3600_000).toISOString().slice(0, 10),
          e.kind,
        ]),
    ),
  );
  /** Best nights of the year for a trip: usable hours × that month's clear-night chance. */
  const best = $derived.by(() => {
    const today = new Date().toISOString().slice(0, 10);
    return nights
      .filter((n) => (year !== THIS_YEAR || n.date >= today) && value(n) > 0)
      .map((n) => {
        const c = climate?.months[Number(n.date.slice(5, 7)) - 1]?.clear;
        return { n, score: value(n) * (c ?? 1), clear: c ?? null };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .sort((a, b) => (a.n.date < b.n.date ? -1 : 1));
  });
  let kinds = $state<Record<YearEvent['kind'], boolean>>({
    'new-moon': true,
    'full-moon': false,
    'lunar-eclipse': true,
    'solar-eclipse': true,
    opposition: true,
    meteors: true,
  });
  const EVENT_CHIPS: [YearEvent['kind'], string][] = [
    ['new-moon', 'New Moons'],
    ['full-moon', 'Full Moons'],
    ['lunar-eclipse', 'Lunar eclipses'],
    ['solar-eclipse', 'Solar eclipses'],
    ['opposition', 'Oppositions'],
    ['meteors', 'Meteor showers'],
  ];
  const shownEvents = $derived(events.filter((e) => kinds[e.kind]));
  const fmtDay = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const fmtEvt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(tz ? { timeZone: tz } : {}),
    });
  const h1 = (h: number | null) => (h == null ? 'n/a' : `${h.toFixed(1)} h`);
  function label(n: NightRow): string {
    return `${fmtDay(n.date)}: ${h1(n.moonlessH)} moonless of ${h1(n.darkH)} dark, Moon ${Math.round(
      n.moonIllum * 100,
    )} %${target ? `, ${target.name} ${h1(n.targetMoonlessH)} above ${minAlt}° without the Moon` : ''}`;
  }
</script>

<div class="yp">
  <div class="ctl">
    <label
      >Year
      <span class="yr">
        <button
          onclick={() => (year = Math.max(YEARS[0] ?? year, year - 1))}
          aria-label="Previous year">‹</button
        >
        <select bind:value={year}>
          {#each YEARS as y (y)}<option value={y}>{y}</option>{/each}
        </select>
        <button
          onclick={() => (year = Math.min(YEARS[YEARS.length - 1] ?? year, year + 1))}
          aria-label="Next year">›</button
        >
      </span></label
    >
    <label
      >Target
      <select bind:value={targetName}>
        <option value="">Darkness only (no target)</option>
        {#each choices as t (t.name)}<option value={t.name}>{t.name}</option>{/each}
      </select></label
    >
    {#if target}
      <label
        >Above
        <select bind:value={minAlt}>
          {#each [15, 20, 30, 40, 50] as a (a)}<option value={a}>{a}°</option>{/each}
        </select></label
      >
    {/if}
    {#if busy}<span class="note" role="status">Working out {year}…</span>{/if}
  </div>
  <p class="note">
    Each night: {target
      ? `hours ${target.name} is above ${minAlt}° in astronomical darkness with the Moon down`
      : 'hours of astronomical darkness with the Moon down'} (darker = more; 10 h fills a cell). ● new
    Moon, ○ full Moon. Clear nights per month:
    {climateState === 'ok' && climate
      ? `${climate.source}, ${climate.years} (a night counts as clear at ≤ 30 % cloud, 9 pm–3 am)`
      : climateState === 'loading'
        ? 'loading ten years of history…'
        : 'n/a (the Open-Meteo archive could not be reached)'}. Tap a night for details.
  </p>

  <div class="months">
    {#each months as mo (mo.m)}
      {@const cl = climate?.months[mo.m]}
      <section class="month" aria-label={`${mo.name} ${year}`}>
        <h3>{mo.name}</h3>
        <p class="msum">
          {cl ? `${Math.round(cl.clear * 100)} % clear nights` : 'clear nights n/a'} · avg {mo.avg.toFixed(
            1,
          )} h
        </p>
        <div class="cal">
          {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as d, i (i)}<span
              class="dow"
              aria-hidden="true">{d}</span
            >{/each}
          {#each Array.from({ length: mo.first }, (_, i) => i) as i (i)}<span aria-hidden="true"
            ></span>{/each}
          {#each mo.list as n (n.date)}
            {@const ph = phaseDays.get(n.date)}
            <button
              class="day"
              class:sel={picked?.date === n.date}
              style:--fill={`${shade(value(n))}%`}
              aria-label={label(n)}
              title={label(n)}
              onclick={() => (picked = n)}
              >{Number(n.date.slice(8))}{#if ph === 'new-moon'}<i aria-hidden="true">●</i
                >{:else if ph === 'full-moon'}<i aria-hidden="true">○</i>{/if}</button
            >
          {/each}
        </div>
      </section>
    {/each}
  </div>

  {#if picked}
    <div class="pick" role="status">
      <p><strong>{fmtDay(picked.date)}</strong></p>
      <dl>
        <dt>Astronomical darkness</dt>
        <dd>
          {picked.darkStart && picked.darkEnd
            ? `${fmtTime(picked.darkStart, tz)}–${fmtTime(picked.darkEnd, tz)} (${h1(picked.darkH)})`
            : 'none (the Sun never gets 18° below the horizon)'}
        </dd>
        <dt>Without the Moon</dt>
        <dd>{h1(picked.moonlessH)} · Moon {Math.round(picked.moonIllum * 100)} % lit</dd>
        {#if target}
          <dt>{target.name}</dt>
          <dd>
            {h1(picked.targetH)} above {minAlt}° in darkness, {h1(picked.targetMoonlessH)} of them moonless
            · highest {picked.targetMaxAlt != null ? `${Math.round(picked.targetMaxAlt)}°` : 'n/a'}
          </dd>
        {/if}
        <dt>Clear nights that month</dt>
        <dd>
          {climate
            ? `${Math.round((climate.months[Number(picked.date.slice(5, 7)) - 1]?.clear ?? 0) * 100)} % in ${climate.years}`
            : 'n/a'} (history, not a forecast: forecasts reach about 16 days ahead)
        </dd>
      </dl>
      {#if picked.darkStart}
        <button
          class="primary"
          onclick={() => picked?.darkStart && onnight(new Date(picked.darkStart))}
          >Show this night (sky and conditions)</button
        >
      {/if}
    </div>
  {/if}

  <div class="two">
    <section>
      <h3>Best nights for a trip{target ? ` (${target.name})` : ''}</h3>
      {#if best.length}
        <ol class="list">
          {#each best as b (b.n.date)}
            <li>
              <button class="link" onclick={() => (picked = b.n)}>{fmtDay(b.n.date)}</button>
              <span class="note"
                >{h1(value(b.n))}{b.clear != null
                  ? ` · ${Math.round(b.clear * 100)} % of such nights clear`
                  : ''}</span
              >
            </li>
          {/each}
        </ol>
        <p class="note">Usable hours × how often that month's nights were clear.</p>
      {:else}
        <p class="note">
          {busy ? 'Working…' : `No usable nights ${year === THIS_YEAR ? 'left ' : ''}in ${year}.`}
          {#if !busy && year < (YEARS[YEARS.length - 1] ?? year)}<button
              class="link"
              onclick={() => (year += 1)}>See {year + 1}</button
            >{/if}
        </p>
      {/if}
    </section>
    <section>
      <h3>Events in {year}</h3>
      <div class="chips" role="group" aria-label="Show events">
        {#each EVENT_CHIPS as [k, l] (k)}
          <button aria-pressed={kinds[k]} onclick={() => (kinds = { ...kinds, [k]: !kinds[k] })}
            >{l}</button
          >
        {/each}
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul class="list" tabindex="0" aria-label={`Events in ${year}`}>
        {#each shownEvents as e (`${e.kind}-${e.t}`)}
          <li class:solar={e.kind === 'solar-eclipse'}>
            <strong>{fmtEvt(e.t)}</strong> · {e.title}<br /><span class="note">{e.detail}</span>
          </li>
        {:else}
          <li class="note">{busy ? 'Working…' : 'None of these this year.'}</li>
        {/each}
      </ul>
    </section>
  </div>
</div>

<style>
  .yp {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s3);
  }
  .ctl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
    align-items: end;
  }
  .ctl label {
    display: grid;
    gap: 4px;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  select {
    font: inherit;
    font-size: var(--fs-14);
    color: var(--text);
    background: var(--ink-0);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
    padding: 6px 8px;
    min-height: 36px;
  }
  .yr {
    display: inline-flex;
    gap: 4px;
  }
  .yr button {
    min-width: 36px;
  }
  .note {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .months {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
    gap: var(--s3);
  }
  .month {
    display: grid;
    gap: 4px;
    padding: var(--s2);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    background: var(--ink-1);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-14);
  }
  .msum {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .cal {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .dow {
    font-size: 10px;
    text-align: center;
    color: var(--text-2);
  }
  .day {
    position: relative;
    min-height: 30px;
    min-width: 0;
    padding: 0;
    font-size: var(--fs-12);
    font-variant-numeric: tabular-nums;
    border-color: transparent;
    background: color-mix(in srgb, var(--brass) var(--fill), var(--ink-0));
    color: var(--text);
  }
  .day.sel {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }
  .day i {
    position: absolute;
    top: 0;
    right: 2px;
    font-style: normal;
    font-size: 9px;
    line-height: 1;
  }
  .pick {
    display: grid;
    gap: var(--s2);
    padding: var(--s3);
    border: 1px solid var(--brass);
    border-radius: var(--r-section);
    background: var(--ink-1);
  }
  .pick p {
    margin: 0;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 2px var(--s3);
    margin: 0;
    font-size: var(--fs-14);
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
  }
  .primary {
    justify-self: start;
    border-color: var(--brass);
    color: var(--brass);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: var(--s4);
  }
  .two section {
    display: grid;
    gap: var(--s2);
    align-content: start;
  }
  .list {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: 6px;
    font-size: var(--fs-14);
  }
  ul.list {
    list-style: none;
    padding: 0;
    max-height: 420px;
    overflow-y: auto;
  }
  .solar strong {
    color: var(--nogo);
  }
  .link {
    padding: 0;
    min-height: 0;
    border: 0;
    background: none;
    color: var(--brass);
    text-decoration: underline;
    font: inherit;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips button {
    font-size: var(--fs-12);
    min-height: 30px;
    padding: 2px 8px;
  }
  .chips button[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
</style>
