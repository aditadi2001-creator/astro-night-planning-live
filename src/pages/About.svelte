<script lang="ts">
  const methods = [
    'Airmass: Kasten & Young (1989).',
    'Refraction: Bennett (1982) and Saemundsson (1986), scaled for temperature and pressure (Meeus, ch. 16); the sky engine’s refraction is patched to match.',
    'Positions: Stellarium Web Engine (ERFA) and Astronomy Engine, cross-checked against JPL Horizons.',
    'Transparency: V-band extinction from Rayleigh scattering (Hansen & Travis 1974), CAMS aerosol optical depth and ozone.',
    'Moonlight: Krisciunas & Schaefer (1991).',
    'Dew risk: dew-point spread versus typical radiative cooling of optics (an estimate).',
    'In the 3D sky: every star and planet is dimmed and reddened by the live extinction along its line of sight, faint stars below the eye threshold for the current sky brightness are hidden (Schaefer 1990, Crumey 2014), cloud layers are placed by the forecast at the site and 35–100 km around it, and the horizon is the real terrain from the Copernicus DEM.',
    'Imaging score: clouds × transparency × Moon × darkness × seeing as relative signal-to-noise factors; models ECMWF, GFS and ICON give the agreement indicator.',
    'Seeing (a forecast): Hufnagel–Valley turbulence profile driven by the jet-stream wind and low-level wind shear, Fried (1966) for the arcsecond value; 7Timer! as a second opinion.',
    'Satellite clouds: NOAA GMGSI and NASA GIBS thermal infrared; a pixel counts as cloud when it is well below the surface temperature, blended with the forecast and fading as the image ages.',
    'Light pollution (yearly): NASA Black Marble VNP46A4 night lights spread with a Garstang / Cinzano–Falchi style distance kernel, calibrated on Globe at Night SQM readings; light domes per compass direction from the same kernel.',
    'Aurora: NOAA SWPC OVATION forecast (chance of visible aurora) and the planetary Kp index; the chance in view uses the geometry of an aurora whose lower edge is 110 km high.',
    'Satellite passes: SGP4 orbit propagation (satellite.js) from CelesTrak elements; a pass is visible while the satellite is sunlit and the Sun is 6° or more below the horizon.',
    'Optional sky surveys (off by default): HiPS image tiles (Fernique et al. 2015) streamed from CDS or its official mirrors and drawn by the sky engine under the stars; galactic-frame surveys are rotated to ICRS. They are archival photographs, not the live sky.',
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
