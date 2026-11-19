# Plan — Astro Night Planning redesign

Improve the existing app (Svelte 5 + Vite + TS, Stellarium Web Engine, ~18 k lines, 198 passing
tests); nothing is rewritten from scratch. Phase 0 audit findings are in DATA_BUDGET.md (quota),
DECISIONS.md (choices) and docs/RESEARCH.md (competitors, APIs, licenses).

## 1. Information architecture

Two pages, one shared state.

```
┌ Header (both pages) ─────────────────────────────────────────────────────────────┐
│ ◐ Astro Night Planning  [Bangalore ▾]  [C9.25 · 0.63× · ATR585M ▾]  [⌕ Ctrl K]   │
│ Night ribbon: 18:02 sunset ▓▒░ dark 19:20 ─────●now──────── 05:08 ░▒▓ sunrise    │
│ (doubles as the time scrubber)       [Beginner|Expert]  [Night ◑]  [Sky ⇄ Plan]  │
└──────────────────────────────────────────────────────────────────────────────────┘
#/plan                                       #/sky
┌ section index (desktop: left rail;  ┐      ┌ full-viewport Stellarium sky ──────┐
│ phone: sticky chips)                │      │ compass · horizon · cardinals       │
│ 1 Tonight at a glance               │      │                                     │
│ 2 Best targets tonight              │      │   telescope reticle + FOV frame     │
│ 3 Planets · Sun · Moon              │      │                                     │
│ 4 Week ahead                        │      │ ┌ dock (bottom sheet on phones,  ┐  │
│ 5 Telescope & FOV                   │      │ │ right drawer on desktop)       │  │
│ 6 Space (aurora, satellites)        │      │ │ Targets · Info · Layers ·      │  │
│ 7 Maps (lazy)                       │      │ │ Telescope · Horizon · Time     │  │
│ 8 About, methods, credits (closed)  │      │ └────────────────────────────────┘  │
└─────────────────────────────────────┘      └─────────────────────────────────────┘
```

**URL state** (hash query, shared by both pages, shareable):
`#/plan?t=M31&at=2026-11-19T21:30+05:30&loc=bangalore&p=c925r&l=con,grid,dss&s=targets`
— `t` target, `at` time (absent = live), `loc` preset id or rounded `lat,lon` (precise coordinates
never enter the URL unless the user shares them), `p` equipment profile, `l` layers, `s` section or
dock panel. Old routes redirect: `#/tonight→#/plan?s=tonight`, `#/week→s=week`,
`#/targets→s=targets`, `#/equipment→s=telescope`, `#/maps→s=maps`, `#/space→s=space`,
`#/about`/`#/credits→s=about`.

Why this order: the first question every night is "is it worth setting up?" (verdict), the second
"what do I shoot?" (targets + planets), then "what about the next nights?" (week), then the
operational parts (rig, telescope), then occasional extras (space, maps) and reference (about).

### Where every current feature goes

| Today                                                                                                  | New home                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header location picker                                                                                 | Header (presets Bangalore/Hanle/Coorg + saved + geolocation + search)                                                                                      |
| Header clock, Night button                                                                             | Header night ribbon / Night toggle                                                                                                                         |
| Sky tab: sky canvas                                                                                    | `#/sky` full viewport                                                                                                                                      |
| Sky search box                                                                                         | Global search (Ctrl/Cmd-K), both pages                                                                                                                     |
| Sky left rail (location, time, layers, info, settings, help)                                           | Dock panels: Time, Layers, Info; location → header; settings → Layers "Display"; help → tour + glossary                                                    |
| Sky time buttons (±1 h/10 m/1 m, Now, play, rate)                                                      | Dock "Time" + header ribbon scrubber; keyboard J/K/L kept                                                                                                  |
| Sky bottom bar (~25 unlabeled icons, sideways scroll)                                                  | Dock "Layers" sheet, grouped and labeled: Lines & labels · Grids · Ground & atmosphere · Objects · Surveys · Overlays; presets Beginner/Imager/Survey/Full |
| Layer chips (long exposure, deep-sky photos, clouds, LP, haze, terrain, surveys, sat map, camera view) | Layers sheet groups "Ground & atmosphere" / "Surveys" / "Overlays"; camera view → Dock "Horizon" (AR)                                                      |
| Oculars (sensor/eyepiece/Telrad/nightscape)                                                            | Dock "Telescope" (FOV frame, eyepiece, Telrad, nightscape)                                                                                                 |
| Object card + duplicate big panel                                                                      | One Info drawer (dock "Info"); the floating card is removed                                                                                                |
| SkyInfo / SkyEphem / PhysicsPanel (calculations)                                                       | Info drawer "Expert" section + Plan "Tonight at a glance" details                                                                                          |
| Tonight tab: freshness list, hourly score table, condition cards                                       | Plan §1 (verdict + key numbers on top; hourly table and cards behind "Hour by hour"; freshness stamps inline)                                              |
| Week tab                                                                                               | Plan §4                                                                                                                                                    |
| Targets tab (OpenNGC ranking)                                                                          | Plan §2 (new engine, filters, presets, per-type views)                                                                                                     |
| Planets/Moon one-liner                                                                                 | Plan §3 (full cards incl. Sun with safety banner)                                                                                                          |
| Equipment tab (3 setups, cameras)                                                                      | Plan §5 "Telescope & FOV": profiles (4 preloaded), live status, frame preview                                                                              |
| Maps tab (LP map, satellite map)                                                                       | Plan §7, lazy (MapLibre loaded on scroll-into-view)                                                                                                        |
| Space tab (aurora, passes)                                                                             | Plan §6                                                                                                                                                    |
| About + Credits                                                                                        | Plan §8 (collapsed), plus "Accuracy" card                                                                                                                  |

## 2. Phases

Each phase ends with the gate in CLAUDE.md (check, lint, tests, build, budget, screenshots at
390/768/1440, zero console errors, PROGRESS.md, commit on `redesign`).

### Phase 1 — foundations

- `src/styles/tokens.css` from DESIGN.md; self-hosted fonts; dark / light / red night themes
  (night = token swap + SVG `feColorMatrix` red-only filter on the canvas layer).
- New shell: header (location, profile, search trigger, Beginner/Expert, night, page switch,
  night ribbon), router with `#/plan` + `#/sky`, redirects, URL-state store
  (`src/lib/state/url.svelte.ts`) with tests.
- Default location Bangalore (12.97, 77.59 rounded; owner's precise site stays local), presets
  Hanle, Coorg; location store with Bortle/SQM model vs measured value.
- Equipment profiles: camera/telescope DB incl. ToupTek ATR585M, the 4 owner profiles, filters;
  tests reproducing 31.6′×17.8′ / 0.494″/px, 16.3′×9.2′ / 0.255″/px, 2.77°×1.56°, 93.8°×70.7°.
- Fetch layer: in-flight dedupe; `npm run check:budget` (static bytes/files, 25 MiB, R2 write/list
  grep, Worker request count from a Playwright measurement); R2 guard lowered to 3 GB.
- Accuracy tests: Sun/Moon/planets vs JPL Horizons reference values (fixtures generated at dev
  time, stored as JSON), rise/set/twilight vs USNO/Horizons, DSO alt/az vs Astropy values.

### Phase 2 — data and search

- `scripts/catalogs/` build pipeline → `public/catalog/<name>-v<n>.json.gz`-style shards (Pages,
  zero R2), manifest with source/license/rows/bytes → DATA_BUDGET.md §6.
- Catalogs in order of value: Messier, Caldwell, Herschel 400, NGC/IC (OpenNGC), Sharpless, Barnard,
  LDN, LBN, vdB, Abell PN, Arp, Hickson, Collinder/Melotte/Trumpler/Stock, Gum/RCW, notable
  AGN/quasars, bright stars with Bayer/Flamsteed/IAU names, doubles, variables, exoplanet hosts,
  UGC/PGC subset — each only after its license check (RESEARCH.md §licenses).
- Survey registry snapshot (`public/surveys.json`, ~30 HiPS grouped by wavelength, mirrors,
  attribution, thumbnails ≤ 8 KB each) with runtime mirror health check + degraded message.
- Unified search: Web Worker fuzzy index (< 100 ms), cross-IDs, constellations, Solar System,
  catalogs and surveys as results, recents/favorites, SIMBAD/Sesame fallback cached in IndexedDB.
- Worker: `Timing-Allow-Origin`, no new routes unless unavoidable; static `properties`; drop v1
  layer references.

### Phase 3 — Plan page

- §1 verdict engine (plain-English go/no-go + "why"), dark window, Moon, clouds/seeing/
  transparency/dew, best hour, model-agreement band.
- §2 targets engine in a Web Worker: current scoring + explainable breakdown, horizon-aware hours,
  filters (catalog, type, constellation, mag, size, SB, min alt, min hours, Moon sep, FOV fit,
  visible at, RA/Dec, text), presets, per-type tabs + diversity-aware "any type", rows with
  sparkline, FOV-fit mini graphic, filter strategy for the owner's filters, difficulty, "why";
  expanded chart with twilight bands, Moon altitude, horizon shading; best-time-of-year chart.
- Tonight Plan (local): add/auto-order, export CSV (Telescopius/NINA columns), JSON, `.ics`, copy
  RA/Dec, print.
- §3 Planets · Sun · Moon cards (Jupiter moons, ring tilt, libration, terminator features, SWPC
  solar data, safety banner); events list.
- §4 week, §6 space, §7 maps moved in and restyled; §8 about + accuracy card.

### Phase 4 — Sky Explorer

- Dock with Targets/Info/Layers/Telescope/Horizon/Time; layers sheet + presets; survey picker with
  thumbnails and opacity; compass widget; tap-to-identify; "show tonight's best" markers.
- One Info drawer for all object types with sources, survey thumbnail, SIMBAD/Wikipedia on demand.
- Foregrounds (license-checked, ≤ 300 KB each, lazy) + brightness/fog; custom horizon import
  (NINA .hrz, CSV, JSON), panorama + skyline tracer, phone survey helper with azimuth calibration,
  export .hrz; horizon drives scoring, charts, HUD, best hour.

### Phase 5 — FOV frame and telescope

- Frame: drag, rotate handle, mosaic with overlap, auto-rotate to long axis, true-scale survey.
- Adapters: simulator, NINA Advanced API, ASCOM Alpaca; read-only default, "Enable control" +
  confirm; HUD (alt/az, RA/Dec J2000 + JNow, PA, HA, pier side, state, time to meridian, time to
  horizon, offset); reticle + "Follow telescope"; local bridge script + 5-step doc; failure states.

### Phase 6 — polish

- WCAG 2.2 AA pass (axe), keyboard map, reduced motion, night-mode pixel test (G = B = 0),
  Lighthouse mobile ≥ 90 on `#/plan`, initial JS ≤ 250 KB gz, offline PWA with 150 MB LRU cap,
  docs, Pages **preview** deploy (asks the owner first), final verification and report.

## 3. Risks and honest expectations

- Scope is very large; Phases 4–5 are where partial delivery is most likely (panorama skyline
  tracer, phone survey helper, mosaic + per-panel rotation). Each will be reported as done /
  partial / not done with evidence.
- Telescope adapters can be tested against the simulator and recorded responses; a live NINA test
  needs the owner's mini PC.
- Some catalogs (HyperLEDA/PGC, WDS, GCVS) have unclear redistribution terms; they are shipped only
  if the license check passes, otherwise via the online SIMBAD fallback.
- CDS (alasky/SIMBAD) availability has been unreliable since 2026-11-09; every CDS dependency
  needs a mirror or a graceful failure.
