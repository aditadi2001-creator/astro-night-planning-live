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
- Two superseded R2 layers (~0.25 GB) can be deleted with the owner's OK (D12).

## Phase 1 — foundations ⏳

## Phase 2 — data and search ⏳

## Phase 3 — Plan page ⏳

## Phase 4 — Sky Explorer ⏳

## Phase 5 — FOV frame and telescope ⏳

## Phase 6 — polish ⏳
