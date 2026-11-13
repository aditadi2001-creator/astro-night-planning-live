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
 └─ yearly light-pollution pipeline     (later phase)
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

| Storage                            | Size                                        | Notes                                                             |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Deep star layer (Gaia DR3, V ≤ 14) | 0.198 GB (uploaded)                         | 12.4 M stars with 10 < V ≤ 14, 25,987 tiles, 15.9 bytes/star      |
| Light pollution PMTiles (Phase 8)  | ≤ 2 GB                                      | resolution chosen to fit                                          |
| Hourly satellite clouds (GMGSI)    | ≈ 0.1 GB                                    | 24 h kept × ~4.3 MB per hour (zoom 0–5 WebP)                      |
| Small JSON etc.                    | < 0.01 GB                                   |                                                                   |
| **Total**                          | **≈ 2.3 GB** (target 5 GB, hard limit 8 GB) | during the yearly light-pollution switch-over, +2 GB for ≤ 1 week |

| Class A (writes, lists)                                       | Per month                            |
| ------------------------------------------------------------- | ------------------------------------ |
| Hourly clouds: 1 LIST + 1 PUT (archive) + 1 PUT (latest.json) | 24 × 30 × 3 = **2,160**              |
| Yearly light-pollution, deep stars, occasional re-uploads     | < 20                                 |
| Deletes                                                       | free                                 |
| **Total**                                                     | **≈ 2,200 = 0.22 % of the free 1 M** |

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

### Scheduled jobs and the 60-day pause

GitHub pauses scheduled workflows in public repos after 60 days without repository activity. The
[`keepalive.yml`](.github/workflows/keepalive.yml) workflow commits the date to
`status/keepalive.md` on the 1st of every month, which counts as activity. If a schedule was paused
anyway: repo → **Actions** → pick the workflow on the left → **Enable workflow**. To stop the hourly
cloud job: same place → **⋯ → Disable workflow** (old hours are then removed by the bucket's 2-day
lifecycle rule).

## Roadmap

1. ✅ Setup, CI, license, trial build of Stellarium Web Engine
2. ✅ 3D sky with self-hosted catalogs, time controls
3. ✅ Live conditions (Open-Meteo weather + air quality), condition cards, tonight timeline
4. ✅ Realism layer: extinction, sky brightness, limiting magnitude, clouds, Moon, terrain horizon
5. ✅ R2 bucket + Worker (range requests, caching, CORS, 7Timer proxy); deep Gaia star layer
6. ✅ Satellite clouds (GIBS map, GMGSI hourly PMTiles, satellite + model "clouds now")
7. Seeing model + 7Timer second opinion
8. Light pollution pipeline (Black Marble → sky glow → PMTiles)
9. Optional HiPS sky surveys
10. PWA, night-vision mode, ISS passes, aurora, polish, accessibility, speed
11. Deploy to Cloudflare Pages — needs your OK

## Known limits

- Seeing and transparency are forecasts; nothing free measures live seeing.
- Light pollution is modelled from yearly satellite data and underestimates LED light.
- Satellite cloud images are ~35 minutes (GOES, Himawari via GIBS) to ~1.5 hours (GMGSI) old
  when they appear, and infrared cannot tell low fog or stratus from the ground.

## License

Copyright (C) 2026 the Astro Night Planning contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [LICENSE](LICENSE).
