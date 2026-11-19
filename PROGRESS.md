# Progress

Status legend: ✅ done (with evidence) · 🟡 partial · ⛔ not possible (reason) · ⏳ not started.

## Phase 0 — audit and plan ✅ (2026-11-19)

No feature code changed.

**Audit evidence**

- Repo: Svelte 5 + Vite 8 + strict TS; 1,053 tracked files; ~18 k lines in `src/` + Worker;
  29 test files / **198 tests pass** (`npx vitest run`); `svelte-check` **0 errors, 0 warnings**
  (319 files); production build OK in 2.4 s, main chunk **156 KB gzipped**.
- Cloudflare (read-only API): one Worker `astro-night-planning-live-data` (cron `47 * * * *`,
  Workers Caching on), one R2 bucket (**≈ 1.838 GB**, from the hourly job log of 2026-11-19
  07:59 UTC), **no KV**, no D1/DO/Queues. There is **no air-quality proxy** in the Worker (the app
  calls Open-Meteo directly).
- Worker requests measured in a production build: **73 on first load** (19 of them duplicate
  fetches), +13 when opening Maps, 0 for the other tabs; repeat visit served from the browser cache.
  Breakdown and reduction plan: DATA_BUDGET.md §3.
- Baseline screenshots: `docs/screenshots/phase0/before-sky-390.jpg` (phone: sky is not full
  screen, icon rail overlaps the sky, two horizontally scrolling bars, header clock in GMT for
  Greenwich) and `before-sky-1440.jpg`.

**Docs written:** CLAUDE.md, PLAN.md, DESIGN.md, DECISIONS.md (D1–D17), DATA_BUDGET.md,
docs/RESEARCH.md, this file.

**Findings that change the plan**

- NINA Advanced API v2's slew/sync/park endpoints are HTTP GETs → read-only must be a path
  allow-list, not "GET only" (D8).
- Chrome 142+ allows HTTPS → `http://192.168.x` after a Local Network Access prompt; Safari/iOS
  does not → ship a mini-PC bridge that serves the app same-origin (D8).
- Telescopius changed its CSV headers in late 2024; NINA 3.2 expects `Right Ascension (J2000)`
  etc. (D9).
- The R2 write guard still allows 8 GB → lowered to 3 GB in Phase 1 (D11).
- All R2 star/DSO layers stay (D12); new catalogs are added on top, as Pages static shards.

## Phase 1 — foundations ✅ (2026-11-19)

**Done (evidence)**

- Design tokens (`src/styles/tokens.css`): dark atlas-navy default, optional light theme, red-only
  night mode. Night check: a scan of every rendered element found **0 colours with G or B > 0**
  on the Plan and Sky pages; the WebGL sky, the light-pollution map and its controls go through
  the luminance→red SVG filter (`docs/screenshots/phase1/sky-night-1440.jpg`).
- Fonts self-hosted (Atkinson Hyperlegible Next, Spectral italic; OFL 1.1, ~82 KB).
- New shell: header (location, equipment profile, search Ctrl/Cmd-K, Beginner/Expert, Night,
  Plan ⇄ Sky), **night ribbon** time scrubber (drag/click/arrow keys; verified it moves the sky
  to 00:50), Plan page with section index in the new order, Sky page full viewport. The sky
  engine loads only on the first visit to `#/sky`.
- Routing + URL state (`src/lib/state/route.ts`, 15 tests): `#/plan`, `#/sky`, shareable
  `s/t/at/loc/p/l` params, all 8 old tab links redirect, coordinates in links limited to 0.01°.
- Locations: Bangalore default (12.97, 77.59, rounded), Hanle and Coorg presets, measured SQM /
  Bortle stored per site on the device (`effectiveSqm` prefers the measurement; 5 tests).
- Equipment profiles (`src/lib/profiles.ts`): ToupTek ATR585M added; the owner's four rigs
  preloaded; tests reproduce **31.6′ × 17.8′ / 0.494″/px**, **16.3′ × 9.2′ / 0.255″/px**,
  **2.77° × 1.56°**, **93.8° × 70.7°** (7 tests). The header profile drives the deep-sky frame
  and target framing scores.
- Requests: shared in-flight fetches (no duplicates; 2 tests). Cold Sky load **73 → 40** Worker
  requests; Plan page **12** (engine not loaded). CDS mirrors are tried last (it is still down),
  which removed the only console error.
- `npm run check:budget` (`scripts/check-budget.mjs`): 924 files, 22.2 MiB shipped, largest
  file 1.15 MiB, static data 18.4 MiB, initial JS **156.5 KiB gz** (budget 250), no R2
  write/list code, Worker counts from `budget/requests.json`. Added to `npm run ci`.
- R2 write guard lowered to **3 GB** (warning 2.5 GB) in `pipelines/r2/r2.py`; 13 Python tests
  pass. It applies to the scheduled jobs only after this branch is merged into `main`.
- Accuracy (`tests/accuracy.test.ts`, docs/ACCURACY.md): vs JPL Horizons, Sun/Moon/planets
  worst **15.6″** (target 60″), rise/set/twilight worst **12.8 s** (target 60 s); vs Astropy,
  deep-sky alt/az worst **7.7″** (target 360″).
- `npm run dev` now uses the data Worker (D18): the 7Timer! seeing row, light pollution/Bortle and
  satellite clouds were missing in the dev view only; none of those features were removed.
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **276 tests pass**, Worker type-check OK,
  build OK, budget OK, 0 console errors. Screenshots: `docs/screenshots/phase1/` (390, 768,
  1440; Plan and Sky; night mode). No horizontal page scroll at 390 px (a wide-table leak in
  the hourly timeline was fixed with `contain: paint`).

**Carried to later phases (honest list)**

- The Sky page still uses the old icon rail and sideways-scrolling bottom bars (Phase 4 layers
  sheet). The duplicate object card/panel is still there (Phase 4).
- The phone header takes ~190 px of 844 (Phase 6 polish: collapse profile/mode into a menu).
- Search is still the sky search box; the unified catalog search is Phase 2.
- Planets/Sun/Moon section reuses the existing ephemeris table plus a solar-safety warning;
  full cards are Phase 3.
- Initial JS is unchanged at 156 KiB because the Plan page still imports every section
  statically; code-splitting is Phase 6.

## Phase 2 — data and search ✅ (2026-11-19)

**Done (evidence)**

- Catalog pipeline `scripts/catalogs/build_catalogs.py` → `public/catalog/` (Pages, zero R2):
  **94,880 deep-sky objects** with cross-IDs for **29 catalogs** (Stellarium DSO catalog v3.23,
  GPL-2.0+), **Herschel 400** flags (399 list rows → 402 objects), **8,924 bright stars** with
  Bayer/Flamsteed/HD/HIP and IAU names, **84 curated** quasars/AGN, doubles, variables and
  exoplanet hosts (positions from Sesame, none typed by hand). Per-catalog counts in About and
  DATA_BUDGET.md §6 (e.g. M 110, C 110, NGC 7,269, IC 3,776, Sh2 316, B 343, LDN 1,786, LBN
  1,118, vdB 161, Arp 391, HCG 247, Cr 468, PGC 79,314). Gum: not available (reported).
- Survey registry generated from the MocServer (`scripts/surveys/build-registry.mjs`): **36
  surveys** across gamma, X-ray, UV, optical, Hα, infrared, sub-mm and radio; CDS mirrors last;
  CDS-only ones marked "host often down"; Mellinger excluded; credits generated per survey.
  The existing survey menu now groups them by wavelength.
- Unified search: index in a **Web Worker** (`src/lib/search/`), Ctrl/Cmd-K dialog
  (`SearchDialog.svelte`) with grouped results, catalog badges, keyboard navigation, recents and
  favorites (device only), catalog browsing ("Messier" → the 110 objects in order), surveys as
  results (choosing one turns it on), coordinates, and an opt-in **SIMBAD/Sesame** fallback
  (verified: "HD 84937" found online). Cross-IDs: M 31 = NGC 224 = UGC 454 = PGC 2557 =
  Andromeda Galaxy in one entry. **18 search tests**; a query over 34,000+ entries takes
  **< 100 ms** (test) and the dialog showed results ~100 ms after typing (40 ms of it debounce).
- Worker requests (cold, Bangalore): **Plan 73 → 14, Sky 73 → 24**. Static light-pollution
  info, static preset horizons (Bangalore, Hanle; verified identical to the live computation),
  no properties probes, orbits only near the Space section. `Timing-Allow-Origin` added to the
  Worker code (not deployed).
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **295 tests pass**, Worker type-check
  OK, R2 guard tests OK, build OK, budget OK (static data 27.4 MiB / 40, initial JS 164.8 KiB
  gz), 0 console errors. Screenshots: `docs/screenshots/phase2/` (390, 768, 1440, go-to M 31).

**Carried to later phases**

- The old in-sky search box still exists next to the new dialog (removed with the Phase 4 sky
  redesign). The survey picker with thumbnails and opacity per layer is Phase 4.
- Target ranking still uses the OpenNGC list; Phase 3 moves it onto the new catalog shards
  (needed for the catalog/type filters).
- Remaining Worker requests are the 9 cloud tiles behind the Tonight table and the deep-sky
  layer's order-0 tiles; the targets (Plan ≤ 6, Sky ≤ 12) are not met yet.
- The Worker change (`Timing-Allow-Origin`) needs a deploy, which waits for the owner's OK.
- Coorg ships without a static horizon (copy failed its checksum); it is computed on first visit.

## Phase 3 — Plan page ✅ (2026-11-19)

**Done (evidence)**

- **Tonight at a glance** (`src/lib/plan/verdict.ts`, 6 tests; `TonightGlance.svelte`): go /
  marginal / no-go in one sentence with plain reasons (when clouds clear, Moon and narrowband,
  seeing, haze, dew, model disagreement), darkness window, best hour, Moon, clouds, seeing,
  transparency, dew, sky brightness (your measurement or the model, with Bortle). Example today:
  "Go — 10 good hours tonight, 07:00 PM–05:00 AM".
- **Best targets** (`src/lib/plan/rank.ts` in a Web Worker, 7 tests): the documented five-factor
  score on ~25,000 catalog objects; hours count only above the minimum altitude and the terrain
  horizon; tabs Any / Galaxies / Nebulae / Clusters; presets Moon-proof, Beginner-friendly,
  Fits my frame, Narrowband tonight; filters for catalog, type, constellation, magnitude, size,
  surface brightness, minimum altitude, minimum hours, Moon distance, frame fit, visible-at time,
  RA/Dec range and text. "Any type" avoids near-duplicates and caps each type at a quarter (the
  open-cluster flood is gone). Each row: type symbol, names, constellation, magnitude/size/SB
  (Expert), when and where it is highest, usable hours, Moon distance, sparkline, frame-fit
  glyph, filter advice for the profile's filters, difficulty and a one-line "why". "Clouds for
  much of the night" is said once per list. Expanded row: altitude chart with twilight bands,
  Moon and horizon floor, "Why this score?" factor bars, best time of year, copy RA/Dec.
- **Tonight plan** (`src/lib/plan/plan.ts`, 5 tests): add/remove, order by best time, NINA CSV
  (NINA 3.2+ sequencer and Target Scheduler headers), JSON, `.ics`, copy, print.
- **Planets · Sun · Moon** (`src/lib/plan/solarsystem.ts`, 5 tests; `PlanetsPanel.svelte`):
  every planet with best time tonight, altitude sparkline, magnitude, apparent size, phase,
  elongation, distance, rise/transit/set, Jupiter's moons diagram, Saturn ring tilt, capture
  tips from the planetary profile (disc size in px, ROI, critical sampling f/ratio, IR-pass in
  poor seeing); the Moon's phase, age, libration, next phases and features on the terminator;
  the Sun with NOAA SWPC flux, sunspot number and active regions, the SDO image, and the safety
  warning.
- **Data fixes found on the way:** dark nebulae had their opacity class as magnitude, reflection
  nebulae their star's magnitude, LDN 1550 was typed as a planetary nebula → set to unknown /
  dark at build time; the ribbon's best window used a 0–100 score as 0–1 (fixed).
- Method changes documented in About and `docs/methods.md` (constraint 9).
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **321 tests pass**, build OK, budget OK
  (initial JS 185.9 KiB gz of 250), 0 console errors, no horizontal scroll at 390 px.
  Screenshots: `docs/screenshots/phase3/`.

**Carried to later phases**

- The custom horizon (Phase 4) will feed the same `horizon` input; today it is the terrain
  profile.
- Week ahead, Space and Maps keep their previous content in the new order; multi-night
  campaign view and integration-time estimates are not built.
- Mosaic panes CSV and auto-rotation of the frame to the object's long axis are Phase 5
  (plan items export PA 0 for now).
- Upcoming-events calendar (conjunctions, oppositions, eclipses, meteor showers) and bright
  comets/asteroids: not built.
- Lunar terminator position is approximate (±3°, libration ignored), stated in the UI.

## Phase 4 — Sky Explorer ⏳

## Phase 5 — FOV frame and telescope ⏳

## Phase 6 — polish ⏳
