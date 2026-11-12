<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SkyView from './components/SkyView.svelte';
  import SunMoonCard from './components/SunMoonCard.svelte';
  import Credits from './pages/Credits.svelte';
  import About from './pages/About.svelte';
  import { loadPlace, savePlace } from './lib/location';
  import type { Place } from './lib/astro/sky';

  let place = $state<Place>(loadPlace());
  let now = $state(new Date());
  let route = $state(location.hash);
  let night = $state(false);

  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
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
        <SkyView {place} {now} />
      </section>
      <aside class="cards" aria-label="Observing conditions">
        <SunMoonCard {place} {now} />
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
    min-height: 60vh;
  }
  @media (min-width: 960px) {
    .layout {
      grid-template-columns: 1fr 360px;
    }
    .sky {
      min-height: calc(100vh - 140px);
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
