# Stellarium Web Engine build

The 3D sky is drawn by [Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine)
(SWE, AGPL-3.0), compiled from C to WebAssembly with Emscripten.

| Pin                | File            | Value                                              |
| ------------------ | --------------- | -------------------------------------------------- |
| Upstream commit    | `SWE_COMMIT`    | see file                                           |
| Emscripten (emsdk) | `EMSDK_VERSION` | `1.39.17` (the version upstream's Dockerfile uses) |

## Why not SCons?

Upstream builds with `make js` → SCons. On Windows, SCons picks MSVC-style flags (`/Fo`, `/I`) and
strips `PATH`, so emcc cannot run. `build-engine.mjs` reproduces the upstream `SConstruct` (release
mode, ES6 module output) by calling `emcc` directly. It runs the same way on Linux CI, Windows and
macOS.

## Build locally

```bash
git clone https://github.com/Stellarium/stellarium-web-engine.git /path/to/swe
git -C /path/to/swe checkout "$(cat engine/SWE_COMMIT)"
git clone https://github.com/emscripten-core/emsdk.git /path/to/emsdk
/path/to/emsdk/emsdk install 1.39.17 && /path/to/emsdk/emsdk activate 1.39.17
source /path/to/emsdk/emsdk_env.sh        # Windows PowerShell: emsdk_env.ps1
node engine/build-engine.mjs /path/to/swe public/engine
```

Output: `public/engine/stellarium-web-engine.js` (~100 KiB) and `.wasm` (~1.2 MiB, ~0.4 MiB
gzipped). A clean build takes about 20 seconds on an 8-core machine.

In CI, `.github/workflows/engine.yml` does the same on Ubuntu and uploads the two files as a build
artifact.

## Integration notes (found in the trial build)

- Call `stel.setFont()` only after the first frame has rendered (two `requestAnimationFrame`s after
  `onReady`). Calling it inside `onReady` crashes with "memory access out of bounds" because the
  renderer does not exist yet.
- With `USE_ES6_IMPORT_META=0` the page must pass `wasmFile` explicitly.
- Star, DSO, Milky Way and planet data are HiPS-style tile folders (`properties` + `Norder*/Dir*/`).
  Star tiles use SWE's binary `eph` format (`src/eph-file.c`). Our own catalogs (Gaia DR3 subset,
  Hipparcos, OpenNGC) are converted to this format by a pipeline; we never load data from
  Stellarium's servers.
- `constellations.show_only_pointed` defaults to `true` (only the constellation at the view centre
  is drawn); we set it to `false`.

## Patches (`engine/patches/`)

`build-engine.mjs` applies every `*.patch` in this folder (skipping ones already applied).

| Patch                                 | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-refraction-rotate-vector.patch` | Upstream raised only the vector's z component to the refracted altitude and then renormalised, which shrinks refraction by cos²(alt): at 42° only 0.66′ of the correct 1.10′ was applied, at 60° only 0.17′ of 0.58′. The patch rotates the vector in the vertical plane, and adds Meeus's zenith term in arcmin (upstream added 0.0019279 **degrees**). Verified in the browser: the engine now matches `src/lib/physics/refraction.ts` to 0.0001′ from 0° to 89°. |

### `0002-live-atmosphere-extinction-skylayers.patch`

Adds what the realism layer needs, all settable from JavaScript (`src/lib/engine/stel.ts`):

| Core property                                   | Effect                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `refraction_pressure`, `refraction_temperature` | Live station pressure and air temperature for refraction (upstream: pressure from elevation, fixed 15 °C).                                                                                                         |
| `extinction_k`                                  | V-band zenith extinction. Every star and planet (Sun and Moon included) is dimmed by k·X, X from Kasten–Young (1989); the engine's Schaefer sky-brightness model uses the same k instead of its built-in estimate. |
| `extinction_dbv`                                | B−V colour excess per airmass: stars redden toward the horizon.                                                                                                                                                    |
| `visual_limit_mag`                              | Naked-eye threshold of the sky background. Stars fainter than it (after extinction and the engine's own telescope gain when zoomed) are hidden, with a 0.6 mag fade.                                               |

New module `src/modules/skylayers.c` with two alt–az RGBA texture layers filled from JS:
`skyclouds` (render order 36, after stars/planets/atmosphere) and `skyterrain` (41, after
everything else, allowed below the horizon). Exported functions: `skylayers_set`,
`skylayers_win_to_altaz` (cursor → alt/az), `skylayers_stat` (debug counters).

Two engine behaviours the module works around:

- `paint_quad` does not split quads at the projection discontinuity behind the viewer, so cells
  outside the viewport are skipped with `painter_is_cap_clipped` (otherwise one cell can smear over
  the whole screen).
- The OBSERVED frame is left-handed; quads must be wound with azimuth decreasing across a cell or
  they are back-face culled. The texture matrix mirrors u to match.

## License

SWE is AGPL-3.0. Because this site links it into a network service, the whole site is AGPL-3.0 and
its complete source, including this build script, is public.
