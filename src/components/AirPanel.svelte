<script lang="ts">
  /**
   * Air section: everything known about the air at the site.
   *  - Now: the US AQI (measured by nearby monitors when they report, else the CAMS model),
   *    the pollutant that sets it, what to do, and the daily (24-hour) figure.
   *  - Every pollutant: measured value and averaging, its EPA sub-index and station, next to
   *    the model's concentration and its US and European sub-indices.
   *  - Every station read, with its share of the blend and its last 24 hours of PM2.5; for
   *    remote sites the nearest monitors up to 100 km away (reference only).
   *  - The model's other fields (dust, haze, UV, CO2, methane, ammonia, pollen) with "n/a"
   *    and the reason where a region has no data.
   *  - A five-day forecast chart, a day-by-day table and every hour.
   * Values that no source gives stay "n/a" (never invented).
   */
  import { aqiAdvice, aqiCategory, aqiUnitToUgm3, eaqiLabel, type Gas } from '../lib/air/aqi';
  import { POLLENS, type Air, type AirHour } from '../lib/data/openmeteo';
  import {
    GAS_MAX_AGE_MS,
    POLLUTANT_LABEL,
    siteAqi,
    stationShares,
    isCurrent,
    type Pollutant,
    type Station,
    type StationAir,
  } from '../lib/data/stationair';
  import type { SourceStatus } from '../lib/data/live.svelte';
  import { fmtHour, fmtTime } from '../lib/time/format';

  interface Props {
    air: Air | null;
    airStatus: SourceStatus;
    stations: StationAir | null;
    /** False without the data Worker (no monitors at all). */
    stationsEnabled: boolean;
    stationStatus: SourceStatus | 'off';
    placeName: string;
    tz: string | undefined;
    /** Site UTC offset (s), for local days. */
    utcOff: number;
    now: number;
    /** Show this hour across the site. */
    onpick?: (t: number) => void;
  }
  let {
    air,
    airStatus,
    stations,
    stationsEnabled,
    stationStatus,
    placeName,
    tz,
    utcOff,
    now,
    onpick,
  }: Props = $props();

  const H = 3600_000;
  const n = (v: number | null | undefined, d = 0) =>
    v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d);
  const ago = (t: number | null | undefined) => {
    if (t == null) return 'n/a';
    const m = Math.max(0, Math.round((now - t) / 60_000));
    return m >= 90 ? `${Math.round(m / 60)} h ago` : `${m} min ago`;
  };
  const day = (t: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz,
    }).format(t);
  const localDay = (t: number) => Math.floor((t + utcOff * 1000) / 86_400_000);
  const catOf = (aqi: number | null | undefined) => (aqi == null ? null : aqiCategory(aqi));
  /** CSS class per US AQI category (tokens only; the category name is always written out). */
  const catCls = (aqi: number | null | undefined) =>
    aqi == null ? 'none' : aqi <= 50 ? 'great' : aqi <= 100 ? 'ok' : aqi <= 150 ? 'meh' : 'bad';

  const measured = $derived(siteAqi(stations));
  const modelNow = $derived.by<AirHour | null>(() => {
    if (!air) return null;
    let best: AirHour | null = null;
    for (const h of air.hours) {
      if (h.t <= now) best = h;
      else break;
    }
    return best && now - best.t < H ? best : null;
  });
  const headline = $derived(
    measured
      ? { aqi: measured.aqi, src: 'measured' as const }
      : modelNow?.usAqi != null
        ? { aqi: modelNow.usAqi, src: 'model' as const }
        : null,
  );

  /** Model's dominant pollutant from its US sub-indices. */
  const modelDominant = (h: AirHour | null): Pollutant | null => {
    if (!h?.us) return null;
    let best: Pollutant | null = null;
    let bv = -1;
    for (const [k, v] of Object.entries(h.us) as [Pollutant, number | null][]) {
      if (v != null && v > bv) {
        bv = v;
        best = k;
      }
    }
    return best;
  };
  const SHORT: Record<Pollutant, string> = {
    pm25: 'PM2.5',
    pm10: 'PM10',
    o3: 'O₃',
    no2: 'NO₂',
    so2: 'SO₂',
    co: 'CO',
  };

  // ---- pollutant table rows -----------------------------------------------------
  const MODEL_KEY: Record<Pollutant, keyof AirHour> = {
    pm25: 'pm25',
    pm10: 'pm10',
    o3: 'o3',
    no2: 'no2',
    so2: 'so2',
    co: 'co',
  };
  const rows = $derived(
    (['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'] as const).map((k) => {
      const part = measured?.parts.find((p) => p.key === k) ?? null;
      const g = k === 'pm25' || k === 'pm10' ? null : (stations?.gases?.[k as Gas] ?? null);
      // A gas reading too old for the AQI is still shown, marked by its age.
      const gasOld = g && !part && stations ? stations.fetched - g.time > GAS_MAX_AGE_MS : false;
      const mv = modelNow ? (modelNow[MODEL_KEY[k]] as number | null | undefined) : null;
      return {
        k,
        part,
        g,
        gasOld,
        modelUg: mv ?? null,
        modelUs: modelNow?.us?.[k] ?? null,
        modelEu: k === 'co' ? null : (modelNow?.eu?.[k as Exclude<Pollutant, 'co'>] ?? null),
      };
    }),
  );

  const shares = $derived(stationShares(stations?.stations ?? [], stations?.fetched ?? now));

  /** PM2.5 model vs monitors, now. */
  const bias = $derived.by(() => {
    const m = measured?.pm25;
    const c = modelNow?.pm25;
    if (m == null || c == null || c <= 0 || m <= 0) return null;
    return { m, c, ratio: m / c };
  });

  // ---- forecast -------------------------------------------------------------------
  const ahead = $derived.by(() => {
    if (!air) return [];
    const i0 = air.hours.findIndex((h) => h.t + H > now);
    return i0 < 0 ? [] : air.hours.slice(i0).filter((h) => h.usAqi != null);
  });
  const days = $derived.by(() => {
    // Hours are in time order, so each local day is one run of consecutive hours.
    const groups: AirHour[][] = [];
    for (const h of ahead) {
      const last = groups[groups.length - 1];
      if (last?.[0] && localDay(last[0].t) === localDay(h.t)) last.push(h);
      else groups.push([h]);
    }
    return groups.map((hs) => {
      const max = hs.reduce(
        (a, h) => ((h.usAqi ?? -1) > (a.usAqi ?? -1) ? h : a),
        hs[0] as AirHour,
      );
      const mean = (f: (h: AirHour) => number | null | undefined) => {
        const v = hs.map(f).filter((x): x is number => x != null && Number.isFinite(x));
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      const mx = (f: (h: AirHour) => number | null | undefined) => {
        const v = hs.map(f).filter((x): x is number => x != null && Number.isFinite(x));
        return v.length ? Math.max(...v) : null;
      };
      return {
        t: hs[0]?.t ?? 0,
        hours: hs.length,
        usMax: max.usAqi,
        usMaxAt: max.t,
        dom: modelDominant(max),
        euMax: mx((h) => h.euAqi),
        pm25: mean((h) => h.pm25),
        o3Max: mx((h) => h.o3),
        aod: mean((h) => h.aod),
        uvMax: mx((h) => h.uv),
        dustMax: mx((h) => h.dust),
      };
    });
  });

  // Chart geometry.
  const W = 720;
  const HT = 220;
  const PAD = { l: 34, r: 10, t: 10, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = HT - PAD.t - PAD.b;
  const yMax = $derived(
    Math.max(
      100,
      Math.ceil((Math.max(...ahead.map((h) => h.usAqi ?? 0), headline?.aqi ?? 0) + 20) / 50) * 50,
    ),
  );
  const xOf = (i: number) => PAD.l + (ahead.length > 1 ? (i / (ahead.length - 1)) * iw : 0);
  const yOf = (v: number) => PAD.t + ih - (Math.min(v, yMax) / yMax) * ih;
  const line = (f: (h: AirHour) => number | null | undefined) =>
    ahead
      .map((h, i) => {
        const v = f(h);
        return v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  const usLine = $derived(line((h) => h.usAqi));
  const euLine = $derived(line((h) => h.euAqi));
  const guides = $derived([50, 100, 150, 200, 300].filter((g) => g < yMax));
  const dayTicks = $derived(
    ahead
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i > 0 && localDay(h.t) !== localDay(ahead[i - 1]?.t ?? h.t)),
  );
  let hover = $state<number | null>(null);
  const hoverHour = $derived(hover != null ? (ahead[hover] ?? null) : null);
  function onMove(e: MouseEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    if (ahead.length < 2 || vx < PAD.l - 4 || vx > W - PAD.r + 4) {
      hover = null;
      return;
    }
    hover = Math.min(
      ahead.length - 1,
      Math.max(0, Math.round(((vx - PAD.l) / iw) * (ahead.length - 1))),
    );
  }
  function onKey(e: KeyboardEvent) {
    const i = hover ?? -1;
    if (e.key === 'ArrowRight') hover = Math.min(ahead.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') hover = Math.max(0, i - 1);
    else if (e.key === 'Enter' && hoverHour && onpick) onpick(hoverHour.t);
    else if (e.key === 'Escape') hover = null;
    else return;
    e.preventDefault();
  }

  /** Little PM2.5 day line for a station (oldest left). */
  function spark(series: (number | null)[] | null | undefined): string {
    if (!series?.length) return '';
    const vals = series.filter((x): x is number => x != null);
    if (vals.length < 2) return '';
    const max = Math.max(...vals, 1);
    const len = series.length;
    return series
      .map((v, i) =>
        v == null ? null : `${((len - 1 - i) / (len - 1)) * 96 + 2},${22 - (v / max) * 20}`,
      )
      .filter(Boolean)
      .join(' ');
  }
  const stationType = (s: Station) => (s.monitor ? 'reference monitor' : 'low-cost sensor');
  const NO_EU = 'n/a (CAMS Europe only)';
  const inEurope = $derived(
    !!modelNow && (modelNow.nh3 != null || POLLENS.some((p) => modelNow?.pollen?.[p] != null)),
  );
  const pollenWord = (v: number) =>
    v < 1 ? 'none' : v < 10 ? 'low' : v < 50 ? 'moderate' : v < 200 ? 'high' : 'very high';
  const uvWord = (v: number) =>
    v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'very high' : 'extreme';
  /** UV peak over the whole local day (past hours included: at night the rest of it is dark). */
  const todayUvMax = $derived.by(() => {
    const v = (air?.hours ?? [])
      .filter((h) => localDay(h.t) === localDay(now))
      .map((h) => h.uv)
      .filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  });
  const providers = $derived(
    [
      ...new Set(
        [...(stations?.stations ?? []), ...(stations?.regional ?? [])]
          .map((s) => s.provider)
          .filter(Boolean),
      ),
    ].join(', '),
  );
</script>

<div class="air">
  <!-- ---- now ---- -->
  <div class="now">
    {#if headline}
      {@const c = catOf(headline.aqi)}
      <p class="big">
        <span class="pill {catCls(headline.aqi)}">{headline.aqi}</span>
        US AQI · <strong>{c?.label}</strong>
      </p>
      <p class="sub">
        {#if headline.src === 'measured' && measured}
          Measured now by {measured.used > 1
            ? `${measured.used} monitors near ${placeName}, weighted by distance`
            : `${measured.station.name} (${measured.station.km.toFixed(1)} km)`}. Set by
          <strong>{SHORT[measured.dominant]}</strong> ({measured.parts[0]?.basis}).
        {:else}
          From the CAMS forecast model{modelDominant(modelNow)
            ? `, set by ${SHORT[modelDominant(modelNow) as Pollutant]}`
            : ''}: no monitor reports within 25 km.
        {/if}
      </p>
      <p class="advice">{aqiAdvice(headline.aqi)}</p>
      <dl class="facts">
        {#if measured?.aqi24 != null}
          <dt>Daily (24-h) AQI</dt>
          <dd>
            {measured.aqi24}
            <span class="muted"
              >{catOf(measured.aqi24)?.label} · PM2.5 {n(measured.pm25Mean24, 1)}, PM10 {n(
                measured.pm10Mean24,
                0,
              )} µg/m³ over 24 h (the basis of official daily reports)</span
            >
          </dd>
        {/if}
        {#if headline.src === 'measured' && modelNow?.usAqi != null}
          <dt>Forecast model now</dt>
          <dd>{modelNow.usAqi} <span class="muted">US AQI (CAMS, for comparison)</span></dd>
        {/if}
        {#if modelNow?.euAqi != null}
          <dt>European AQI</dt>
          <dd>
            {modelNow.euAqi}
            <span class="muted">{eaqiLabel(modelNow.euAqi)} (model; EEA bands)</span>
          </dd>
        {/if}
        {#if bias}
          <dt>Model vs monitors</dt>
          <dd>
            PM2.5 {n(bias.c, 1)} µg/m³ in the model, {n(bias.m, 1)} measured:
            <strong
              >{bias.ratio >= 1.25
                ? `model ${bias.ratio.toFixed(1)}× too low`
                : bias.ratio <= 0.8
                  ? `model ${(1 / bias.ratio).toFixed(1)}× too high`
                  : 'they agree'}</strong
            >{bias.ratio >= 1.25 || bias.ratio <= 0.8
              ? '. Expect the forecast hours below to be off in the same way.'
              : '.'}
          </dd>
        {/if}
      </dl>
    {:else if airStatus === 'loading' || stationStatus === 'loading'}
      <p class="muted">Loading air quality…</p>
    {:else}
      <p class="muted">No air-quality data could be loaded for {placeName} right now.</p>
    {/if}
  </div>

  <!-- ---- every pollutant ---- -->
  <h3>Every pollutant now</h3>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" role="region" aria-label="Pollutants now" tabindex="0">
    <table>
      <caption class="visually-hidden">
        Each pollutant now: the measured value with its averaging and US AQI sub-index and where it
        was measured, then the forecast model's concentration and its US and European sub-indices.
      </caption>
      <thead>
        <tr>
          <th scope="col">Pollutant</th>
          <th scope="col">Measured</th>
          <th scope="col">US AQI</th>
          <th scope="col">Station</th>
          <th scope="col">Model µg/m³</th>
          <th scope="col">Model US</th>
          <th scope="col">Model EU</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.k)}
          <tr class:dominant={measured?.dominant === r.k}>
            <th scope="row">{POLLUTANT_LABEL[r.k]}</th>
            <td>
              {#if r.part}
                {n(r.part.value, r.part.unit === 'ppm' ? 2 : 1)}
                {r.part.unit}{#if r.part.unit !== 'µg/m³'}<span class="muted"
                    >{` ≈ ${n(aqiUnitToUgm3(r.part.value, r.k as Gas), 0)} µg/m³`}</span
                  >{/if}
                <span class="muted">· {r.part.basis}</span>
              {:else if r.g && r.g.latest != null}
                {n(r.g.latest, r.g.unit === 'ppm' ? 2 : 1)}
                {r.g.unit}
                <span class="muted"
                  >· {r.gasOld ? `too old (${ago(r.g.time)})` : 'too few hours to average'}</span
                >
              {:else}
                <span class="muted"
                  >{!stationsEnabled
                    ? 'n/a (no monitor source)'
                    : !measured && !stations?.stations.length
                      ? 'n/a (no monitor within 25 km)'
                      : r.k === 'pm25' || r.k === 'pm10'
                        ? 'n/a (not reported nearby)'
                        : stations && !('o3' in (stations.gases ?? {}))
                          ? 'n/a (the data service does not read gases yet)'
                          : 'n/a (no nearby monitor measures it)'}</span
                >
              {/if}
            </td>
            <td>
              {#if r.part}<span class="pill {catCls(r.part.aqi)}">{r.part.aqi}</span>{:else}—{/if}
            </td>
            <td class="muted">
              {#if r.part}
                {r.part.from}{r.part.km != null ? `, ${r.part.km.toFixed(1)} km` : ''} · {ago(
                  r.part.time,
                )}
              {:else if r.g}
                {r.g.name}, {r.g.km.toFixed(1)} km
              {:else}—{/if}
            </td>
            <td>{n(r.modelUg, r.k === 'co' ? 0 : 1)}</td>
            <td>{n(r.modelUs)}</td>
            <td>{r.k === 'co' ? '—' : n(r.modelEu)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="note">
    US AQI = the highest of the sub-indices (EPA). Averaging as the EPA prescribes: PM by the
    NowCast (last 12 h, recent hours weighted more), ozone and CO by the 8-hour mean (ozone's 1-hour
    value counts from 0.125 ppm), NO₂ and SO₂ by the hour (SO₂ by the 24-hour mean from 305 ppb).
    Measured gases are converted to µg/m³ at 25 °C for comparison. Monitors measure at the station,
    the model is a {inEurope ? '~11 km (CAMS Europe)' : '~45 km (CAMS global)'} grid average.
  </p>

  <!-- ---- stations ---- -->
  <h3>Monitoring stations</h3>
  {#if !stationsEnabled}
    <p class="muted">Measured data needs the site's data service, which is not configured here.</p>
  {:else if stationStatus === 'loading' && !stations}
    <p class="muted">Looking for monitors near {placeName}…</p>
  {:else if !stations}
    <p class="muted">
      The monitor data (OpenAQ) could not be reached right now; the model is shown.
    </p>
  {:else if stations.stations.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Monitoring stations" tabindex="0">
      <table>
        <caption class="visually-hidden">
          Every monitoring station read for this place, nearest first, with its share of the blended
          PM2.5 and its last 24 hours of PM2.5.
        </caption>
        <thead>
          <tr>
            <th scope="col">Station</th>
            <th scope="col">Distance</th>
            <th scope="col">Updated</th>
            <th scope="col">PM2.5 now</th>
            <th scope="col">PM2.5 24 h</th>
            <th scope="col">PM10 now</th>
            <th scope="col">AQI</th>
            <th scope="col">Weight</th>
            <th scope="col">Last 24 h</th>
          </tr>
        </thead>
        <tbody>
          {#each stations.stations as s, i (s.name + s.km)}
            <tr>
              <th scope="row">
                {s.name}<span class="muted small"
                  >{s.provider ?? 'unknown network'} · {stationType(s)}</span
                >
              </th>
              <td>{s.km.toFixed(1)} km</td>
              <td>{ago(s.time)}</td>
              <td>{n(s.pm25, 1)}</td>
              <td>{n(s.pm25Mean24, 1)}</td>
              <td>{n(s.pm10, 0)}</td>
              <td><span class="pill {catCls(s.aqi)}">{s.aqi ?? '—'}</span></td>
              <td>
                {#if shares[i]}{Math.round((shares[i] ?? 0) * 100)} %{:else if !isCurrent(s, stations.fetched)}<span
                    class="muted">too old, left out</span
                  >{:else}—{/if}
              </td>
              <td>
                {#if spark(s.pm25Series)}
                  <svg class="spark" viewBox="0 0 100 24" aria-hidden="true"
                    ><polyline points={spark(s.pm25Series)} /></svg
                  >
                {:else}<span class="muted">—</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="note">
      PM in µg/m³. “Now” is the EPA NowCast; the 24-hour mean needs 18 of 24 hours. Weight = share
      of the site's PM2.5 blend (1/(distance + 2 km)²). Reference monitors are used when there are
      any; low-cost sensors only when there are none.
    </p>
  {:else}
    <p class="muted">
      No monitor has reported within 25 km of {placeName} in the last 3 hours, so the figure above is
      the forecast model.
    </p>
  {/if}
  {#if stations?.regional?.length}
    <h4>Nearest monitors further away (reference only)</h4>
    <ul class="regional">
      {#each stations.regional as s (s.name + s.km)}
        <li>
          <strong>{s.name}</strong>, {s.km.toFixed(0)} km
          <span class="muted"
            >({s.provider ?? 'unknown network'}, {stationType(s)}, {ago(s.time)})</span
          >: AQI <span class="pill {catCls(s.aqi)}">{s.aqi}</span> · PM2.5 {n(s.pm25, 1)}, PM10 {n(
            s.pm10,
            0,
          )} µg/m³
        </li>
      {/each}
    </ul>
    <p class="note">
      Too far to stand for the site (air at a dark site is usually cleaner than in the nearest
      town), so they do not change the figure above.
    </p>
  {/if}

  <!-- ---- model extras ---- -->
  <h3>More from the forecast model now</h3>
  {#if modelNow}
    <dl class="facts grid2">
      <dt>Haze (aerosol optical depth)</dt>
      <dd>{n(modelNow.aod, 2)} <span class="muted">at 550 nm; sets transparency</span></dd>
      <dt>Desert dust</dt>
      <dd>{n(modelNow.dust, 0)} µg/m³</dd>
      <dt>UV index</dt>
      <dd>
        {n(modelNow.uv, 1)} now
        <span class="muted"
          >(clear sky {n(modelNow.uvClear, 1)}){#if todayUvMax != null}; today's peak {todayUvMax.toFixed(
              1,
            )}, {uvWord(todayUvMax)}{/if}</span
        >
      </dd>
      <dt>Carbon dioxide</dt>
      <dd>{n(modelNow.co2, 0)} ppm</dd>
      <dt>Methane</dt>
      <dd>{n(modelNow.ch4, 0)} µg/m³</dd>
      <dt>Ammonia</dt>
      <dd>{modelNow.nh3 != null ? `${n(modelNow.nh3, 1)} µg/m³` : NO_EU}</dd>
      <dt>Pollen</dt>
      <dd>
        {#if POLLENS.some((p) => modelNow?.pollen?.[p] != null)}
          {#each POLLENS as p, i (p)}
            {@const v = modelNow.pollen?.[p] ?? null}
            {i ? ' · ' : ''}{p}
            {v == null ? 'n/a' : `${v.toFixed(0)} (${pollenWord(v)})`}
          {/each}
          <span class="muted">grains/m³</span>
        {:else}
          {NO_EU}
        {/if}
      </dd>
    </dl>
  {:else}
    <p class="muted">
      {airStatus === 'loading' ? 'Loading the model…' : 'Model data unavailable.'}
    </p>
  {/if}

  <!-- ---- forecast ---- -->
  <h3>Forecast, next {days.length} days</h3>
  {#if ahead.length > 1}
    <figure class="chart">
      <div
        class="chart-scroll"
        role="slider"
        tabindex="0"
        aria-label="Air-quality forecast chart. Arrow keys move between hours; Enter shows the hour across the site. The tables below have the same data."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, ahead.length - 1)}
        aria-valuenow={hover ?? 0}
        aria-valuetext={hoverHour
          ? `${day(hoverHour.t)} ${fmtHour(hoverHour.t, tz)}: US AQI ${n(hoverHour.usAqi)}, European ${n(hoverHour.euAqi)}`
          : 'No hour selected'}
        onkeydown={onKey}
      >
        <!-- The slider around the chart gives the keyboard the same: arrows, Enter, Escape. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <svg
          viewBox="0 0 {W} {HT}"
          role="img"
          aria-label="US and European AQI forecast"
          onmousemove={onMove}
          onmouseleave={() => (hover = null)}
          onclick={() => hoverHour && onpick?.(hoverHour.t)}
        >
          {#each guides as g (g)}
            <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={yOf(g)} y2={yOf(g)} />
            <text class="ax" x={PAD.l - 4} y={yOf(g) + 4} text-anchor="end">{g}</text>
          {/each}
          {#each dayTicks as d (d.h.t)}
            <line class="day" x1={xOf(d.i)} x2={xOf(d.i)} y1={PAD.t} y2={PAD.t + ih} />
            <text class="ax" x={xOf(d.i) + 3} y={HT - 8}>{day(d.h.t)}</text>
          {/each}
          <text class="ax" x={PAD.l + 2} y={HT - 8}>now</text>
          <polyline class="eu" points={euLine} />
          <polyline class="us" points={usLine} />
          {#if hoverHour && hover != null}
            <line class="nowline" x1={xOf(hover)} x2={xOf(hover)} y1={PAD.t} y2={PAD.t + ih} />
            {#if hoverHour.usAqi != null}
              <circle class="dot" cx={xOf(hover)} cy={yOf(hoverHour.usAqi)} r="4" />
            {/if}
          {/if}
        </svg>
      </div>
      <p class="readout" aria-live="polite">
        {#if hoverHour}
          {day(hoverHour.t)}
          {fmtHour(hoverHour.t, tz)}: US AQI <strong>{n(hoverHour.usAqi)}</strong>
          ({catOf(hoverHour.usAqi)?.label}, {SHORT[modelDominant(hoverHour) ?? 'pm25']}) · European {n(
            hoverHour.euAqi,
          )} · PM2.5 {n(hoverHour.pm25, 1)} · O₃ {n(hoverHour.o3, 0)} · NO₂ {n(hoverHour.no2, 0)} µg/m³
          · haze {n(hoverHour.aod, 2)}
        {:else}
          <span class="muted">Point at the chart (or use the arrow keys) to read an hour.</span>
        {/if}
      </p>
      <figcaption>
        <span class="key"><span class="sw us"></span>US AQI (0–500)</span>
        <span class="key"><span class="sw eu"></span>European AQI (0–100+)</span>
        <span class="key">Lines at 50, 100, 150, 200: category edges of the US AQI</span>
      </figcaption>
    </figure>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Air-quality forecast by day" tabindex="0">
      <table>
        <caption class="visually-hidden">Forecast air quality for each day.</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Worst US AQI</th>
            <th scope="col">Set by</th>
            <th scope="col">Worst EU</th>
            <th scope="col">PM2.5 mean</th>
            <th scope="col">O₃ peak</th>
            <th scope="col">Dust peak</th>
            <th scope="col">Haze mean</th>
            <th scope="col">UV peak</th>
          </tr>
        </thead>
        <tbody>
          {#each days as d (d.t)}
            <tr>
              <th scope="row"
                >{day(d.t)}<span class="muted small">{d.hours < 24 ? `${d.hours} h` : ''}</span></th
              >
              <td>
                <span class="pill {catCls(d.usMax)}">{n(d.usMax)}</span>
                <span class="muted">{fmtHour(d.usMaxAt, tz)}</span>
              </td>
              <td>{d.dom ? SHORT[d.dom] : '—'}</td>
              <td>{n(d.euMax)}</td>
              <td>{n(d.pm25, 1)}</td>
              <td>{n(d.o3Max, 0)}</td>
              <td>{n(d.dustMax, 0)}</td>
              <td>{n(d.aod, 2)}</td>
              <td>{n(d.uvMax, 1)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <details class="hours">
      <summary>Every forecast hour ({ahead.length})</summary>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" role="region" aria-label="Air-quality forecast by hour" tabindex="0">
        <table>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">US AQI</th>
              <th scope="col">EU</th>
              <th scope="col">PM2.5</th>
              <th scope="col">PM10</th>
              <th scope="col">O₃</th>
              <th scope="col">NO₂</th>
              <th scope="col">SO₂</th>
              <th scope="col">CO</th>
              <th scope="col">Dust</th>
              <th scope="col">Haze</th>
            </tr>
          </thead>
          <tbody>
            {#each ahead as h, i (h.t)}
              {@const prev = ahead[i - 1]}
              <tr>
                <th scope="row">
                  {#if onpick}
                    <button type="button" class="hour" onclick={() => onpick?.(h.t)}
                      >{fmtHour(h.t, tz)}</button
                    >
                  {:else}{fmtHour(
                      h.t,
                      tz,
                    )}{/if}{#if !prev || localDay(prev.t) !== localDay(h.t)}<span class="muted">
                      {day(h.t)}</span
                    >{/if}
                </th>
                <td><span class="pill {catCls(h.usAqi)}">{n(h.usAqi)}</span></td>
                <td>{n(h.euAqi)}</td>
                <td>{n(h.pm25, 1)}</td>
                <td>{n(h.pm10, 0)}</td>
                <td>{n(h.o3, 0)}</td>
                <td>{n(h.no2, 0)}</td>
                <td>{n(h.so2, 0)}</td>
                <td>{n(h.co, 0)}</td>
                <td>{n(h.dust, 0)}</td>
                <td>{n(h.aod, 2)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">Concentrations in µg/m³; haze is the aerosol optical depth at 550 nm.</p>
    </details>
  {:else}
    <p class="muted">
      {airStatus === 'loading' ? 'Loading the forecast…' : 'No forecast available yet.'}
    </p>
  {/if}

  <p class="credit">
    {`Measured: OpenAQ (openaq.org) from the agencies that run the monitors${providers ? ` (here ${providers})` : ''}, read every 20 minutes${stations ? ` (last ${fmtTime(stations.fetched, tz)})` : ''}. `}
    {`Model: CAMS (Copernicus Atmosphere Monitoring Service) via Open-Meteo.com (CC BY 4.0), hourly, five days ahead${air?.lat != null ? `, grid point ${air.lat.toFixed(2)}°, ${air.lon?.toFixed(2)}°` : ''}. `}
    AQI rules: US EPA Technical Assistance Document (May 2026); European AQI as computed by Open-Meteo
    with the EEA bands.
  </p>
</div>

<style>
  .air {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s3);
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2);
  }
  .big .pill {
    font-size: var(--fs-24);
    padding: 2px 10px;
  }
  .sub {
    margin: var(--s2) 0 0;
    color: var(--text-2);
  }
  .advice {
    margin: var(--s2) 0 var(--s3);
  }
  .muted {
    color: var(--text-2);
  }
  .small {
    display: block;
    font-size: var(--fs-12);
    font-weight: 400;
  }
  h3 {
    margin: var(--s3) 0 0;
    font-size: var(--fs-16);
  }
  h4 {
    margin: var(--s2) 0 0;
    font-size: var(--fs-14);
  }
  .facts {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: var(--s1) var(--s3);
    margin: 0;
    font-size: var(--fs-14);
  }
  .facts dt {
    color: var(--text-2);
  }
  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .note,
  .credit {
    margin: 0;
    font-size: var(--fs-12);
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
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
    vertical-align: top;
  }
  thead th {
    font-size: var(--fs-12);
    color: var(--text-2);
    font-weight: 600;
  }
  tr.dominant th {
    color: var(--brass);
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
  .spark {
    width: 100px;
    height: 24px;
    display: block;
  }
  .spark polyline {
    fill: none;
    stroke: var(--chart-cool);
    stroke-width: 1.5;
  }
  .regional {
    margin: 0;
    padding-left: 1.2em;
    font-size: var(--fs-14);
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
    width: 100%;
    min-width: 560px;
    height: auto;
    display: block;
    cursor: crosshair;
    touch-action: pan-y;
  }
  .spark {
    min-width: 0;
    cursor: default;
  }
  .grid {
    stroke: var(--rule);
    stroke-width: 1;
  }
  .day {
    stroke: var(--ui-line);
    stroke-dasharray: 3 3;
  }
  .ax {
    fill: var(--text-2);
    font-size: 11px;
    font-family: var(--font-ui);
  }
  .us {
    fill: none;
    stroke: var(--brass);
    stroke-width: 2;
  }
  .eu {
    fill: none;
    stroke: var(--chart-cool);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .nowline {
    stroke: var(--text);
    stroke-width: 1;
  }
  .dot {
    fill: var(--brass);
    stroke: var(--ink-1);
    stroke-width: 2;
  }
  .readout {
    min-height: 3em;
    margin: var(--s2) 0 0;
    font-size: var(--fs-14);
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
    height: 3px;
  }
  .sw.us {
    background: var(--brass);
  }
  .sw.eu {
    background: var(--chart-cool);
  }
  details.hours > summary {
    cursor: pointer;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    color: var(--brass);
  }
  button.hour {
    min-height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--brass);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
</style>
