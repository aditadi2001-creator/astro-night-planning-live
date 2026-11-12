<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SkyView from './components/SkyView.svelte';
  import TimeControls from './components/TimeControls.svelte';
  import SunMoonCard from './components/SunMoonCard.svelte';
  import Layers from './components/Layers.svelte';
  import Credits from './pages/Credits.svelte';
  import About from './pages/About.svelte';
  import { loadPlace, savePlace } from './lib/location';
  import type { Place } from './lib/astro/sky';

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  /** The moment the sky and cards show; follows `now` while live. */
  let shown = $state(new Date());
  let live = $state(true);
  let route = $state(location.hash);
  let night = $state(false);
  let layers = $state({ constellations: true });

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
<TopBar {place} {now} bind:night onplace={setPlace} />

<main id="main">
  {#if route === '#/credits'}
    <Credits />
  {:else if route === '#/about'}
    <About />
  {:else}
    <div class="layout">
      <section class="sky" aria-label="Live sky view">
        <TimeControls {place} time={shown} {live} onchange={setTime} />
        <div class="sky-box">
          <SkyView {place} time={shown} {live} constellations={layers.constellations} />
        </div>
      </section>
      <aside class="cards" aria-label="Observing conditions">
        <SunMoonCard {place} now={shown} />
        <Layers bind:layers />
      </aside>
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
    z-index: 10;
    background: var(--panel);
    padding: 8px;
  }
  main {
    padding: var(--gap);
  }
  .layout {
    display: grid;
    gap: var(--gap);
    grid-template-columns: 1fr;
  }
  .sky {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sky-box {
    height: 62vh;
    min-height: 320px;
  }
  .cards {
    display: grid;
    gap: var(--gap);
    align-content: start;
  }
  @media (min-width: 960px) {
    .layout {
      grid-template-columns: 1fr 360px;
    }
    .sky-box {
      height: calc(100vh - 190px);
    }
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 12px var(--gap) 24px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
