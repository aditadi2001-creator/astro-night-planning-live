<script lang="ts">
  import manifest from '../../public/catalog/manifest-v1.json';
  import { CATALOG_INFO } from '../lib/search/index';
  import { SURVEYS } from '../lib/sky/surveys';

  const counts = manifest.catalogs as Record<string, number>;
  const catalogRows = CATALOG_INFO.filter((c) => counts[c.badge]).map((c) => ({
    name: c.name,
    n: counts[c.badge] ?? 0,
  }));
  const methods = [
    'Airmass: Kasten & Young (1989).',
    'Refraction: Bennett (1982) and Saemundsson (1986), scaled for temperature and pressure (Meeus, ch. 16); the sky engine’s refraction is patched to match.',
    'Positions: Stellarium Web Engine (ERFA) and Astronomy Engine, cross-checked against JPL Horizons. Measured accuracy (automated tests, Bangalore, Nov 2026): Sun, Moon and planets within 16 arcseconds, rise/set/twilight within 13 seconds, deep-sky altitude/azimuth within 8 arcseconds of Astropy (docs/ACCURACY.md).',
    'Transparency: V-band extinction from Rayleigh scattering (Hansen & Travis 1974), CAMS aerosol optical depth and ozone.',
    'Moonlight: Krisciunas & Schaefer (1991).',
    'Dew risk: dew-point spread versus typical radiative cooling of optics (an estimate).',
    'In the 3D sky: every star and planet is dimmed and reddened by the live extinction along its line of sight, faint stars below the eye threshold for the current sky brightness are hidden (Schaefer 1990, Crumey 2014), cloud layers are placed by the forecast at the site and 35–100 km around it, and the horizon is the real terrain from the Copernicus DEM.',
    'Imaging score: clouds × transparency × Moon × darkness × seeing as relative signal-to-noise factors; models ECMWF, GFS and ICON give the agreement indicator.',
    'Seeing (a forecast): Hufnagel–Valley turbulence profile driven by the jet-stream wind and low-level wind shear, Fried (1966) for the arcsecond value; 7Timer! as a second opinion. Changed 20 November 2026 (tests in tests/seeing-sites.test.ts): the near-ground layer is calibrated on real nights (archived forecasts replayed against measured medians at Kavalur, Sutherland, Devasthal and Hanle, all now within 15 %), plus a city term, so central Bangalore reads about 2–2.5″ instead of 1.6″; the old version was about twice too optimistic on real nights.',
    'Satellite clouds: NOAA GMGSI and NASA GIBS thermal infrared; a pixel counts as cloud when it is well below the surface temperature, blended with the forecast and fading as the image ages.',
    'Light pollution (yearly): NASA Black Marble VNP46A4 night lights spread with a Garstang / Cinzano–Falchi style distance kernel, calibrated on Globe at Night SQM readings; light domes per compass direction from the same kernel.',
    'Clouds: the median of six global models (ECMWF, GFS, ICON, JMA, Météo-France, UK Met Office; GEM and CMA are shown but left out after scoring 800 night hours per site against ERA5: they are strongly biased towards clear skies, and without them the error fell at every site tested, tests/clouds-estimate.test.ts) per layer, pulled towards the newest satellite infrared image for the next hours (weight 0.85·e^(−Δt/3 h)); past hours are the satellite record. In the sky, clouds are placed where the satellite saw them (cloud-top height from the brightness temperature at 6.5 K/km) and drift with the forecast winds.',
    'City sky glow: the yearly light-pollution model brightens the whole night sky (more towards the horizon) as well as the light domes.',
    'Equipment: pixel scale 206.265 × pixel size / focal length, field of view from the sensor size, Dawes and Rayleigh limits, Nyquist sampling against the seeing; frames drawn by inverse gnomonic projection.',
    'Best targets: about 25,000 objects from the Stellarium deep-sky catalog ranked by the same five factors as before — dark hours above the minimum altitude (30° by default) weighted by the cloud forecast, the Moon, contrast against the sky brightness, framing in your camera and brightness. Changes in November 2026 (tested in tests/rank.test.ts): hours below your terrain or custom horizon no longer count; surface brightness is computed from the catalog magnitude and size (mean over the ellipse, as OpenNGC does); magnitudes that are not the object’s own (dark-nebula opacity classes, illuminating-star magnitudes of reflection nebulae) are ignored; the “any type” list skips near-duplicates and keeps any one type to a quarter of the list; reflection nebulae no longer get the bright-core boost meant for emission nebulae.',
    'Air quality now: OpenAQ government monitors within 25 km, each as an EPA NowCast, blended by distance (1/(d + 2 km)²) before the US AQI is taken (changed 20 November 2026: one station used to set the figure; tests/aqi.test.ts). The CAMS model is used for later hours.',
    'Tonight verdict: tonight rolls over to the coming night at sunrise. Go when at least 3 dark hours score 40 or more out of 100, marginal for 1–3 such hours (or a best hour of 25–40), no-go otherwise; the reasons come from the same hourly clouds, Moon, seeing, transparency, dew and model-agreement values.',
    'Telescope HUD (November 2026, tests in tests/telescope.test.ts): the mount’s position is converted between J2000 and the equator of date with Astronomy Engine (IAU 2006 precession, IAU 2000B nutation); hour angle uses the mount’s sidereal time when it reports one; “below your horizon in” steps the position forward in 2-minute steps against your planning horizon (no refraction). Mosaic panes are spaced by the frame size minus the overlap on the tangent plane and turned with the frame.',
    'Planets, Sun and Moon: Astronomy Engine positions, magnitudes, phases and Jupiter-moon positions; apparent diameters from IAU radii; the Moon’s terminator longitude from its phase (about ±3°, libration ignored); sunspot and flux data from NOAA SWPC.',
    'Aurora: NOAA SWPC OVATION forecast (chance of visible aurora) and the planetary Kp index; the chance in view uses the geometry of an aurora whose lower edge is 110 km high.',
    'Satellite passes: SGP4 orbit propagation (satellite.js) from CelesTrak elements; a pass is visible while the satellite is sunlit and the Sun is 6° or more below the horizon.',
    "Light-pollution map: our yearly sky-brightness tiles (magnitudes above a solar-minimum natural sky of 22.0 mag/arcsec²) recoloured to a Bortle-style palette; the value under a click is read from the same tile and, like the site figures, adds today's natural sky (airglow brightens it by up to ~0.3 mag near solar maximum), so the map and the site figures always agree.",
    'Light domes in the 3D sky: the glow of the towns in each 10° of azimuth from the same model, as contrast against the local sky, fading with altitude as e^(−alt/12°), on top of the engine’s uniform Bortle sky glow.',
    'Ocular view (like Stellarium’s Oculars plugin): the sensor frame at its true angular size at the screen centre; eyepiece true field = apparent field ÷ magnification (telescope focal × Barlow ÷ eyepiece focal); Telrad rings 0.5°, 2° and 4°.',
    'Object information: hour angle from the local apparent sidereal time, galactic coordinates by the standard ICRS → galactic rotation, constellation by the IAU boundaries (Astronomy Engine), airmass by Kasten & Young.',
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

  <h2>Catalogs in search</h2>
  <p>
    Objects per catalog in the bundled files (built {manifest.built}; an object in several catalogs
    is counted in each). Bright stars: {manifest.rows.stars.toLocaleString('en')} to magnitude 6.5; curated
    notable objects: {manifest.rows.notable}. Sky surveys: {SURVEYS.length}, streamed from their
    providers. Not available: Gum nebulae (no machine-readable catalogue found).
  </p>
  <table class="counts">
    <thead><tr><th scope="col">Catalog</th><th scope="col">Objects</th></tr></thead>
    <tbody>
      {#each catalogRows as r (r.name)}
        <tr><td>{r.name}</td><td>{r.n.toLocaleString('en')}</td></tr>
      {/each}
    </tbody>
  </table>

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
  .counts {
    border-collapse: collapse;
    font-size: var(--fs-14);
  }
  .counts th,
  .counts td {
    text-align: left;
    padding: 2px 16px 2px 0;
    border-bottom: 1px solid var(--rule);
  }
  .counts td:last-child {
    text-align: right;
  }
</style>
