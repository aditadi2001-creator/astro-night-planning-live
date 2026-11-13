<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from './components/TopBar.svelte';
  import SkyView from './components/SkyView.svelte';
  import TimeControls from './components/TimeControls.svelte';
  import ConditionCards from './components/ConditionCards.svelte';
  import Timeline from './components/Timeline.svelte';
  import DataStatus from './components/DataStatus.svelte';
  import Layers, { type LayerState, type SurveyStatus } from './components/Layers.svelte';
  import Extras from './components/Extras.svelte';
  import WeekAhead from './components/WeekAhead.svelte';
  import { weekAhead } from './lib/clouds/week';
  import {
    AURORA_MIN_LAT,
    loadAurora,
    loadKp,
    type AuroraSite,
    type KpPoint,
  } from './lib/space/aurora';
  import { loadOrbits, ORBITS_URL, type Orbits } from './lib/space/orbits';
  import PhysicsPanel from './components/PhysicsPanel.svelte';
  import Credits from './pages/Credits.svelte';
  import About from './pages/About.svelte';
  import { loadPlace, savePlace } from './lib/location';
  import type { Place } from './lib/astro/sky';
  import { LiveSource } from './lib/data/live.svelte';
  import {
    hourAt,
    loadAir,
    loadCloudRing,
    loadModelClouds,
    loadWeather,
    type Air,
    type CloudRing,
    type ModelClouds,
    type Weather,
  } from './lib/data/openmeteo';
  import { buildRow, buildTimeline, moonEvents, twilight } from './lib/conditions';
  import { estimateClouds, timelineEnd, timelineStart, type SatObs } from './lib/clouds/estimate';
  import { colourExcessPerAirmass, zenithExtinction } from './lib/physics/extinction';
  import { limitingMagnitude, zenithSkyBrightness } from './lib/physics/skybrightness';
  import { cloudColors, type CloudInput } from './lib/sky/clouds';
  import { groundColor } from './lib/sky/horizon';
  import {
    DEM_BASE,
    hasCachedHorizon,
    loadHorizon,
    shouldSaveData,
    type SiteHorizon,
  } from './lib/sky/dem';
  import type { EngineAtmosphere, EngineSurvey } from './lib/engine/stel';
  import { pickServer, SURVEYS, surveyById } from './lib/sky/surveys';
  import { GMGSI_INDEX_URL } from './lib/sat/gmgsi';
  import { loadSatellite, type SatelliteSample } from './lib/sat/satellite';
  import { SEVEN_TIMER_ENABLED, loadSevenTimer, type SevenTimer } from './lib/data/seventimer';
  import { LP_INFO_URL, loadSiteLight, type SiteLight } from './lib/lp/lightpollution';
  import {
    blendLayers,
    blendSamples,
    cloudsNow,
    irCloudFraction,
    satelliteWeight,
    type SatPoint,
  } from './lib/sat/ir';

  const WEATHER_INTERVAL = 30 * 60_000;

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  /** The moment the sky and cards show; follows `now` while live. */
  let shown = $state(new Date());
  let live = $state(true);
  let route = $state(location.hash);
  let night = $state(readNight());
  let layers = $state<LayerState>({
    clouds: true,
    haze: true,
    terrain: true,
    constellations: true,
    satmap: false,
    lightpollution: true,
    surveys: false,
    survey: SURVEYS[0]?.id ?? 'dss',
    surveyOpacity: 0.8,
  });

  // ---- optional sky survey: find a server only once the user turns it on ----------
  let surveyStatus = $state<SurveyStatus>({ state: 'off' });
  let surveyUrl = $state<string | null>(null);
  $effect(() => {
    const on = layers.surveys;
    const survey = surveyById(layers.survey);
    surveyUrl = null;
    if (!on || !survey) {
      surveyStatus = { state: 'off' };
      return;
    }
    let cancelled = false;
    surveyStatus = { state: 'loading' };
    void pickServer(survey).then((src) => {
      if (cancelled) return;
      surveyStatus = src ? { state: 'ready', host: src.host } : { state: 'down' };
      surveyUrl = src?.url ?? null;
    });
    return () => {
      cancelled = true;
    };
  });
  const engineSurvey = $derived.by((): EngineSurvey | null => {
    const survey = surveyById(layers.survey);
    if (!layers.surveys || !survey || !surveyUrl) return null;
    return {
      url: surveyUrl,
      galactic: survey.frame === 'galactic',
      opacity: layers.surveyOpacity,
    };
  });
  let cursor = $state<{ alt: number; az: number } | null>(null);

  // ---- live data sources, recreated per location --------------------------------
  type Sources = {
    weather: LiveSource<Weather>;
    models: LiveSource<ModelClouds>;
    air: LiveSource<Air>;
    ring: LiveSource<CloudRing>;
    /** Infrared satellite around the site (only with the data Worker). */
    satellite: LiveSource<SatelliteSample> | null;
    /** 7Timer! second opinion via the data Worker (updates every 3 h). */
    sevenTimer: LiveSource<SevenTimer> | null;
    /** Yearly light-pollution map at the site (only with the data Worker). */
    light: LiveSource<SiteLight> | null;
    /** OVATION aurora chance (only 40° or more from the equator: the feed is ~0.9 MB). */
    aurora: LiveSource<AuroraSite> | null;
  };
  let sources = $state<Sources | null>(null);

  $effect(() => {
    const lat = place.lat;
    const lon = place.lon;
    const s: Sources = {
      weather: new LiveSource(
        'weather',
        (sig, f) => loadWeather(lat, lon, sig, f),
        WEATHER_INTERVAL,
      ),
      models: new LiveSource(
        'models',
        (sig, f) => loadModelClouds(lat, lon, sig, f),
        WEATHER_INTERVAL,
      ),
      air: new LiveSource('air', (sig, f) => loadAir(lat, lon, sig, f), WEATHER_INTERVAL),
      // Surrounding cloud field changes slowly; hourly is plenty.
      ring: new LiveSource('ring', (sig, f) => loadCloudRing(lat, lon, sig, f), 60 * 60_000),
      // New GMGSI hours arrive hourly (~40 min after the hour).
      satellite: GMGSI_INDEX_URL
        ? new LiveSource(
            'satellite',
            (sig, f) => loadSatellite(lat, lon, sig, f),
            30 * 60_000,
            3 * 3600_000,
          )
        : null,
      sevenTimer: SEVEN_TIMER_ENABLED
        ? new LiveSource('7timer', (sig, f) => loadSevenTimer(lat, lon, sig, f), 3 * 3600_000)
        : null,
      // Yearly data: look once a day for a new year, keep the last good copy for months.
      light: LP_INFO_URL
        ? new LiveSource(
            'light',
            (sig, f) => loadSiteLight(lat, lon, sig, f),
            24 * 3600_000,
            400 * 24 * 3600_000,
          )
        : null,
      aurora:
        Math.abs(lat) >= AURORA_MIN_LAT
          ? new LiveSource(
              'aurora',
              (sig, f) => loadAurora(lat, lon, sig, f),
              30 * 60_000,
              3 * 3600_000,
            )
          : null,
    };
    sources = s;
    // Loaders answer from the cache when it is fresh, and fall back to the last
    // good copy (marked stale) when the network fails.
    const stops = [s.weather.start(), s.models.start(), s.air.start(), s.ring.start()];
    if (s.satellite) stops.push(s.satellite.start());
    if (s.sevenTimer) stops.push(s.sevenTimer.start());
    if (s.light) stops.push(s.light.start());
    if (s.aurora) stops.push(s.aurora.start());
    return () => stops.forEach((stop) => stop());
  });

  // Site-independent sources: geomagnetic index and satellite orbits.
  const kpSource = new LiveSource<KpPoint[]>(
    'kp',
    (sig, f) => loadKp(sig, f),
    3 * 3600_000,
    12 * 3600_000,
  );
  // Orbits come from our own R2 copy (refreshed every 6 h by the hourly job).
  const orbitSource = ORBITS_URL
    ? new LiveSource<Orbits>(
        'orbits',
        (sig, f) => loadOrbits(sig, f),
        60 * 60_000,
        3 * 24 * 3600_000,
      )
    : null;
  // Started once (untracked): start() reads the sources' own state, and a tracked
  // read would restart them on every update.
  onMount(() => {
    const stops = [kpSource.start()];
    if (orbitSource) stops.push(orbitSource.start());
    return () => stops.forEach((stop) => stop());
  });

  const weather = $derived(sources?.weather.data ?? null);
  const models = $derived(sources?.models.data ?? null);
  const air = $derived(sources?.air.data ?? null);
  const ring = $derived(sources?.ring.data ?? null);
  const satellite = $derived(sources?.satellite?.data ?? null);
  const sevenTimer = $derived(sources?.sevenTimer?.data ?? null);
  /** Light pollution at the site, or null (layer off, not published yet, or no Worker). */
  const siteLight = $derived(layers.lightpollution ? (sources?.light?.data ?? null) : null);
  const darkSkyMag = $derived(siteLight?.sqm);

  // ---- terrain horizon (Copernicus DEM, cached per site) ----------------------------
  let siteHorizon = $state<SiteHorizon | null>(null);
  let horizonState = $state<'off' | 'loading' | 'ok' | 'error' | 'saved'>(
    DEM_BASE ? 'loading' : 'off',
  );
  let forceTerrain = $state(false);
  $effect(() => {
    const lat = place.lat;
    const lon = place.lon;
    // GPS without altitude or unknown elevation: let the DEM decide.
    const elev = place.needsElevation ? null : place.elevation;
    const force = forceTerrain;
    if (!DEM_BASE || !layers.terrain) return;
    siteHorizon = null;
    // Respect Data Saver / slow connections unless this site is already cached.
    if (!force && shouldSaveData() && !hasCachedHorizon(lat, lon, elev)) {
      horizonState = 'saved';
      return;
    }
    const ctrl = new AbortController();
    horizonState = 'loading';
    // Wait until the page is idle so terrain never delays the first screen.
    const start = () =>
      loadHorizon(lat, lon, elev, ctrl.signal)
        .then((h) => {
          siteHorizon = h;
          horizonState = h ? 'ok' : 'off';
        })
        .catch(() => {
          if (!ctrl.signal.aborted) horizonState = 'error';
        });
    // Called as methods of window (an unbound requestIdleCallback throws
    // "Illegal invocation"); the timeout makes sure it runs on a busy page too.
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const handle = hasIdle
      ? window.requestIdleCallback(start, { timeout: 3000 })
      : window.setTimeout(start, 1500);
    return () => {
      ctrl.abort();
      if (hasIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  });
  const horizonSource = $derived(
    horizonState === 'ok' && siteHorizon?.tiles
      ? `Copernicus DEM terrain (site ${siteHorizon.siteElevation} m)`
      : horizonState === 'ok'
        ? 'flat (sea or no terrain data)'
        : horizonState === 'loading'
          ? 'loading terrain…'
          : horizonState === 'saved'
            ? 'flat (terrain skipped to save data)'
            : horizonState === 'error'
              ? 'flat (terrain unavailable right now)'
              : 'flat mathematical horizon',
  );
  /** Site time zone: geocoder's, else the forecast's, else the browser's. */
  const tz = $derived(place.timezone ?? weather?.timezone);

  // Fill a missing elevation (GPS without altitude) from the forecast terrain model.
  $effect(() => {
    if (place.needsElevation && weather) {
      setPlace({ ...place, elevation: Math.round(weather.elevation), needsElevation: false });
    }
  });

  // ---- derived conditions ---------------------------------------------------------
  // Recompute at most once a minute in live mode (inputs are hourly).
  const minute = $derived(Math.floor(shown.getTime() / 60_000) * 60_000);
  const mean = (a: readonly number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  // ---- clouds: model consensus, corrected by the satellite, recorded for past hours ----
  const utcOff = $derived(weather?.utcOffsetSeconds ?? 0);
  const satObs = $derived.by<SatObs[]>(() => {
    if (!satellite) return [];
    return (satellite.history ?? [])
      .map((h) => {
        const w = weather ? hourAt(weather.hours, h.time) : null;
        const sk = w?.temperature != null ? w.temperature + 273.15 : Number.NaN;
        return { time: h.time, frac: irCloudFraction(h.site, sk) ?? 0, meanK: mean(h.site) };
      })
      .filter((o) => Number.isFinite(o.frac));
  });
  const nowMin = $derived(Math.floor(now.getTime() / 600_000) * 600_000);
  const cloudAt = (t: number) => estimateClouds(t, nowMin, models, weather, satObs);
  const hourStart = (t: number) =>
    Math.floor((t + utcOff * 1000) / 3600_000) * 3600_000 - utcOff * 1000;
  const row = $derived(
    buildRow(minute, place, weather, models, air, darkSkyMag, cloudAt(hourStart(minute))),
  );
  const tw = $derived(twilight(place, new Date(minute)));
  // ---- satellite + model "clouds now" ---------------------------------------------
  const satWeight = $derived(satellite ? satelliteWeight((minute - satellite.time) / 3600_000) : 0);
  const surfaceK = $derived(
    row.weather?.temperature != null ? row.weather.temperature + 273.15 : Number.NaN,
  );
  const satPoint = (bt: readonly number[]): SatPoint => ({
    frac: irCloudFraction(bt, surfaceK),
    meanK: mean(bt),
  });
  const satSite = $derived(satellite ? satPoint(satellite.site) : null);
  const satRing = $derived(satellite ? satellite.ring.map(satPoint) : []);
  const satSummary = $derived(
    satellite && satSite
      ? {
          frac: satSite.frac,
          meanK: satSite.meanK,
          time: satellite.time,
          weight: satWeight,
          // The hour's figure already holds the satellite correction (clouds/estimate.ts).
          now: row.cloud?.total ?? cloudsNow(row.weather?.cloud ?? null, satSite.frac, satWeight),
        }
      : null,
  );
  const moon = $derived(moonEvents(place, new Date(minute)));
  // ---- realism inputs for the sky engine -----------------------------------------
  const pressure = $derived(row.weather?.pressure ?? null);
  const temperature = $derived(row.weather?.temperature ?? null);
  const stdPressure = $derived(1013.25 * Math.exp(-place.elevation / 8434));
  const ext = $derived(row.extinction ?? zenithExtinction(pressure ?? stdPressure, 0.1));
  const dbv = $derived(colourExcessPerAirmass(pressure ?? stdPressure, row.aod ?? 0.1));
  const sky = $derived(
    zenithSkyBrightness({
      sunAlt: row.sunAlt,
      moonAlt: row.moonAlt,
      moonPhaseAngle: row.moonPhaseAngle,
      extinction: ext.total,
      ...(darkSkyMag != null ? { baseMag: darkSkyMag } : {}),
    }),
  );
  const limitMag = $derived(limitingMagnitude(sky.nl));
  const engineAtmosphere = $derived<EngineAtmosphere | null>(
    layers.haze ? { pressure, temperature, k: ext.total, dbv, limitMag } : null,
  );

  const lighting = $derived({
    sunAlt: row.sunAlt,
    moonAlt: row.moonAlt,
    moonIllum: moon.illumination,
  });
  // Drift time quantised to 30 s so the cloud texture is rebuilt at most twice a minute.
  const driftT = $derived(Math.floor(shown.getTime() / 30_000) * 30);
  const cloudInput = $derived.by<Omit<CloudInput, 'width' | 'height'> | null>(() => {
    const w = row.weather;
    if (!layers.clouds || !w || w.cloudLow == null || w.cloudMid == null || w.cloudHigh == null)
      return null;
    const r = ring ? hourAt(ring.hours, minute) : null;
    const samples =
      ring && r
        ? ring.points.map((p, i) => ({
            ...p,
            low: r.low[i] ?? w.cloudLow ?? 0,
            mid: r.mid[i] ?? w.cloudMid ?? 0,
            high: r.high[i] ?? w.cloudHigh ?? 0,
          }))
        : [];
    const wind = (l: 850 | 500 | 250) => ({
      speed: w.upper[l].speed ?? 0,
      dir: w.upper[l].dir ?? 270,
    });
    const center = { low: w.cloudLow, mid: w.cloudMid, high: w.cloudHigh };
    return {
      // Observed cloud from the satellite moves the forecast towards reality,
      // direction by direction (weight fades with the image's age).
      // The site's layers already carry the satellite correction (clouds/estimate.ts).
      center: row.cloud ? center : satSite ? blendLayers(center, satSite, satWeight) : center,
      samples:
        satRing.length === samples.length ? blendSamples(samples, satRing, satWeight) : samples,
      wind: { low: wind(850), mid: wind(500), high: wind(250) },
      time: driftT,
      // City glow lights clouds from below (orange), scaled by the light pollution.
      color: cloudColors(
        lighting.sunAlt,
        lighting.moonAlt,
        lighting.moonIllum,
        siteLight ? Math.min(1, siteLight.brightening / 3.5) : 0,
      ),
    };
  });
  const ground = $derived(groundColor(lighting.sunAlt, lighting.moonAlt, lighting.moonIllum));
  // Round the colour so the terrain texture is not rebuilt every minute for invisible changes.
  const groundKey = $derived(ground.map((c) => Math.round(c)).join(','));
  const groundRgb = $derived(groundKey.split(',').map(Number) as [number, number, number]);
  // Light domes appear once the sky darkens after sunset (full strength by −12°).
  // Rounded so the terrain texture is not rebuilt every minute.
  const domeStrength = $derived(
    Math.round(Math.min(1, Math.max(0, (-4 - row.sunAlt) / 8)) * 20) / 20,
  );
  const domeGlow = $derived(
    siteLight && domeStrength > 0
      ? { domes: siteLight.domes, zenith: siteLight.ratio, strength: domeStrength }
      : null,
  );

  // Seven nights of model clouds (recomputed every 10 minutes at most).
  const week = $derived(weekAhead(place, models, weather, satObs, nowMin, utcOff));
  // Three hours back (recorded) to the coming 05:00 (forecast).
  const timeline = $derived(
    buildTimeline(
      place,
      { start: timelineStart(nowMin, utcOff), end: timelineEnd(nowMin, utcOff) },
      weather,
      models,
      air,
      darkSkyMag,
      cloudAt,
    ),
  );

  $effect(() => {
    const t = setInterval(() => {
      now = new Date();
      if (live) shown = now;
    }, 1000);
    const onHash = () => (route = location.hash);
    addEventListener('hashchange', onHash);
    return () => {
      clearInterval(t);
      removeEventListener('hashchange', onHash);
    };
  });

  /** Night mode is remembered on this device (a red screen at 2 AM should stay red). */
  function readNight(): boolean {
    try {
      return localStorage.getItem('anp:night') === '1';
    } catch {
      return false;
    }
  }
  $effect(() => {
    document.documentElement.dataset.night = String(night);
    // Phone status bar / browser chrome: black in night mode.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', night ? '#000000' : '#05070d');
    try {
      localStorage.setItem('anp:night', night ? '1' : '0');
    } catch {
      /* private mode: not remembered */
    }
  });

  function setPlace(p: Place) {
    place = p;
    savePlace(p);
  }

  function setTime(t: Date, isLive: boolean) {
    live = isLive;
    shown = t;
  }
</script>

<a class="skip" href="#main">Skip to content</a>
<TopBar {place} {now} {tz} bind:night onplace={setPlace} />

<main id="main">
  {#if route === '#/credits'}
    <Credits />
  {:else if route === '#/about'}
    <About />
  {:else}
    <div class="stack">
      <div class="controls">
        <TimeControls {place} time={shown} {live} {tz} onchange={setTime} />
        {#if sources}
          <DataStatus
            now={now.getTime()}
            sources={[
              { label: 'Weather', source: sources.weather },
              { label: 'Models', source: sources.models },
              { label: 'Air quality', source: sources.air },
              { label: 'Cloud field', source: sources.ring },
              ...(sources.satellite ? [{ label: 'Satellite', source: sources.satellite }] : []),
              ...(sources.sevenTimer ? [{ label: '7Timer!', source: sources.sevenTimer }] : []),
              ...(sources.light ? [{ label: 'Light pollution', source: sources.light }] : []),
              ...(sources.aurora ? [{ label: 'Aurora', source: sources.aurora }] : []),
              { label: 'Kp index', source: kpSource },
              ...(orbitSource ? [{ label: 'Orbits', source: orbitSource }] : []),
            ]}
          />
        {/if}
      </div>

      <section class="sky-box" aria-label="Live sky view">
        <SkyView
          {place}
          time={shown}
          {live}
          constellations={layers.constellations}
          atmosphere={engineAtmosphere}
          clouds={cloudInput}
          horizon={layers.terrain ? (siteHorizon?.profile ?? null) : null}
          groundColor={groundRgb}
          glow={domeGlow}
          survey={engineSurvey}
          oncursor={(p) => (cursor = p)}
        />
      </section>

      <Timeline
        rows={timeline}
        {tz}
        shown={shown.getTime()}
        {sevenTimer}
        now={nowMin}
        onpick={(t) => setTime(new Date(t), false)}
      />

      <WeekAhead nights={week} {tz} />

      <ConditionCards
        {row}
        {moon}
        {tw}
        {tz}
        satellite={satSummary}
        {sevenTimer}
        light={siteLight}
        lightStatus={layers.lightpollution ? (sources?.light?.status ?? 'off') : 'off'}
        loading={sources?.weather.status === 'loading'}
      />

      <Extras
        {place}
        {tz}
        {now}
        aurora={sources?.aurora?.data ?? null}
        kp={kpSource.data}
        orbits={orbitSource?.data ?? null}
        orbitsMissing={!orbitSource || orbitSource.status === 'error'}
      />

      {#if layers.satmap}
        {#await import('./components/SatelliteMap.svelte') then { default: SatelliteMap }}
          <SatelliteMap {place} {tz} />
        {:catch}
          <p class="note">
            The satellite map could not be loaded. Check the connection and try again.
          </p>
        {/await}
      {/if}

      <div class="pair">
        <Layers bind:layers {surveyStatus} />
        <PhysicsPanel
          extinction={ext}
          {dbv}
          {sky}
          {limitMag}
          {cursor}
          {pressure}
          {temperature}
          {horizonSource}
          onloadterrain={horizonState === 'saved' ? () => (forceTerrain = true) : undefined}
        />
      </div>
    </div>
  {/if}
</main>

<footer>
  <a href="#/">Sky</a>
  <a href="#/about">About &amp; methods</a>
  <a href="#/credits">Credits</a>
  <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="license">AGPL-3.0</a>
</footer>

<style>
  .skip {
    position: absolute;
    left: -999px;
  }
  .skip:focus {
    left: 8px;
    top: 8px;
    z-index: 30;
    background: var(--panel);
    padding: 8px;
  }
  main {
    padding: var(--gap);
    max-width: 1400px;
    margin: 0 auto;
  }
  .stack {
    display: grid;
    gap: var(--gap);
  }
  .pair {
    display: grid;
    gap: var(--gap);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    align-items: start;
  }
  .controls {
    display: grid;
    gap: 6px;
  }
  .sky-box {
    height: 62vh;
    min-height: 320px;
  }
  @media (min-width: 960px) {
    .sky-box {
      height: 72vh;
    }
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 12px var(--gap) 24px;
    font-size: 13px;
    color: var(--muted);
    max-width: 1400px;
    margin: 0 auto;
  }
</style>
