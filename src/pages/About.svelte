<script lang="ts">
  const methods = [
    'Airmass: Kasten & Young (1989).',
    'Refraction: Bennett (1982) and Saemundsson (1986), scaled for temperature and pressure (Meeus, ch. 16); the sky engine’s refraction is patched to match.',
    'Positions: Stellarium Web Engine (ERFA) and Astronomy Engine, cross-checked against JPL Horizons.',
    'Transparency: V-band extinction from Rayleigh scattering (Hansen & Travis 1974), CAMS aerosol optical depth and ozone.',
    'Moonlight: Krisciunas & Schaefer (1991).',
    'Dew risk: dew-point spread versus typical radiative cooling of optics (an estimate).',
    'In the 3D sky: every star and planet is dimmed and reddened by the live extinction along its line of sight, faint stars below the eye threshold for the current sky brightness are hidden (Schaefer 1990, Crumey 2014), cloud layers are placed by the forecast at the site and 35–100 km around it, and the horizon is the real terrain from the Copernicus DEM.',
    'Imaging score: clouds × transparency × Moon × darkness as relative signal-to-noise factors; models ECMWF, GFS and ICON give the agreement indicator.',
  ];
</script>

<article class="page">
  <h1>About &amp; methods</h1>
  <p>
    Astro Night Planning shows a realistic sky for your exact location and time, together with the
    observing conditions that matter for astrophotography. Everything is computed from open data and
    published physics; nothing is decorative.
  </p>

  <h2>Honest limits</h2>
  <ul>
    <li>
      <strong>Seeing and transparency are forecasts.</strong> No free source measures live seeing; values
      come from weather-model winds and aerosol forecasts.
    </li>
    <li>
      <strong>Light pollution is yearly, not live.</strong> It is modelled from satellite night lights,
      which underestimate blue/white LED light, so real skies may be brighter.
    </li>
    <li>
      <strong>Clouds</strong> combine satellite infrared imagery (minutes to hours old) with weather-model
      cloud cover; small local clouds can be missed.
    </li>
  </ul>

  <h2>Methods implemented so far</h2>
  <ul>
    {#each methods as m (m)}<li>{m}</li>{/each}
  </ul>
  <p>
    Source code: AGPL-3.0. The full method write-ups live in the repository's <code>docs/</code>
    folder.
  </p>
</article>

<style>
  .page {
    max-width: 820px;
    margin: 0 auto;
  }
  li {
    margin: 6px 0;
  }
</style>
