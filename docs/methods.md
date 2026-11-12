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

_Later phases add: extinction, sky brightness (Krisciunas & Schaefer 1991), limiting magnitude
(Schaefer 1990 / Crumey 2014), the seeing estimate, the imaging score and the light-pollution
model._
