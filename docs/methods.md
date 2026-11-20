# Methods

Every formula here has unit tests in `tests/` checked against the published reference values.

## Airmass — Kasten & Young (1989)

`src/lib/physics/airmass.ts`

X = 1 / (cos z + 0.50572 · (96.07995° − z)^−1.6364), z = apparent zenith angle in degrees.

Reference: Kasten, F. & Young, A. T. (1989), _Applied Optics_ 28(22), 4735–4738. Values tested:
0.9997 at the zenith, 1.994 at 30° altitude, 5.60 at 10°, 37.92 at the horizon.

## Refraction — Bennett (1982), Saemundsson (1986)

`src/lib/physics/refraction.ts`

- From apparent altitude hₐ (Bennett): R = cot(hₐ + 7.31/(hₐ + 4.4)) arcmin, with Meeus's
  correction −0.06 sin(14.7R + 13°) so that R = 0 at the zenith.
- From true altitude h (Saemundsson): R = 1.02 cot(h + 10.3/(h + 5.11)) arcmin.
- Both assume 1010 hPa and 10 °C. For live conditions multiply by
  (P/1010 hPa) · (283 K / (273 K + T)) (Meeus, _Astronomical Algorithms_, 2nd ed., ch. 16), using
  the station pressure and temperature from Open-Meteo.

The two fits agree with each other to about 0.12′ (7″), far below typical seeing.

## Positions

- **3D sky:** Stellarium Web Engine computes apparent positions with ERFA (precession, nutation,
  aberration, proper motion and parallax from the catalogues). Its refraction uses Saemundsson's
  formula; we patch an upstream bug that applied only cos²(alt) of the refraction (half of it at
  45°) and a degree/arcmin mix-up in Meeus's zenith term — see `engine/README.md`. After the patch
  the engine matches `src/lib/physics/refraction.ts` to 0.0001′ between 0° and 89°.
- **Cross-check:** for Altair from Greenwich on 2026-11-12 18:11:02 UTC the engine's geometric
  altitude/azimuth agree with an independent Astronomy Engine calculation (Hipparcos position and
  proper motion) to 4.7″ / 2.6″.
- **Planets (engine vs JPL Horizons):** Sydney, 2026-11-12 12:00 UT, geometric (airless). Sun,
  Moon and Mars agree with Astronomy Engine to ≤ 2″; against JPL Horizons the engine is ~20″ off
  for Jupiter and ~17″ for Saturn (Astronomy Engine: ~3″ and ~12″). That is smaller than Jupiter's
  disc and irrelevant for framing, but it is the engine's accuracy limit for the outer planets.
- **Cards:** Sun, Moon and planets in the side cards come from Astronomy Engine (topocentric,
  aberration-corrected) with our own refraction.
- **Darkness times:** astronomical dusk/dawn (Sun at −18°) from Astronomy Engine's altitude search;
  tested against the timeanddate.com table for London (18:11 / 05:18 UTC on 12–13 Nov 2026).
  Where the Sun never reaches −18° (summer at high latitude), "Tonight" jumps to the Sun's lowest
  point instead.
- **Pending:** the engine estimates pressure from elevation at a fixed 15 °C. Live temperature and
  pressure from Open-Meteo are wired into it in the realism phase.

## Catalogues

See `pipelines/catalogs/README.md`: Hipparcos + Gaia DR3 to V = 10 in the site itself, OpenNGC deep
sky objects, IAU star names, the Stellarium Western sky culture, and a Milky Way reprojected from
ESA's Gaia EDR3 colour map.

## Extinction and transparency

`src/lib/physics/extinction.ts`. Zenith V-band extinction k (mag/airmass) = Rayleigh + aerosol +
ozone, with Δm = 1.0857 τ:

- **Rayleigh:** Hansen & Travis (1974) optical depth, τ(550 nm) = 0.0973 at 1013.25 hPa (matches
  Bucholtz 1995: 0.09728), scaled by the forecast station pressure.
- **Aerosol:** CAMS AOD at 550 nm from Open-Meteo. CAMS AOD already includes humidity growth, so
  humidity is not applied a second time.
- **Ozone:** Chappuis band, σ(550 nm) = 3.3·10⁻²¹ cm² (Serdyuchenko et al. 2014), climatological
  300 DU (Open-Meteo has no total-column ozone) → 0.029 mag.
- Checks: a Mauna Kea-like site (615 hPa, AOD 0.02) gives 0.12, inside the measured 0.11–0.13
  (Krisciunas et al. 1987); a clear sea-level night (AOD 0.1) gives 0.24.
- Classes: < 0.18 excellent, < 0.25 good, < 0.35 average, < 0.5 poor, otherwise bad.

## Moonlight

`src/lib/physics/moonlight.ts`: Krisciunas & Schaefer (1991), PASP 103, 1033, equations 1, 3, 15,
20 and 21. Check: the paper's dark sky 21.587 mag/arcsec² = 79.0 nL; a full Moon 60° high gives
18.1 mag/arcsec² 45° away (k = 0.172), consistent with the usual ~18 for full-Moon skies.

## Dew risk (heuristic)

`src/lib/physics/dew.ts`. Dew point from Magnus–Tetens (Alduchov & Eskridge 1996 constants). Optics
under a clear calm sky run ~3 °C below air temperature by radiative cooling (Monteith & Unsworth);
clouds remove this and wind reduces it (×0.3 at ≥ 8 m/s). Risk compares the dew-point spread with
that undercooling: margin ≤ 0 high, ≤ 1.5 °C moderate, ≤ 3 °C low. Labelled as an estimate.

## Imaging score

`src/lib/physics/score.ts`. For sky-limited imaging SNR ∝ S/√B, so the score (0–100) multiplies
relative SNR factors:

| Factor       | Formula                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| Clouds       | 1 − [1 − (1 − L)(1 − M)(1 − 0.6 H)] — random overlap; thin high cloud blocks 60 %     |
| Transparency | 10^(−0.4 (k − 0.15) · 1.5): light lost vs. a clean site at airmass 1.5                |
| Moon         | √(B_dark / (B_dark + B_moon)), K&S moonlight for a target 45° high, 90° from the Moon |
| Darkness     | 0 above −12° Sun altitude, 1 below −18°, linear between                               |
| Seeing       | 1.70″ / √(ε² + 1.5²): SNR ∝ 1/FWHM, star image = seeing ε ⊕ 1.5″ optics/guiding       |

B_dark is the site's moonless sky: light pollution plus today's natural sky (see "Natural sky and
the solar cycle"), or the natural sky alone when the light-pollution layer is off. Hours follow
the site's local clock (half-hour zones included) and are sampled at mid-hour.

## Seeing (forecast estimate) — Hufnagel–Valley profile, Fried (1966)

`src/lib/physics/seeing.ts`. Seeing cannot be measured by any free source, so this is a forecast
from model winds, labelled as such everywhere. Optical turbulence C_n²(h) integrates to
J = ∫C_n² dh; then r₀ = (0.423 k² J)^(−3/5) and FWHM ε = 0.98 λ/r₀ (λ = 500 nm, zenith).

J has three parts, each from the Hufnagel–Valley (1980) profile
C_n² = 0.00594 (v/27)² (10⁻⁵h)¹⁰ e^(−h/1000) + 2.7·10⁻¹⁶ e^(−h/1500) + A e^(−h/100):

| Part              | Our input                                                                               | Integral J           |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------- |
| Jet stream        | v = rms of the 500, 300, 250, 200 hPa winds (Hufnagel: rms wind 5–20 km)                | 2.1555·10⁻¹³ (v/27)² |
| Lower troposphere | × e^(−H/1500) for site height H; × (1 + (S/12 m/s)²) ≤ 4, S = 10 m–850 hPa vector shear | 4.05·10⁻¹³ × factors |
| Ground layer      | calibrated typical level × this hour's near-ground weather factor (below)               | HV 5/7 ground term   |

Check: the HV 5/7 reference (v = 21 m/s, A = 1.7·10⁻¹⁴) gives r₀ = 5.0 cm and 2.0″, as published
(unit-tested). Rating: ≤1.0″ excellent (5), ≤1.5″ good (4), ≤2.0″ average (3), ≤2.75″ poor (2),
else bad (1); shown as a ±30 % range. Tube currents and dome seeing are never included.

### Ground layer (near-ground turbulence)

For a telescope standing on the ground most of the seeing comes from the lowest tens of metres
(Dome C: 0.93″ at 3 m vs 0.55″ at 8 m; the surface layer is 35–63 % of all seeing at Paranal,
Mauna Kea and La Palma). The old fixed 0.7″ made low sites far too optimistic (Bangalore 0.7–1″
against the 2–3″ amateurs see).

**Recalibrated 20 Nov 2026 on real nights.** The earlier version was calibrated with hand-picked
"typical" weather for each site. Replaying ECMWF forecasts for 25 Aug - 12 Nov 2026 through it
showed it about 2x too optimistic on real nights (Kavalur median 0.91″ vs 1.85″ measured, Hanle
0.44″ vs 1.27″, Bangalore 1.6″): the AERMOD stable-night scheme collapses to almost no turbulence
at the low winds typical of these nights, which measured medians contradict. Now:

- **Typical level:** ε_g^(5/3) = 1 + 4.45·e^(−H/600 m) (in units of a 1″ layer): about 2.8″ at
  sea level, 1.66″ at 725 m, about 1″ above 2 km. Solved so the median over each site's dark
  hours of that period matches its measured median (`tests/seeing-sites.test.ts`, real-night
  fixture `tests/fixtures/seeing-nights.json`):

  | Site (height)       | Model median | Measured                                    |
  | ------------------- | ------------ | ------------------------------------------- |
  | Kavalur (725 m)     | 1.76″        | 1.85″ (RAA 2019, 1.3 m short exposures)     |
  | Sutherland (1760 m) | 1.44″        | 1.32″ (MASS-DIMM, Catala et al. 2013)       |
  | Devasthal (2450 m)  | 1.25″        | 1.1″ (DIMM, ARIES)                          |
  | Hanle (4500 m)      | 1.21″        | 1.27″ (DIMM, Parihar et al. 2015; IAO: <1″) |
  | Mauna Kea, Paranal  | 1.05″, 1.43″ | 0.65″, 0.8″ (laminar summits: read high)    |

- **Night weather factor** (mild, about 1 on a typical night): × (0.8 + 0.4·clear fraction) for
  ground cooling under clear skies, × (1 + ((wind − 6 m/s)/6)²) ≤ 2 above 6 m/s at 10 m.
- **City heat:** × (1 + 0.8·urban), urban 0–1 from the light-pollution model. Calibrated so
  central Bangalore (920 m, Bortle 9) reads about 2.45″ on clear nights and 2.05″ on cloudy ones:
  observers there report 2–3″, and meteoblue gave 2.05–2.57″ for the night of 20 Nov 2026 (it has
  no city term, so a city centre should read a little worse).
- **By day** (Sun above the horizon) the convective physics of `surfacelayer.ts` (AERMOD day
  fluxes, Wyngaard C_T²) still sets the factor, at least 1.
- Limits: one measured site below 1 km (Kavalur), so the sea-level end (about 2.8″ rural) rests on
  the fit; the observer's own surroundings (a hot roof, a cold-air pool), tube currents and dome
  seeing are not included. Night-to-night changes come mostly from the free-atmosphere terms.

Second opinion: 7Timer! ASTRO (GFS-based, every 3 h, 72 h ahead) through the data Worker, which
caches each 0.1° location for 3 h. Its classes 1–8 are shown in arcseconds as documented by 7Timer!:
<0.5, 0.5–0.75, 0.75–1, 1–1.25, 1.25–1.5, 1.5–2, 2–2.5, >2.5″; its transparency classes
(<0.3 … >1 mag/airmass) appear next to our aerosol-based value.

## Air quality: measured where possible

`src/lib/data/stationair.ts`, `src/lib/air/aqi.ts`, Worker route `/aq/<lat>/<lon>`. The CAMS global
model behind the forecast AQI (~45 km grid) badly underestimates city particle pollution in places:
on 15 Nov 2026 it gave Delhi 46 µg/m³ PM2.5 (US AQI 155) while stations read several times that. For
the present hour the site therefore uses measured data: the nearest OpenAQ reference monitors
(government stations such as India's CPCB/DPCC, the US EPA, the EEA; low-cost sensors only if no
monitor is in range) within 25 km that reported in the last 3 h: the Worker reads up to eight
and keeps those with a recent PM2.5 hour first, up to five (since 20 Nov 2026). The Worker turns
each monitor's last 12 hourly PM2.5 and PM10 values into EPA NowCast concentrations (weight
w = min/max floored at 0.5; at least two of the last three hours); the site turns those into the US
AQI with the February 2024 breakpoints (PM2.5 Good to 9.0 µg/m³), taking the larger of the PM2.5
and PM10 indices. **Since 20 Nov 2026 the headline blends the stations:** PM2.5 and PM10 are
each averaged over the stations that report them with weights 1/(d + 2 km)², the usual way to
estimate a point from a monitoring network, before the AQI is taken (one station alone gave
Bangalore 175 on 20 Nov 05:30 while IQAir showed the city at 112 and WAQI's 04:00 stations
121–138). The nearest PM2.5 station and the others' AQIs are listed. CAMS remains for
forecast hours and where no station is near. Needs a free OpenAQ key as the Worker secret
`OPENAQ_KEY`; the Worker caches each 0.01° cell for 20 minutes.

## Satellite clouds: how much, and how thick

`src/lib/sat/ir.ts`, `src/lib/sky/clouds.ts`. The hourly GMGSI infrared image is blended with the
models (weight 0.85·e^(−Δt/3 h)) for cover; two physical limits of a single infrared channel are
handled explicitly:

- **Thickness of high cloud.** Forecast models give high-cloud _amount_ but not how thick it is, and
  a cold infrared top can be a thin cirrus veil or an opaque deck. The pixel's effective emissivity
  ε = (B(T_s) − B(T_b)) / (B(T_s) − B(T_c)) (Planck radiance at 10.8 µm; T_s the forecast surface
  air, T_c the forecast 250 hPa temperature) gives how opaque it is; with τ_vis ≈ 2 τ_ir for ice
  cloud (Minnis et al. 1993) the share of sky light blocked is 1 − (1 − ε)². Thin cirrus (ε 0.2–0.4)
  blocks 35–65 %; a deck reading near its own temperature is opaque and drawn grey like mid cloud.
  Each satellite cell sets its own opacity; elsewhere the site's measured value is handed over to a
  typical 0.5 with a 12 h time constant (a kind of cloud deck lasts longer than each cloud's place).
  Checked on Bangalore, 15 Nov 2026 11:30 IST: models 100 % high cloud, satellite tops 232–248 K over
  26 °C ground → opacity 0.99; the sky went from 40 % blocked (drawn as cirrus) to 98 % (overcast),
  as observed.
- **Low cloud under a warm top.** Stratus and fog are about as warm as the ground, so a warm pixel
  doesn't prove a clear sky. The satellite may add cloud anywhere but remove at most 30 % × its
  weight of the models' low cloud (cards, timeline and the 3D sky alike).
- A full overcast is drawn without holes (the noise threshold drops below its soft edge above 97 %).

## Cloud forecast: which models make the median (20 Nov 2026)

The hourly cloud figure is the per-layer median of six models: ECMWF, GFS, ICON, JMA, Météo-France
and UK Met Office. GEM and CMA are still fetched and shown, and count in the spread (min–max),
but not in the median. Scored on 800 night hours per site (25 Aug - 12 Nov 2026, Open-Meteo's
archived forecasts against ERA5 reanalysis cloud cover; MAE and bias in percentage points):

| Site      | Median of 8 | Median of 6 | GEM / CMA bias |
| --------- | ----------- | ----------- | -------------- |
| Bangalore | 13.0, −0.5  | 12.0, +5.3  | −28 / −44      |
| Coorg     | 11.9, −4.6  | 9.9, +1.8   | −28 / −55      |
| Hanle     | 20.8, −17.4 | 19.5, −13.1 | −19 / −24      |

The mean of the models was worse than the median at Bangalore and Coorg (19.1 and 18.1). Caveat:
ERA5 is an ECMWF product, so ECMWF itself is favoured somewhat; the GEM/CMA dry bias is far larger
than that effect. All models read Hanle clearer than ERA5 (unresolved).

## Model agreement

Total cloud cover from Open-Meteo's best match plus ECMWF IFS 0.25°, GFS and ICON for the same hour;
spread (max − min) ≤ 20 points = high, ≤ 45 = medium, otherwise low.

## Realism layer in the 3D sky

All values below are recomputed for the time shown and passed to the patched engine
(`engine/patches/0002`). The Physics panel on the page shows the live numbers.

| Effect              | Input                                                                                                                      | Method                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refraction          | forecast station pressure and temperature                                                                                  | engine's Saemundsson formula (patched, see above) with live P/T                                                                                                                                                                                                                                                                                                      |
| Star/planet dimming | k from Rayleigh + CAMS AOD + ozone                                                                                         | Δm = k · X(alt), Kasten–Young airmass, per star, every frame                                                                                                                                                                                                                                                                                                         |
| Reddening           | same inputs                                                                                                                | E(B−V) per airmass = k_B − k_V: Rayleigh at 0.44 µm (Hansen & Travis), aerosol with Ångström α = 1.3, ozone Chappuis ≈ 10 % in B                                                                                                                                                                                                                                     |
| Sky brightness      | Sun, Moon, k                                                                                                               | zenith: natural 22.0 + Schaefer (1993) twilight + Krisciunas & Schaefer moonlight; the engine's own Schaefer model draws the whole dome with the same k                                                                                                                                                                                                              |
| Faintest star       | zenith sky brightness                                                                                                      | Hecht threshold as in Schaefer (1990); matches the Birriel et al. (2014) form to 0.02 mag in dark skies and Crumey (2014) to 0.4 mag in bright skies. Stars dimmer than this (after extinction and telescope gain) are hidden                                                                                                                                        |
| Milky Way           | sky luminance                                                                                                              | the engine fades it by contrast with the average sky brightness                                                                                                                                                                                                                                                                                                      |
| Clouds              | low/mid/high cover at the site and at 16 points 35/100 km away (one multi-location Open-Meteo call); 850/500/250 hPa winds | layers at 1.5 / 4.5 / 9 km; each line of sight meets its layer at the right distance and bearing; noise only decides _where_ inside that area the cloud is, thresholded so the covered fraction equals the forecast (tested over the dome); layers drift with the forecast wind; colours follow Sun/Moon light (and city glow once the light-pollution layer exists) |
| Horizon             | Copernicus DEM GLO-30, overview 3 (≈ 240 m) within 90 km                                                                   | ray-march per 0.5° of azimuth; curvature with terrestrial refraction κ = 0.13; first 300 m skipped (surface model = trees/roofs); eye at the known site elevation + 1.7 m. Checked: Pic du Midi summit sees −2.1° to the north (dip over the plains) and +0.7° toward the higher Pyrenean peaks                                                                      |

Limits: the visual limit uses the zenith sky brightness (the Moon-side of the sky is brighter than
that); cloud _shapes_ are illustrative even though their amount, height, direction and drift come
from the forecast; until the light-pollution map exists the sky assumes a natural dark site; on
high mountain sites, Open-Meteo's low cloud (up to 3 km altitude) may actually lie below the
observer, but it is always drawn above (a cloud-base model is a possible later improvement).

_Later phases add: the seeing estimate, satellite cloud placement and the light-pollution model._

## Natural sky and the solar cycle — Krisciunas et al. (2007)

`src/lib/physics/airglow.ts`. The natural zenith sky is not a constant 22.0: airglow (mostly the
[O I] 557.7 nm line, inside V) follows solar activity. Krisciunas et al. (2007, PASP 119, 687) found
the yearly V-band sky at Cerro Tololo best correlated with the 10.7 cm solar flux ~5 days earlier.
We fitted their Table 5 yearly zenith V (1992–2006, in linear flux) against the yearly mean
observed F10.7 for the same years (daily values from GFZ Potsdam):

B / B(22.0) = 0.8069 + 0.003188 · F10.7 (r = 0.77, 14 years)

That is 21.97 at solar minimum (F10.7 ≈ 70) and 21.63 at a strong maximum (≈ 190): a 0.34 mag swing,
in line with the 0.3–0.5 mag usually quoted for V. The curve is anchored at 22.0 for F10.7 = 70, the
sky the light-pollution model below was calibrated against. The site reads NOAA SWPC's daily F10.7
(twice a day, ~22 kB) and averages the 27 days ending 5 days before the newest reading; without it,
the long-run mean (110 sfu, 21.87) is used.

- **Light pollution itself** (map colours, Bortle class, "mag brighter than a natural sky") stays
  referenced to the 22.0 solar-minimum sky, so it describes artificial light only.
- **The sky right now** (site SQM, map readouts, faintest star, imaging score, the engine's limit)
  is artificial light + today's natural sky: SQM = 22.0 − 2.5 log10(f + R), f = natural / 22.0-sky.
- Night-to-night airglow varies by a few tenths of a magnitude more than this (gravity waves,
  season, storms); only the slow solar part is predictable. Ecliptic latitude (zodiacal light) is
  not modelled.

## Light pollution (yearly) — Garstang / Cinzano–Falchi style kernel

`pipelines/lightpollution/model.py`, calibrated in `skyglow.py`. Zenith artificial brightness relative
to the natural sky: R = A · Σ L·area·(d² + d0²)^(−p/2)·e^(−d/D) for d ≤ 150 km, with L the
VNP46A4 snow-free upward radiance (nW cm⁻² sr⁻¹); SQM = 22.0 − 2.5 log10(1 + R). The convolution
runs by FFT in 2.5° latitude strips with the kernel for that latitude. Fit to 5,345 Globe at Night
clear-sky SQM readings: p = 2.0, d0 = 0.5 km, D = 300 km, median error 0.35 mag (see README).
Bortle class from SQM with the commonly quoted boundaries (approximate: Bortle is a visual scale).

Light domes (src/lib/lp/lightpollution.ts): night lights within 150 km summed per 10° of azimuth with
the kernel one power of distance flatter; horizon brightness = 2.5 × zenith R × (sector / mean). In
the sky they are drawn by contrast with the local sky (src/lib/sky/horizon.ts, glowAlpha). Approximate,
for the picture.

### Haze and light pollution, hour by hour

`src/lib/physics/hazeglow.ts`. The yearly map describes a typical night. On a hazy or smoggy night
aerosol scatters more of a town's upward light back down near the town (brighter city sky) and
absorbs and scatters away more of it on the way to distant places (fainter far domes); Kocifaj &
Barentine (2021) report changes of tens of per cent within a few kilometres of a source. We compute
the change with a single-scattering model in Garstang's (1986) geometry: zenith line of sight, light
from a source at distance D reaching height h along a slant path, scattered down by molecules
(Rayleigh) and aerosol (Henyey–Greenstein g = 0.7, single-scattering albedo 0.9), attenuated on both
legs; exponential atmospheres (molecules τ 0.0973, 8 km; aerosol τ = CAMS AOD at 550 nm, 1.5 km);
Garstang's city emission function with G = F = 0.15. Only the ratio to a reference night (AOD 0.15)
is applied, so the empirical calibration of the yearly map is kept:

| AOD 0.5 vs 0.15 | 0.5 km | 2 km | 5 km | 10 km | 20 km | 50 km |
| --------------- | ------ | ---- | ---- | ----- | ----- | ----- |
| zenith glow     | ×1.78  | 1.24 | 0.72 | 0.38  | 0.20  | 0.13  |

The loader stores how much of the site's zenith light (and each dome's) comes from 16 distance bins
(0.5–150 km); each hour's factor is the share-weighted mean, applied to the artificial part before
today's natural sky is added. Bortle class and "mag brighter than a natural sky" stay yearly. Limits:
single scattering (multiple scattering adds a few per cent below AOD 0.3, Aubé 2015, more in heavy
haze), flat Earth, one aerosol type and layer height, the dome correction reuses the zenith factor,
and clouds (which amplify city glow much more) are not modelled.

The imaging score does not include light pollution as a penalty: it rates each hour for the site
(the Moon factor uses the site's own dark-sky brightness). The Sky quality card shows the site's
light pollution itself.

## Best targets (updated 2026-11-19)

`src/lib/plan/rank.ts`, tests in `tests/rank.test.ts`. The score is unchanged in form:
100 × time × Moon × contrast × framing × brightness (factor definitions as in
`src/lib/targets.ts`). What changed:

- Catalog: the Stellarium DSO catalog (≈ 25,000 core objects) instead of OpenNGC alone.
- Usable time counts 15-minute samples in darkness that are above the minimum altitude
  (default 30°) **and** above the horizon profile (terrain from the Copernicus DEM, or a custom
  horizon) at the object's azimuth.
- Surface brightness = m + 2.5 log10(π/4 · a · b), a and b in arcsec (mean over the ellipse).
- Catalog magnitudes that do not describe the object are set to unknown at build time: opacity
  classes of Lynds/Barnard dark nebulae, illuminating-star magnitudes of van den Bergh / vdBH /
  Cederblad reflection nebulae, and 0.0 placeholders.
- The bright-core contrast boost applies to emission nebulae only (not reflection nebulae).
- "Any type" list: an object within max(0.25°, half the larger size) of one already listed is
  skipped unless it is ≥ 1.5× larger, of the same type and scores ≥ 60 % as much (then it
  replaces the smaller one); no type takes more than a quarter of the list.

## Tonight verdict

"Tonight" rolls over to the coming night at sunrise (before 20 Nov 2026 it did so at noon,
so mornings described the night that had just ended).

`src/lib/plan/verdict.ts`, tests in `tests/verdict.test.ts`. Go = ≥ 3 dark hours with an hourly
imaging score ≥ 40/100; marginal = 1–3 such hours or a best hour of 25–40; no-go otherwise;
"no darkness" when the Sun stays above −12°.

## Telescope HUD (added 2026-11-20)

- **J2000 ↔ of date:** Astronomy Engine `Rotation_EQJ_EQD` (IAU 2006 precession + IAU 2000B
  nutation), applied to the mount's reported epoch. Round trip < 0.01″ (tests/telescope.test.ts).
- **Hour angle** = local apparent sidereal time (the mount's own when it reports one) − RA of
  date. **To the meridian** = −HA (or 24 h − HA) in sidereal hours × 0.99727.
- **Below your horizon in:** the position of date is stepped forward in 2-minute steps (up to
  12 h) and compared with your planning horizon (custom horizon, else terrain, else flat); no
  refraction.
- **Pier side** is what the mount reports; the simulator uses the usual GEM rule (looking east →
  telescope on the west side).
- **Mosaic panes** are laid out on the tangent plane around the frame centre, spaced by the frame
  size × (1 − overlap) and turned with the frame, then projected back (gnomonic).

## Trip planner (added 2026-11-20)

`src/lib/plan/year.ts` (Web Worker), `src/lib/data/climate.ts`; tests `tests/year-planner.test.ts`.

- **Darkness:** Sun −18° crossings found with Astronomy Engine's SearchAltitude, starting from local
  solar noon of each date. Checked: about 10.0 h at the December solstice and 8.6 h in June at 13°N.
- **Moon:** topocentric apparent RA/Dec every hour, interpolated; altitude every 15 minutes;
  "moonless" = centre below the horizon (refraction ignored, about ±2 min).
- **Target:** J2000 → of date once per year, altitude every 15 minutes; hours above the chosen
  altitude in darkness and in moonless darkness. Milky Way core taken at RA 266.42°, Dec −29.0°.
- **Clear nights per month:** ERA5 hourly cloud cover 2016–2025 at the site (rounded to 0.1°),
  a night counts as clear when its 9 pm–3 am (solar time) mean is ≤ 30 %. History, not a forecast.
- **Best nights:** usable hours × that month's clear-night share, top ten of the (remaining) year.
- **Events:** new/full Moons, lunar eclipses (visible when the Moon is up at mid-eclipse), local
  solar eclipses (with the solar-filter warning), oppositions of Mars to Neptune, and the IMO's usual
  meteor-shower peak dates (they move by about a day between years).
