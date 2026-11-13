# Astro Night Planning — live sky

A free, open-source website for astrophotographers. It shows a realistic 3D view of the sky from
your exact location right now, together with live observing conditions: clouds, seeing,
transparency, haze, light pollution, the Moon and darkness times.

- **$0 to build, host and use.** No ads, no paid APIs, no paid features. Non-commercial.
- **Real data, published physics.** Every visual effect comes from measured or forecast data and a
  cited formula. See [docs/methods.md](docs/methods.md).
- **Honest about limits.** Seeing and transparency are forecasts, light pollution is yearly, and
  satellite night lights underestimate LED light.
- **License: [AGPL-3.0](LICENSE)**, required by Stellarium Web Engine.

> Status: **Phase 4 of 11 done** (3D sky with realism layer, live weather and air quality,
> condition cards, tonight timeline). See [Roadmap](#roadmap).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run ci         # type check, lint, format check, tests, build
```

Requirements: Node 20+. Building the sky engine additionally needs Emscripten; see
[engine/README.md](engine/README.md).

## Architecture

```
Browser (Svelte + TypeScript, PWA)
 ├─ Stellarium Web Engine (WebAssembly)   3D sky, stars, planets, constellations
 ├─ astronomy-engine                      Sun/Moon/planets, twilight, rise/set
 ├─ physics/*                             refraction, airmass, extinction, sky brightness …
 ├─ Open-Meteo (direct, no key)           weather, clouds, upper winds, air quality
 ├─ NASA GIBS (direct, no key)            10-minute infrared satellite tiles
 └─ Cloudflare Worker  ──►  R2 bucket      light pollution PMTiles, star catalogs,
                         └►  7Timer proxy   hourly GMGSI cloud PMTiles
GitHub Actions (public repo, free)
 ├─ CI on every push
 ├─ engine build (emsdk on Linux)
 ├─ hourly GMGSI → PMTiles → R2         (later phase)
 └─ yearly light-pollution pipeline     (pipelines/lightpollution, GitHub Actions → R2)
Cloudflare Pages (free)                  static site, deployed with
                                         wrangler pages deploy --project-name astro-night-planning-live
```

| Folder             | Contents                                             |
| ------------------ | ---------------------------------------------------- |
| `src/lib/physics/` | Pure physics formulas, each with unit tests          |
| `src/lib/astro/`   | Positions and Moon data (astronomy-engine wrappers)  |
| `src/components/`  | UI components                                        |
| `src/pages/`       | Credits and About pages                              |
| `engine/`          | Stellarium Web Engine build script and version pins  |
| `tests/`           | Vitest unit tests against published reference values |
| `docs/`            | Method write-ups                                     |

## Data sources

The full list with exact attributions is in [`src/lib/credits.ts`](src/lib/credits.ts) and on the
site's Credits page. Only openly licensed sources that need no permission request are used.

## Methods

See [docs/methods.md](docs/methods.md). Implemented so far: Kasten–Young airmass, Bennett and
Saemundsson refraction with live temperature and pressure correction, a patched engine refraction,
position cross-checks against Astronomy Engine and JPL Horizons, darkness times, V-band extinction
(Rayleigh + CAMS aerosol + ozone), Krisciunas & Schaefer moonlight, dew risk, the imaging score
with model agreement, and the realism layer in the 3D sky: per-star extinction and reddening, live
refraction, Schaefer/Crumey limiting magnitude, forecast-placed cloud layers and the Copernicus
terrain horizon.

## Open-Meteo usage (live weather)

Each visitor's browser calls Open-Meteo directly (no key; free terms: non-commercial, < 600/min,
5,000/hour, 10,000/day **per IP**). Per location we make 3 merged requests, cached for 30 minutes in
memory and localStorage and shared by everyone within ~1 km (coordinates rounded to 0.01°), plus
one hourly multi-location request for the cloud field around the site:

| Request                         | Variables                              | Open-Meteo call-equivalents* |
| ------------------------------- | -------------------------------------- | ---------------------------- |
| Forecast, best match            | 12 surface + 18 pressure-level, 4 days | 3                            |
| Cloud cover, ECMWF + GFS + ICON | 1 × 3 models                           | 1                            |
| Air quality (CAMS)              | 6                                      | 1                            |
| Cloud field, 16 points (hourly) | 3 per point                            | 16 (one per location)        |

\*Open-Meteo counts large requests as several calls (roughly one per 10 variables).

A tab left open all day: 48 refreshes × 5 + 24 × 16 ≈ 620 call-equivalents per day, about 6 % of
one visitor's daily allowance. Refreshing pauses while the tab is hidden, and failed requests retry
after 1 s, 2 s and 4 s, then back off from 30 s up to 30 min. Location search adds one geocoding
call per search (cached for a week).

## Terrain horizon (Copernicus DEM via the Worker)

The Copernicus GLO-30 bucket on AWS Open Data has no CORS headers, so browsers read it through our
data Worker (`VITE_DATA_BASE` + `/dem`); during development without a Worker the Vite dev server
proxies `/dem` (it turns the app's `?r=a-b` slices into `Range` headers for Amazon). Without either, the site shows a flat horizon.

Per **new** location the browser reads one header and one overview block from each 1°×1° tile
within 90 km: typically 4–6 tiles = **8–12 requests, 2.5–4 MB**, once. The finished profile is
cached on the device, so revisits cost nothing. Terrain loads only after the page is idle and is
skipped under Data Saver / 2G / 3G unless the visitor asks for it.

Worker budget: 100 visitors a day trying 2 new locations each ≈ 2,400 Worker requests/day for
terrain, 2–3 % of the account-wide 100,000/day free limit (see the Worker section below).

## Data Worker and R2 (free tier only)

One Worker, `astro-night-planning-live-data` (code in [`worker/`](worker/)), on the **free Workers
plan**, bound to one R2 bucket, `astro-night-planning-live-data`. The browser never reads R2
directly and never lists the bucket.

Live at `https://astro-night-planning-live-data.aditadi2001.workers.dev`. Production builds pick
that URL up from the committed [`.env.production`](.env.production) (`VITE_DATA_BASE`, public, no
secrets); `npm run dev` leaves it unset and uses the Vite DEM proxy instead. Deploy only with
`npx wrangler deploy --config worker/wrangler.jsonc`. The free plan caps CPU at 10 ms per request
on its own; custom CPU limits are a paid setting, so the config sets none.

| Route                               | What it serves                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `/tiles/<dataset>/<z>/<x>/<y>.webp` | one tile out of a PMTiles archive in R2 (light pollution, hourly clouds)                   |
| `/hips/gaia/...`                    | the deep star layer (Gaia DR3, V 10–14) for the sky engine                                 |
| `/data/<name>.json`                 | small JSON files (e.g. the list of available cloud hours)                                  |
| `/dem/<tile>.tif?r=<a>-<b>`         | one byte slice (≤ 4 MiB) of a Copernicus DEM tile (no CORS on that bucket), cached 30 days |
| `/7timer/<lat>/<lon>`               | 7Timer! ASTRO forecast (no CORS there), cached 3 h                                         |

Everything else is 404, so the Worker can't be used as an open proxy. Large datasets are **one
PMTiles file each**. The Worker reads single tiles out of them with range requests and serves each
tile at its own URL, so [Workers Caching](https://developers.cloudflare.com/workers/cache/) can keep
it: a cache hit doesn't run the Worker or read R2.

Why the DEM byte range is in the URL (`?r=`) and not a `Range` header: Workers Caching strips
`Range` headers, asks the Worker for the whole object and slices it from cache. For a 30–40 MB
elevation file that would mean pulling the whole file. With the range in the URL, each slice is its
own small cacheable response, so a second visitor near the same place costs no Amazon request.
(Splitting the Worker into an uncached front and a cached back would also work, but with caching on
each internal call is billed as a separate request, which would double usage.)

### Expected monthly usage (with calculation)

**R2 free tier: 10 GB-month storage, 1 M Class A, 10 M Class B. Our rule: stay under half.**

| Storage                             | Size                                         | Notes                                                         |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Deep star layer (Gaia DR3, V ≤ 14)  | 0.198 GB (uploaded)                          | 12.4 M stars with 10 < V ≤ 14, 25,987 tiles, 15.9 bytes/star  |
| Light pollution PMTiles (2025)      | 0.249 GB (uploaded)                          | sky brightness z0–8 220 MB + night-lights radiance z0–6 29 MB |
| Hourly satellite clouds (GMGSI)     | ≈ 0.1 GB                                     | 24 h kept × ~4.3 MB per hour (zoom 0–5 WebP)                  |
| Small JSON (incl. satellite orbits) | < 0.01 GB                                    | `data/orbits.json` ≈ 50 kB, replaced every 6 h                |
| **Total**                           | **≈ 0.55 GB** (target 5 GB, hard limit 8 GB) | during the yearly switch-over, +0.25 GB for under an hour     |

| Class A (writes, lists)                                       | Per month                            |
| ------------------------------------------------------------- | ------------------------------------ |
| Hourly clouds: 1 LIST + 1 PUT (archive) + 1 PUT (latest.json) | 24 × 30 × 3 = **2,160**              |
| Satellite orbits: 1 LIST + 1 PUT every 6 h                    | 4 × 30 × 2 = **240**                 |
| Yearly light-pollution, deep stars, occasional re-uploads     | < 20                                 |
| Deletes                                                       | free                                 |
| **Total**                                                     | **≈ 2,400 = 0.24 % of the free 1 M** |

| Class B (reads)                                                                                                                                                                           | Per month                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Hard ceiling: the free Workers plan stops at 100,000 requests/day (Error 1027, no charge). Even if every request missed the cache and needed ~1.05 R2 reads (tile + occasional directory) | 100,000 × 30 × 1.05 ≈ **3.2 M = 32 % of the free 10 M** |
| Realistic (50 % Workers Caching hit rate, 5,000 visits/day × 4 Worker requests)                                                                                                           | 5,000 × 4 × 30 × 0.5 ≈ **0.3 M**                        |

So the free Workers request cap also caps R2 reads below half the R2 free tier.

### Worker requests per visit (account-wide free limit: 100,000/day, shared with your main site)

| Action                                        | Worker requests                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Open the site (sky + cards)                   | 0–2 (deep star tiles only when zoomed in; 7Timer once per 3 h, Phase 7)     |
| Zoom the sky to a telescope field             | 5–30 star tiles, cached afterwards                                          |
| New location: terrain horizon                 | 8–12, once (then cached on the device)                                      |
| Site's own satellite cloud sample             | 1–2 GMGSI tiles + 1 small JSON per hour                                     |
| Open the satellite cloud map (off by default) | ≈ 10–20 GMGSI tiles; ×6 if you press play (GIBS tiles don't use the Worker) |
| Light-pollution value at the site (Phase 8)   | 1–2                                                                         |

A typical visit costs ~2–5 requests; a heavy one ~60. **10,000 typical visits/day ≈ 20,000–50,000
requests**, so traffic would have to grow to tens of thousands of visits a day before the shared
limit is close. I will tell you if usage approaches it. Above the limit Cloudflare answers with
error 1027 for the rest of the UTC day (the site still loads from Pages; the Worker-backed extras
show their "unavailable" state) — it never charges.

### Storage guard in every R2 write job

[`pipelines/r2/r2.py`](pipelines/r2/r2.py) is the only code that writes to R2. Before every upload
it totals the bucket. If the upload would take it above **8 GB** it first deletes the oldest hourly
cloud files (deletes are free); if that is not enough the job **fails and uploads nothing**. It
refuses any bucket whose name does not start with `astro-night-planning-live`. Unit-tested in
`pipelines/r2/test_r2.py`. Raw downloads (Gaia, NASA `.h5`, GMGSI) never go to R2: jobs process
them on the GitHub runner and upload only the finished PMTiles.

A bucket **lifecycle rule** deletes `clouds/hourly/` objects after 2 days as a safety net.

### Checking R2 and Worker usage

1. **R2 enabled?** Dashboard → **Storage & Databases → R2 Object Storage**. If it offers to
   "Purchase R2" / add a subscription, it is not enabled; enabling is a $0 subscription.
2. **R2 usage:** R2 → **Overview** shows storage and Class A / Class B operations this month.
   `python pipelines/r2/r2.py usage` (with the secrets in your environment) lists the bucket.
3. **Worker usage:** **Workers & Pages → astro-night-planning-live-data → Metrics** (requests per
   day). The 100,000/day limit is account-wide, so also glance at **Workers & Pages → Overview**.
4. **Anything billable?** **Manage Account → Billing → Billable Usage** — should read $0.00.
5. **Get an email before any charge:** on that page select **Set Budget Alert**, enter **$0.01**,
   **Create**. (Cloudflare creates a $10 alert by default on pay-as-you-go accounts; lower it to
   $0.01.) Also available under **Notifications → Add → Budget Alert**.

### Custom domain option (later)

If you add a custom domain on Cloudflare (e.g. `sky.example.com`), the same Worker can serve on it
(`routes` in `worker/wrangler.jsonc`), or R2 can be connected to it directly as a public bucket
domain with Cloudflare's CDN in front. Neither costs money. The `r2.dev` URL stays off: it is
rate-limited and meant for testing.

## Satellite clouds

Two kinds of observed cloud, both thermal infrared (works day and night):

- **NASA GIBS** WMTS (no key), Web Mercator endpoint: `GOES-East_ABI_Band13_Clean_Infrared`,
  `GOES-West_ABI_Band13_Clean_Infrared`, `Himawari_AHI_Band13_Clean_Infrared`, every 10 minutes,
  zoom 0–6. These layers don't accept "current": the app asks for an explicit 10-minute time and
  steps back with `HEAD` requests until one exists (a time not yet published returns 404).
  Browsers load these tiles straight from NASA; they don't touch our Worker.
- **NOAA GMGSI** (public S3 bucket `noaa-gmgsi-pds`, no account): an hourly global mosaic that also
  covers Europe, Africa and India (Meteosat). The **Hourly satellite clouds** workflow
  ([`clouds-hourly.yml`](.github/workflows/clouds-hourly.yml), minute 47 of every hour) turns each
  new hour into one PMTiles file of WebP tiles (zoom 0–5, ~4.3 MB) with
  [`pipelines/clouds/gmgsi.py`](pipelines/clouds/gmgsi.py) and publishes it with
  `r2.py publish-hourly`: one listing, the 8 GB guard, the upload, deletion of hours older than 24 h,
  and `data/clouds-latest.json` listing the hours that exist. The raw NetCDF never leaves the runner.
  - The file's grid is already Mercator (0.072° columns, rows uniform in Mercator y to ±72.7°), so
    tiling is a resample. Grey levels follow `T = (660 − grey) / 2` K; checked against model skin
    temperatures at clear sites (clear pixels read 2–9 K colder, the usual water-vapour effect).

**Clouds now.** At the site and at the 16 cloud-ring points the app reads GMGSI pixels (~30 km
boxes) and counts a pixel as cloud when it is more than 8 K colder than the surface air
temperature (fully at 20 K). That observed fraction is blended with the forecast: weight 0.6 for
an image up to 1.5 h from the time shown, falling to 0 at 6 h. In the sky view the same blend is
applied direction by direction, so observed cloud appears on the correct side of the sky; cloud
the model lacks entirely is drawn high (cirrus) when the tops are below 240 K, otherwise mid-level.
Infrared misses low fog and stratus, which is why the forecast always keeps some weight.

### Who starts the hourly job

GitHub's own `schedule:` never fired in this repository's first hours, so the data Worker also
starts the job: a **Cron Trigger** on the Worker (`47 * * * *` in `worker/wrangler.jsonc`, free plan:
1 of 5 per account) calls GitHub's `workflow_dispatch` API for `clouds-hourly.yml`. It uses the
Worker secret `GH_DISPATCH_TOKEN`, a **fine-grained GitHub token** limited to this one repository with
only _Actions: read and write_ (plus the mandatory read-only _Metadata_); it cannot read or change
code, settings or secrets. The GitHub schedule stays as a backup; if both fire, the second run sees
the hour is already published (the list is read past the cache) and stops without touching R2.

**Renewing the token (yearly — 2 minutes).** It expires on **12 Nov 2027**; GitHub emails a week
before. Without it the Worker simply doesn't start the job (logged), nothing breaks.

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens** →
   _astro-night-planning-live cron_ → **Regenerate token** → copy it.
2. In the repo folder: `npx wrangler secret put GH_DISPATCH_TOKEN --config worker/wrangler.jsonc`
   and paste it at the prompt (never into a chat or a file).

### Scheduled jobs and the 60-day pause

GitHub pauses scheduled workflows in public repos after 60 days without repository activity. The
[`keepalive.yml`](.github/workflows/keepalive.yml) workflow commits the date to
`status/keepalive.md` on the 1st of every month, which counts as activity. If a schedule was paused
anyway: repo → **Actions** → pick the workflow on the left → **Enable workflow**. To stop the hourly
cloud job: same place → **⋯ → Disable workflow** (old hours are then removed by the bucket's 2-day
lifecycle rule).

## Light pollution (yearly model)

[`pipelines/lightpollution`](pipelines/lightpollution) turns NASA Black Marble **VNP46A4** (yearly,
moonlight-corrected night lights, 15″ ≈ 500 m) into artificial sky brightness with a light-propagation
model in the style of Garstang / Cinzano–Falchi, simplified to a distance kernel:

    R(x) = A · Σ L·area·(d² + d0²)^(−p/2)·e^(−d/D),  d ≤ 150 km      SQM = 22.0 − 2.5 log10(1 + R)

`A`, `p`, `d0` and `D` are fitted to **5,345 clear-sky SQM meter readings from Globe at Night**
(2022–2025, CC BY 4.0) with a robust (Huber) fit over a grid of kernel shapes. Result for the 2025
map: **p = 2.0, d0 = 0.5 km, D = 300 km** (inside the searched grid: p 1.6–2.8, D 100–1000 km).

| Validation vs. Globe at Night SQM | n     | median error | RMS (outliers > 1.5 mag removed) | bias (measured − model) |
| --------------------------------- | ----- | ------------ | -------------------------------- | ----------------------- |
| all clear-sky readings            | 5,345 | **0.35 mag** | 0.51 mag                         | −0.06 mag               |
| bright skies (SQM < 19)           | 1,807 | 0.53 mag     | 0.59 mag                         | −0.32 mag               |
| suburban (SQM 19–21)              | 2,276 | 0.31 mag     | 0.50 mag                         | +0.10 mag               |
| dark skies (SQM > 21)             | 1,262 | 0.28 mag     | 0.42 mag                         | −0.13 mag               |

13 % of readings are more than 1.5 mag off; Globe at Night readings are citizen measurements, and
moonlight, thin cloud, twilight or a nearby lamp easily explain such outliers. In cities the model
is ~0.3 mag too dark: satellites under-count blue/white LED light. The site says this, and that the
map is yearly, not live. Checks run before every switch (verify.py, through the Worker): London
centre 16.8, Delhi 16.9, Manhattan 16.2 mag/arcsec²; central Sahara and mid-Pacific 22.0.

Light domes are computed in the browser from the coarse night-lights layer (`lprad`, ~2 km) within
150 km with the same kernel one power of distance flatter, per 10° of azimuth, and drawn above the real
horizon by their contrast with the local sky.

### Yearly light pollution update — 2 minutes

NASA publishes the previous year's VNP46A4 in spring; the **Yearly light pollution** workflow runs by
itself on 20 May. If it failed because the Earthdata token expired (they last ~60 days):

1. Sign in at <https://urs.earthdata.nasa.gov> → **Generate Token** → copy the token.
2. Repo → **Settings → Secrets and variables → Actions** → `EARTHDATA_TOKEN` → **Update** → paste.
3. Repo → **Actions → Yearly light pollution (Black Marble to R2) → Run workflow** (leave the fields
   empty).

It takes about an hour on GitHub. The site keeps the current map until the new one passes its checks;
the previous year is deleted only after the switch. One-time account setup (already done here): the
Earthdata account must list **LAADS Web** under _Applications → Authorized Apps_, which needs an
_Organization_ in the profile.

## Optional sky surveys (HiPS)

Off by default. Turn on **Layers → Sky surveys**, pick a survey and an opacity. The survey is drawn
by the sky engine itself (patch `0003`), under the stars and behind clouds, the terrain and the
daytime sky, so it sits in the real sky at your site.

| Survey                      | Shows                                          | Coverage           | Terms                           |
| --------------------------- | ---------------------------------------------- | ------------------ | ------------------------------- |
| DSS2 colour                 | Photographic optical sky (POSS-II, UK Schmidt) | all sky            | CC BY-NC-SA 4.0, non-commercial |
| H-alpha (Finkbeiner 2003)   | Emission nebulae, low resolution               | all sky (galactic) | public data, citation           |
| 2MASS colour                | Near-infrared J, H, Ks                         | all sky            | public data, acknowledgement    |
| AllWISE colour              | Mid-infrared W1, W2, W4                        | all sky            | public data (NASA)              |
| Pan-STARRS DR1 colour (irg) | Deep optical                                   | north of Dec −30°  | public data (MAST)              |
| Gaia DR3 density            | Star counts                                    | all sky            | ESA, credit required            |

- **Nothing is hosted here.** Tiles stream from CDS Strasbourg or the official mirrors CDS lists
  (ESA ESDC, NASA MAST, NASA IRSA, CSIRO CASDA, China-VO): no R2 storage, no Worker requests.
  `src/lib/sky/surveys.ts` tries each server's `properties` file in order (6 s timeout), checks it
  names the right survey and frame, and remembers the first that answers for the session. CDS's own
  servers have been offline since a security incident on 9 November 2026; the mirrors carry
  everything except the Gaia density map, which comes back when CDS does.
- **Cost on a phone:** nothing until a survey is switched on. A wide view needs about six
  low-resolution tiles (~50 KB each); zooming in loads sharper tiles only for the area on screen.
- Each survey's acknowledgement is on the Credits page and its short credit sits under the menu.
  DSS forbids for-profit use: this site is free, but a commercial fork must drop that survey.
- **Left out for now:** Axel Mellinger's colour Milky Way panorama (`P/Mellinger/color`). Its
  terms are "all rights reserved", so it waits for the owner's decision.

## Aurora, satellite passes, night mode and offline use

- **Aurora** (NOAA SWPC, public domain): everyone gets the planetary Kp index (observed + 3-day
  forecast, ~7 kB). Sites 40° or more from the equator also load the OVATION 30–90 minute forecast
  (~0.9 MB); it is reduced in the browser to the chance overhead and the best chance in view, with
  its direction and height above the horizon (lower edge of the aurora taken at 110 km, ignored
  below 5° and below 5 % chance), and only those numbers are cached.
- **ISS & satellite passes**: SGP4 (satellite.js) in a Web Worker, ISS and Tiangong for 3 days and
  CelesTrak's ~150 brightest satellites for 24 h. A pass counts as visible while the satellite is
  sunlit and the Sun is below −6° at the site; the card shows where it appears, its highest
  _visible_ point and whether it fades into Earth's shadow. Checked against Skyfield (rise, peak and
  set within ~1 s, altitude within 0.1°; `tests/space.test.ts`).
- **Orbits never come from browsers.** CelesTrak blocks clients that download the same data more
  than once every two hours (this happened to the dev machine while building this). The hourly
  GitHub job runs `pipelines/orbits/orbits.py` at most every 6 h and publishes `data/orbits.json`
  to R2 through the storage guard; the Worker serves it with caching. If CelesTrak is down, the
  last copy stays (elements stay usable for days).
- **Night mode**: deep red, no blue or green light (the sky and map canvases are filtered too),
  remembered on the device and applied before the first paint, with a black browser bar. Secondary
  text keeps 4.7:1 contrast.
- **Installable app (PWA)**: `public/manifest.webmanifest` + a service worker generated at build
  time (`scripts/pwa-plugin.mjs`, `src/pwa/sw-template.js`). The page, scripts, styles, sky engine
  and icons (~1.5 MB) are cached on install; star tiles and lazily loaded code as they are used.
  Each build has its own cache and old ones are deleted. Live data is not handled by the service
  worker: each source keeps its own last good copy with its age, so offline the site opens with the
  last forecast. `public/_headers` lets Cloudflare Pages cache hashed files for a year.

### Accessibility and speed checks

- axe-core 4.10 (run by hand in the dev build): no violations in day or night mode, with the survey
  panel open, or on the Credits and About pages. The sky can be driven by keyboard (arrows look
  around, +/− zoom, Esc clears the selection).
- First screen: 101 kB of app script (gzip) and 3 kB of CSS; the sky engine (1.2 MB WebAssembly,
  ~0.4 MB compressed by Pages) is preloaded in parallel. The satellite map (MapLibre), GeoTIFF
  decoders and sky surveys load only when used.

## Roadmap

1. ✅ Setup, CI, license, trial build of Stellarium Web Engine
2. ✅ 3D sky with self-hosted catalogs, time controls
3. ✅ Live conditions (Open-Meteo weather + air quality), condition cards, tonight timeline
4. ✅ Realism layer: extinction, sky brightness, limiting magnitude, clouds, Moon, terrain horizon
5. ✅ R2 bucket + Worker (range requests, caching, CORS, 7Timer proxy); deep Gaia star layer
6. ✅ Satellite clouds (GIBS map, GMGSI hourly PMTiles, satellite + model "clouds now")
7. ✅ Seeing model (Hufnagel–Valley from upper winds) + 7Timer second opinion
8. ✅ Light pollution pipeline (Black Marble → sky glow → PMTiles), SQM/Bortle, light domes
9. ✅ Optional HiPS sky surveys (DSS2, H-alpha, 2MASS, AllWISE, Pan-STARRS, Gaia density; mirror fallback)
10. ✅ PWA (offline shell), night-vision mode, ISS and satellite passes, aurora, accessibility, speed
11. Deploy to Cloudflare Pages — needs your OK

## Known limits

- Seeing and transparency are forecasts; nothing free measures live seeing.
- Light pollution is modelled from yearly satellite data and underestimates LED light.
- Satellite cloud images are ~35 minutes (GOES, Himawari via GIBS) to ~1.5 hours (GMGSI) old
  when they appear, and infrared cannot tell low fog or stratus from the ground.
- Sky surveys are archival photographs (taken 1980s–2010s), not tonight's sky.

## License

Copyright (C) 2026 the Astro Night Planning contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [LICENSE](LICENSE).
