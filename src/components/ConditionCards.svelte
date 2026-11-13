<script lang="ts">
  import Card from './Card.svelte';
  import type { HourRow, MoonEvents, TwilightTimes } from '../lib/conditions';
  import { transparencyClass } from '../lib/physics/extinction';
  import { MODEL_LABELS } from '../lib/data/openmeteo';
  import { moonPhaseName } from '../lib/astro/sky';
  import { fmtTime } from '../lib/time/format';
  import * as Astronomy from 'astronomy-engine';
  import {
    TRANSPARENCY_CLASSES,
    seeingClassText,
    sevenTimerAt,
    type SevenTimer,
  } from '../lib/data/seventimer';

  interface Props {
    row: HourRow | null;
    moon: MoonEvents;
    tw: TwilightTimes;
    tz: string | undefined;
    /** Infrared satellite summary at the site (null without the data Worker). */
    satellite?: {
      frac: number | null;
      meanK: number | null;
      time: number;
      weight: number;
      now: number | null;
    } | null;
    /** 7Timer! second opinion (seeing, transparency), if loaded. */
    sevenTimer?: SevenTimer | null;
    loading: boolean;
  }
  let { row, moon, tw, tz, satellite = null, sevenTimer = null, loading }: Props = $props();

  const st = $derived(sevenTimer && row ? sevenTimerAt(sevenTimer, row.t) : null);
  const transpText = (c: number) => {
    const r = TRANSPARENCY_CLASSES[c - 1];
    if (!r) return '—';
    return r[1] === Infinity ? `>${r[0]}` : r[0] === 0 ? `<${r[1]}` : `${r[0]}–${r[1]}`;
  };

  /** "1 h 10 min" between the image and the time shown. */
  const ago = (ms: number) => {
    const m = Math.round(Math.abs(ms) / 60_000);
    const s = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    return ms >= 0 ? `${s} before` : `${s} after`;
  };

  const w = $derived(row?.weather ?? null);
  const n = (v: number | null | undefined, d = 0, unit = '') =>
    v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`;

  const COMPASS = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const compass = (deg: number | null | undefined) =>
    deg == null ? '' : (COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? '');

  const AQI_US = [
    [50, 'Good'],
    [100, 'Moderate'],
    [150, 'Unhealthy for sensitive groups'],
    [200, 'Unhealthy'],
    [300, 'Very unhealthy'],
    [Infinity, 'Hazardous'],
  ] as const;
  const aqiLabel = (v: number | null | undefined) =>
    v == null ? '' : (AQI_US.find(([max]) => v <= max)?.[1] ?? '');

  const DEW_TEXT = {
    none: 'No dew expected',
    low: 'Low dew risk',
    moderate: 'Dew likely later — consider a dew heater',
    high: 'Dew forming on optics — use dew heaters',
  } as const;

  const sunAltNow = $derived(row?.sunAlt ?? null);
  function skyState(alt: number | null): string {
    if (alt == null) return '';
    if (alt > -0.833) return 'Daylight';
    if (alt > -6) return 'Civil twilight';
    if (alt > -12) return 'Nautical twilight';
    if (alt > -18) return 'Astronomical twilight';
    return 'Astronomical darkness';
  }

  // Lunar phase name from the ecliptic elongation (0 new … 180 full).
  const phaseName = $derived(moonPhaseName(Astronomy.MoonPhase(new Date(row?.t ?? Date.now()))));
  const bar = (v: number | null | undefined) => `${Math.min(100, Math.max(0, v ?? 0))}%`;
</script>

<div class="grid">
  <Card title="Clouds" tag="forecast" credit="Weather data by Open-Meteo.com">
    {#if w}
      <p class="big">{n(w.cloud, 0, '%')} <span class="sub">total cover</span></p>
      <ul class="layers" aria-label="Cloud cover by layer">
        {#each [['Low', w.cloudLow], ['Mid', w.cloudMid], ['High', w.cloudHigh]] as const as [label, value] (label)}
          <li>
            <span class="lbl">{label}</span>
            <span class="track" aria-hidden="true"
              ><span class="fill" style:width={bar(value)}></span></span
            >
            <span class="val">{n(value, 0, '%')}</span>
          </li>
        {/each}
      </ul>
      {#if row}
        <p class="agree agree-{row.agreement}">
          Model agreement: <strong>{row.agreement}</strong>
          {#if row.cloudSpread != null}(spread {row.cloudSpread.toFixed(0)} points){/if}
        </p>
        <p class="models">
          {#each Object.entries(row.modelClouds) as [m, c] (m)}
            <span>{MODEL_LABELS[m] ?? m}: {n(c, 0, '%')}</span>
          {/each}
        </p>
      {/if}
    {:else}
      <p class="muted">{loading ? 'Loading forecast…' : 'No forecast available yet.'}</p>
    {/if}
  </Card>

  {#if satellite}
    <Card
      title="Clouds now"
      tag="satellite + model"
      credit="NOAA/NESDIS GMGSI infrared · model: Open-Meteo.com"
    >
      <p class="big">{n(satellite.now, 0, '%')} <span class="sub">best estimate</span></p>
      <p class="kv">
        <span
          >Satellite: <strong
            >{satellite.frac == null ? 'no data' : n(satellite.frac * 100, 0, '%')}</strong
          >{#if satellite.meanK != null}
            <span class="muted">(cloud tops / ground {n(satellite.meanK - 273.15, 0, ' °C')})</span
            >{/if}</span
        >
        <span>Model: <strong>{n(w?.cloud, 0, '%')}</strong></span>
      </p>
      <p class="muted small">
        Infrared image from {fmtTime(satellite.time, tz)}{#if row}, {ago(row.t - satellite.time)} the
          time shown{/if}. Satellite weight {Math.round(satellite.weight * 100)} %, fading as the image
        ages. Infrared cannot see low fog or stratus (as warm as the ground), so the forecast still counts.
      </p>
    </Card>
  {/if}

  <Card title="Transparency" tag="forecast" credit="CAMS ENSEMBLE data provider · Open-Meteo.com">
    {#if row?.extinction}
      <p class="big">
        {row.extinction.total.toFixed(2)} <span class="sub">mag/airmass (V)</span>
      </p>
      <p class="rating">{transparencyClass(row.extinction.total)}</p>
      <dl>
        <dt>Aerosol optical depth</dt>
        <dd>{n(row.aod, 2)} at 550 nm</dd>
        <dt>Breakdown</dt>
        <dd>
          air {row.extinction.rayleigh.toFixed(2)} · aerosol {row.extinction.aerosol.toFixed(2)} · ozone
          {row.extinction.ozone.toFixed(2)}
        </dd>
        {#if st?.transparency}
          <dt>7Timer! (2nd opinion)</dt>
          <dd>{transpText(st.transparency)} mag/airmass</dd>
        {/if}
      </dl>
    {:else}
      <p class="muted">{loading ? 'Loading aerosol forecast…' : 'Aerosol data unavailable.'}</p>
    {/if}
  </Card>

  <Card
    title="Seeing"
    tag="forecast · estimate"
    credit="Upper-air winds: Open-Meteo.com · second opinion: 7Timer! ASTRO (7timer.info)"
  >
    {#if row?.seeing}
      <p class="big">
        ≈{row.seeing.range[0].toFixed(1)}–{row.seeing.range[1].toFixed(1)}″
        <span class="sub">FWHM</span>
      </p>
      <p class="rating">
        {row.seeing.label}
        <span class="sub">({row.seeing.rating}/5)</span>
      </p>
      <dl>
        <dt>Jet stream</dt>
        <dd>
          {w
            ? `250 hPa ${n(w.upper[250].speed, 0, ' km/h')} ${compass(w.upper[250].dir)} · `
            : ''}rms 5–12 km {(row.seeing.jetMs * 3.6).toFixed(0)} km/h → {row.seeing.parts.jet.toFixed(
            2,
          )}″
        </dd>
        <dt>Lower air</dt>
        <dd>
          {row.seeing.shearMs != null
            ? `${(row.seeing.shearMs * 3.6).toFixed(0)} km/h shear`
            : 'no shear data'} → {row.seeing.parts.lower.toFixed(2)}″
        </dd>
        <dt>Ground layer</dt>
        <dd>{row.seeing.parts.ground.toFixed(1)}″ assumed (local, not forecastable)</dd>
        <dt>7Timer!</dt>
        <dd>
          {st?.seeing ? `${seeingClassText(st.seeing)} (class ${st.seeing}/8)` : 'not loaded'}
        </dd>
      </dl>
      <p class="muted small">
        {#if row.sunAlt > -6}Daytime: ground heating makes real seeing worse than this night-time
          model.
        {/if}No free source measures live seeing; both values are forecasts from model winds.
      </p>
    {:else}
      <p class="muted">{loading ? 'Loading upper-air winds…' : 'Upper-air winds unavailable.'}</p>
    {/if}
  </Card>

  <Card title="Sky quality (SQM / Bortle)" tag="coming soon">
    <p class="muted">
      Needs the yearly light-pollution map, which is built in a later phase. It will be based on
      NASA Black Marble night lights; note that satellites under-count blue/white LED light.
    </p>
  </Card>

  <Card title="Air quality" tag="forecast" credit="CAMS ENSEMBLE data provider · Open-Meteo.com">
    {#if row?.air}
      {@const a = row.air}
      <dl>
        <dt>US AQI</dt>
        <dd>{n(a.usAqi)} <span class="sub">{aqiLabel(a.usAqi)}</span></dd>
        <dt>European AQI</dt>
        <dd>{n(a.euAqi)}</dd>
        <dt>PM2.5 / PM10</dt>
        <dd>{n(a.pm25, 1)} / {n(a.pm10, 1, ' µg/m³')}</dd>
        <dt>Dust</dt>
        <dd>{n(a.dust, 0, ' µg/m³')}</dd>
      </dl>
    {:else}
      <p class="muted">{loading ? 'Loading…' : 'Air-quality data unavailable.'}</p>
    {/if}
  </Card>

  <Card title="Temperature & dew" tag="forecast" credit="Weather data by Open-Meteo.com">
    {#if w}
      <dl>
        <dt>Temperature</dt>
        <dd>{n(w.temperature, 1, ' °C')}</dd>
        <dt>Dew point</dt>
        <dd>
          {n(w.dewPoint, 1, ' °C')}
          <span class="sub">(spread {n(row?.dew?.spread, 1, ' °C')})</span>
        </dd>
        <dt>Humidity</dt>
        <dd>{n(w.humidity, 0, '%')}</dd>
        <dt>Pressure</dt>
        <dd>{n(w.pressure, 0, ' hPa')} <span class="sub">at the site</span></dd>
      </dl>
      {#if row?.dew}
        <p class="dew dew-{row.dew.risk}" role={row.dew.risk === 'high' ? 'alert' : undefined}>
          {DEW_TEXT[row.dew.risk]}
        </p>
        <p class="muted small">Estimate: clear calm skies cool optics ~3 °C below the air.</p>
      {/if}
    {/if}
  </Card>

  <Card title="Wind" tag="forecast" credit="Weather data by Open-Meteo.com">
    {#if w}
      <p class="big">{n(w.wind, 0, ' km/h')} <span class="sub">{compass(w.windDir)}</span></p>
      <dl>
        <dt>Gusts</dt>
        <dd>{n(w.gusts, 0, ' km/h')}</dd>
        <dt>Visibility</dt>
        <dd>{w.visibility == null ? '—' : `${(w.visibility / 1000).toFixed(0)} km`}</dd>
      </dl>
    {/if}
  </Card>

  <Card title="Moon" credit="Astronomy Engine">
    <p class="big">{(moon.illumination * 100).toFixed(0)}% <span class="sub">{phaseName}</span></p>
    <dl>
      <dt>Altitude now</dt>
      <dd>{n(row?.moonAlt, 1, '°')}</dd>
      <dt>Rises</dt>
      <dd>{fmtTime(moon.rise, tz)}</dd>
      <dt>Sets</dt>
      <dd>{fmtTime(moon.set, tz)}</dd>
    </dl>
  </Card>

  <Card title="Darkness" credit="Astronomy Engine">
    <p class="big">{n(sunAltNow, 1, '°')} <span class="sub">{skyState(sunAltNow)}</span></p>
    <dl>
      <dt>Sunset</dt>
      <dd>{fmtTime(tw.sunset, tz)}</dd>
      <dt>Astronomical dark</dt>
      <dd>
        {tw.astroEnd
          ? `${fmtTime(tw.astroEnd, tz)} – ${fmtTime(tw.astroStart, tz)}`
          : 'none tonight'}
      </dd>
      <dt>Nautical</dt>
      <dd>{fmtTime(tw.nauticalEnd, tz)} – {fmtTime(tw.nauticalStart, tz)}</dd>
      <dt>Sunrise</dt>
      <dd>{fmtTime(tw.sunrise, tz)}</dd>
    </dl>
  </Card>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--gap);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  }
  .big {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 6px;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 12px;
    margin-top: 2px;
  }
  .kv {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0 0 6px;
    font-size: 14px;
  }
  .rating {
    margin: -4px 0 8px;
    text-transform: capitalize;
    color: var(--accent);
  }
  .layers {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .layers li {
    display: grid;
    grid-template-columns: 40px 1fr 44px;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .lbl {
    color: var(--muted);
  }
  .val {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 8px;
    border-radius: 4px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--muted);
  }
  .agree {
    margin: 0;
    font-size: 13px;
  }
  .agree-high strong {
    color: var(--good);
  }
  .agree-medium strong {
    color: var(--warn);
  }
  .agree-low strong {
    color: var(--bad);
  }
  .models {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .dew {
    margin: 0;
    font-weight: 500;
  }
  .dew-none,
  .dew-low {
    color: var(--good);
  }
  .dew-moderate {
    color: var(--warn);
  }
  .dew-high {
    color: var(--bad);
  }
</style>
