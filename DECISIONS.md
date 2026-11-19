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

**D12. Superseded R2 layers stay until the owner approves deletion.** `stars/gaia-deep-v1` and
`dso/deep-v1` (~0.25 GB) are unreachable once the app drops their fallbacks, but deleting is
permanent and outward-facing, so it is listed as a next step, not done.

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
