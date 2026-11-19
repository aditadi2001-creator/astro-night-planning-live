# Research (Phase 0, 2026-11-19)

Web research done for this redesign. Facts carry their source; anything that could not be
confirmed from a primary source is marked **unverified**.

## 1. What the best tools do best

| Product                                                                                                                                                                                                 | Best at                                                | Pattern to borrow                                                                                                                                                                                                        | Weakness                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **NINA Sky Atlas + Framing** ([atlas](https://nighttime-imaging.eu/docs/master/site/tabs/skyatlas/), [framing](https://nighttime-imaging.eu/docs/master/site/tabs/framing/))                            | Expert target selection and framing                    | Filter by "visible from–to for at least N hours"; altitude chart with Now line, nautical/astro darkness and custom horizon; one-click Send to Framing/Sequencer/Mount; N×M mosaics with overlap and "preserve alignment" | Windows desktop only; no Moon data per object                           |
| **Stellarium Web** ([engine](https://github.com/Stellarium/stellarium-web-engine))                                                                                                                      | The real-sky feel (WebGL/WASM, Gaia, HiPS, atmosphere) | Smooth navigation, surveys under the stars                                                                                                                                                                               | Almost no planning (no filters, FOV, exports) — unverified feature list |
| **Telescopius** ([NINA import of its CSV](https://nighttime-imaging.eu/downloads/Setup/Releases/1.10.1.9001/index.html))                                                                                | Web target finder for imagers                          | Filters incl. min altitude for a duration and Moon distance; lists sorted by transit; mosaic planner; CSV that NINA and ASIAIR import                                                                                    | One catalogue filter at a time; no weather link (unverified)            |
| **Astrospheric** ([site](https://www.astrospheric.com/))                                                                                                                                                | Astronomy weather presentation                         | Cloud/transparency/seeing as the top three hourly rows; Sun/Moon lines on the grid; smoke in transparency; model ensemble                                                                                                | North-American models; key features paid                                |
| **Clear Outside** ([site](https://clearoutside.com/))                                                                                                                                                   | At-a-glance free forecast                              | 7-day hourly grid with red/amber/green per hour; low/mid/high cloud; darkness bands; ISS row; Bortle/SQM estimate                                                                                                        | No seeing/transparency, no targets                                      |
| **Heavens-Above** ([site](https://www.heavens-above.com/))                                                                                                                                              | Satellites                                             | 10-day ISS passes, bright satellites, Starlink trains                                                                                                                                                                    | Dated UI                                                                |
| **SkySafari 7 Pro** ([review](https://space.com/sky-safari-7-pro-app-review), [control](https://skysafariastronomy.com/skysafari-7-professional-astronomy-telescope-control-software-for-android.html)) | Mobile planetarium + control                           | "Tonight" panel, Tonight's Best, Events Finder, native INDI/Alpaca                                                                                                                                                       | Paid, visual-observing oriented                                         |
| **ESASky** ([interface](https://cosmos.esa.int/web/esdc/esasky-interface))                                                                                                                              | Multi-wavelength exploration                           | Skies grouped by wavelength with opacity/stretch per layer; bookmark URL keeps target, sky, FOV; step through an uploaded target list                                                                                    | No observing context                                                    |
| KStars Imaging Planner ([docs](https://kstars-docs.kde.org/en/user_manual/tool-imaging-planner.html))                                                                                                   | Planning UX                                            | Picked / Imaged / Ignored flags, Min Hours filter, altitude graph with a thick green "constraints met" band and Moon hatching, notes per object                                                                          | Desktop app                                                             |
| Meteoblue Astronomy Seeing ([help](https://content.meteoblue.com/en/private-customers/website-help/outdoor-and-sports/astronomy-seeing))                                                                | Free global seeing                                     | Jet-stream speed and "bad layers"; covers India                                                                                                                                                                          | 3 days free                                                             |
| PhotoPills ([AR article](https://photopills.com/articles/how-to-plan-the-milky-way-using-the-augmented-reality))                                                                                        | Nightscape planning                                    | Night AR with Milky Way/core path, swipe through time                                                                                                                                                                    | Paid app                                                                |

## 2. Fifteen improvements, ranked by impact ÷ effort

| #   | Improvement                                                                                                                         | Impact | Effort | Build?                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | :----: | :----: | ----------------------------------------------------------------------------------------------- |
| 1   | "Why not tonight?" / "Why this score?" plain-English explanations                                                                   |   H    |   S    | **Yes** (Phase 3)                                                                               |
| 2   | Imaging-window band on every altitude chart (constraints met, Moon hatching, twilight, custom horizon)                              |   H    |   S    | **Yes** (Phase 3)                                                                               |
| 3   | Filter-aware Moon avoidance using the owner's filters (Hα/OIII/SII tolerate the Moon; L-Pro/RGB don't; Bortle 9 favours narrowband) |   H    |   S    | **Yes** (Phase 3)                                                                               |
| 4   | Shareable plan links (target, time, place preset, profile, layers in the URL)                                                       |   H    |   S    | **Yes** (Phase 1 URL state)                                                                     |
| 5   | NINA / Target Scheduler CSV export (+ mosaic panes)                                                                                 |   H    |   S    | **Yes** (Phase 3)                                                                               |
| 6   | Custom horizon (import .hrz/CSV/JSON, draw, phone survey with azimuth calibration) driving all visibility                           |   H    |   M    | **Yes** (Phase 4)                                                                               |
| 7   | Calendar `.ics` export of dark window and target windows                                                                            |   M    |   S    | **Yes** (Phase 3)                                                                               |
| 8   | Ensemble uncertainty band (spread of the eight cloud models already fetched)                                                        |   H    |   M    | **Yes** (Phase 3; extends the model-agreement indicator)                                        |
| 9   | Offline-first PWA for dark sites, 150 MB LRU cap, "Prepare for Hanle" pack                                                          |   H    |   M    | **Yes** (Phase 6)                                                                               |
| 10  | Multi-night campaign view (hours gathered per target/filter, best remaining nights)                                                 |   H    |   M    | **Partly**: per-target "next good nights" in Phase 3; full campaign log after the observing log |
| 11  | Integration-time estimate (SNR from site SQM, filter bandwidth, aperture, pixel scale, SB)                                          |   M    |   M    | Stretch (Phase 3 if time allows)                                                                |
| 12  | Observing log with Picked / Imaged / Ignored flags and notes                                                                        |   M    |   S    | **Yes** (Phase 3, local)                                                                        |
| 13  | SQM/Bortle calibration (measured vs model per site)                                                                                 |   M    |   M    | **Yes** (Phase 1 data model, Phase 3 UI)                                                        |
| 14  | Mosaic + meridian-flip planner (N×M, overlap, flip time, pier side)                                                                 |   M    |   M    | **Yes** (Phase 5)                                                                               |
| 15  | Satellite-trail risk through the planned FOV                                                                                        |   M    |   L    | No (later)                                                                                      |

Chosen beyond the brief: #1, #2, #3, #8 and #12 are cheap, high-trust features no free web tool
combines; they are folded into Phase 3.

## 3. Telescope connectivity

### NINA Advanced API (christian-photo/ninaAPI)

- Stable **2.2.15.3** (2026-11-07); v3 beta 3.0.0.5. The bump.sh link in the brief returns 404;
  current docs: https://christian-photo.github.io/github-page/projects/ninaAPI/v2/doc/api, spec
  `ninaAPI/api_spec.yaml` ([releases](https://api.github.com/repos/christian-photo/ninaAPI/releases)).
- Default port **1888**, base `http://<host>:1888/v2/api`, plain HTTP, binds all interfaces.
  WebSockets `/v2/socket` (events such as `MOUNT-CONNECTED`, `MOUNT-PARKED`, `MOUNT-AFTER-FLIP`,
  `ROTATOR-MOVED`, `SEQUENCE-STARTING`).
- Envelope `{Response, Error, StatusCode, Success, Type}`.
- `GET /equipment/mount/info` → `Connected`, `RightAscension` (h), `Declination` (°),
  `Coordinates{RA, Dec, Epoch: JNOW|J2000|…}`, `Altitude`, `Azimuth`, `SideOfPier`
  (`pierEast|pierWest|pierUnknown`), `TrackingEnabled`, `Slewing`, `AtPark`, `AtHome`,
  `SiderealTime` (h), `TimeToMeridianFlip` (hours — **unverified unit**), site lat/lon/elevation.
  RA/Dec are in the mount's own system (usually JNOW).
- Also `GET /equipment/camera/info`, `/equipment/rotator/info` (`Position`, `MechanicalPosition`),
  `/framing/info`, `/profile/horizon` (`{Altitudes[], Azimuths[]}`), `/equipment/info` (all, since
  2.2.15.0).
- CORS: `UseAccessControlHeader` default **true** → `Access-Control-Allow-Origin: *`.
- **No auth in v2**, and **slew, sync, park, flip, tracking, connect are all GET** — read-only
  needs a path allow-list. `/profile/show` exposes stored API keys: never call it, and warn users
  never to expose port 1888 to the internet.
- v3 (beta): `/v3/api`, actions become POST, optional HTTPS and Basic auth.

### ASCOM Alpaca ([device API](https://ascom-standards.org/api/AlpacaDeviceAPI_v1.yaml), [management API](https://ascom-standards.org/api/AlpacaManagementAPI_v1.yaml))

- `GET /api/v1/telescope/{n}/{rightascension|declination|altitude|azimuth|sideofpier|tracking|slewing|atpark|siderealtime|equatorialsystem|connected|devicestate}`
  with optional `ClientID`, `ClientTransactionID`. Response `{Value, ErrorNumber, ErrorMessage,
…}`; HTTP 200 is not success unless `ErrorNumber` = 0.
- `sideofpier` 0 East / 1 West / −1 unknown; `equatorialsystem` 1 = topocentric (JNow), 2 = J2000.
- Discovery is UDP 32227 (impossible from a browser) → manual host:port.
- ASCOM Remote Server: port 11111, HTTP, **CORS off by default** (can be enabled, origins `*`).

### Browsers

- Chrome **142+** (desktop and Android): Local Network Access permission prompt for public HTTPS
  → private IPs or loopback ([Chrome blog](https://developer.chrome.com/blog/local-network-access)).
  Requests known to be local (private IP literal, `.local`, or `fetch(..., {targetAddressSpace:
'local'})`) are exempt from mixed-content blocking after the prompt.
- Firefox ~151+: LNA prompts; mixed-content exemption for LAN IPs **unverified** (assume blocked).
- Safari/iOS (all iOS browsers): no documented exemption; `http://192.168.x` from HTTPS is blocked
  as mixed content (**unverified by test**).
- `*.pages.dev` is HSTS-preloaded, so the site can't be loaded over plain HTTP.
- **Chosen fix (D8):** direct fetch with `targetAddressSpace: 'local'` for Chromium browsers; a
  tiny same-origin bridge on the mini PC for Safari/iOS/Firefox; simulator for everything else.

### NINA import/export formats

- NINA sequencer "Import targets": headers lowercased/trimmed; observing list `Familiar Name`,
  `Catalogue Entry`, `Right Ascension (J2000)`, `Declination (J2000)`, optional
  `Position Angle (East)` (3.2+; 3.1 reads `Right Ascension`/`Declination`); mosaic panes
  `Pane, RA, DEC, Position Angle (East)`. Source: NINA `SimpleSequenceVM.cs`.
- Target Scheduler 5.11 CSV: its own `Type, Name, Ra, Dec, Rotation, ROI` or the Telescopius
  columns ([docs](https://tcpalmer.github.io/nina-scheduler/target-management/targets.html)).
- Framing Assistant: no list import found (unverified).
- Horizon text (NINA `CustomHorizon.cs`): `az alt` per line in degrees, separators tab/space/comma/
  semicolon, `#` comments, ≥ 2 points, sorted and 0°/360° filled by the parser, linear
  interpolation.
- Telescopius changed its CSV headers in late 2024 ([forum](https://forum.telescopius.com/t/machine-readable-observation-plan-export/1793));
  exact current headers unverified.

## 4. Catalogs, surveys and licenses

_Filled in from the catalog/survey license research (see below)._
