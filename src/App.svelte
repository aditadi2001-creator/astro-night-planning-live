<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import AppHeader from './components/AppHeader.svelte';
  import NightRibbon from './components/NightRibbon.svelte';
  import SectionIndex from './components/SectionIndex.svelte';
  import PlanetsPanel from './components/PlanetsPanel.svelte';
  import {
    buildHash,
    parseHash,
    PLAN_SECTIONS,
    type Page,
    type RouteParams,
    type SectionId,
  } from './lib/state/route';
  import type { RibbonHour } from './lib/ribbon';
  import SearchDialog from './components/SearchDialog.svelte';
  import { profileSummary } from './lib/profiles';
  import {
    foregroundProfile,
    loadForeground,
    tintGround,
    type ForegroundState,
  } from './lib/sky/foreground';
  import { loadCustomHorizon, toProfile, type CustomHorizon } from './lib/sky/customHorizon';
  import { skyView } from './lib/sky/view.svelte';
  import type { Pin } from './lib/astro/pin';
  import type { ResultEntry } from './lib/search/client';
  import {
    loadActiveProfileId,
    loadProfiles,
    profileSetup,
    saveActiveProfileId,
    type Profile,
  } from './lib/profiles';
  import { fmtDateTime, fmtTime } from './lib/time/format';
  import type SkyView from './components/SkyView.svelte';
  import type { DockPanel, TimeCmd } from './components/SkyView.svelte';
  import ConditionCards from './components/ConditionCards.svelte';
  import Timeline from './components/Timeline.svelte';
  import DataStatus from './components/DataStatus.svelte';
  import type { LayerState, SurveyStatus } from './components/LayerBar.svelte';
  import Extras from './components/Extras.svelte';
  import WeekAhead from './components/WeekAhead.svelte';
  import YearPlanner from './components/YearPlanner.svelte';
  import Equipment from './components/Equipment.svelte';
  import { telescope } from './lib/telescope/session.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import Tour, { markTourSeen, tourSeen, type TourStep } from './components/Tour.svelte';
  import TargetsPanel from './components/TargetsPanel.svelte';
  import { loadPlan, type PlanItem } from './lib/plan/plan';
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
  import { effectiveSqm, loadPlace, loadSiteSky, savePlace } from './lib/location';
  import TonightGlance from './components/TonightGlance.svelte';
  import { verdict } from './lib/plan/verdict';
  import { bortle } from './lib/lp/lightpollution';
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
  import { buildRow, buildTimeline, moonEvents, twilight, type SiteGround } from './lib/conditions';
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
  import {
    LP_INFO_URL,
    loadSiteLight,
    withHaze,
    withNaturalSky,
    type SiteLight,
  } from './lib/lp/lightpollution';
  import { roughnessFromLight, urbanFromLight } from './lib/physics/surfacelayer';
  import {
    STATION_AIR_ENABLED,
    loadStationAir,
    siteAqi,
    type StationAir,
  } from './lib/data/stationair';
  import {
    loadSolarFlux,
    naturalSkyMag,
    TYPICAL_FLUX,
    type SolarFlux,
  } from './lib/physics/airglow';
  import {
    blendLayers,
    blendSamples,
    cloudsNow,
    HIGH_OPACITY_PRIOR,
    highCloudK,
    irCloudFraction,
    irEmissivity,
    satelliteWeight,
    visibleOpacity,
    type SatPoint,
  } from './lib/sat/ir';

  const WEATHER_INTERVAL = 30 * 60_000;

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  /** The moment the sky and cards show; follows `now` while live. */
  let shown = $state(new Date());
  let live = $state(true);
  // ---- two pages and the shareable URL state (src/lib/state/route.ts) ----
  const firstRoute = parseHash(location.hash) ?? { page: 'plan', params: {}, redirected: false };
  if (firstRoute.redirected) {
    history.replaceState(null, '', buildHash(firstRoute.page, firstRoute.params));
  }
  let page = $state<Page>(firstRoute.page);
  let params = $state<RouteParams>(firstRoute.params);
  const sectionOf = (s: string | undefined): SectionId =>
    (PLAN_SECTIONS.find((x) => x.id === s)?.id ?? 'tonight') as SectionId;
  let activeSection = $state<SectionId>(sectionOf(firstRoute.params.s));
  /** The sky engine (1.3 MB) loads on the first visit to the Sky page and then stays mounted. */
  let skyMounted = $state(firstRoute.page === 'sky');
  $effect(() => {
    if (page === 'sky') skyMounted = true;
  });

  function goPage(p: Page, extra: RouteParams = {}) {
    const next = { ...params, ...extra };
    if (p === 'sky') delete next.s;
    location.hash = buildHash(p, next);
  }
  // ---- the Plan page renders in stages: Tonight first, then one section per idle moment, so
  // the first paint is not one long task. A jump (or a link naming a section) renders all. ----
  const PLAN_ORDER: (SectionId | 'tonight-detail')[] = [
    'tonight',
    'tonight-detail',
    'targets',
    'planets',
    'week',
    'trips',
    'telescope',
    'space',
    'maps',
    'about',
  ];
  let planStage = $state(firstRoute.params.s ? PLAN_ORDER.length : 1);
  const ready = (id: SectionId | 'tonight-detail') => planStage > PLAN_ORDER.indexOf(id);
  $effect(() => {
    if (page !== 'plan' || planStage >= PLAN_ORDER.length) return;
    const next = () => (planStage += 1);
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(next, { timeout: 600 });
      return () => cancelIdleCallback(h);
    }
    const t = setTimeout(next, 60);
    return () => clearTimeout(t);
  });
  // A link that names a section (#/plan?s=week) opens there, not at the browser's old scroll.
  onMount(() => {
    const s = firstRoute.page === 'plan' ? firstRoute.params.s : undefined;
    if (!s || s === 'tonight') return;
    history.scrollRestoration = 'manual';
    let userMoved = false;
    const mark = () => (userMoved = true);
    addEventListener('wheel', mark, { once: true, passive: true });
    addEventListener('touchmove', mark, { once: true, passive: true });
    const go = () => {
      if (!userMoved) document.getElementById(`sec-${s}`)?.scrollIntoView({ block: 'start' });
    };
    void tick().then(go);
    // Sections above grow as their data arrives (forecasts, maps): keep the asked-for section
    // in place for the first 10 s, until the user scrolls.
    const body = document.querySelector('.plan-body');
    const ro = body ? new ResizeObserver(() => go()) : null;
    if (body) ro?.observe(body);
    const t = setTimeout(() => ro?.disconnect(), 10_000);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      removeEventListener('wheel', mark);
      removeEventListener('touchmove', mark);
    };
  });
  function renderAll(): Promise<void> {
    planStage = PLAN_ORDER.length;
    return tick();
  }
  function jumpTo(id: SectionId) {
    activeSection = id;
    if (page !== 'plan') {
      location.hash = buildHash('plan', { ...params, s: id });
      return;
    }
    params = { ...params, s: id };
    history.replaceState(null, '', buildHash('plan', params));
    void renderAll().then(() =>
      document.getElementById(`sec-${id}`)?.scrollIntoView({ block: 'start' }),
    );
  }
  function sectionInView(id: SectionId) {
    if (id === activeSection) return;
    activeSection = id;
    params = { ...params, s: id };
    history.replaceState(null, '', buildHash('plan', params));
  }

  // ---- Beginner / Expert (same data; Expert shows every column and unit) ----
  let expert = $state(readFlag('anp:expert'));
  $effect(() => writeFlag('anp:expert', expert));
  function hasStoredSetups(): boolean {
    try {
      return localStorage.getItem('anp.setups.v1') != null;
    } catch {
      return false;
    }
  }

  // Maps (MapLibre + tiles, ~1–3 MB) load only when their section comes near the viewport.
  let mapsNear = $state(firstRoute.params.s === 'maps');
  function nearView(node: HTMLElement, onnear: () => void) {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          onnear();
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  function readFlag(k: string): boolean {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  }
  function writeFlag(k: string, v: boolean) {
    try {
      localStorage.setItem(k, v ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  // ---- search: Ctrl/Cmd-K anywhere opens the sky search ----
  // ---- the sky's dock, foreground and custom horizon -------------------------------------
  let dock = $state<DockPanel | null>(null);
  /** Part of the sky the open dock sheet covers; the sky shrinks so nothing hides under it. */
  let dockInset = $state({ right: 0, bottom: 0 });
  let skyFull = $state(false);
  let skyRef = $state<ReturnType<typeof SkyView>>();
  let foreground = $state<ForegroundState>(loadForeground());
  let customHorizon = $state<CustomHorizon | null>(untrack(() => loadCustomHorizon(place)));

  // ---- help: glossary, keys and the guided tour (offered once to new visitors) ----
  let helpOpen = $state(false);
  let touring = $state(false);
  let tourOffer = $state(false);
  const TOUR: TourStep[] = [
    {
      sel: '.bar .loc',
      title: 'Your site',
      text: 'Pick where you observe from: Bangalore, Hanle, Coorg or anywhere. Places stay on this device. You can also save the star maps for offline use here.',
    },
    {
      sel: '.ribbon',
      title: 'Tonight in one strip',
      text: 'Sunset to sunrise: blue bands are twilight and full darkness, shading is cloud, the gold bar is the best imaging window and the grey bar shows when the Moon is up. Drag it, or tap an hour, to see that moment everywhere.',
    },
    {
      sel: '#sec-tonight .glance',
      title: 'Go or no-go',
      text: 'The verdict for tonight in one line, the key numbers and the reasons behind it.',
    },
    {
      sel: '.bar .profile',
      title: 'Your equipment',
      text: 'Choose the telescope and camera you use tonight: targets, framing and the frame on the sky follow it.',
    },
    {
      sel: '.bar .pages',
      title: 'Plan and Sky',
      text: 'Plan is this page. Sky is a live planetarium with your camera frame, survey images and your telescope.',
    },
    {
      sel: '.bar .search',
      title: 'Find anything',
      text: 'Search 100,000 objects by name or catalog number (Ctrl K).',
    },
    {
      sel: '.bar .night',
      title: 'Red night mode',
      text: 'Turns everything deep red so your eyes stay adapted to the dark at the telescope.',
    },
    {
      sel: '.bar .help',
      title: 'Help',
      text: 'This tour again, the keys and a glossary of every term in plain words.',
    },
  ];
  onMount(() => {
    if (tourSeen() || firstRoute.page !== 'plan') return;
    const t = setTimeout(() => (tourOffer = true), 2500);
    return () => clearTimeout(t);
  });
  function startTour() {
    helpOpen = false;
    tourOffer = false;
    if (page !== 'plan') goPage('plan');
    // Wait until the Plan page has drawn its first card (after switching from Sky).
    let tries = 0;
    const go = () => {
      if (!document.querySelector('#sec-tonight .glance') && tries++ < 20) {
        setTimeout(go, 100);
        return;
      }
      window.scrollTo({ top: 0 });
      touring = true;
    };
    void tick().then(go);
  }
  let searchOpen = $state(false);
  function openSearch() {
    searchOpen = true;
  }
  /** A search result was chosen: centre it in the sky (planets at the shown time). */
  function pickResult(e: ResultEntry) {
    if (e.kind === 'planet') {
      const body = Astronomy.Body[e.label as keyof typeof Astronomy.Body] as Astronomy.Body;
      const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
      const eq = Astronomy.Equator(body, shown, obs, false, true);
      gotoSky(
        eq.ra * 15,
        eq.dec,
        e.label === 'Sun' || e.label === 'Moon' ? 3 : 1,
        `NAME ${e.label}`,
      );
      return;
    }
    if (e.ra == null || e.dec == null) return;
    const fov =
      e.kind === 'constellation'
        ? 50
        : Math.min(60, Math.max(e.kind === 'star' ? 5 : 0.5, (e.sizeDeg ?? 0.2) * 4));
    // Everything but constellations gets a pin: used when the 3D sky has no entry for it
    // (Sharpless, Lynds, PGC, SDSS, SIMBAD, coordinates…), so it is marked and described.
    const name = e.label.split(' · ')[0] ?? e.label;
    const pin =
      e.kind === 'constellation'
        ? undefined
        : {
            label: name,
            ra: e.ra,
            dec: e.dec,
            names: [...new Set([name, ...(e.info?.designations ?? []), ...(e.info?.common ?? [])])],
            type: e.type ?? '',
            mag: e.mag ?? null,
            sizeArcmin: e.sizeDeg != null ? e.sizeDeg * 60 : null,
          };
    gotoSky(e.ra, e.dec, fov, e.engineId, pin);
  }
  /** A shared link (#/sky?t=M%2042) opens the sky on that object once, at load. */
  onMount(() => {
    const t = firstRoute.page === 'sky' ? firstRoute.params.t : undefined;
    if (!t) return;
    const name = t.replace(/^NAME /, '');
    void import('./lib/search/client').then(async ({ searchCatalogs }) => {
      const r = await searchCatalogs(name, 8);
      if (!r.ok) return;
      const key = name.toLowerCase();
      const hit =
        r.results.find(
          (e) =>
            e.engineId === t ||
            e.label.toLowerCase() === key ||
            (e.label.split(' · ')[0] ?? '').toLowerCase() === key,
        ) ?? r.results[0];
      if (hit) pickResult(hit);
    });
  });
  function pickSurvey(id: string) {
    layers = { ...layers, surveys: true, survey: id };
    goPage('sky');
  }
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  let headH = $state(110);
  /** Time-rate multiplier while not live (Stellarium J/K/L); 0 = stopped at the chosen time. */
  let rate = $state(0);
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
    /** Measured air quality from nearby monitors (OpenAQ via the data Worker). */
    stationAir: LiveSource<StationAir | null> | null;
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
      // Monitors report hourly; the Worker caches each place for 20 minutes.
      stationAir: STATION_AIR_ENABLED
        ? new LiveSource(
            'stationAir',
            (sig, f) => loadStationAir(lat, lon, sig, f),
            20 * 60_000,
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
    if (s.stationAir) stops.push(s.stationAir.start());
    return () => stops.forEach((stop) => stop());
  });

  // Site-independent sources: geomagnetic index and satellite orbits.
  const kpSource = new LiveSource<KpPoint[]>(
    'kp',
    (sig, f) => loadKp(sig, f),
    3 * 3600_000,
    12 * 3600_000,
  );
  // 10.7 cm solar flux for the natural-sky brightness (daily readings; slow).
  const solarSource = new LiveSource<SolarFlux>(
    'f107',
    (sig, f) => loadSolarFlux(sig, f),
    12 * 3600_000,
    60 * 24 * 3600_000,
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
  // Orbits (~50 kB, one data-Worker request) are needed only by the Space section: they start
  // when it scrolls near the viewport.
  let orbitStop: (() => void) | null = null;
  function startOrbits() {
    if (orbitSource && !orbitStop) orbitStop = orbitSource.start();
  }
  onMount(() => {
    const stops = [kpSource.start(), solarSource.start()];
    return () => {
      stops.forEach((stop) => stop());
      orbitStop?.();
    };
  });

  const weather = $derived(sources?.weather.data ?? null);
  const models = $derived(sources?.models.data ?? null);
  const air = $derived(sources?.air.data ?? null);
  const ring = $derived(sources?.ring.data ?? null);
  const satellite = $derived(sources?.satellite?.data ?? null);
  const sevenTimer = $derived(sources?.sevenTimer?.data ?? null);
  /** Today's natural sky from the solar cycle (airglow), or the long-run mean while unknown. */
  const solarFlux = $derived(solarSource.data?.flux ?? null);
  const naturalSky = $derived(naturalSkyMag(solarFlux ?? TYPICAL_FLUX));
  /** Yearly light pollution at the site as loaded, or null (layer off, not published yet, or no Worker). */
  const baseLight = $derived(layers.lightpollution ? (sources?.light?.data ?? null) : null);
  /**
   * The site's surroundings for the seeing's ground layer: roughness and how built-up it is,
   * from the yearly light-pollution model (loaded even when that layer is hidden).
   */
  const siteGround = $derived.by<SiteGround>(() => {
    const l = sources?.light?.data ?? null;
    return {
      z0: roughnessFromLight(l?.brightening ?? null),
      urban: urbanFromLight(l?.ratio ?? null),
    };
  });
  /** The site's light pollution on a night with this haze (AOD), under today's natural sky. */
  const lightFor = $derived((aod: number | null) =>
    baseLight ? withNaturalSky(withHaze(baseLight, aod), naturalSky) : null,
  );
  /** Moonless zenith sky (SQM) for an hour's haze: drives each timeline hour's score. */
  const darkSkyAt = $derived((aod: number | null) => lightFor(aod)?.sqm ?? naturalSky);
  /** Haze (CAMS AOD at 550 nm) for the time shown. */
  const aodShown = $derived.by(() => (air ? (hourAt(air.hours, minute)?.aod ?? null) : null));
  /** Light pollution at the site for the time shown (haze and natural sky included), or null. */
  const siteLight = $derived(lightFor(aodShown));
  const darkSkyMag = $derived(siteLight?.sqm ?? naturalSky);
  /** Measured AQI, shown only for times within 90 minutes of now (it is an observation). */
  const measured = $derived.by(() =>
    Math.abs(shown.getTime() - now.getTime()) <= 90 * 60_000
      ? siteAqi(sources?.stationAir?.data ?? null)
      : null,
  );
  const stationNote = $derived(
    !STATION_AIR_ENABLED || !sources?.stationAir
      ? ''
      : sources.stationAir.data == null
        ? 'Measured station data is not available right now.'
        : (sources.stationAir.data.stations.length ?? 0) === 0
          ? 'No monitoring station has reported within 25 km in the last 3 hours.'
          : 'Measured values are shown for the present hour only.',
  );

  // ---- terrain horizon (Copernicus DEM, cached per site) ----------------------------
  let siteHorizon = $state<SiteHorizon | null>(null);
  let horizonState = $state<'off' | 'loading' | 'ok' | 'error' | 'saved'>(
    DEM_BASE ? 'loading' : 'off',
  );
  let forceTerrain = $state(false);
  /**
   * Planning horizon (target hours, charts, verdict, telescope HUD): your custom horizon for this
   * site, else the real terrain when the terrain layer is on, else a flat horizon.
   */
  const horizonProfile = $derived<ArrayLike<number> | null>(
    customHorizon
      ? toProfile(customHorizon.points)
      : layers.terrain
        ? (siteHorizon?.profile ?? null)
        : null,
  );
  /** What the sky draws: the custom horizon, else the chosen foreground, else the terrain. */
  const skyHorizon = $derived<Float32Array | null>(
    customHorizon
      ? toProfile(customHorizon.points)
      : foreground.id === 'dem'
        ? layers.terrain
          ? (siteHorizon?.profile ?? null)
          : null
        : foregroundProfile(foreground.id),
  );
  // "None" hides the ground; any other foreground shows it.
  let lastFg = '';
  $effect(() => {
    const id = foreground.id;
    if (id === lastFg) return;
    if (lastFg) skyView.ground = id !== 'none';
    lastFg = id;
  });
  // Custom horizons are per site.
  let lastSite = '';
  $effect(() => {
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    if (key === lastSite) return;
    if (lastSite) customHorizon = loadCustomHorizon(place);
    lastSite = key;
  });
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
    buildRow(
      minute,
      place,
      weather,
      models,
      air,
      darkSkyMag,
      cloudAt(hourStart(minute)),
      siteGround,
    ),
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
          // Foreground fog adds visual haze only (never used in planning numbers).
          k: ext.total + foreground.fog * 0.6,
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
  // ---- how thick the high cloud is (sat/ir.ts) ----------------------------------------
  const highK = $derived(highCloudK(surfaceK, row.weather?.upper[250]?.temp ?? null));
  /** Opacity of the high cloud the satellite sees over the site (mean of its cloudy pixels), or null. */
  const satHighOpacity = $derived.by(() => {
    if (!satellite || !Number.isFinite(surfaceK)) return null;
    const ops = satellite.site
      .filter((bt) => (irCloudFraction([bt], surfaceK) ?? 0) > 0.05)
      .map((bt) => irEmissivity(bt, surfaceK, highK))
      .filter((e): e is number => e != null)
      .map(visibleOpacity);
    return ops.length ? ops.reduce((a, b) => a + b, 0) / ops.length : null;
  });
  /**
   * High-cloud opacity for the time shown: what the satellite measured, handed over to a
   * typical value with a 12 h time constant (the kind of cloud deck lasts longer than the
   * exact place of each cloud, which the 3 h nowcast weight follows).
   */
  const highOpacity = $derived.by(() => {
    if (satHighOpacity == null || !satellite) return HIGH_OPACITY_PRIOR;
    const w = Math.exp(-Math.abs(minute - satellite.time) / (12 * 3600_000));
    return w * satHighOpacity + (1 - w) * HIGH_OPACITY_PRIOR;
  });
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
              highK,
            }
          : null,
      highOpacity,
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
      darkSkyAt,
      cloudAt,
      siteGround,
    ),
  );

  // ---- tonight at a glance -------------------------------------------------------------
  const siteSky = $derived(loadSiteSky(place));
  const sqmUsed = $derived.by(() => {
    const e = effectiveSqm(siteLight?.sqm ?? null, siteSky);
    return { value: e.sqm, source: e.source, bortle: e.sqm == null ? null : bortle(e.sqm) };
  });
  const tonightVerdict = $derived(verdict(timeline, tw, moon.illumination, (t) => fmtTime(t, tz)));

  // Cloud factor per forecast hour (the same factor the hourly score uses) for target ranking.
  const clearByHour = $derived<[number, number][]>(
    timeline.flatMap((r): [number, number][] =>
      r.cloud ? [[r.t, cloudFactor(r.cloud.low, r.cloud.mid, r.cloud.high)]] : [],
    ),
  );
  let plan = $state<PlanItem[]>(loadPlan());

  const ribbonHours = $derived<RibbonHour[]>(
    timeline.map((r) => ({
      t: r.t,
      cloud: r.cloud?.total ?? r.weather?.cloud ?? null,
      moonAlt: r.moonAlt,
      sunAlt: r.sunAlt,
      // The hourly score is 0–100; the ribbon works in 0–1.
      score: r.score ? r.score.score / 100 : null,
    })),
  );

  $effect(() => {
    const t = setInterval(() => {
      now = new Date();
      if (live) shown = now;
    }, 1000);
    const onHash = () => {
      const r = parseHash(location.hash);
      // In-page anchors (the skip link) are not routes.
      if (!r) return;
      if (r.redirected) history.replaceState(null, '', buildHash(r.page, r.params));
      const pageChanged = r.page !== page;
      page = r.page;
      params = r.params;
      if (r.page === 'plan') {
        const id = sectionOf(r.params.s);
        activeSection = id;
        if (r.params.s || pageChanged) {
          requestAnimationFrame(() => {
            if (r.params.s)
              void renderAll().then(() =>
                document.getElementById(`sec-${id}`)?.scrollIntoView({ block: 'start' }),
              );
            else window.scrollTo({ top: 0 });
          });
        }
      } else if (pageChanged) {
        window.scrollTo({ top: 0 });
      }
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
      ?.setAttribute('content', night ? '#000000' : '#0d0e10');
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
  let gotoTarget = $state<{
    ra: number;
    dec: number;
    fovDeg: number;
    n: number;
    id?: string;
    pin?: Pin;
  } | null>(null);
  let gotoN = 0;
  function gotoSky(ra: number, dec: number, fovDeg: number, id?: string, pin?: Pin) {
    gotoTarget = { ra, dec, fovDeg, n: ++gotoN, ...(id ? { id } : {}), ...(pin ? { pin } : {}) };
    goPage('sky', id ? { t: id } : pin ? { t: pin.label } : {});
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
  let frameCenter = $state<{
    ra: number;
    dec: number;
    target: string | null;
    pa: number;
  } | null>(null);
  // ---- live telescope (dock "Telescope") -------------------------------------------
  const scopeMark = $derived(
    telescope.status === 'live' && telescope.state
      ? {
          ra: telescope.state.ra2000,
          dec: telescope.state.dec2000,
          label: telescope.settings.kind === 'simulator' ? 'Telescope (simulator)' : 'Telescope',
          slewing: telescope.state.slewing,
        }
      : null,
  );
  // "Follow the telescope": turn the sky to each new reading.
  $effect(() => {
    const m = scopeMark;
    if (!telescope.follow || !m) return;
    untrack(() => skyRef?.pointAt(m.ra, m.dec));
  });
  // The header's profile selector drives the deep-sky frame (FOV, framing scores).
  let profiles = $state<Profile[]>(loadProfiles());
  let profileId = $state(loadActiveProfileId());
  const activeProfile = $derived(profiles.find((p) => p.id === profileId) ?? profiles[0] ?? null);
  function selectProfile(id: string) {
    profileId = id;
    saveActiveProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) setups = { ...setups, deepsky: { ...profileSetup(p), kind: 'deepsky' } };
  }
  // First visit: start from the active profile instead of the generic default rig.
  untrack(() => {
    if (!hasStoredSetups() && activeProfile) {
      setups = { ...setups, deepsky: { ...profileSetup(activeProfile), kind: 'deepsky' } };
    }
  });
  // Setups are saved here too: rotation can change from the sky while the Equipment tab is closed.
  $effect(() => {
    saveSetups($state.snapshot(setups) as Record<SetupKind, Setup>);
  });

  // ---- best targets tonight -------------------------------------------------------
  function showTarget(t: {
    ra: number;
    dec: number;
    sizeDeg: number;
    bestT?: number;
    id?: string;
  }) {
    // Below 20° at the shown time: jump to its best moment tonight.
    if (t.bestT != null) {
      Astronomy.DefineStar(Astronomy.Body.Star2, t.ra / 15, t.dec, 1000);
      const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
      if (altAz(Astronomy.Body.Star2, obs, shown).alt < 20) setTime(new Date(t.bestT), false);
    }
    const st = setupStats(setups.deepsky);
    const fov = Math.max(t.sizeDeg * 3, st.fovDiag * 1.6, 1);
    shownFrames = { ...shownFrames, deepsky: true };
    gotoSky(t.ra, t.dec, Math.min(60, fov), t.id);
  }

  // Turning the satellite map on from the sky's layer bar opens it in the Maps tab
  // (leaving full screen first, where the rest of the page is hidden).
  let satmapWas = false;
  $effect(() => {
    const on = layers.satmap;
    if (on && !satmapWas && untrack(() => page) !== 'plan') {
      if (document.fullscreenElement) void document.exitFullscreen();
      location.hash = buildHash('plan', { ...untrack(() => params), s: 'maps' });
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
    rate = 0;
  }
  // Stellarium time keys: J slower (×10 steps, through zero into reverse), K normal
  // speed, L faster, 8 now.
  const RATES = [-100000, -10000, -1000, -100, -10, -1, 0, 1, 10, 100, 1000, 10000, 100000];
  function timeCmd(cmd: TimeCmd) {
    if (cmd === 'now') return setTime(new Date(), true);
    if (cmd === 'pause') {
      live = false;
      rate = 0;
      return;
    }
    const cur = live ? 1 : rate;
    if (cmd === 'real') {
      if (Math.abs(shown.getTime() - Date.now()) < 5000) return setTime(new Date(), true);
      live = false;
      rate = 1;
      return;
    }
    const i = RATES.indexOf(cur);
    const at = i < 0 ? RATES.indexOf(0) : i;
    const next = RATES[Math.min(RATES.length - 1, Math.max(0, at + (cmd === 'faster' ? 1 : -1)))];
    live = false;
    rate = next ?? 0;
  }
  // Advance the shown time at the chosen rate (the engine animates in between).
  $effect(() => {
    if (live || rate === 0) return;
    let last = performance.now();
    const t = setInterval(() => {
      const n = performance.now();
      shown = new Date(shown.getTime() + (n - last) * rate);
      last = n;
    }, 250);
    return () => clearInterval(t);
  });
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

{#if helpOpen}
  <HelpDialog onclose={() => (helpOpen = false)} ontour={startTour} />
{/if}
{#if touring}
  <Tour steps={TOUR} onclose={() => (touring = false)} />
{/if}
{#if tourOffer && !touring}
  <div class="tour-offer" role="status">
    <span>New here? A one-minute tour shows the main controls.</span>
    <button class="primary" onclick={startTour}>Show me</button>
    <button
      onclick={() => {
        tourOffer = false;
        markTourSeen();
      }}>No thanks</button
    >
  </div>
{/if}
{#if searchOpen}
  <SearchDialog
    onclose={() => (searchOpen = false)}
    onpick={pickResult}
    onsurvey={pickSurvey}
    centre={() => skyRef?.viewCentre() ?? null}
  />
{/if}

<div class="head" class:on-sky={page === 'sky'} bind:clientHeight={headH}>
  <AppHeader
    {page}
    {place}
    {now}
    {tz}
    {profiles}
    {profileId}
    {expert}
    {night}
    onplace={setPlace}
    onprofile={selectProfile}
    onexpert={(v) => (expert = v)}
    onnight={(v) => (night = v)}
    onpage={(p) => goPage(p)}
    onsearch={openSearch}
    onhelp={() => (helpOpen = true)}
  />
  <NightRibbon
    {tw}
    hours={ribbonHours}
    shown={shown.getTime()}
    now={now.getTime()}
    {live}
    {tz}
    onpick={(t, isLive) => setTime(new Date(t), isLive)}
  />
</div>

<main id="main" tabindex="-1" style:--head-h={`${headH}px`}>
  <!-- The sky loads on the first visit to the Sky page, then stays mounted (the WebGL
       engine is never torn down); on the Plan page it waits off-screen at a small size. -->
  {#if skyMounted}
    {#await import('./sky-parts') then P}
      <section
        class="sky-panel"
        class:offscreen={page !== 'sky'}
        inert={page !== 'sky'}
        aria-label="Live sky"
      >
        <h1 class="visually-hidden">Live sky</h1>
        <div class="sky-row">
          <div class="sky-box">
            <P.SkyView
              {place}
              time={shown}
              {live}
              {rate}
              {tz}
              atmosphere={engineAtmosphere}
              clouds={cloudInput}
              horizon={skyHorizon}
              groundColor={tintGround(groundRgb, foreground)}
              glow={domeGlow}
              survey={engineSurvey}
              bind:setups
              bind:shownFrames
              bind:layers
              bind:night
              onframecenter={(c) => (frameCenter = c)}
              scope={scopeMark}
              onselect={(i) => {
                // The info is refreshed every second while selected; only a newly picked
                // object opens the Info panel, so other panels stay usable.
                const picked = i != null && i.name !== selectedInfo?.name;
                selectedInfo = i;
                if (picked) dock = 'info';
              }}
              goto={gotoTarget}
              onjumptime={(t) => setTime(t, false)}
              {clearSignal}
              deepSky={layers.deepSky && !layers.surveys ? deepSkyUrl : null}
              longExposure={layers.longExposure}
              oncursor={(p) => (cursor = p)}
              ontime={timeCmd}
              onrate={(r) => {
                if (r === 0) setTime(new Date(), true);
                else {
                  live = false;
                  rate = r;
                }
              }}
              bind:this={skyRef}
              inset={dockInset}
              bind:fullscreen={skyFull}
              onopen={(p) => (dock = dock === p ? null : p)}
              onsearch={openSearch}
            >
              {#snippet overlay()}
                <P.SkyDock
                  bind:active={dock}
                  onsearch={openSearch}
                  infoAvailable={!!selectedInfo}
                  oninset={(i) => (dockInset = i)}
                >
                  {#snippet quick()}
                    <P.QuickToggles
                      frameOn={Object.values(shownFrames).some(Boolean)}
                      ontoggleframe={() => skyRef?.frame()}
                      bind:layers
                      surveyLabel={surveyById(layers.survey)?.label ?? 'Survey'}
                      {surveyStatus}
                      full={skyFull}
                      onfull={() => skyRef?.fullScreen()}
                    />
                  {/snippet}
                  {#snippet content(p: DockPanel)}
                    {#if p === 'targets'}
                      <TargetsPanel
                        compact
                        {place}
                        {tz}
                        {tw}
                        dark={tonightVerdict.dark}
                        clear={clearByHour}
                        sqm={sqmUsed.value ?? 21}
                        profile={activeProfile}
                        horizon={horizonProfile}
                        shown={shown.getTime()}
                        {expert}
                        bind:plan
                        onshow={(r) =>
                          showTarget({
                            ra: r.o.ra,
                            dec: r.o.dec,
                            sizeDeg: (r.o.maj ?? 6) / 60,
                            ...(r.best ? { bestT: r.best.t } : {}),
                            id: r.o.name,
                          })}
                      />
                    {:else if p === 'info'}
                      {#if selectedInfo}
                        <P.InfoDrawer
                          info={selectedInfo}
                          {place}
                          time={shown}
                          {tw}
                          {tz}
                          {profiles}
                          {expert}
                          horizon={horizonProfile}
                          bind:plan
                          onclose={() => {
                            clearSignal++;
                            selectedInfo = null;
                            dock = null;
                          }}
                          ongoto={() => skyRef?.centreSelected()}
                          onframe={() => {
                            if (!Object.values(shownFrames).some(Boolean)) skyRef?.frame();
                          }}
                          skySurvey={layers.surveys ? layers.survey : null}
                          onsurvey={(id) => {
                            // From the object's own survey list: show it under the stars and
                            // bring the object to the middle so it is in view.
                            layers = id
                              ? { ...layers, surveys: true, survey: id }
                              : { ...layers, surveys: false };
                            if (id) skyRef?.centreSelected();
                          }}
                        />
                      {:else}
                        <p class="dock-empty">
                          Tap any star, planet, galaxy or nebula in the sky to see what it is, where
                          it is, when it is best and how it fits your camera.
                        </p>
                      {/if}
                    {:else if p === 'layers'}
                      <P.LayersSheet bind:layers {surveyStatus} {expert} />
                    {:else if p === 'telescope'}
                      <P.TelescopePanel
                        {place}
                        selected={selectedInfo}
                        bind:setups
                        frameOn={Object.values(shownFrames).some(Boolean)}
                        {frameCenter}
                        profileName={activeProfile?.name ?? 'No profile'}
                        profileText={activeProfile ? profileSummary(activeProfile) : ''}
                        horizon={horizonProfile}
                        ontoggleframe={() => skyRef?.frame()}
                        oncentre={() => skyRef?.centreSelected()}
                      />
                    {:else if p === 'horizon'}
                      <P.HorizonPanel
                        {place}
                        bind:foreground
                        bind:customHorizon
                        terrainOn={layers.terrain}
                        ontoggleterrain={(v) => (layers = { ...layers, terrain: v })}
                        shown={shown.getTime()}
                        terrain={siteHorizon?.profile ?? null}
                      />
                    {:else if p === 'time'}
                      <div class="dock-stack">
                        <P.TimeControls
                          {place}
                          time={shown}
                          {live}
                          {tz}
                          events={timeEvents}
                          onchange={setTime}
                        />
                        <div class="dock-row" role="group" aria-label="Time speed">
                          <button onclick={() => timeCmd('slower')} aria-label="Slower (J)"
                            >◀◀</button
                          >
                          <button onclick={() => timeCmd(live || rate !== 0 ? 'pause' : 'real')}
                            >{live || rate !== 0 ? 'Pause' : 'Play'}</button
                          >
                          <button onclick={() => timeCmd('faster')} aria-label="Faster (L)"
                            >▶▶</button
                          >
                          <button onclick={() => timeCmd('now')} aria-pressed={live}>Now</button>
                        </div>
                      </div>
                    {:else}
                      <P.SkyMore
                        {place}
                        time={shown}
                        {tz}
                        onplace={setPlace}
                        onpick={(n) =>
                          pickResult({ kind: 'planet', label: n, sub: '', badges: [] })}
                        onfull={() => skyRef?.fullScreen()}
                        oncamera={() => (cameraOpen = true)}
                      />
                    {/if}
                  {/snippet}
                </P.SkyDock>
              {/snippet}
            </P.SkyView>
          </div>
        </div>
      </section>
    {/await}
  {/if}

  {#if page === 'plan'}
    <div class="plan">
      <h1 class="visually-hidden">Plan your night at {place.name}</h1>
      <aside class="plan-index">
        <SectionIndex active={activeSection} onactive={sectionInView} onjump={jumpTo} />
      </aside>
      <div class="plan-body">
        <section id="sec-tonight" class="sec" aria-labelledby="h-tonight">
          <header class="sec-head">
            <div>
              <h2 id="h-tonight">Tonight at a glance</h2>
              <p class="lede">
                Conditions at {place.name} for {live ? 'now' : fmtDateTime(shown, tz)}. Pick an hour
                in the timeline or drag the night ribbon to see that moment here and in the sky.
              </p>
            </div>
            {#if !live}<button onclick={() => setTime(new Date(), true)}>Back to now</button>{/if}
          </header>

          <TonightGlance v={tonightVerdict} {moon} {tz} {expert} sqm={sqmUsed} />
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
          {#if ready('tonight-detail')}
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
              {naturalSky}
              {solarFlux}
              {measured}
              {stationNote}
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
                {naturalSky}
                {solarFlux}
                onloadterrain={horizonState === 'saved' ? () => (forceTerrain = true) : undefined}
              />
            </div>
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-targets" class="sec" aria-labelledby="h-targets">
          <header class="sec-head">
            <div>
              <h2 id="h-targets">Best targets tonight</h2>
              <p class="lede">
                Deep-sky objects ranked for tonight's dark hours, your sky and your camera frame.
              </p>
            </div>
          </header>
          {#if ready('targets')}
            <TargetsPanel
              {place}
              {tz}
              {tw}
              dark={tonightVerdict.dark}
              clear={clearByHour}
              sqm={sqmUsed.value ?? 21}
              profile={activeProfile}
              horizon={horizonProfile}
              shown={shown.getTime()}
              {expert}
              bind:plan
              onshow={(r) =>
                showTarget({
                  ra: r.o.ra,
                  dec: r.o.dec,
                  sizeDeg: (r.o.maj ?? 6) / 60,
                  ...(r.best ? { bestT: r.best.t } : {}),
                  id: r.o.name,
                })}
            />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-planets" class="sec" aria-labelledby="h-planets">
          <header class="sec-head">
            <div>
              <h2 id="h-planets">Planets, Sun and Moon</h2>
              <p class="lede">
                Where the Solar System is tonight, with rise, transit and set times.
              </p>
            </div>
          </header>
          {#if ready('planets')}
            <PlanetsPanel
              {place}
              {tz}
              {tw}
              shown={shown.getTime()}
              {expert}
              profile={profiles.find((p) => p.profileKind === 'planetary') ?? activeProfile}
              seeing={tonightVerdict.seeing}
              onshow={(name) => pickResult({ kind: 'planet', label: name, sub: '', badges: [] })}
            />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-week" class="sec" aria-labelledby="h-week">
          <header class="sec-head">
            <div>
              <h2 id="h-week">Week ahead</h2>
              <p class="lede">Cloud outlook for the next seven nights from the forecast models.</p>
            </div>
          </header>
          {#if ready('week')}
            <WeekAhead nights={week} {tz} />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-trips" class="sec" aria-labelledby="h-trips">
          <header class="sec-head">
            <div>
              <h2 id="h-trips">Trip planner: months and years ahead</h2>
              <p class="lede">
                Every night of any year to {new Date().getFullYear() + 15}: dark hours without the
                Moon, when your target is up, and how often each month's nights were clear here over
                the last ten years. Change the place (top left) to plan a trip somewhere else.
              </p>
            </div>
          </header>
          {#if ready('trips')}
            <YearPlanner
              {place}
              {tz}
              targets={[
                ...(selectedInfo
                  ? [
                      {
                        name: selectedInfo.name,
                        ra: selectedInfo.ra2000,
                        dec: selectedInfo.dec2000,
                      },
                    ]
                  : []),
                ...plan.map((p) => ({
                  name: p.common ? `${p.name} · ${p.common}` : p.name,
                  ra: p.ra,
                  dec: p.dec,
                })),
              ]}
              onnight={(t) => {
                setTime(t, false);
                jumpTo('tonight');
              }}
            />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-telescope" class="sec" aria-labelledby="h-telescope">
          <header class="sec-head">
            <div>
              <h2 id="h-telescope">Telescope and field of view</h2>
              <p class="lede">
                Your setups and their fields of view; switch the profile in the header.
              </p>
            </div>
          </header>
          {#if ready('telescope')}
            <Equipment
              bind:setups
              bind:shown={shownFrames}
              seeing={row.seeing?.arcsec ?? null}
              center={frameCenter}
            />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-space" class="sec" aria-labelledby="h-space">
          <header class="sec-head">
            <div>
              <h2 id="h-space">Aurora and satellites</h2>
              <p class="lede">Aurora chances and bright passes of the ISS and other satellites.</p>
            </div>
          </header>
          {#if ready('space')}
            <div use:nearView={startOrbits}></div>
            <Extras
              {place}
              {tz}
              {now}
              aurora={sources?.aurora?.data ?? null}
              kp={kpSource.data}
              orbits={orbitSource?.data ?? null}
              orbitsMissing={!orbitSource || orbitSource.status === 'error'}
            />
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-maps" class="sec" aria-labelledby="h-maps">
          <header class="sec-head">
            <div>
              <h2 id="h-maps">Light pollution and cloud maps</h2>
              <p class="lede">
                Our yearly light-pollution model and the infrared satellite cloud map of the last
                hours.
              </p>
            </div>
          </header>
          {#if ready('maps')}
            <div class="night-filter" use:nearView={() => (mapsNear = true)}>
              {#if mapsNear}
                {#await import('./components/LightPollutionMap.svelte') then { default: LightPollutionMap }}
                  <LightPollutionMap {place} site={siteLight} {naturalSky} onplace={setPlace} />
                {:catch}
                  <p class="note">
                    The light-pollution map could not be loaded. Check the connection.
                  </p>
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
                        Infrared images of the last 2.5 hours around your site (about 1–3 MB). Off
                        until you open it, to save data.
                      </p>
                    </div>
                    <button onclick={() => (layers.satmap = true)}>Show the satellite map</button>
                  </div>
                {/if}
              {:else}
                <p class="note">The maps load when you scroll here (they need about 1–3 MB).</p>
              {/if}
            </div>
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
        <section id="sec-about" class="sec" aria-labelledby="h-about">
          <header class="sec-head">
            <div>
              <h2 id="h-about">About, methods and credits</h2>
              <p class="lede">How every number is computed, its limits, and who made the data.</p>
            </div>
          </header>
          {#if ready('about')}
            <details class="about" open={activeSection === 'about' && params.s === 'about'}>
              <summary>Methods, honest limits, data sources and credits</summary>
              <div class="prose">
                <About />
                <div id="credits"><Credits /></div>
              </div>
            </details>
          {:else}
            <p class="sec-wait" aria-hidden="true"></p>
          {/if}
        </section>
      </div>
    </div>
  {/if}
</main>

<footer class:hidden={page === 'sky'}>
  <span>Astro Night Planning</span>
  <a href="#/plan?s=about">About &amp; methods</a>
  <a href="#/plan?s=about">Credits</a>
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
  /* Header + night ribbon stay in reach on both pages. */
  .head {
    position: sticky;
    top: 0;
    z-index: 15;
    background: var(--ink-1);
    border-bottom: 1px solid var(--rule);
  }
  main {
    padding: 0 var(--gap) var(--gap);
    max-width: 1600px;
    margin: 0 auto;
    outline: none;
  }
  main:has(.sky-panel:not(.offscreen)) {
    padding: 0;
    max-width: none;
  }
  /* ---- sky tab ---- */
  .sky-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
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
  /* Phones: the sky fills the screen under the header. */
  .sky-box {
    height: calc(100vh - var(--head-h, 110px));
    height: calc(100dvh - var(--head-h, 110px));
    min-height: 420px;
    min-width: 0;
  }
  .offscreen .sky-box {
    height: 240px;
    min-height: 0;
  }
  @media (min-width: 900px) and (min-height: 600px) {
    /* The whole sky page fits the window: no scrolling to reach the sky. */
    .sky-panel:not(.offscreen) {
      height: calc(100vh - var(--head-h, 110px));
      height: calc(100dvh - var(--head-h, 110px));
      min-height: 560px;
    }
    .sky-panel:not(.offscreen) .sky-box {
      height: auto;
      min-height: 300px;
    }
  }
  @media (min-width: 1100px) {
  }
  /* ---- dock panels drawn by this page ---- */
  .dock-empty {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-14);
  }
  .dock-stack {
    display: grid;
    gap: var(--s3);
  }
  .dock-stack p {
    margin: 0;
  }
  .dock-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .dock-row button[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  /* ---- first-visit tour offer ---- */
  .tour-offer {
    position: fixed;
    z-index: 55;
    left: 50%;
    bottom: var(--s4);
    transform: translateX(-50%);
    width: min(520px, calc(100% - 24px));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    padding: var(--s3) var(--s4);
    background: var(--ink-1);
    border: 1px solid var(--brass);
    border-radius: 12px;
    box-shadow: var(--shadow-float);
    font-size: var(--fs-14);
  }
  .tour-offer span {
    flex: 1 1 220px;
  }
  .tour-offer .primary {
    border-color: var(--brass);
    color: var(--brass);
  }
  /* ---- Plan page ---- */
  .plan {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s4);
    max-width: 1440px;
    margin: 0 auto;
  }
  /* Phones: the chips scroll away with the page (the header already takes a fifth of the screen). */
  .plan-index {
    z-index: 5;
    margin: 0 calc(-1 * var(--gap));
    padding: var(--s2) var(--gap);
    background: var(--ink-0);
    border-bottom: 1px solid var(--rule);
  }
  .plan-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  /* Space held for a section that has not rendered yet (keeps the page from jumping). */
  .sec-wait {
    min-height: 40vh;
    margin: 0;
  }
  .sec {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s4);
    padding: var(--s6) 0;
    border-top: 1px solid var(--rule);
    scroll-margin-top: calc(var(--head-h, 110px) + 64px);
  }
  .sec:first-child {
    border-top: 0;
    padding-top: var(--s4);
  }
  .sec-head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--s2) var(--s4);
  }
  .sec-head h2 {
    margin: 0;
    font-family: var(--font-name);
    font-style: italic;
    font-weight: 600;
    font-size: var(--fs-30);
    line-height: var(--lh-head);
  }
  details.about > summary {
    cursor: pointer;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    color: var(--brass);
  }
  .prose {
    max-width: var(--measure);
  }
  footer.hidden {
    display: none;
  }
  @media (min-width: 600px) {
    .plan-index {
      position: sticky;
      top: var(--head-h, 110px);
    }
  }
  @media (min-width: 1100px) {
    .plan {
      grid-template-columns: 180px minmax(0, 1fr);
      gap: var(--s6);
    }
    .plan-index {
      align-self: start;
      margin: 0;
      padding: var(--s5) 0 0;
      border-bottom: 0;
      background: transparent;
      top: var(--head-h, 110px);
    }
  }
  @media (max-width: 599px) {
    .sec-head h2 {
      font-size: var(--fs-24);
    }
  }
  /* ---- shared ---- */
  .lede {
    margin: var(--s1) 0 0;
    color: var(--text-2);
    max-width: var(--measure);
    font-size: var(--fs-16);
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
