# Data budget

Free-tier limits and our self-imposed ceilings (CLAUDE.md, constraints 2–3). Every number below
is measured unless marked _estimate_ or _target_. `npm run check:budget` (Phase 1) enforces the
static-asset part and prints the Worker requests per page load.

## 1. Limits

| Resource                       | Free limit                | Our ceiling                                                           |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------- |
| R2 Standard storage            | 10 GB-month               | **≤ 3 GB**                                                            |
| R2 Class A (write, list)       | 1 M / month               | **≤ 100 k / month**                                                   |
| R2 Class B (read)              | 10 M / month              | **≤ 3 M / month (projected)**                                         |
| R2 Infrequent Access           | no free tier              | **never used**                                                        |
| Workers requests               | 100 k / day, account-wide | ≤ 30 k / day for this site (_target_), leaving room for the main site |
| Pages files per deployment     | 20,000                    | **≤ 15,000** (budget check fails above)                               |
| Pages file size                | 25 MiB                    | **≤ 20 MiB** per file                                                 |
| Pages builds                   | 500 / month               | manual/CI deploys only                                                |
| On-device cache (PWA, offline) | browser quota             | **≤ 150 MB** (LRU eviction)                                           |

## 2. Cloudflare inventory (Phase 0 audit, 2026-11-19, read-only)

| Item                                    | State                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker `astro-night-planning-live-data` | Routes: `/tiles/*` (PMTiles in R2), `/hips/{gaia,gaia16,dso,dso2}/*` (eph tiles in R2), `/data/<name>.json` (R2), `/dem/*` (Copernicus S3 pass-through, not R2), `/7timer/*` (proxy, not R2), `/health`. Workers Caching on. Cron `47 * * * *` dispatches the hourly cloud workflow. No `limits` block (free plan). |
| R2 buckets                              | One: `astro-night-planning-live-data`. Bucket total **≈ 1.838 GB** (reported by the hourly job, 2026-11-19 07:59 UTC).                                                                                                                                                                                              |
| KV namespaces                           | None.                                                                                                                                                                                                                                                                                                               |
| Durable Objects, D1, Queues             | None.                                                                                                                                                                                                                                                                                                               |
| Air-quality proxy                       | **Does not exist**: air quality is fetched from Open-Meteo directly (the brief assumed a Worker proxy).                                                                                                                                                                                                             |
| R2 writers                              | Only GitHub Actions through `pipelines/r2/r2.py` (guard currently 8 GB hard / 5 GB target → **to be lowered to 3 GB in Phase 1**). No browser code writes or lists.                                                                                                                                                 |

R2 contents (from the pipeline logs and project notes):

| Prefix                                                                                  | Size                                                                  | Status                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `stars/gaia-deep-v1.pmtiles`                                                            | 0.198 GB                                                              | **superseded** by v2 (route `/hips/gaia`, still referenced as a fallback in `stel.ts`) |
| `stars/gaia-deep-v2.pmtiles`                                                            | ≈ 0.8 GB _estimate_ (V 10–16; the bucket total minus the other items) | in use (`/hips/gaia16`)                                                                |
| `dso/deep-v1.pmtiles`                                                                   | < 0.085 GB                                                            | **superseded** by v2                                                                   |
| `dso/deep-v2.pmtiles`                                                                   | 0.085 GB (3.37 M objects)                                             | in use (`/hips/dso2`)                                                                  |
| `lightpollution/lp-2025`, `lprad-2025`                                                  | 0.249 GB                                                              | in use                                                                                 |
| `lightpollution/history/lp-2016…2025`                                                   | ≈ 0.25 GB _estimate_                                                  | in use (map year player)                                                               |
| `clouds/hourly/*`                                                                       | ≈ 0.1–0.2 GB (24–48 h × 4.4 MB, lifecycle 2 days)                     | rolling                                                                                |
| `data/*.json` (orbits, clouds-latest, lightpollution, lphistory, pgc-NNN search chunks) | < 0.02 GB                                                             | in use                                                                                 |

**Decision (D12): all layers stay.** The v1 files are kept as fallbacks; nothing is deleted.

## 3. Worker requests per page load (Phase 0 baseline; Phase 2 results below the table)

Production build (`vite preview`, real Worker), fresh browser profile, default location
(Greenwich), 2026-11-19. Counted with `performance.getEntriesByType('resource')`.

| Route                                                                   |                    Worker requests | What                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First load (`#/sky`, all tabs' data start at once)                      |                             **73** | 12 small JSON (3 files × **4 duplicate fetches**), 4 HiPS `properties` (2 × 2 duplicates), 9 DSO order-0 tiles, 18 GMGSI cloud tiles (5 hours × 2 at z4 + 4 at z5 **fetched twice**), 1 light-pollution + 4 night-lights tiles, 24 DEM slices (12 tiles × 2), 1 7Timer |
| `#/tonight`, `#/week`, `#/targets`, `#/equipment`, `#/space`, `#/about` |                             0 each | data already loaded                                                                                                                                                                                                                                                    |
| `#/maps`                                                                |                                 13 | `lphistory.json` + 12 light-pollution tiles (z7)                                                                                                                                                                                                                       |
| Whole first session through all tabs                                    |                             **86** | matches the owner's count of ~71                                                                                                                                                                                                                                       |
| Repeat visit (reload)                                                   | 22 entries, all `transferSize = 0` | served from the browser HTTP cache (immutable tiles, device cache for JSON/DEM). Cross-origin timing hides sizes without `Timing-Allow-Origin`, so this is an _estimate_ of ≈ 0–3 real requests; Phase 2 adds `Timing-Allow-Origin: *` to measure exactly.             |

**Avoidable today:** 19 duplicates (JSON ×9, properties ×2, cloud z5 ×8).

**After Phase 2 (measured, cold, Bangalore):** Plan **14**, Sky **24** (from 73). Done: shared
in-flight fetches, static light-pollution info, static preset horizons, no properties probes,
orbits only when the Space section is near. Still open: the 9 recorded/now-cast cloud tiles (needed
by the Tonight table) and the DSO layer's order-0 tiles (served from R2 by the engine).

### Reduction plan (Phase 1–2) and targets

| Change                                                                                                                                                       | Saves (first visit) |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------: |
| In-flight dedupe in `cache.ts` for every fetch (one request per URL per page)                                                                                |                  19 |
| `lightpollution.json` (yearly) and both HiPS `properties` files shipped as Pages static assets                                                               |                   5 |
| DSO deep layer order 0–1 tiles shipped statically (≤ 2 MB, versioned with the route)                                                                         |                   9 |
| Recorded cloud hours (4 past hours × 2 tiles) loaded only when the Tonight detail needs them                                                                 |                   8 |
| Precomputed horizon profiles for the three presets (Bangalore, Hanle, Coorg) as static JSON; other places still read the DEM once and cache it on the device |      24 for presets |
| `orbits.json` loaded only when the Space section scrolls into view                                                                                           |                   1 |
| **Target: cold first visit to `#/plan` ≤ 6, to `#/sky` ≤ 12, repeat visit ≤ 2**                                                                              |                     |

Projection with the targets: at 6–12 requests per new visitor and ≤ 2 per returning visit, the
site's own share stays under 30 k/day up to ~2,500 new visitors/day. Above the 100 k/day account
cap Cloudflare returns error 1027 (no charge); the app shows its "data service unavailable" state
and keeps working on Open-Meteo, NOAA and static data.

## 4. R2 projections

**Storage:** 1.84 GB now (all layers kept, D12). New assets in this redesign go to
Pages, not R2 (catalog shards, foregrounds, icons, fonts, survey thumbnails). Budget check fails a
pipeline upload that would pass 3 GB.

**Class A:** hourly cloud job = 1 LIST + 2 PUT per run; GitHub's own schedule and the Worker cron
both fire it (observed ~1.3–2 runs/hour) → ≤ 48 runs/day × 3 = 144/day; orbits 4 × 2/day; ≈ **4.6 k
/ month** (4.6 % of our 100 k ceiling).

**Class B:** only Worker cache misses on R2-backed routes read R2 (Workers Caching hits do not run
the Worker). Physical worst case = every Worker request a miss: 100 k/day × 30 × ≤ 1.0 read (PMTiles
directories cached per isolate) = **3.0 M / month**, i.e. 30 % of the free 10 M — compliance with
the free tier is guaranteed by the request cap itself. Projected realistic use: 1,000 visits/day ×
~10 R2-backed requests × 50 % miss = **0.15 M / month** (5 % of our ceiling).

## 5. Shipped static assets (Pages) — baseline

| Item                                                                   | Files |                                    Bytes |
| ---------------------------------------------------------------------- | ----: | ---------------------------------------: |
| `dist/` total (incl. 5.5 MB source maps)                               |   918 |                                  28.6 MB |
| `skydata/stars` (Hipparcos + Gaia to V 10)                             |   730 |                                  14.6 MB |
| `skydata/surveys` (Gaia Milky Way, Moon texture)                       |    75 |                                   2.9 MB |
| `skydata/dso` (OpenNGC eph tiles)                                      |    54 |                                  0.97 MB |
| `skydata/dsonames.json`, `nebulae.json`, `targets.json`, `skycultures` |     5 |                                  0.79 MB |
| Engine (`stellarium-web-engine.wasm` + `.js`)                          |     2 |                                  1.31 MB |
| Largest single file                                                    |     — |       `maplibre-gl` chunk 1.10 MB (lazy) |
| Initial JS (main chunk, gzipped)                                       |     — | **156 KB** (target ≤ 250 KB on `#/plan`) |

## 6. Catalog shards and other static data (Phase 2)

All on Cloudflare Pages (zero R2), versioned file names, built by
`python scripts/catalogs/build_catalogs.py` (inputs downloaded to `scripts/catalogs/raw/`,
git-ignored, never uploaded).

| File                             | Source                                                           | License                        |            Rows |     Bytes |      gzip | Loaded                                               |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------ | --------------: | --------: | --------: | ---------------------------------------------------- |
| `catalog/dso-core-v1.json`       | Stellarium DSO catalog v3.23 + Herschel 400 list                 | GPL-2.0-or-later (list: facts) |          25,555 | 2,466,850 |   650,842 | when search first opens                              |
| `catalog/dso-galaxies-v1.json`   | same (objects only in PGC/UGC/ESO, no name, fainter than mag 13) | GPL-2.0-or-later               |          69,325 | 6,331,596 | 1,641,466 | only when a query needs it                           |
| `catalog/stars-v1.json`          | bundled Hipparcos/Gaia star tiles + BSC5 + IAU WGSN names        | ESA open data / public domain  | 8,924 (V ≤ 6.5) |   588,652 |   235,939 | when search first opens                              |
| `catalog/notable-v1.json`        | curated names, positions from CDS Sesame                         | acknowledgement (SIMBAD)       |              84 |     5,859 |     2,328 | when search first opens                              |
| `catalog/manifest-v1.json`       | counts, sources                                                  | —                              |               — |     1,060 |       662 | About page (bundled)                                 |
| `data/lightpollution-2025.json`  | copy of the Worker's yearly model description                    | ours                           |               — |     ~2 KB |         — | Tonight (instead of a Worker request)                |
| `horizons/presets-v1.json`       | Copernicus GLO-30 horizon profiles (Bangalore, Hanle)            | Copernicus DEM licence (free)  |         2 × 720 |     ~8 KB |         — | first visit at a preset (instead of 12 DEM requests) |
| `src/lib/sky/survey-registry.ts` | CDS MocServer records + CORS-tested mirrors                      | per survey (Credits)           |      25 surveys |     in JS |         — | survey picker                                        |

Objects per catalog (an object can be in several): PGC 79,314 · ESO 17,396 · UGC 13,371 ·
NGC 7,269 · Abell 5,249 · IC 3,776 · PN G 2,929 · PK 1,897 · LDN 1,786 · VV 1,126 · LBN 1,118 ·
SNR G 730 · Cr 468 · H400 402 · Arp 391 · B 343 · Sh2 316 · Ced 301 · vdB-Ha 262 · HCG 247 ·
Mel 245 · DWB 193 · RCW 186 · Ru 174 · vdB 161 · vdBH 135 · M 110 · C 110 · Tr 37 · St 22.
Not available: Gum (no machine-readable catalogue found). Curated: 15 quasars/AGN, 25 doubles,
25 variables, 19 exoplanet hosts (GJ 1214 was left out: Sesame did not answer reliably).

Static data now 27.4 MiB in 870 files (budget 40 MiB); initial JS 164.8 KiB gzipped.

## 7. Phase 6: offline cache and its effect on the Worker (2026-11-20)

- The service worker answers repeat requests for Worker tiles from its data cache while their
  Cache-Control allows (tiles: a year; LP info: a day; 7Timer!: 3 h), so returning visitors
  make fewer Worker requests and R2 reads than the first-visit numbers in §3.
- "Save for offline" downloads 872 Pages files (28.7 MB): **0 Worker requests, 0 R2 reads**.
- The device keeps at most 150 MB of cached data (least recently used dropped first).
- Initial JS: 173.1 KiB gz (Sky page code split off; was 203.9 KiB after Phase 5).
