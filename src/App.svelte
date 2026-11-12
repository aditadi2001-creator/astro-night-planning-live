<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SkyView from './components/SkyView.svelte';
  import TimeControls from './components/TimeControls.svelte';
  import ConditionCards from './components/ConditionCards.svelte';
  import Timeline from './components/Timeline.svelte';
  import DataStatus from './components/DataStatus.svelte';
  import Layers from './components/Layers.svelte';
  import Credits from './pages/Credits.svelte';
  import About from './pages/About.svelte';
  import { loadPlace, savePlace } from './lib/location';
  import type { Place } from './lib/astro/sky';
  import { LiveSource } from './lib/data/live.svelte';
  import {
    loadAir,
    loadModelClouds,
    loadWeather,
    type Air,
    type ModelClouds,
    type Weather,
  } from './lib/data/openmeteo';
  import { buildRow, buildTimeline, moonEvents, nightWindow, twilight } from './lib/conditions';

  const WEATHER_INTERVAL = 30 * 60_000;

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  /** The moment the sky and cards show; follows `now` while live. */
  let shown = $state(new Date());
  let live = $state(true);
  let route = $state(location.hash);
  let night = $state(false);
  let layers = $state({ constellations: true });

  // ---- live data sources, recreated per location --------------------------------
  type Sources = {
    weather: LiveSource<Weather>;
    models: LiveSource<ModelClouds>;
    air: LiveSource<Air>;
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
    };
    sources = s;
    // Loaders answer from the cache when it is fresh, and fall back to the last
    // good copy (marked stale) when the network fails.
    const stops = [s.weather.start(), s.models.start(), s.air.start()];
    return () => stops.forEach((stop) => stop());
  });

  const weather = $derived(sources?.weather.data ?? null);
  const models = $derived(sources?.models.data ?? null);
  const air = $derived(sources?.air.data ?? null);
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
            ]}
          />
        {/if}
      </div>

      <section class="sky-box" aria-label="Live sky view">
        <SkyView {place} time={shown} {live} constellations={layers.constellations} />
      </section>

      <Timeline
        rows={timeline}
        {tz}
        shown={shown.getTime()}
        onpick={(t) => setTime(new Date(t), false)}
      />

      <ConditionCards {row} {moon} {tw} {tz} loading={sources?.weather.status === 'loading'} />

      <Layers bind:layers />
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
