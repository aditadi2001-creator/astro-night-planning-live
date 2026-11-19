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

## Phase 2 — data and search ⏳

## Phase 3 — Plan page ⏳

## Phase 4 — Sky Explorer ⏳

## Phase 5 — FOV frame and telescope ⏳

## Phase 6 — polish ⏳
