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

## Accuracy pass (2026-11-20)

**D46. The parallel accuracy branch is merged into `redesign`.** OpenAQ measured air quality, the
calibrated seeing model, satellite cloud thickness, haze-dependent light pollution and airglow
were built on `claude/session-status-check-280608` while the redesign started from older `main`,
so the redesign never had them. Merged (one App.svelte conflict, resolved by keeping the redesign
template and passing the new props).

**D47. Seeing is calibrated on real nights,** not on hand-picked typical weather: archived
forecasts replayed through the model against measured medians at four land sites. The
stable-night surface physics is no longer used at night (it collapses at low wind); a mild
cloud/wind factor and a city term replace it. Sea-level values rest on the fit (one site < 1 km).

**D48. GEM and CMA leave the cloud median** (kept in the spread and the model list): verified dry
bias of 19–55 points at every site; the six-model median beat the eight-model median and the mean
everywhere tested.

**D49. The measured AQI blends nearby stations by distance**, and the Worker reads up to eight
monitors keeping those with PM2.5. One station is not the site: on 20 Nov 2026 it read 175 while
the city read 112–138 elsewhere. The eight-monitor read needs a Worker deploy.

**D50. "Tonight" rolls over at sunrise, not noon.** Morning planning is for the coming night.

**D51. Transparency stays on the CAMS aerosol forecast.** It is the only free aerosol forecast; the
extinction formula was checked step by step and METAR visibility (5 km haze) is consistent with the
forecast optical depths. 7Timer! remains the second opinion.

## Sky usability, search, surveys and mount control (2026-11-20)

**D52. The sky shrinks beside an open panel** (right on wide screens, above the sheet on phones)
instead of the panel covering it, so the camera frame, the telescope marker and the selected
object stay visible; the frame's controls move with it. Costs a canvas resize when a panel opens.

**D53. The camera frame carries its own label** (telescope, camera, field, pixel scale, focal
length, position angle, mosaic), as Stellarium's Oculars plugin does, and six quick switches
(frame, survey, lines, grid, ground, atmosphere) stay on the sky. The rest remains in Layers.

**D54. Charcoal instead of navy** for the dark theme (owner's request): near-black page, dark-grey
panels; contrast re-checked (text 16.4:1, secondary 8.0:1, control borders 3.6:1).

**D55. Search indexes everything the sky draws** (the engine's OpenNGC and nebula lists) and
sends designations only an online service knows (SDSS J…, 2MASS, Mrk, MCG, UGCA, HD…) to SIMBAD
by itself; "SDSS" lists SDSS DR16 galaxies and quasars with spectra around the view from VizieR
rather than shipping a catalogue of millions of objects. The typo-tolerant match no longer accepts
queries made only of short words (it returned Sirius for "Mrk 421").

**D56. Surveys are recommended per object** (by type, size and footprint) and shown in the sky with
one tap from the object's Info. Footprints are approximate rules, tested on M 31, M 51, the North
America and Carina nebulae; a survey that turns out empty shows a faded preview.

**D57. Full mount control, still opt-in each visit.** Park, unpark and tracking join slew/sync/stop
behind "Enable control" and a confirmation; NINA adds plate-solve centring and rotation, sequence
targets, loading saved sequences and the framing assistant (Advanced API 2.2.15, checked against
its OpenAPI spec and Sequence.cs: J2000 degrees, 0-based container index, rotation =
PositionAngle). A direct USB connection (Web Serial, LX200 and NexStar/SynScan) works with no
other software. A GoTo is refused near the Sun without a confirmed solar filter, and below the
horizon. Never sent: flip, connect, starting a sequence, the NINA profile endpoint, LX200 site/time
or NexStar setup commands.

## Search pins, sky switches and the trip planner (2026-11-20)

**D58. Objects the 3D sky has no entry for are pinned, not just pointed at.** Sharpless, Barnard,
Lynds, PGC/UGC galaxies, SDSS and SIMBAD results and typed coordinates get a marker and an Info
panel built from the catalog (`src/lib/astro/pin.ts`); before, the view moved but nothing was
selected, so search looked broken. Any object below the horizon gets a note with when to look and
a "see through the ground" switch.

**D59. Nine switches stay on the sky:** frame, survey, constellation lines, RA/Dec grid,
equatorial view, meridian, ground, atmosphere and full screen. Full screen falls back to covering
the page where the Fullscreen API is missing (iPhone Safari).

**D60. Trip planner from ERA5 history, not long-range forecasts.** No free forecast reaches past
about 16 days; ten years of ERA5 night cloud say which months are usually clear, which is what a trip
needs. Only twelve monthly figures are kept on the device.

**D61. Survey recommendations put mirrored surveys first;** surveys served only by CDS (Legacy,
DECaPS, SkyMapper, ZTF, SHASSA, unWISE, ROSAT) follow, because CDS was down on 20 Nov 2026.

**D62. The Sky page has its own timeline, always on screen** (owner's request): step, play
(one step per second, either way) or scrub by minutes to centuries, or type a date; the sky follows
(tested 1539 to 2039). Calendar-correct months and years (`src/lib/time/shift.ts`). The Trips
calendar stays on the Plan page.

**D63. The mount is always on the sky:** a "Connect mount" button, then the mount's state, its
distance from the selected object and Stop (with control on). GoTo stays in the Telescope panel,
where the safety checks and the confirmation are; that panel now starts with the telescope.

**D64. "Any mount" through six routes and a picker.** INDI and Wi-Fi/Ethernet LX200/NexStar mounts
go through the bridge (browsers cannot open TCP sockets); the bridge answers only the published
app's origin and passes only allow-listed commands and INDI properties. Where a maker's network
protocol is not documented or verified (Celestron Wi-Fi, Sky-Watcher Wi-Fi, iOptron), the picker
routes through ASCOM or INDI instead of guessing.

**D65. SDSS objects come from the app's own deep-sky layer, not VizieR.** The 2.6 million SDSS DR17
spectroscopic galaxies are already in R2 (/hips/dso2) and drawn in the sky; search reads the same
eph tiles around the view (descending only below full tiles, so no request is made for a missing
one), parses positions from SDSS names, and finds famous SDSS objects by nickname. VizieR remains a
fallback only where there is no data Worker (local development).

**D66. While the view tracks the stars, the app runs the sky's clock.** The engine draws before
our frame callback, so re-pointing after it left each frame one frame behind the sky's rotation,
and the page's once-a-second clock resets made the stars jump by a few hundredths of a second of
rotation. Both were invisible at wide fields and several pixels at high zoom (the equatorial-view
shake). Now the clock is reset only for real jumps (more than 1.5 s, or a deliberate time change),
and in the equatorial view (or after a go-to) mountStep advances time and pointing together. The
north-up roll is measured over a fixed 0.5° step and damped.

## Neutral defaults for the public site (2026-11-20)

**D67. Nobody's personal site or rig ships with the app; each visitor's choices live in their
browser.** The owner asked for their places and equipment to be removed from the live site. The
built-in places are four public observatories (Greenwich, Mauna Kea, Roque de los Muchachos,
Cerro Paranal; 0.01° as before) and Greenwich is the default because it is neutral (longitude 0°)
and its terrain horizon ships precomputed (no DEM requests through the Worker on first visits). A
first visit asks once for the visitor's place (GPS, picker, or keep Greenwich) and only then
offers the tour. The starter rigs are common generic equipment. The visitor's own deep-sky
equipment from Plan → Telescope becomes "My setup" in the header as soon as it differs from the
chosen rig, and is kept when they try a starter rig; a browser that already holds the owner's
C9.25 setup therefore keeps it as My setup. Sky layer switches are now remembered too (the
satellite map is not restored, as turning it on opens the Maps tab). Everything stays in
localStorage (CLAUDE.md rule 5).

**D68. The sky engine only starts when WebGL is available.** Without WebGL the engine started with
no drawing context and every texture upload threw (seen on production too, on each Sky → Plan
switch). The app now checks WebGL on a scratch canvas first and shows how to turn it on; texture
uploads are skipped while the context is missing.

**D69. A missing DEM tile counts as sea only inside its own 1° square.** It used to read 0 m for
every point, so a site with sea within 90 km got a flat sea-level terrain horizon (found while
computing the Mauna Kea and Paranal presets; tests/dem-sea.test.ts).

**D70. The service worker never stores the HTML page as a script; unknown paths are real 404s.**
Right after the 20 November deploy a browser updated its service worker before the new files had
reached every Cloudflare edge; Pages answered the new script's path with the app page (status
200, text/html) and the worker cached it, so the site stayed blank in that browser. The install
now fetches each file itself and fails (keeping the old version, retried on the next visit) on an
HTML answer for anything but the page; a stored HTML copy of a script is dropped and fetched
again; and `404.html` makes Pages answer unknown paths with a 404 (routing is hash-based, so
nothing relied on the fallback). Tested in tests/sw-html-guard.test.ts.
