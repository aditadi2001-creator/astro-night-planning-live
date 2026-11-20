# Astro Night Planning: the complete guide

A free, open-source planner for astronomers and astrophotographers: tonight's conditions, the best
targets, a live 3D sky you can move through time, your camera's field of view on that sky, and
control of your telescope mount. It runs in any modern browser on a computer or phone. Nothing to
install, no account, no adverts.

Contents: [1 The screen](#1-the-screen) · [2 Plan page](#2-the-plan-page) ·
[3 Sky page](#3-the-sky-page) · [4 Search](#4-search) · [5 Camera frame](#5-the-camera-frame) ·
[6 Telescope and mount control](#6-telescope-and-mount-control) ·
[7 Beginner and Expert](#7-beginner-and-expert) · [8 Night mode, offline, your data](#8-night-mode-offline-and-your-data) ·
[9 Where the numbers come from](#9-where-the-numbers-come-from) · [10 Why it is free](#10-why-it-is-free-for-you-and-everyone) ·
[11 Troubleshooting](#11-troubleshooting)

---

## 1. The screen

**Header (top bar), left to right**

| Control                                                        | What it does                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Place** (e.g. "Greenwich", with its local time)              | Opens the place picker: search any town or observatory, use your phone's GPS, type coordinates, pick a built-in observatory (Greenwich, Mauna Kea, La Palma, Paranal) or one of your saved places, save the current one, or _Save for offline_ (section 8). Every forecast, the sky and the planners follow the place. |
| **Equipment profile** (e.g. "80 mm f/6 refractor · ASI2600MC") | Your telescope + camera combination. It sets the camera frame on the sky, the pixel scale, which targets fit, and imaging advice. Four starter rigs are built in; enter your own telescope and camera in Plan → Telescope and it appears here as **My setup**.                                                         |
| **Search** (Ctrl K / ⌘ K)                                      | Finds anything: section 4.                                                                                                                                                                                                                                                                                             |
| **Beginner / Expert**                                          | How much detail is shown: section 7.                                                                                                                                                                                                                                                                                   |
| **?**                                                          | Help: a one-minute guided tour, the keyboard keys and a glossary of 38 terms.                                                                                                                                                                                                                                          |
| **Night**                                                      | Red-only night mode for your dark adaptation: section 8.                                                                                                                                                                                                                                                               |
| **Plan / Sky**                                                 | The two pages.                                                                                                                                                                                                                                                                                                         |

**Night ribbon** (the strip under the header): tonight from sunset to sunrise. Blue shades are
twilight, black is astronomical darkness, the bright band is the Moon, and the gold line marks the
shown time. Drag it (or use the arrow keys on it) to look at any moment tonight; **Now** returns to
the live time. Everything (forecast cards, sky, targets) follows the shown time.

---

## 2. The Plan page

The side index (left on a computer, tabs on top on a phone) jumps between sections; links like
`#/plan?s=trips` open a section directly.

### Tonight at a glance

- **Verdict**: _Go_, _Marginal_ or _No-go_, with the best hour and its score out of 100. Go means at
  least 3 dark hours scoring 40 or more.
- **Facts**: darkness (astronomical night), best hour, Moon (illumination, rise and set), clouds
  during darkness, seeing, transparency, dew risk and sky brightness (SQM, Bortle).
- **Reasons**: plain sentences explaining the verdict (cloud timing, Moon, seeing, haze, dew, model
  disagreement).
- **Data status**: how fresh each source is (weather, models, air quality, cloud field, satellite,
  7Timer!, light pollution, Kp index, orbits). "Loads when its section is opened" means that source is
  only fetched when you scroll to the part that uses it, which saves requests.

### Hourly timeline

One column per hour, from the last 3 hours to sunrise. Tap a column to show that hour everywhere.

- **Score** (0–100): clouds × transparency × Moon × darkness × seeing, as the signal-to-noise an
  imager would get.
- **Clouds**: the median of six global weather models (ECMWF, GFS, ICON, JMA, Météo-France, UK Met
  Office). For the next few hours it is corrected by the latest satellite image (_sat._); past hours
  show what the satellite recorded (_rec._).
- **Seeing** (arcseconds): a forecast estimate from upper-air winds and the local ground layer,
  calibrated on real nights (about 2–3″ for central Bangalore).
- **Moon**: its altitude, or "down".
- **Expert only**: low, mid and high (thin) cloud, the lowest–highest range across all 8 models,
  transparency (extinction in magnitudes per airmass), the 7Timer! seeing class, and model agreement
  (green agree, amber partly, red disagree).

### Condition cards

Clouds (forecast and satellite now), transparency (aerosols from CAMS), seeing, sky quality
(SQM/Bortle from our light-pollution model, natural sky glow and airglow), air quality (measured by
government monitors via OpenAQ, blended by distance; CAMS model for later hours), temperature and dew,
wind, Moon and darkness. Each card names its source and says "n/a" when a value is unknown.

### Targets (best tonight)

The whole catalog (about 25,000 objects with sizes and magnitudes) ranked for your site, time,
profile and sky: altitude during darkness, size against your frame, surface brightness against your
sky glow, Moon distance, and your custom horizon. Tabs by type, presets (_Moon-proof_ narrowband
targets, _Beginner-friendly_, _Fits my frame_, _Narrowband tonight_), filters, the reason behind each score,
and filter advice for your camera. Add targets to **Tonight's plan** and export it for NINA (CSV),
as JSON or to a calendar.

### Planets, Sun and Moon

For each planet: when it is best tonight, size, brightness, phase, distance, rise, transit and set;
Jupiter's moons and Saturn's ring tilt; capture tips for your planetary profile. The Moon: phase,
age, libration, next phases and features on the terminator. The Sun: live NOAA space weather with the
solar-filter safety warning.

### Week ahead

Cloud outlook for the next seven nights from the forecast models (forecasts beyond about 3 days are
rough).

### Trips (months and years ahead)

Every night of any year from last year to 15 years ahead, as month calendars. Each day is shaded by
its moonless dark hours (or, with a target chosen, the hours that target is above your chosen
altitude in moonless darkness); ● new Moon, ○ full Moon. Each month shows how often its nights were
**clear over the last ten years** at the place (ERA5 history: history, not a forecast). _Best nights
for a trip_ ranks nights by usable hours × that month's clear-night chance. _Events_ lists new and
full Moons, eclipses visible from the place (with the solar-filter warning), planet oppositions and
meteor-shower peaks. Tap a night for its details and _Show this night_.

### Telescope (equipment)

Your equipment: telescope (aperture, focal length, reducer/Barlow), camera (sensor, pixels),
filters. The app works out the field of view, pixel scale, sampling and f-ratio. As soon as you
change the deep-sky telescope or camera, the header calls it **My setup**; you can try a starter
rig and switch back to My setup without losing it.

### Space

Aurora chance (NOAA OVATION, only shown 40°+ from the equator), the Kp index, and satellite passes
over the place (orbits from CelesTrak, refreshed every 6 hours).

### Maps

- **Light pollution**: our own yearly model from NASA Black Marble night lights, calibrated on
  Globe at Night readings, coloured like the Bortle scale; a 10-year history player.
- **Clouds**: a live cloud map, and the satellite infrared map (NOAA GMGSI hourly, GOES and Himawari
  every 10 minutes) with an animation of the last 2.5 hours.

### About

Methods, accuracy checks, data sources and credits, licences (the 3D sky is the AGPL Stellarium Web
Engine; the app's own source is public).

---

## 3. The Sky page

A real-time 3D sky for your place: stars to magnitude 16, planets, deep-sky objects, the Milky Way,
the real horizon from terrain data, live clouds and haze.

**Moving around**: drag to look around; scroll, pinch or +/− to zoom; tap an object to select it;
double-click to centre it. Keys follow Stellarium (F1 lists them all).

### Always on screen

- **Search** and **Tonight's best** (top left).
- **Quick switches** (left edge): **Frame** (your camera frame), **Survey** (a real sky photograph
  under the stars), **Lines** (constellation figures), **Grid** (RA/Dec grid), **EQ view** (the sky
  turns about the celestial pole, as an equatorial mount sees it), **Meridian** (where objects are
  highest and mounts flip), **Ground**, **Air** (atmosphere/daylight) and **Full screen** (on iPhone
  the sky covers the page, since Safari has no full-screen mode).
- **Timeline** (bottom): pick a step (minute, hour, day, week, month, year, decade, century), then
  −1 / +1, play backwards ◀◀ or forwards ▶▶ (one step per second), drag the slider (up to 50 steps
  either way, finer near the middle), or tap the date to type any date and time. **Now** returns to
  the live sky. Example: step "year", ▶▶ watches the planets move year by year; step "century", −1
  five times shows the sky of the 1500s.
- **Mount** (bottom right): _Connect mount_; once connected, what the mount is doing, how far it is
  from the selected object and **Stop**.
- **Panels** (right on a computer, bottom on a phone): Targets, Info, Layers, Telescope, Horizon,
  Time, More. An open panel never covers the sky: the sky shrinks beside it (or above it on a phone),
  so the frame and the selected object stay visible.

### Panels

- **Targets**: tonight's best list (as on the Plan page); tap one to frame it.
- **Info**: everything about the selected object: what it is (Wikipedia, SIMBAD), designations,
  position now, rise/transit/set and an altitude chart for tonight, size, magnitude, surface
  brightness, distance, how it fits your camera, imaging strategy, notes, and **survey images**: the
  four surveys it looks best in (chosen by object type, size and sky coverage) with one-tap _Show in
  the sky_, plus _More surveys_ to preview any of the 36.
- **Layers**: presets (Simple, Imager, Survey, Full), every display switch, physical layers (live
  clouds, light pollution, haze and extinction, real terrain, long exposure, deep-sky photos) and the
  survey picker (36 surveys from gamma rays to radio, streamed from public servers).
- **Telescope**: mount connection and control (section 6) and the camera frame (rotation, align to
  the object, mosaics and their NINA export).
- **Horizon**: the foreground drawn in the sky (looks only) and your **custom horizon** (used by all
  planning): import NINA .hrz, CSV or JSON, draw points, trace a 360° panorama, or survey the skyline
  with your phone's compass and tilt sensors.
- **Time**: date and time controls with steps from a minute to a year, play speeds and tonight's
  events.
- **More**: place, display settings, Sun and planet calculations, full screen, the phone camera view
  (point your phone at the sky to find objects), and the keyboard keys.

### Notes on the sky

- An object **below the horizon** gets a note with when it is best tonight, **Show it then** and
  **See through the ground**.
- The field of view starts at **120°**, about what both human eyes see at once, and returns there
  when you close the camera frame.

---

## 4. Search

Ctrl K (⌘ K), or the magnifier. It finds:

- **Deep-sky objects** from 30 catalogs, about 96,000 objects: Messier, Caldwell, Herschel 400,
  NGC, IC, Sharpless, Barnard, Lynds dark and bright nebulae, van den Bergh, RCW, Cederblad, Abell,
  planetary nebula catalogs (PN G, PK), supernova remnants, Arp, Hickson, VV, Collinder, Melotte,
  Trumpler, Stock, Ruprecht, DWB, PGC, UGC, ESO and more, by designation or common name ("m31",
  "sh2-129", "north america", "horsehead"), with one typo allowed.
- **Stars**: 8,924 bright and named stars (names, Bayer and Flamsteed letters, HD, HIP).
- **Planets**, the Sun and Moon; **constellations**; **84 notable objects** (quasars, doubles,
  variables, exoplanet hosts).
- **SDSS galaxies, installed in the app**: the 2.6 million SDSS DR17 galaxies with spectra that
  the 3D sky draws. Type **sdss** to list those around the view centre (brightest first, with r
  magnitude and redshift), then the famous SDSS objects; type a name, full ("SDSS
  J103843.59+484917.7") or short ("SDSS J1038+4849"); or a nickname: **smiley** / **Cheshire Cat**
  lens, **Hanny's Voorwerp**, **Cosmic Horseshoe**, **Teacup**, **Green Bean**, the five-image lensed
  quasar. SDSS covers about a third of the sky (Ursa Major, Leo, Virgo, Coma…), far from the Milky Way.
- **Anything else** (SDSS J…, 2MASS J…, Mrk, MCG, UGCA, HD…) is looked up in SIMBAD automatically.
- **Coordinates** ("10h45m −59°40′"), **catalogs** ("messier" lists all 110) and **sky surveys**.

Objects the 3D sky has no entry for (most Sharpless, Barnard, PGC, SDSS objects…) are pinned with a
gold marker and still get a full Info panel. Favourites (★ or Alt F) and recent searches stay on
your device.

---

## 5. The camera frame

The **Frame** switch draws your camera's field at true size on the sky (like Stellarium's Oculars
plugin), labelled with the telescope, camera, field, pixel scale, focal length, position angle and
mosaic. Controls (top right of the sky): sensor, eyepiece, Telrad or nightscape mode; the deep-sky,
planetary or lunar/solar setup; rotate (also [ and ]); _True PA_ to keep the frame aligned to
celestial north; binning; zoom to frame; details. In the Telescope panel: _Align to the object_
(turns the frame along a galaxy's long axis), mosaics (columns, rows, overlap) and _Export mosaic for
NINA_. Closing the frame zooms back to the 120° eye view.

---

## 6. Telescope and mount control

### Connecting

Open **Connect mount** (on the sky) or the Telescope panel and answer **What mount do you have?**:
ZWO AM3/AM5/AM7, Sky-Watcher, Celestron, Meade, OnStep, iOptron, 10Micron or any other. The app picks
the recommended way and shows the steps. The six ways:

| Way           | Talks to                                                                                   | Use when                                                            |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| NINA          | NINA's Advanced API plugin (port 1888)                                                     | You image with NINA: best GoTo (plate-solve centring) and sequences |
| ASCOM Alpaca  | ASCOM Remote (port 11111) or an Alpaca device                                              | Windows with your mount's ASCOM driver                              |
| INDI          | indiserver (Linux, Raspberry Pi, StellarMate, Astroberry, KStars/Ekos), via the bridge     | Linux / Pi setups: every INDI mount driver                          |
| USB cable     | The hand controller straight from the browser (Chrome/Edge on a computer)                  | A laptop at the mount, nothing installed                            |
| Network mount | Wi-Fi/Ethernet mounts speaking LX200 or NexStar (ZWO AM, OnStep, 10Micron), via the bridge | Wi-Fi mounts                                                        |
| Simulator     | A pretend mount                                                                            | Trying it all safely                                                |

**The bridge** (`node tools/bridge/bridge.mjs`, free, needs Node.js on a computer next to the
telescope) is needed for INDI and network mounts, because a web page cannot open those connections
itself, and for Safari/iPhone, which block secure pages from talking to `http://` devices. It answers
only this app's own web address, passes only allowed commands, and refuses any movement unless started
with `--allow-control`. Never forward its port to the internet.

### What you can do

- **Read only by default**: position (J2000 and of date), altitude/azimuth, hour angle, pier side,
  tracking, time to the meridian and NINA's flip countdown, time until it drops below your horizon,
  rotator angle, distance from the selected object; _Follow the telescope_ turns the sky with it.
- **Enable control** (off again every visit) unlocks GoTo, sync, stop, park/unpark and tracking.
  **Every action asks for confirmation.**
- **Safety checks before every GoTo**: refused within 15° of the Sun unless you confirm a certified
  full-aperture solar filter is fitted; refused below the horizon; warnings for targets behind your
  trees or buildings, under 15°, or about to cross the meridian.
- **With NINA**: _Slew and centre_ (NINA takes a frame, plate-solves and re-slews until the target is
  centred), _Centre and rotate_ to the frame's angle, _Set as the target_ of a container in the
  sequence open in NINA, load a saved sequence, send to the framing assistant. The app never starts a
  sequence by itself.
- **Not possible**: ZWO ASIAIR and closed smart telescopes (Seestar, Dwarf) have no way for other
  apps to control them.

---

## 7. Beginner and Expert

The same data, two levels of detail. **Beginner** (default) shows the essentials in plain words:
the verdict, score, clouds, seeing and Moon in the hourly table, four reasons, short descriptions.
**Expert** adds: cloud layers, the models' range, transparency, the 7Timer! second opinion and model
agreement rows; eight reasons; every catalog designation, proper motion and parallax in Info; extra
columns and timings in Targets and Planets; keyboard shortcuts in Layers; and the coordinates under
the pointer (alt/az and RA/Dec) in the sky's status line. A note says what changed when you switch.

---

## 8. Night mode, offline and your data

- **Night mode** turns the whole page, the 3D sky and photos red only (no green or blue at all), so
  your eyes stay dark-adapted.
- **Offline**: the site installs itself in the browser. _Save for offline_ (in the place picker)
  downloads the star maps, catalogs and horizons (about 30 MB). At a dark site without signal the sky,
  catalogs and planners work, and forecasts show their last copy with its age.
- **Your data stays on your device**: places, profiles, plans, notes, favourites, horizons,
  telescope settings. Nothing is uploaded; export and import as files.
- **First visit and coming back**: a new visitor starts at the Royal Observatory, Greenwich, with a
  starter rig, and is asked once where they observe from (GPS, a place, or keep Greenwich). Every
  choice (place, equipment, layers, Beginner/Expert, night mode, view settings) is remembered in
  that browser, so the site opens the same way next time. Another browser or device starts fresh;
  clearing the browser's site data resets it.

---

## 9. Where the numbers come from

Weather and clouds: Open-Meteo (ECMWF, GFS, ICON, JMA, Météo-France, UK Met Office, GEM, CMA).
Aerosols and model air quality: CAMS. Measured air quality: OpenAQ (government monitors). Satellite:
NOAA GMGSI, GOES, Himawari (NASA GIBS). Seeing: our model (Hufnagel–Valley, calibrated on real nights
at Kavalur, Sutherland, Devasthal and Hanle) with 7Timer! as a second opinion. Light pollution: our
model from NASA Black Marble, checked against 5,345 Globe at Night readings. Clear-night history:
ERA5. Space weather: NOAA SWPC. Orbits: CelesTrak. Catalogs: Stellarium DSO catalog, OpenNGC,
Hipparcos/Gaia, SIMBAD, VizieR. Surveys: CDS, ESA, IRSA, MAST, CASDA and other public HiPS servers.
Positions: Astronomy Engine and the Stellarium Web Engine. Methods and accuracy tests: About page,
`docs/methods.md`, `docs/ACCURACY.md`. Forecasts are forecasts: they can be wrong, and unknown values
show "n/a" with the source that lacks them.

---

## 10. Why it is free for you and everyone

- **Hosting**: Cloudflare Pages free plan (unlimited visitors and bandwidth for the site itself).
- **The data Worker** (deep stars, terrain, 7Timer!, light pollution, measured air quality,
  satellite tiles): uses only Cloudflare Workers **free-plan** features (no paid limits, no paid
  add-ons; confirm the account shows "Workers Free" under Workers & Pages → Plans). On the free plan
  the limit is 100,000 requests a day and going over is not billed: extra requests simply fail and
  those features show their last copy or "n/a". The site uses about 24 Worker requests per new
  visitor (fewer on return visits, thanks to caching).
- **Storage (R2)**: about 0.5 GB of our own tiles, far below the free 10 GB. R2 has no spending cap,
  so the limits are enforced by design: the pipeline that uploads refuses to go above 3 GB; nothing in
  the browser can write to R2; and every R2 read goes through the Worker, whose free limit of 100,000
  requests a day caps reads at about 3 million a month, under the free 10 million. A $0.01 budget alert
  is set on the account.
- **Everything else is called from each visitor's own browser, free and without keys**: Open-Meteo
  (free for non-commercial use, 10,000 calls a day per visitor), NOAA, NASA, CelesTrak, Wikipedia,
  SIMBAD, VizieR and the public survey servers. The only key (OpenAQ, free) lives in the Worker, never
  in the site.
- **No paid APIs, no accounts, no adverts, no tracking.** Updates are built and checked on GitHub for
  free (public repository).
- **If the site ever became commercial** (charging users or showing ads), Open-Meteo's terms would
  require their paid plan; as a free, open-source project it qualifies for free use.

---

## 11. Troubleshooting

| Problem                                     | What to do                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sky is blank or says it could not start | The 3D sky needs WebGL 2 (any recent Chrome, Edge, Firefox or Safari). Update the browser; the Plan page works regardless.                                                            |
| A searched object is not visible            | It may be below the horizon: the note offers _Show it then_ or _See through the ground_.                                                                                              |
| A survey shows nothing                      | Its servers may be down (the CDS mirrors often are) or it does not cover that part of the sky: try another in Info → Survey images.                                                   |
| "Unavailable" in the data status            | That service did not answer; the last copy is shown with its age. It retries by itself.                                                                                               |
| The mount does not connect                  | Follow the steps in "What mount do you have?"; Safari/iPhone need the bridge; check the computer's address and port and that the program (NINA, ASCOM Remote, indiserver) is running. |
| "Blocked: … allow-list"                     | Tick _Enable control_, and start the bridge with `--allow-control`.                                                                                                                   |
| The page looks old after an update          | Reload once: pages always check the network first.                                                                                                                                    |
