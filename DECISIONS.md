# Decisions

Newest last. Each entry: decision, why, consequences. "Owner" = the person the app is built for.

## Phase 0 (2026-11-19)

**D1. Branch `redesign`.** Work happens on branch `redesign`, created from the session worktree
(branch `claude/astro-night-planning-redesign-2931d9` at `82f8275`). One commit per phase. Nothing
is pushed without the owner's OK.

**D2. Improve, don't rewrite.** The codebase is healthy: strict TS, 29 test files / 198 tests
passing, 0 svelte-check errors, a patched and reproducible engine build, documented physics. The
redesign replaces the shell (tabs → two pages), the sky chrome, and the targets/equipment/info UIs,
and reuses `src/lib/**` (physics, astro, data, sky, sat, space) almost unchanged. No part was
judged unsalvageable. `App.svelte` (1,208 lines) and `SkyView.svelte` (1,887 lines) will be split,
not rewritten: their logic moves into stores and smaller components.

**D3. Default location = Bangalore city centre, rounded.** 12.97° N, 77.59° E, 920 m, Asia/Kolkata
(rounded to 0.01°; this is the city centre, not the owner's rooftop). The owner's precise site
(Mathikere) is entered once and lives only in localStorage. Presets: Bangalore, Hanle (IAO, 32.78°
N, 78.96° E, 4,500 m) and Coorg (Madikeri, 12.42° N, 75.74° E, 1,150 m). Greenwich is removed.

**D4. Two pages, Plan order by nightly question.** See PLAN.md §1. The Sky page keeps the engine
mounted while the Plan page is shown (existing off-screen technique), so switching is instant and
costs no re-download.

**D5. One art direction: "Atlas at the eyepiece".** Atlas navy, brass accent, atlas object
symbols, italic serif object names, the night ribbon as the single bold element. Rejected: black +
neon, glass over star photos, SaaS card grids. See DESIGN.md.

**D6. Fonts: Atkinson Hyperlegible Next + Spectral, self-hosted.** Both OFL 1.1 (compatible with
AGPL distribution; the OFL text ships next to the files). Self-hosting avoids a third-party request
(privacy, offline use at dark sites). Budget ≤ 120 KB.

**D7. Night mode = red-only tokens + an SVG luminance→red filter on canvas and images.** Tokens
alone can't change WebGL pixels or map tiles; the filter can. Only #FF0000 and #F00000 reach AA
text contrast on black, so night-mode hierarchy uses size/weight. A pixel-scan test (G = B = 0)
is part of the Phase 6 QA.

**D8. Telescope connectivity: direct local fetch first, mini-PC-served copy as the universal
fallback.** Facts (docs/RESEARCH.md §3): NINA Advanced API v2 listens on plain HTTP `:1888`, sends
`Access-Control-Allow-Origin: *` by default, has no auth, and — important — its slew/sync/park
actions are **HTTP GETs**. Chrome 142+ (desktop + Android) lets an HTTPS page fetch
`http://192.168.x.x` after a Local Network Access prompt when the request is recognised as local
(`targetAddressSpace: 'local'` or a private IP literal); Safari/iOS and Firefox do not reliably
exempt such requests from mixed-content blocking. Therefore:

1. Primary: `fetch('http://<host>:1888/v2/api/equipment/mount/info', { targetAddressSpace: 'local' })`,
   polled every 1–2 s (no WebSocket dependency).
2. Universal fallback: `tools/bridge/` — a ~150-line, dependency-free Node script for the mini PC
   that serves the built app and proxies an allow-list of read-only NINA/Alpaca paths on the same
   origin (`http://minipc.local:8080`); same origin = no CORS, no mixed content, works in Safari.
   Control paths pass only when started with `--allow-control`.
3. Read-only is enforced client-side by a path allow-list (info endpoints only), because GET is
   not a safe-method signal for this API. Slew/sync require "Enable control" + a confirm dialog.
4. Simulator adapter for development, tests and demos.
   NINA reports RA/Dec in the mount's own epoch (`Coordinates.Epoch`, usually JNOW); the HUD converts
   to J2000 itself and labels both. Alpaca: same idea, `equatorialsystem` tells the epoch; ASCOM
   Remote has CORS off by default, so the docs tell users to enable it or use the bridge.

**D9. NINA exports.** CSV with `Familiar Name,Catalogue Entry,Type,Right Ascension (J2000),
Declination (J2000),Position Angle (East)` (works with NINA 3.2+ sequencer import and Target
Scheduler); a second "mosaic panes" CSV `Pane,RA,DEC,Position Angle (East)` (also NINA 3.1).
Horizon files follow NINA's `CustomHorizon` parser: `az alt` per line, `#` comments, any of
tab/space/comma/semicolon. Framing Assistant has no list import, so none is offered.

**D10. Worker: no new routes for the redesign.** New assets go to Pages. Worker work is limited to
cutting requests (DATA_BUDGET.md §3: 73 → ≤ 12 on a cold sky load, ≤ 6 on Plan) and adding
`Timing-Allow-Origin: *` so the budget measurement can see cache hits. The Class B worst case is
bounded by the free plan's 100 k requests/day cap (≤ 3.0 M/month, 30 % of the free 10 M).

**D11. R2 storage guard lowered to the new 3 GB ceiling** (`pipelines/r2/r2.py` HARD_LIMIT
8 → 3 GB, warning at 2.5 GB) in Phase 1. Bucket is at 1.84 GB, so no job breaks.

**D12. Every star and deep-sky layer stays; nothing in R2 is deleted.** The owner wants more
catalogs, not fewer. The older `stars/gaia-deep-v1` and `dso/deep-v1` files (~0.25 GB) remain as
fallbacks; the bucket (1.84 GB) is well under the 3 GB ceiling with them. (Superseded an earlier
proposal to delete them, which the owner rejected on 2026-11-19.)

**D13. Request measurement.** `npm run check:budget` does the static checks (bytes, file count,
25 MiB, R2 write/list patterns in client code, fetch-URL inventory) and prints the last recorded
per-page Worker request counts from `budget/requests.json`, failing if they exceed the targets.
`npm run measure:requests` refreshes that file with Playwright (dev dependency, Apache-2.0) against
`vite preview`; it is optional locally because it downloads a browser.

**D14. Accuracy references are generated at dev time, stored as fixtures.** JPL Horizons API
(topocentric apparent RA/Dec/alt-az, rise/transit/set) and Astropy (DSO alt/az) values are
fetched once by `scripts/accuracy/` and committed as JSON; tests compare against them offline.
Nothing from these tools ships.

**D15. Heavy work in Web Workers**: target ranking (thousands of objects × night samples), the
search index, and horizon-aware visibility. The existing passes/clouds workers stay.

**D16. Catalogs ship as Pages static shards, not R2**, built by `scripts/catalogs/`. Only after a
license check; anything with unclear redistribution terms is reachable through the online
SIMBAD/Sesame fallback instead (licenses in docs/RESEARCH.md §licenses).

**D17. Mellinger Milky Way survey stays out** ("All rights reserved"), as decided in Phase 9 of
the original build; listed but disabled with that reason.

**D18. `npm run dev` uses the same data Worker as production** (`.env.development`, public
URL only). Without it the dev server hid the 7Timer! seeing row, light pollution/Bortle,
satellite clouds and the deep star/DSO layers, which looked like those features had been
removed. Dev traffic is small next to the 100 k/day limit.

## Phase 2 (2026-11-19)

**D19. Stellarium's DSO catalog is the backbone of every catalog.** It is GPL-2.0-or-later (usable
in AGPL via GPLv3), already cross-identifies 29 catalogs for 94,880 objects, and carries common
names with sources. That replaces 15 separate VizieR downloads with unclear terms. OpenNGC stays
for the existing target ranking until Phase 3 moves ranking onto the new shards.

**D20. Two DSO shards.** "Core" = anything with a name, in a classic catalog, or brighter than mag
13 (25,555 rows, 651 KB gzipped); "galaxies" = the rest (69,325 PGC/UGC/ESO rows, 1.6 MB gzipped),
fetched only when a query asks for them. Both are Pages assets, so search costs no Worker requests.

**D21. Curated objects list names only.** Quasars/AGN, doubles, variables and exoplanet hosts are
resolved with Sesame at build time; nothing is typed in by hand (constraint 7). Names Sesame
cannot resolve are left out and listed.

**D22. Survey registry is generated, not hand-typed.** `scripts/surveys/build-registry.mjs` reads
the MocServer record for each chosen survey (mirrors, frame, coverage, copyright), adds mirrors
tested for CORS, and puts CDS last. CDS-only surveys are kept but marked "host often down".

**D23. Online fallback is opt-in per query.** SIMBAD/Sesame is called only when the user presses
"Search SIMBAD online", answers are cached on the device for 30 days, and the CfA mirror is tried
before IDIA. This respects Sesame's rate limits and keeps automatic third-party requests at zero.

**D24. Static copies instead of Worker reads where data changes yearly or never:** the yearly
light-pollution description and the preset horizons. The Worker copy remains the fallback.
The Coorg horizon was left computed on demand (its copied profile failed the checksum against the
live computation, so it was not shipped).

**D25. `Timing-Allow-Origin: *` added to the Worker's responses** (code only; the Worker is not
redeployed until the owner agrees) so future request measurements can tell cache hits from
downloads.

## Phase 3 (2026-11-19)

**D26. Verdict thresholds:** an hour is usable at an imaging score ≥ 40/100; go needs 3 such
hours. These match the existing score's meaning (relative signal-to-noise) and were checked on
tonight's Bangalore data (scores 40–56 under a 70 % Moon read as a workable narrowband night).

**D27. Ranking keeps the documented factors;** only the inputs changed (catalog, horizon,
computed surface brightness). Galaxies rank low from a Bortle 9 sky because their contrast is
low — that is the method working, so they get their own tab instead of a boost.

**D28. Bad catalog magnitudes are removed at build time, not patched in the ranking,** so search,
the info drawer and the ranking agree (one source of truth).

**D29. Plan exports PA 0** until Phase 5 adds frame rotation; NINA treats the PA column as
optional, so 0 means "no rotation requested".

## Phase 4 (2026-11-19)

**D30. One dock with labelled tabs replaces the side rail and floating windows.** A beginner
reads words, an expert uses the F-keys; both reach the same seven panels. The sky's view switches
live in one shared store (`skyView`, saved on the device) so the Layers sheet and keyboard
shortcuts never disagree.

**D31. Foregrounds are drawn in code, not shipped as panoramas.** Zero bytes, nothing to license,
and they render through the engine's existing terrain layer. They are for looks and practice
only: planning never uses them.

**D32. Planning horizon precedence: your custom horizon, then the real terrain (if the terrain
layer is on), then flat.** One horizon feeds target hours, charts, the verdict and the sky's
ground, so the numbers match what you see.

**D33. Object details come from Sesame (SIMBAD data) on the CfA mirror with the IDIA mirror as
fallback, cached 30 days on the device.** A SIMBAD TAP join was tried and was several seconds
slower; CDS Strasbourg itself has been degraded since 2026-11-09 (D22, docs/RESEARCH.md). Only
the object's name is sent.

**D34. The engine's meteor simulation is switched off.** It draws random meteors that are not
real events, which breaks "no fabricated data". Real meteor showers belong in the events
calendar (not built).

**D35. A selection opens the Info tab only when a new object is picked.** The info refreshes
every second as the object moves; re-opening Info on each refresh made the other tabs unusable.

## Phase 5 (2026-11-20)

**D36. Telescope readings bypass the data cache.** They are live readings from a device on your
network: nothing to share or reuse, and a cached position would be wrong. One poll loop per page
does the deduplication; it backs off while the device does not answer.

**D37. Read-only is enforced twice: a path allow-list in the app and the same list in the
bridge.** "Enable control" resets on every visit and on disconnect, every slew/sync is
confirmed, and even "Stop" needs control on: read-only means no command at all.

**D38. Mosaic panes are placed on the sky, not on the screen.** Each pane is computed on the
tangent plane around the frame centre and projected, so the grid stays correct in the alt-az view
where north is not up; "zoom to frame" measures what is drawn.

**D39. Browser-drawn form controls get the red filter at night** (sliders, checkboxes, radio
buttons) and scrollbars get theme colours; select boxes use the theme colours instead of the
filter, because the filter maps red text to near-black.

## Phase 6 (2026-11-20)

**D40. The Sky page is one lazily loaded chunk (`src/sky-parts.ts`),** precached by the service
worker so it still works offline. The Plan page (the default) no longer downloads it.

**D41. The Plan page renders in stages** on idle callbacks instead of virtualising or
removing content: every section still exists, and anything that jumps or links to a section
renders the rest first so positions are right.

**D42. One capped data cache in the service worker (150 MB, least recently used first)**
instead of per-source caches. Responses are reused while their Cache-Control allows (so repeat
views do not reach the Worker or R2) and any copy is used offline. Opaque (no-CORS) responses
are never stored: their size is unknown and padded in the storage quota.

**D43. "Save for offline" fetches only Pages static files** (star tiles, catalogs, horizons:
28.7 MB). Deep-sky Worker tiles and survey imagery are cached as you look at them, never bulk
downloaded, so preparing for a trip costs no Worker or R2 requests.

**D44. Search favorites by keyboard are Alt+F** because a listbox option may not contain a
button (WCAG / ARIA); the star stays as a mouse shortcut and the option's name says
"favorite".

**D45. Night-mode secondary text is full red (#ff0000):** #f00000 on the #200000 panels is 4.4:1,
under AA. Hierarchy at night comes from size and weight, as DESIGN.md already says.
