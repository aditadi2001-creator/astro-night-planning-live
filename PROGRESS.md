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

## Phase 4 — Sky Explorer ✅ (2026-11-19)

**Done (evidence)**

- **One dock instead of 25 unlabeled icons** (`SkyDock.svelte`): search, "Tonight's best" and
  seven labelled tabs (Targets, Info, Layers, Telescope, Horizon, Time, More). Bottom sheet on
  phones, right-hand drawer from 900 px; Esc closes; F-keys open the same panels. The old side
  rail, floating windows, time bar, button bar and chips are gone, and so are `SkySearch`,
  `SkyInfo`, `ObjectDetails`, `TabNav` and `TopBar` (unused after the refactor).
- **Layers sheet** (`LayersSheet.svelte`, view state in `src/lib/sky/view.svelte.ts`): presets
  Beginner / Imager / Survey / Full; grouped switches (lines and labels, grids, ground and
  atmosphere, objects) each with a one-line hint and its keyboard shortcut; the physical layers
  (clouds, light pollution, haze, terrain, long exposure, deep-sky images) with what they show;
  the survey picker: 36 surveys grouped by band, each with a live HiPS thumbnail of Orion, the
  serving mirror and an opacity slider.
- **Horizon and foreground** (`HorizonPanel.svelte`): 12 foregrounds drawn in code (real
  terrain, none, flat, ocean, desert, hills, forest, mountains, Himalayan peaks, city, Bangalore
  rooftop with parapet, observatory dome) with brightness and fog (`src/lib/sky/foreground.ts`,
  3 tests). **Custom horizon** per site (`src/lib/sky/customHorizon.ts`, 5 tests): import NINA
  `.hrz`, CSV or JSON, export NINA `.hrz`, clear; draw by clicking or typing az/alt, start from
  the terrain; trace a panorama photo (click points or auto-trace the sky edge); phone survey
  with the compass, calibrated on the Sun or Moon. The custom horizon drives target hours,
  charts and the verdict on the Plan page and the sky's ground.
- **Info drawer** (`InfoDrawer.svelte`, `src/lib/info/details.ts`, 2 tests on recorded Sesame
  replies): plain-language "What is this?" plus the Wikipedia summary; Centre, Frame, + Plan,
  Favorite; survey cut-outs (DSS2, 2MASS, AllWISE, Pan-STARRS, Hα, GALEX) at a zoom chosen from
  the object's size (`src/lib/sky/healpix.ts`, 3 tests); identity and aliases; position (J2000,
  of date, hour angle, galactic, ecliptic, constellation); physical data with its source
  (magnitude, size and PA, computed surface brightness, distance, redshift for z ≥ 0.001, radial
  velocity, spectral type, proper motion, parallax; planet disc, phase, Jupiter's moons,
  Saturn's ring tilt, Moon phase and libration); visibility tonight with the altitude chart;
  imaging strategy and fit for each equipment profile; private notes; links (SIMBAD, NED,
  Wikipedia, ESASky). Checked on M 42, Saturn and Vega.
- **Shared links open on the object:** `#/sky?t=M%2042` now selects M 42 at load (it was written
  to the URL but never read). Search go-to waits up to 6 s for the engine's deep-sky tile.
- **Fixes found on the way:** the engine's random meteor simulation is off (it drew invented
  streaks; constraint 7); `describe()` no longer asks the engine for a non-existent `type`
  info (one console line per second while something was selected); picking a dock tab no longer
  snaps back to Info every second; disabled buttons now look disabled; the night button has an
  accessible name on phones.
- No new Worker or R2 requests: SIMBAD/Sesame, Wikipedia and the HiPS thumbnails come from
  public servers and are cached on the device.
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **334 tests pass**, build OK,
  `check:budget` OK, no horizontal scroll at 390 px, 0 console errors after reload. Night mode:
  the SVG filter matrix zeroes G and B (the JPEG screenshot shows only chroma bleed next to
  bright red text). Screenshots: `docs/screenshots/phase4/` (1440 info, 768 horizon, 390 info,
  layers and night).

**Not verified / carried to later phases**

- The panorama tracer and the phone compass survey were not exercised end to end here (the
  browser pane has no camera roll or orientation sensor); the `.hrz` import, export and clear
  were.
- A burst of short streaks can appear in the first seconds after load at wide fields; it is not
  the meteor module (off) and disappears once the view settles. To investigate in Phase 6.
- Opacity is one slider for the survey layer, not per stacked layer.
- The telescope tab holds the existing frame controls; the frame upgrade, mosaics and live
  telescope HUD are Phase 5.

## Phase 5 — FOV frame and telescope ✅ (2026-11-20)

**Done (evidence)**

- **Telescope panel** (`TelescopePanel.svelte`, dock tab "Telescope"): camera frame on/off,
  centre on the selected object, rotation (−180°…180°), the frame centre (J2000) and the
  position angle of its top edge.
- **Align to the object:** turns the frame so its long side follows the object's catalog
  position angle (M 42, PA 90° → top edge at PA 0°). Objects with no PA in the catalog say so.
- **Mosaic:** 1–6 × 1–6 panes with 5–40 % overlap, drawn on the sky at their true positions and
  turned with the frame (`mosaicPanes` in `src/lib/equipment.ts`). "Zoom to frame" fits the whole
  mosaic as drawn. Export as NINA mosaic panes CSV (`Pane, RA, DEC, Position Angle (East)`).
- **Live telescope** (`src/lib/telescope/`): simulator, NINA Advanced API v2 and ASCOM Alpaca
  adapters behind one interface; one poll loop (1.5 s, 0.5 s while slewing, backing off to 15 s
  while failing); plain-language errors with what to check.
- **HUD:** altitude/azimuth, RA/Dec J2000 and of date, hour angle, pier side, state (parked,
  slewing, tracking), time to the meridian, NINA's meridian-flip countdown, time until it drops
  below your planning horizon, rotator angle, offset from the selected object, the mount's epoch.
  A ring on the sky marks where the telescope points, with an edge arrow when off-screen;
  "Follow the telescope" keeps the sky on it.
- **Safety (constraint 8):** read-only by default. Control appears only after "Enable control"
  (off on every visit and on disconnect); slew and sync each need a confirmation that names the
  target, warns when it is below your horizon, and reminds to clear cables and people. Even
  "Stop" needs control on. Requests are checked against a path allow-list (`allow.ts`): park,
  flip, connect and NINA's `/profile/show` (which exposes API keys) are never sent.
- **Bridge** (`tools/bridge/bridge.mjs`, ~200 lines, no dependencies): serves the built app and
  forwards the same allow-list on the same origin for Safari/iPhone/Firefox; commands only with
  `--allow-control`. Five-step guide: `docs/telescope.md`, and in the panel ("How to connect").
- **Tests:** 11 in `tests/telescope.test.ts` (allow-lists and bridge routes agree, NINA/Alpaca
  parsing with JNow → J2000, coordinates, horizon/meridian times, simulator, mosaic, CSV).
- **Browser checks:** simulator connect → enable control → confirm → slew → tracking; a mock NINA
  server following `ninaAPI`'s `api_spec.yaml`, reached directly (Chrome) and through the bridge:
  HUD filled (JNow → J2000 gave M 42's position), only `mount/info` and `rotator/info` were
  requested while read-only, and the confirmed slew arrived as J2000 degrees
  (`ra=83.823910&dec=-5.388232`). The bridge answered 403 to slew without `--allow-control`, to
  park and to `/profile/show`, and path traversal returned only the app page.
- **Night mode fixes found here:** slider tracks, checkboxes and scrollbars were drawn white/grey
  by the browser; select boxes now use theme colours. 0 grey pixels at 768 px with the panel open.
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **345 tests pass**, build OK,
  `check:budget` OK (no new Worker or R2 requests: the telescope is on your network), no
  horizontal scroll at 390 px, 0 console errors. Screenshots: `docs/screenshots/phase5/`
  (1440 mosaic + reticle, 390 HUD and confirmation, 768 night).

**Not verified / carried over**

- Not tested against a real NINA or a real Alpaca driver (only the simulator and a mock that
  follows the published API). The direct path from the deployed HTTPS site depends on Chrome's
  local-network prompt, which a localhost test cannot show.
- NINA's "Position Angle (East)" convention for mosaic panes and plan items is assumed to equal
  the app's (PA of the frame's top edge, east of north); check once against a plate solve.
  Plan items still export PA 0 unless a mosaic is exported (D29).
- No drag-to-move or rotate handle on the frame itself (rotation is the slider, `[`/`]` keys and
  "Align"); frame offsets from the screen centre are not supported.

## Phase 6 — polish ✅ (2026-11-20, except the preview deploy)

**Done (evidence)**

- **Accessibility (WCAG 2.2 AA):** axe-core 4.14 (dev dependency, MPL-2.0, not shipped) run in
  the browser on the Plan page, every Sky dock tab, the Info drawer with an object, search,
  the location picker, Help, the tour and night mode. Fixed: time-step buttons whose spoken name
  did not contain the visible text (2.5.3); a tab list containing a link; favorite buttons
  nested in listbox options (now Alt+F, announced as ", favorite"; the star stays for the
  mouse); "Esc" button name; night-mode secondary text at 4.4:1 (now full red, 5:1); card
  headings read as "Cloudsforecast". Result: 0 violations in all of those states.
  Lighthouse accessibility 100.
- **Reduced motion:** the sky's go-to, centre, follow and zoom jump instead of gliding when the
  system asks for less motion (CSS transitions already did).
- **Performance:** the Sky page's code (dock, panels, telescope) is a separate chunk loaded on
  the first visit to Sky: initial JS 203.9 → 173.1 KiB gz (budget 250). The Plan page renders
  in stages (Tonight first, then one section per idle moment; a jump or a link to a section
  renders everything). Date formatters are cached; the satellite cloud field decodes per tile
  instead of 14,641 promises. Tonight's key figures sit above the reasons, so the arriving
  forecast no longer pushes them. Lighthouse mobile on `#/plan` (production build, local):
  **performance 90–92** (was 77), CLS 0.139 → 0.04, TBT 450 → 170–240 ms, accessibility 100,
  best practices 100.
- **Offline (PWA):** the service worker keeps a data cache across versions, capped at
  **150 MB** (least recently used dropped first), for star tiles, catalogs and horizons, the
  data Worker's tiles and public HiPS survey tiles. It follows each response's Cache-Control
  and uses any copy when the network fails. The Sky chunk is precached too. "Save for offline"
  (location picker) downloads the 872 static data files (28.7 MB, Pages only: no Worker or R2
  requests) with progress, asks for persistent storage and shows the space used. Tested with
  the server stopped: the Plan page with the last forecast, the Sky engine, stars and catalog
  search all worked (`docs/screenshots/phase6/offline-sky-search.jpg`).
- **Beginners:** a "?" Help button (tour, keys, a 34-term plain-language glossary with search)
  and an 8-step guided tour, offered once to new visitors (dismissible, remembered).
- **Phone header:** two rows instead of three (197 → 153 px): the profile, a single "Expert"
  toggle and Plan/Sky share the second row.
- **Linked sections:** `#/plan?s=week` now opens at that section (the browser used to restore
  its old scroll position).
- **Night-mode check in the gate:** `npm run check:budget` now fails if any night token has
  green or blue, or if the `#night-red` filter lets them through (35 colours checked).
- **Load streaks (Phase 4 note):** not seen again on a plain load or a go-to link; they were
  most likely the engine's meteor simulation, switched off in Phase 4.
- Gate: svelte-check 0/0, ESLint clean, Prettier clean, **345 tests pass**, build OK,
  `check:budget` OK. Screenshots: `docs/screenshots/phase6/`.

**Not done / waiting**

- **Preview deploy to Cloudflare Pages:** needs the owner's OK (CLAUDE.md, outward-facing).
- The forecast offline is the app's last good copy (3 days in localStorage); there is no
  "prepare a forecast for a date" beyond loading the site before leaving.
- Lighthouse was run locally against `vite preview`; the deployed site (CDN, HTTP/2) should do
  at least as well but is not measured.

## Accuracy pass ✅ (2026-11-20, after Phase 6, at the owner's request)

**Why:** the owner saw 0.8–1″ seeing for Bangalore (observers there get 2–3″) and the measured
OpenAQ air quality missing. Cause: that work lived on a parallel branch never merged into
`redesign` (D46). Merged, then checked against outside sources and fixed what was still off.

- **Seeing** (D47): replaying about 80 real nights showed even the calibrated model about 2x too
  optimistic (Kavalur 0.91″ vs 1.85″, Hanle 0.44″ vs 1.27″, Bangalore 1.6″). Recalibrated on real
  nights: Kavalur 1.76″, Sutherland 1.44″, Devasthal 1.25″, Hanle 1.21″ (all within 15 % of
  measured); Bangalore centre about 2.45″ clear / 2.05″ cloudy; tonight 2.4–2.5″ vs meteoblue
  2.05–2.57″.
- **Clouds** (D48): six-model median (GEM, CMA out): error down at Bangalore, Coorg and Hanle on
  800 night hours each. Tonight's early-evening cloud (24 % → 0 %) now shows, closer to meteoblue.
  Last night's "0 %" agreed with the airport METARs (VOBL, VOBG: no significant cloud, haze).
- **Air quality** (D49): distance-weighted blend of stations; the Worker change (read 8 monitors,
  keep PM2.5 ones) is written and type-checked but **not deployed** (needs the owner's OK). Until
  then Bangalore still has only one PM2.5 station in the reply, so it still reads high.
- **Bug fixes:** "Tonight at a glance" described the past night until noon (Moon "down" though it
  sets at 02:51); it now rolls over at sunrise (D50). The haze reason no longer says "dust or
  smoke" for Bangalore's fine-particle haze; card headings read "Clouds, forecast" to screen
  readers.
- **Transparency:** checked, unchanged (D51). Tonight 0.51–0.78 mag/airmass follows CAMS's rising
  aerosol forecast (optical depth 0.29 → 0.58).
- Tests: 412 pass (new real-night seeing fixture, cloud-median and AQI-blend tests, sunrise
  rollover). Sources: meteoblue astronomy seeing, IQAir, WAQI, aviationweather.gov METARs,
  Open-Meteo historical forecasts and ERA5, RAA 2019 (Kavalur), Parihar et al. 2015 via arXiv
  1802.00372 (Hanle).
