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

Sun, Moon and planets come from Astronomy Engine (topocentric, aberration-corrected); we apply our
own T/P-aware refraction instead of the library's fixed standard atmosphere.

_Later phases add: extinction, sky brightness (Krisciunas & Schaefer 1991), limiting magnitude
(Schaefer 1990 / Crumey 2014), the seeing estimate, the imaging score and the light-pollution
model._
