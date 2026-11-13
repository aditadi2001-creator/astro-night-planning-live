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

B_dark is the natural sky (22.0 mag/arcsec²) until the light-pollution layer exists. Hours follow
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
| Ground layer      | not forecastable (local terrain, buildings, cooling ground)                             | fixed: the J of 0.7″ |

Check: the HV 5/7 reference (v = 21 m/s, A = 1.7·10⁻¹⁴) gives r₀ = 5.0 cm and 2.0″, as published
(unit-tested). Rating: ≤1.0″ excellent (5), ≤1.5″ good (4), ≤2.0″ average (3), ≤2.75″ poor (2),
else bad (1); shown as a ±20 % range. Night-time model: daytime convection is not included, and
tube currents or dome seeing never are.

Second opinion: 7Timer! ASTRO (GFS-based, every 3 h, 72 h ahead) through the data Worker, which
caches each 0.1° location for 3 h. Its classes 1–8 are shown in arcseconds as documented by 7Timer!:
<0.5, 0.5–0.75, 0.75–1, 1–1.25, 1.25–1.5, 1.5–2, 2–2.5, >2.5″; its transparency classes
(<0.3 … >1 mag/airmass) appear next to our aerosol-based value.

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
