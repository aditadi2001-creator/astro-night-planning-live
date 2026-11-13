<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import TopBar from './components/TopBar.svelte';
  import TabNav, { tabFromHash, type TabId } from './components/TabNav.svelte';
  import { fmtDateTime } from './lib/time/format';
  import SkyView from './components/SkyView.svelte';
  import TimeControls from './components/TimeControls.svelte';
  import ConditionCards from './components/ConditionCards.svelte';
  import Timeline from './components/Timeline.svelte';
  import DataStatus from './components/DataStatus.svelte';
  import LayerBar, { type LayerState, type SurveyStatus } from './components/LayerBar.svelte';
  import Extras from './components/Extras.svelte';
  import WeekAhead from './components/WeekAhead.svelte';
  import Equipment from './components/Equipment.svelte';
  import ObjectDetails from './components/ObjectDetails.svelte';
  import BestTargets from './components/BestTargets.svelte';
  import { cloudFactor } from './lib/physics/score';
  import * as Astronomy from 'astronomy-engine';
  import { altAz, bodyFor } from './lib/astro/target';
  import type { ObjectInfo } from './lib/engine/stel';
  import { loadSetups, setupStats, type SetupKind, saveSetups, type Setup } from './lib/equipment';
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
  import {
    estimateClouds,
    nowcastWeight,
    timelineEnd,
    timelineStart,
    type SatObs,
  } from './lib/clouds/estimate';
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
  let tab = $state<TabId>(tabFromHash(location.hash));
  let headH = $state(110);
  // Phones: time controls folded away so the sky is in view (one tap to open).
  let timeOpen = $state(!matchMedia('(max-width: 640px)').matches);
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
    longExposure: false,
    deepSky: true,
  });

  // Deep-sky photos: the DSS2 colour survey, faded in by the sky view when zoomed in.
  let deepSkyUrl = $state<string | null>(null);
  $effect(() => {
    if (!layers.deepSky) return;
    const dss = surveyById('dss');
    if (!dss || deepSkyUrl) return;
    let cancelled = false;
    void pickServer(dss).then((src) => {
      if (!cancelled) deepSkyUrl = src?.url ?? null;
    });
    return () => {
      cancelled = true;
    };
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
    layers.haze
      ? {
          pressure,
          temperature,
          k: ext.total,
          dbv,
          // Long exposure reaches ~4 mag deeper than the eye against the same sky.
          limitMag: limitMag + (layers.longExposure ? 4 : 0),
          // The site's Bortle class drives the engine's sky glow and Milky Way contrast;
          // with the light-pollution layer off, a pristine sky.
          bortle: layers.lightpollution ? (siteLight?.bortle ?? 3) : 1,
        }
      : null,
  );

  const lighting = $derived({
    sunAlt: row.sunAlt,
    moonAlt: row.moonAlt,
    moonIllum: moon.illumination,
  });
  // Satellite weight for the real cloud field at the shown time (same hand-over as the figures).
  const satWeightField = $derived(
    satellite?.field && Number.isFinite(surfaceK) ? nowcastWeight(minute, satellite.field.time) : 0,
  );
  // Sky glow from the light-pollution ratio (artificial / natural zenith brightness):
  // opacity 0.065·ln(1 + ratio): 0.05 rural (SQM ~21), 0.14 suburban (~19.5), 0.29 inner
  // city (~17). Over a dark screen that gives roughly the dim brown-grey of a city sky
  // (Bortle 9 is ~0.016 cd/m², ~90× a natural sky), brighter towards the horizon.
  const skyGlow = $derived.by(() => {
    if (!siteLight || domeStrength <= 0) return null;
    // The engine adds a uniform glow for the Bortle class (atmosphere.c); this veil now
    // mainly supplies the brightening towards the horizon, so it is 40 % of the full value.
    const a = Math.min(0.15, 0.026 * Math.log(1 + Math.max(0, siteLight.ratio))) * domeStrength;
    return a > 0.01
      ? {
          rgb: [128, 102, 86] as [number, number, number],
          zenithA: Math.round(a * 100) / 100,
          // Directional domes, scaled by how dark the sky is.
          domes: siteLight.domes.map((d) => d * domeStrength),
          zenithRatio: siteLight.ratio,
        }
      : null;
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
      // Real clouds from the newest satellite image, placed where it saw them.
      field:
        satellite?.field && satWeightField > 0.01
          ? {
              n: satellite.field.n,
              stepKm: satellite.field.stepKm,
              bt: satellite.field.bt,
              surfaceK: surfaceK,
              weight: satWeightField,
              ageS: Math.round((driftT * 1000 - satellite.field.time) / 1000),
            }
          : null,
      // Light-pollution sky glow (yearly model) behind the clouds, at night only.
      glow: skyGlow,
      // City glow lights clouds from below (orange), scaled by the light pollution.
      color: cloudColors(
        lighting.sunAlt,
        lighting.moonAlt,
        lighting.moonIllum,
        siteLight ? Math.min(1, siteLight.brightening / 5) : 0,
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
    const onHash = () => {
      const h = location.hash;
      // In-page anchors (the skip link) are not section changes.
      if (h && !h.startsWith('#/')) return;
      const next = tabFromHash(h);
      if (next !== tab) {
        tab = next;
        window.scrollTo({ top: 0 });
      }
      if (h === '#/credits')
        requestAnimationFrame(() => document.getElementById('credits')?.scrollIntoView());
    };
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

  // Night milestones for the time slider and jump buttons.
  const timeEvents = $derived.by(() => {
    const ev: { label: string; t: number }[] = [];
    const add = (label: string, d: Date | null | undefined) => {
      if (d) ev.push({ label, t: d.getTime() });
    };
    add('Sunset', tw.sunset);
    add('Civil dusk', tw.civilEnd);
    add('Nautical dusk', tw.nauticalEnd);
    add('Dark', tw.astroEnd);
    add('Dark ends', tw.astroStart);
    add('Nautical dawn', tw.nauticalStart);
    add('Civil dawn', tw.civilStart);
    add('Sunrise', tw.sunrise);
    const first = tw.sunset?.getTime();
    const last = tw.sunrise?.getTime();
    if (first != null && last != null) {
      // Local midnight inside the night.
      const off = utcOff * 1000;
      const mid = Math.ceil((first + off) / 86_400_000) * 86_400_000 - off;
      if (mid > first && mid < last) ev.push({ label: 'Midnight', t: mid });
      const inNight = (d: Date | null) =>
        !!d && d.getTime() > first - 3600_000 && d.getTime() < last + 3600_000;
      if (inNight(moon.rise)) add('Moonrise', moon.rise);
      if (inNight(moon.set)) add('Moonset', moon.set);
    }
    return ev;
  });

  // ---- selected object and "go to" requests ---------------------------------------
  let selectedInfo = $state<ObjectInfo | null>(null);
  let clearSignal = $state(0);
  let gotoTarget = $state<{ ra: number; dec: number; fovDeg: number; n: number } | null>(null);
  let gotoN = 0;
  function gotoSky(ra: number, dec: number, fovDeg: number) {
    gotoTarget = { ra, dec, fovDeg, n: ++gotoN };
    location.hash = '#/sky';
  }

  // ---- phone camera horizon view ---------------------------------------------------
  let cameraOpen = $state(false);
  const cameraTarget = $derived(
    selectedInfo
      ? {
          name: selectedInfo.name,
          ra2000: selectedInfo.ra2000,
          dec2000: selectedInfo.dec2000,
          body: bodyFor([selectedInfo.name, ...selectedInfo.otherNames, ...selectedInfo.ids]),
        }
      : null,
  );

  // ---- equipment setups and their frames on the sky --------------------------------
  let setups = $state(loadSetups());
  let shownFrames = $state<Record<SetupKind, boolean>>({
    deepsky: false,
    planetary: false,
    lunarsolar: false,
  });
  let frameCenter = $state<{ ra: number; dec: number; target: string | null } | null>(null);
  const anyFrame = $derived(Object.values(shownFrames).some(Boolean));
  let lastFrames: Record<SetupKind, boolean> = {
    deepsky: true,
    planetary: false,
    lunarsolar: false,
  };
  function toggleFrames() {
    if (anyFrame) {
      lastFrames = { ...shownFrames };
      shownFrames = { deepsky: false, planetary: false, lunarsolar: false };
    } else {
      shownFrames = Object.values(lastFrames).some(Boolean)
        ? { ...lastFrames }
        : { deepsky: true, planetary: false, lunarsolar: false };
    }
  }
  // Setups are saved here too: rotation can change from the sky while the Equipment tab is closed.
  $effect(() => {
    saveSetups($state.snapshot(setups) as Record<SetupKind, Setup>);
  });

  // ---- best targets tonight -------------------------------------------------------
  const darkTonight = $derived.by(() => {
    const start = tw.astroEnd ?? tw.nauticalEnd;
    const end = tw.astroStart ?? tw.nauticalStart;
    return start && end && end > start ? { start: start.getTime(), end: end.getTime() } : null;
  });
  const clearFactorAt = (t: number) => {
    const c = cloudAt(hourStart(t));
    return c ? cloudFactor(c.low, c.mid, c.high) : 1;
  };
  const deepFrameShort = $derived.by(() => {
    const st = setupStats(setups.deepsky);
    return Math.min(st.fovW, st.fovH);
  });
  function showTarget(t: { ra: number; dec: number; sizeDeg: number; bestT?: number }) {
    // Below 20° at the shown time: jump to its best moment tonight.
    if (t.bestT != null) {
      Astronomy.DefineStar(Astronomy.Body.Star2, t.ra / 15, t.dec, 1000);
      const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
      if (altAz(Astronomy.Body.Star2, obs, shown).alt < 20) setTime(new Date(t.bestT), false);
    }
    const st = setupStats(setups.deepsky);
    const fov = Math.max(t.sizeDeg * 3, st.fovDiag * 1.6, 1);
    shownFrames = { ...shownFrames, deepsky: true };
    gotoSky(t.ra, t.dec, Math.min(60, fov));
  }

  // Turning the satellite map on from the sky's layer bar opens it in the Maps tab
  // (leaving full screen first, where the rest of the page is hidden).
  let satmapWas = false;
  $effect(() => {
    const on = layers.satmap;
    if (on && !satmapWas && untrack(() => tab) !== 'maps') {
      if (document.fullscreenElement) void document.exitFullscreen();
      location.hash = '#/maps';
    }
    satmapWas = on;
  });

  function skipToMain(e: MouseEvent) {
    e.preventDefault();
    document.getElementById('main')?.focus();
  }

  function setTime(t: Date, isLive: boolean) {
    live = isLive;
    shown = t;
  }
</script>

<a class="skip" href="#main" onclick={skipToMain}>Skip to content</a>
{#if cameraOpen}
  {#await import('./components/CameraView.svelte') then { default: CameraView }}
    <CameraView
      {place}
      time={shown}
      {tz}
      target={cameraTarget}
      horizon={siteHorizon?.profile ?? null}
      onclose={() => (cameraOpen = false)}
    />
  {/await}
{/if}

{#snippet layerChips()}
  <button
    class="chip"
    aria-pressed={anyFrame}
    title="Show your camera's field of view on the sky (set up under Equipment)"
    onclick={toggleFrames}
  >
    <span aria-hidden="true">{anyFrame ? '●' : '○'}</span>FOV frame
  </button>
  <button
    class="chip"
    aria-pressed={cameraOpen}
    title="Phone camera with the horizon, altitude lines and your target's path, to check what blocks it"
    onclick={() => {
      if (document.fullscreenElement) void document.exitFullscreen();
      cameraOpen = true;
    }}
  >
    <span aria-hidden="true">○</span>Camera view
  </button>
{/snippet}

<div class="head" bind:clientHeight={headH}>
  <TopBar {place} {now} {tz} bind:night onplace={setPlace} />
  <TabNav {tab} />
</div>

<main id="main" tabindex="-1" style:--head-h={`${headH}px`}>
  <!-- The sky stays mounted on every tab (the WebGL engine is never torn down);
       other tabs move it off-screen at a small size. -->
  <section
    class="sky-panel"
    class:offscreen={tab !== 'sky'}
    inert={tab !== 'sky'}
    aria-label="Live sky"
  >
    <h1 class="visually-hidden">Live sky</h1>
    <LayerBar bind:layers {surveyStatus} extra={layerChips} />
    <div class="sky-row" class:with-details={!!selectedInfo}>
      <div class="sky-col">
        <div class="time-wrap">
          <button
            class="time-toggle"
            aria-expanded={timeOpen}
            aria-controls="sky-time"
            onclick={() => (timeOpen = !timeOpen)}
            >Time: {live ? 'live' : 'chosen'} · {fmtDateTime(shown, tz)}
            {timeOpen ? '▴' : '▾'}</button
          >
          <div id="sky-time" class="time-body" class:open={timeOpen}>
            <TimeControls {place} time={shown} {live} {tz} events={timeEvents} onchange={setTime} />
          </div>
        </div>
        <div class="sky-box">
          <SkyView
            {place}
            time={shown}
            {live}
            {tz}
            constellations={layers.constellations}
            atmosphere={engineAtmosphere}
            clouds={cloudInput}
            horizon={layers.terrain ? (siteHorizon?.profile ?? null) : null}
            groundColor={groundRgb}
            glow={domeGlow}
            survey={engineSurvey}
            bind:setups
            bind:shownFrames
            onframecenter={(c) => (frameCenter = c)}
            onselect={(i) => (selectedInfo = i)}
            goto={gotoTarget}
            {clearSignal}
            deepSky={layers.deepSky && !layers.surveys ? deepSkyUrl : null}
            longExposure={layers.longExposure}
            oncursor={(p) => (cursor = p)}
          >
            {#snippet fullControls()}
              <LayerBar bind:layers {surveyStatus} extra={layerChips} compact />
              <TimeControls
                {place}
                time={shown}
                {live}
                {tz}
                events={timeEvents}
                onchange={setTime}
              />
            {/snippet}
          </SkyView>
        </div>
      </div>
      {#if selectedInfo}
        <div class="details-col">
          <ObjectDetails
            info={selectedInfo}
            {place}
            time={shown}
            {tw}
            {tz}
            {setups}
            onclose={() => {
              clearSignal++;
              selectedInfo = null;
            }}
          />
        </div>
      {/if}
    </div>
  </section>

  {#if tab === 'tonight'}
    <section class="page" aria-labelledby="pg-tonight">
      <header class="page-head">
        <div>
          <h1 id="pg-tonight">Tonight</h1>
          <p class="lede">
            Conditions at {place.name} for {live ? 'now' : fmtDateTime(shown, tz)}. Pick an hour in
            the timeline to see that moment here and in the sky.
          </p>
        </div>
        {#if !live}<button onclick={() => setTime(new Date(), true)}>Back to now</button>{/if}
      </header>
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
      <Timeline
        rows={timeline}
        {tz}
        shown={shown.getTime()}
        {sevenTimer}
        now={nowMin}
        onpick={(t) => setTime(new Date(t), false)}
      />
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
      <div class="pair">
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
    </section>
  {:else if tab === 'week'}
    <section class="page" aria-labelledby="pg-week">
      <header class="page-head">
        <div>
          <h1 id="pg-week">Week ahead</h1>
          <p class="lede">Cloud outlook for the next seven nights from the forecast models.</p>
        </div>
      </header>
      <WeekAhead nights={week} {tz} />
    </section>
  {:else if tab === 'targets'}
    <section class="page" aria-labelledby="pg-targets">
      <header class="page-head">
        <div>
          <h1 id="pg-targets">Targets</h1>
          <p class="lede">
            The best deep-sky objects for tonight's dark hours, ranked for your sky and your
            deep-sky frame. Show one to centre it in the sky with the frame on.
          </p>
        </div>
      </header>
      <BestTargets
        {place}
        {tz}
        dark={darkTonight}
        clearAt={clearFactorAt}
        sqm={siteLight?.sqm ?? 21}
        sqmKnown={!!siteLight}
        frameShortDeg={deepFrameShort}
        stamp={nowMin}
        onshow={showTarget}
      />
    </section>
  {:else if tab === 'equipment'}
    <section class="page" aria-labelledby="pg-equipment">
      <header class="page-head">
        <div>
          <h1 id="pg-equipment">Equipment</h1>
          <p class="lede">
            Your three setups. Their fields of view appear on the sky with the FOV frame switch.
          </p>
        </div>
        <a class="btn" href="#/sky">Open the sky</a>
      </header>
      <Equipment
        bind:setups
        bind:shown={shownFrames}
        seeing={row.seeing?.arcsec ?? null}
        center={frameCenter}
      />
    </section>
  {:else if tab === 'maps'}
    <section class="page" aria-labelledby="pg-maps">
      <header class="page-head">
        <div>
          <h1 id="pg-maps">Maps</h1>
          <p class="lede">
            Our yearly light-pollution model and the infrared satellite cloud map of the last hours.
          </p>
        </div>
      </header>
      {#await import('./components/LightPollutionMap.svelte') then { default: LightPollutionMap }}
        <LightPollutionMap {place} site={siteLight} onplace={setPlace} />
      {:catch}
        <p class="note">The light-pollution map could not be loaded. Check the connection.</p>
      {/await}
      {#if layers.satmap}
        {#await import('./components/SatelliteMap.svelte') then { default: SatelliteMap }}
          <div id="satmap">
            <SatelliteMap {place} {tz} />
          </div>
        {:catch}
          <p class="note">
            The satellite map could not be loaded. Check the connection and try again.
          </p>
        {/await}
      {:else}
        <div class="placeholder">
          <div>
            <h2>Satellite cloud map</h2>
            <p>
              Infrared images of the last 2.5 hours around your site (about 1–3 MB). Off until you
              open it, to save data.
            </p>
          </div>
          <button onclick={() => (layers.satmap = true)}>Show the satellite map</button>
        </div>
      {/if}
    </section>
  {:else if tab === 'space'}
    <section class="page" aria-labelledby="pg-space">
      <header class="page-head">
        <div>
          <h1 id="pg-space">Space</h1>
          <p class="lede">Aurora chances and bright passes of the ISS and other satellites.</p>
        </div>
      </header>
      <Extras
        {place}
        {tz}
        {now}
        aurora={sources?.aurora?.data ?? null}
        kp={kpSource.data}
        orbits={orbitSource?.data ?? null}
        orbitsMissing={!orbitSource || orbitSource.status === 'error'}
      />
    </section>
  {:else if tab === 'about'}
    <section class="page prose" aria-label="About and credits">
      <About />
      <div id="credits"><Credits /></div>
    </section>
  {/if}
</main>

<footer>
  <span>Astro Night Planning</span>
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
  /* Top bar + section tabs stay in reach on every page. */
  .head {
    position: sticky;
    top: 0;
    z-index: 15;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
  }
  main {
    padding: var(--gap);
    max-width: 1600px;
    margin: 0 auto;
    outline: none;
  }
  /* ---- sky tab ---- */
  .sky-panel {
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  /* Other tabs: keep the engine alive off-screen, small (cheap to draw) but never 0×0. */
  .sky-panel.offscreen {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 360px;
    height: 300px;
    visibility: hidden;
    pointer-events: none;
    overflow: hidden;
  }
  .sky-row {
    display: grid;
    gap: var(--gap);
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }
  .sky-col {
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
  .time-toggle {
    display: none;
    width: 100%;
    text-align: left;
    font-size: 14px;
    min-height: 40px;
  }
  @media (max-width: 640px) {
    .time-toggle {
      display: block;
    }
    .time-body:not(.open) {
      display: none;
    }
    .time-body.open {
      margin-top: 8px;
    }
  }
  .time-wrap {
    min-width: 0;
  }
  .sky-box {
    height: 68vh;
    height: 68dvh;
    min-height: 320px;
  }
  .offscreen .sky-box {
    height: 240px;
    min-height: 0;
  }
  @media (min-width: 900px) and (min-height: 600px) {
    /* The whole sky page fits the window: no scrolling to reach the sky. */
    .sky-panel:not(.offscreen) {
      height: calc(100vh - var(--head-h, 110px) - 2 * var(--gap));
      height: calc(100dvh - var(--head-h, 110px) - 2 * var(--gap));
      min-height: 560px;
    }
    .sky-panel:not(.offscreen) .sky-box {
      height: auto;
      min-height: 300px;
    }
  }
  @media (min-width: 1100px) {
    .sky-row.with-details {
      grid-template-columns: minmax(0, 1fr) 380px;
    }
    .details-col {
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }
  }
  /* ---- content tabs ---- */
  .page {
    display: grid;
    gap: var(--gap);
    grid-template-columns: minmax(0, 1fr);
    max-width: 1280px;
    margin: 0 auto;
    padding-bottom: 8px;
  }
  .page-head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 4px 2px 2px;
  }
  .page-head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .lede {
    margin: 4px 0 0;
    color: var(--muted);
    max-width: 70ch;
    font-size: 14px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-2);
    text-decoration: none;
    color: var(--text);
  }
  .btn:hover {
    border-color: var(--accent);
  }
  .pair {
    display: grid;
    gap: var(--gap);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    align-items: start;
  }
  .placeholder {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    background: var(--panel);
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    padding: 16px;
  }
  .placeholder h2 {
    margin: 0 0 4px;
    font-size: 16px;
  }
  .placeholder p {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    max-width: 60ch;
  }
  .note {
    color: var(--muted);
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 16px var(--gap) 24px;
    font-size: 13px;
    color: var(--muted);
    max-width: 1600px;
    margin: 0 auto;
    border-top: 1px solid var(--line);
  }
  footer span {
    margin-right: auto;
  }
</style>
