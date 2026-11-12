<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SkyView from './components/SkyView.svelte';
  import TimeControls from './components/TimeControls.svelte';
  import ConditionCards from './components/ConditionCards.svelte';
  import Timeline from './components/Timeline.svelte';
  import DataStatus from './components/DataStatus.svelte';
  import Layers, { type LayerState } from './components/Layers.svelte';
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
  import { buildRow, buildTimeline, moonEvents, nightWindow, twilight } from './lib/conditions';
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
  import type { EngineAtmosphere } from './lib/engine/stel';

  const WEATHER_INTERVAL = 30 * 60_000;

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  /** The moment the sky and cards show; follows `now` while live. */
  let shown = $state(new Date());
  let live = $state(true);
  let route = $state(location.hash);
  let night = $state(false);
  let layers = $state<LayerState>({
    clouds: true,
    haze: true,
    terrain: true,
    constellations: true,
  });
  let cursor = $state<{ alt: number; az: number } | null>(null);

  // ---- live data sources, recreated per location --------------------------------
  type Sources = {
    weather: LiveSource<Weather>;
    models: LiveSource<ModelClouds>;
    air: LiveSource<Air>;
    ring: LiveSource<CloudRing>;
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
    };
    sources = s;
    // Loaders answer from the cache when it is fresh, and fall back to the last
    // good copy (marked stale) when the network fails.
    const stops = [s.weather.start(), s.models.start(), s.air.start(), s.ring.start()];
    return () => stops.forEach((stop) => stop());
  });

  const weather = $derived(sources?.weather.data ?? null);
  const models = $derived(sources?.models.data ?? null);
  const air = $derived(sources?.air.data ?? null);
  const ring = $derived(sources?.ring.data ?? null);

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
  const row = $derived(buildRow(minute, place, weather, models, air));
  const tw = $derived(twilight(place, new Date(minute)));
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
    return {
      center: { low: w.cloudLow, mid: w.cloudMid, high: w.cloudHigh },
      samples,
      wind: { low: wind(850), mid: wind(500), high: wind(250) },
      time: driftT,
      color: cloudColors(lighting.sunAlt, lighting.moonAlt, lighting.moonIllum, 0),
    };
  });
  const ground = $derived(groundColor(lighting.sunAlt, lighting.moonAlt, lighting.moonIllum));
  // Round the colour so the terrain texture is not rebuilt every minute for invisible changes.
  const groundKey = $derived(ground.map((c) => Math.round(c)).join(','));
  const groundRgb = $derived(groundKey.split(',').map(Number) as [number, number, number]);

  const timeline = $derived.by(() => {
    const win = nightWindow(place, new Date(Math.floor(now.getTime() / 600_000) * 600_000));
    return win ? buildTimeline(place, win, weather, models, air) : [];
  });

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

  $effect(() => {
    document.documentElement.dataset.night = String(night);
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
          oncursor={(p) => (cursor = p)}
        />
      </section>

      <Timeline
        rows={timeline}
        {tz}
        shown={shown.getTime()}
        onpick={(t) => setTime(new Date(t), false)}
      />

      <ConditionCards {row} {moon} {tw} {tz} loading={sources?.weather.status === 'loading'} />

      <div class="pair">
        <Layers bind:layers />
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
