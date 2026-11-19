# Accuracy

Measured by `tests/accuracy.test.ts` (runs with `npm test`) against reference values fetched once
at development time and committed as fixtures. Nothing from the reference tools ships in the app.

| Quantity                                                                               | Reference                                       | Target        | Measured (worst case) |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------- | --------------------- |
| Sun, Moon, Mercury–Neptune: topocentric apparent RA/Dec of date (27 cases)             | NASA/JPL Horizons                               | ≤ 1′          | **15.6″**             |
| Same bodies: airless altitude/azimuth                                                  | JPL Horizons                                    | ≤ 1′          | **15.0″**             |
| Sunset, sunrise (upper limb on the refracted horizon)                                  | Horizons elevation, 1-min samples, interpolated | ≤ 1 min       | **12.8 s**            |
| Civil / nautical / astronomical dusk and dawn (Sun centre at −6° / −12° / −18°)        | Horizons                                        | ≤ 1 min       | **0.1 s**             |
| Moonrise, moonset                                                                      | Horizons                                        | ≤ 1 min       | **12.3 s**            |
| Solar transit                                                                          | Horizons (parabola through the highest samples) | ≤ 1 min       | **5.0 s**             |
| Deep-sky alt/az with refraction (M 31, M 33, M 42, M 45, M 1, NGC 253, NGC 7000, M 15) | Astropy 8.0.3, 1010 hPa, 10 °C                  | ≤ 0.1° (360″) | **7.7″**              |

Site: the Bangalore preset (12.97° N, 77.59° E, 920 m). Epochs: 2026-11-19 16:00 UT,
2026-11-20 00:00 UT, 2026-12-01 18:00 UT; events of the night of 19/20 November 2026.

## How the numbers are produced

- `node scripts/accuracy/fetch-horizons.mjs` → `tests/fixtures/horizons-bangalore-2026-11.json`
  (Horizons API, QUANTITIES 2 and 4 for positions; 1-minute airless elevation + angular diameter
  series for the Sun and Moon). Horizons' own rise/set listing is limited to ±2 minutes at its
  smallest step, so the tests interpolate the 1-minute series instead, using the app's
  convention: the upper limb on the refracted horizon (centre at −(34′ + angular radius)).
- `python scripts/accuracy/astropy_dso.py` → `tests/fixtures/astropy-dso-bangalore.json`
  (IERS download disabled; the resulting UT1 uncertainty is < 1 s ≈ 15″ of azimuth).
- The tests call the same functions as the app: `Astronomy.Equator`/`Horizon` (cards),
  `twilight()` and `moonEvents()` (`src/lib/conditions.ts`), `altAz()` (`src/lib/astro/target.ts`).

## Known limits

- The 3D sky (Stellarium Web Engine) is ~20″ off JPL for Jupiter and ~17″ for Saturn (measured
  in the original build, `docs/methods.md`): smaller than Jupiter's disc, irrelevant for framing.
- Rise/set times assume a sea-level horizon and standard refraction (34′). Real refraction at the
  horizon varies by several arcminutes with temperature and pressure, which moves rise/set by up
  to ~1 minute; a custom horizon (buildings, hills) changes it far more and is handled separately.
- Positions of deep-sky objects ignore proper motion (irrelevant at 0.1°).
