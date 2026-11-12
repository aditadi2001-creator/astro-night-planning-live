# Sky catalog pipeline

Builds everything in `public/skydata/` (served by Cloudflare Pages) from openly licensed sources.
Nothing is loaded from Stellarium's servers.

| Output                 | Script                | Source (license)                                                                                                                           | Size            |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `stars/`               | `build_stars.py`      | Hipparcos, ESA 1997 (ESA open data) via VizieR; Gaia DR3, ESA/Gaia/DPAC, via GAVO TAP; Yale BSC5 (public domain) for Bayer/Flamsteed names | see below       |
| `dso/`                 | `build_dso.py`        | OpenNGC, Mattia Verga (CC BY-SA 4.0)                                                                                                       | ~1 MB, 53 tiles |
| `skycultures/western/` | `build_skyculture.py` | Stellarium "Western" sky culture (CC BY-SA) + IAU Catalog of Star Names (IAU WGSN)                                                         | 90 KB           |
| `surveys/milkyway/`    | `build_milkyway.py`   | Gaia EDR3 all-sky colour map, ESA/Gaia/DPAC, CC BY-SA 3.0 IGO, ack. A. Moitinho                                                            | ~2 MB, 60 tiles |
| `surveys/sso/moon/`    | `build_skyculture.py` | Moon texture by Oleg Pluton, CC BY 4.0 (from NASA public-domain data)                                                                      | 1 MB            |

Raw downloads go to `raw/` (git-ignored) and are **never** uploaded to R2.

## Run

```bash
python -m venv pipelines/.venv
pipelines/.venv/bin/pip install numpy astropy astropy-healpix pillow reproject requests
cd pipelines/catalogs
../.venv/bin/python fetch.py            # ~70 MB of downloads; Gaia is an async TAP job (can take an hour)
../.venv/bin/python build_stars.py      # Hipparcos + Gaia DR3 to V = 10
../.venv/bin/python build_dso.py
../.venv/bin/python build_skyculture.py
../.venv/bin/python build_milkyway.py
```

In CI: **Actions → Build sky catalogs → Run workflow** produces the same files as an artifact.

## Star method

- **Hipparcos** gives every star to V = 10 that it contains (Gaia saturates on the brightest), with
  Johnson V, B−V and HD numbers. Positions are ICRS at J1991.25 plus proper motion; the engine
  propagates them to the date shown.
- **Gaia DR3** adds all other stars to V = 10. V is computed with the published DR3 relation
  (Riello et al. 2021, A&A 649, A3, table C.2); B−V comes from a cubic in BP−RP fitted on the
  Hipparcos cross-match (fit coefficients and scatter are printed by the script).
- **De-duplication:** Gaia sources within 3″ of a Hipparcos star (at J2016.0), or within 20″ of a
  star brighter than V = 3, are dropped.
- **Tiling:** brightest first, each star goes into the shallowest HEALPix tile on its line of sight
  that has room (1024 stars). Each tile records which children exist, so the browser never requests
  missing tiles.
- **Deeper stars (V 10 → ~13.5)** come later from a Gaia-only layer in R2, which the engine
  automatically starts at `max_vmag` = 10 of this layer.

The engine's constellation lines look up stars by HIP number in order-0/1 tiles. Because all
constellation stars are brighter than V ≈ 6.5, they always land there.
