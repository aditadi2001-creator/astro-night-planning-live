# Astro Night Planning — live sky

A free, open-source website for astrophotographers. It shows a realistic 3D view of the sky from
your exact location right now, together with live observing conditions: clouds, seeing,
transparency, haze, light pollution, the Moon and darkness times.

- **$0 to build, host and use.** No ads, no paid APIs, no paid features. Non-commercial.
- **Real data, published physics.** Every visual effect comes from measured or forecast data and a
  cited formula. See [docs/methods.md](docs/methods.md).
- **Honest about limits.** Seeing and transparency are forecasts, light pollution is yearly, and
  satellite night lights underestimate LED light.
- **License: [AGPL-3.0](LICENSE)**, required by Stellarium Web Engine.

> Status: **Phase 2 of 11 done** (3D sky with self-hosted catalogs and time controls). See
> [Roadmap](#roadmap).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run ci         # type check, lint, format check, tests, build
```

Requirements: Node 20+. Building the sky engine additionally needs Emscripten; see
[engine/README.md](engine/README.md).

## Architecture

```
Browser (Svelte + TypeScript, PWA)
 ├─ Stellarium Web Engine (WebAssembly)   3D sky, stars, planets, constellations
 ├─ astronomy-engine                      Sun/Moon/planets, twilight, rise/set
 ├─ physics/*                             refraction, airmass, extinction, sky brightness …
 ├─ Open-Meteo (direct, no key)           weather, clouds, upper winds, air quality
 ├─ NASA GIBS (direct, no key)            10-minute infrared satellite tiles
 └─ Cloudflare Worker  ──►  R2 bucket      light pollution PMTiles, star catalogs,
                         └►  7Timer proxy   hourly GMGSI cloud PMTiles
GitHub Actions (public repo, free)
 ├─ CI on every push
 ├─ engine build (emsdk on Linux)
 ├─ hourly GMGSI → PMTiles → R2         (later phase)
 └─ yearly light-pollution pipeline     (later phase)
Cloudflare Pages (free)                  static site, deployed with
                                         wrangler pages deploy --project-name astro-night-planning-live
```

| Folder             | Contents                                             |
| ------------------ | ---------------------------------------------------- |
| `src/lib/physics/` | Pure physics formulas, each with unit tests          |
| `src/lib/astro/`   | Positions and Moon data (astronomy-engine wrappers)  |
| `src/components/`  | UI components                                        |
| `src/pages/`       | Credits and About pages                              |
| `engine/`          | Stellarium Web Engine build script and version pins  |
| `tests/`           | Vitest unit tests against published reference values |
| `docs/`            | Method write-ups                                     |

## Data sources

The full list with exact attributions is in [`src/lib/credits.ts`](src/lib/credits.ts) and on the
site's Credits page. Only openly licensed sources that need no permission request are used.

## Methods

See [docs/methods.md](docs/methods.md). Implemented so far: Kasten–Young airmass, Bennett and
Saemundsson refraction with live temperature and pressure correction, a patched engine refraction,
position cross-checks against Astronomy Engine and JPL Horizons, and darkness times.

## Cloudflare R2: cost rules

R2 is the only service with a payment method on file, so the design stays **well under half** of
the free tier and has a hard cap:

| Free tier (per month) | Our hard limit                                  |
| --------------------- | ----------------------------------------------- |
| 10 GB storage         | 5 GB target, **jobs refuse uploads above 8 GB** |
| 1 M Class A ops       | ~1–2 k/month expected (one upload per hour)     |
| 10 M Class B ops      | capped far lower by the free Worker's 100 k/day |

The detailed monthly estimate with calculations is added in Phase 5, when the bucket and Worker
exist.

### Checking that R2 is enabled and how much it is used

1. Cloudflare dashboard → **Storage & Databases → R2 Object Storage** (older dashboards: **R2** in
   the sidebar). If you see a "Purchase R2 / Add R2 subscription" screen, R2 is not enabled yet.
   Enabling it is a $0 subscription; you are only billed above the free tier.
2. The R2 **Overview** page shows total storage and Class A / Class B operations for the month.
3. **Manage Account → Billing → Billable usage** shows anything that would be charged. It should
   always read $0.00.
4. Usage alerts: **Notifications → Add** and look for a usage-based billing alert. Phase 5 will
   confirm the exact option name in your dashboard.

## Roadmap

1. ✅ Setup, CI, license, trial build of Stellarium Web Engine
2. ✅ 3D sky with self-hosted catalogs, time controls
3. Live conditions (Open-Meteo weather + air quality), condition cards, tonight timeline
4. Realism layer: extinction, sky brightness, limiting magnitude, clouds, Moon, terrain horizon
5. R2 bucket + Worker (range requests, caching, CORS, 7Timer proxy) — needs your OK
6. Satellite clouds (GIBS map, GMGSI hourly PMTiles)
7. Seeing model + 7Timer second opinion
8. Light pollution pipeline (Black Marble → sky glow → PMTiles)
9. Optional HiPS sky surveys
10. PWA, night-vision mode, ISS passes, aurora, polish, accessibility, speed
11. Deploy to Cloudflare Pages — needs your OK

## Known limits

- Seeing and transparency are forecasts; nothing free measures live seeing.
- Light pollution is modelled from yearly satellite data and underestimates LED light.
- Satellite cloud images are 10 minutes (GIBS) to 2–3 hours (GMGSI) old.

## License

Copyright (C) 2026 the Astro Night Planning contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [LICENSE](LICENSE).
