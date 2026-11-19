# CLAUDE.md — Astro Night Planning

Free, open-source (AGPL-3.0) astrophotography planner: a Stellarium Web Engine sky plus observing
conditions, targets, equipment and telescope status. Static site on Cloudflare Pages, one data
Worker in front of one R2 bucket. Owner: a deep-sky imager in Bangalore who also wants the app to be
usable by complete beginners.

## Hard constraints (non-negotiable)

1. **Free only.** No paid APIs, no paid Cloudflare features, no secrets in the repo. Committed env
   files hold public values only (`.env.production` = `VITE_DATA_BASE`).
2. **R2 free limits must never be exceeded** (free per month: 10 GB-month Standard storage, 1 M
   Class A, 10 M Class B, free egress; R2 has no spend cap). Self-imposed ceilings: **storage
   ≤ 3 GB, Class B ≤ 3 M/month, Class A ≤ 100 k/month.** Never use Infrequent Access (no free tier).
   No browser code may write to or list R2. Everything served from R2 or the Worker carries
   `Cache-Control`, and the Worker uses Workers Caching / the Cache API so repeat views are not R2
   reads. `pipelines/r2/r2.py` is the only R2 writer and enforces the storage ceiling.
3. **Prefer zero R2 for new assets.** New catalogs, icons, foregrounds and fonts ship as Pages static
   assets (limits: 20,000 files/deployment, 25 MiB/file, 500 builds/month). Keep the Worker far
   below 100 k requests/day (the limit is account-wide and shared with the owner's main site):
   cache, batch and dedupe every Worker call.
4. **Stream, don't host, big imagery.** HiPS survey tiles come from public servers at runtime (CDS,
   ESA, IRSA, MAST, CASDA, China-VO mirrors) with fallback and a clear degraded-mode message. Never
   mirror surveys into our storage.
5. **User data stays on the device**: precise location, custom horizons, panoramas, favorites,
   plans, notes, equipment, observing log (localStorage / IndexedDB) with JSON export/import. The
   shipped default location is rounded to 0.01°.
6. **Licenses.** The app embeds Stellarium Web Engine (AGPL-3.0): keep the license notice and the
   public source link in Credits. No AGPL-incompatible dependencies. Check and record the license of
   every dataset, landscape, font and image before bundling (DATA_BUDGET.md table). Keep attribution
   current (CDS/HiPS, DSS/STScI, Pan-STARRS, 2MASS, SDSS, Gaia, OpenNGC, NASA/NOAA, Open-Meteo, 7Timer).
7. **No fabricated data.** Unknown values render as "n/a" with the source that lacks them.
8. **Safety UX.** Telescope connections are read-only by default; slew/sync needs an explicit
   "Enable control" toggle plus a confirmation dialog. Every solar view shows: never observe or
   image the Sun without a certified full-aperture solar filter.
9. **Do not regress accuracy.** Keep the documented methods (About page, `docs/methods.md`). Any
   change to a method needs a test and a note on the About page.

## Outward-facing actions — ask the owner first

Deploys (Pages preview included the first time; **never production** until the owner confirms),
Worker deploys, R2 uploads/deletes, bucket or token changes, pushing, opening PRs, creating repos.
Always pass `--project-name astro-night-planning-live` / `--config worker/wrangler.jsonc`: the
Cloudflare account also hosts the owner's main website — never touch anything else in it.

## Commands

| Task               | Command                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| Dev server         | `npm run dev` (http://localhost:5173, no Worker unless `.env` sets `VITE_DATA_BASE`) |
| Production preview | `npm run build && npx vite preview --port 4173` (uses the real Worker)               |
| Type-check         | `npm run check`                                                                      |
| Lint / format      | `npm run lint`, `npm run format:check`                                               |
| Unit tests         | `npm test` (Vitest, `tests/**/*.test.ts`)                                            |
| Data budget        | `npm run check:budget` (added in Phase 1; must pass before every commit)             |
| Everything CI runs | `npm run ci`                                                                         |
| Worker type-check  | `npm run worker:check`; local Worker: `npm run worker:dev`                           |
| Engine rebuild     | see `engine/README.md` (emcc direct, emsdk 1.39.17; patches in `engine/patches/`)    |

Phase gate (every phase): check + lint + tests + build + `check:budget` pass; browser screenshots
at 390, 768 and 1440 px reviewed; zero console errors; PROGRESS.md updated; one commit per phase on
branch `redesign`.

## Conventions

- Svelte 5 runes + strict TypeScript. Pure logic in `src/lib/**` with Vitest tests; components in
  `src/components/`. Heavy computation (target ranking, search index, passes) in Web Workers.
- Keep the engine handle in `$state.raw` (a deep proxy caches stale WASM heaps). Never portal a
  component's top-level node. Start `LiveSource`s in `onMount`, not inside `$effect`.
- All nested CSS grids need `grid-template-columns: minmax(0, 1fr)` (phones overflow otherwise).
- Design tokens live in `src/styles/tokens.css` (see DESIGN.md); components use tokens only, never
  raw hex. Night mode must produce pixels with G = B = 0, the sky canvas included.
- Every fetch goes through `src/lib/data/cache.ts` (in-flight dedupe + device cache + stale
  fallback). New Worker routes need a strict allow-list in `worker/src/routes.ts` and a test.
- Rebuilt R2 layers get a new route name (tiles are immutable and 404s are cached).
- Data shown to users carries its source and freshness stamp.
- Docs: PLAN.md (IA and phases), DESIGN.md (tokens), DECISIONS.md (every non-obvious choice),
  PROGRESS.md (phase log with evidence), DATA_BUDGET.md (bytes, files, R2 and Worker projections),
  docs/RESEARCH.md, docs/ACCURACY.md, docs/methods.md.
- Commit messages end with the Co-Authored-By line from the session instructions.
