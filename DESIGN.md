# Design — "Atlas at the eyepiece"

## Subject, audience, job

- **Subject:** planning a night of astrophotography, from "is it worth setting up?" to "the scope
  is pointing at the target".
- **Audience:** an expert imager at a laptop or a phone beside the telescope, dark-adapted, often
  one-handed; and complete beginners who have never heard of airmass.
- **Primary job:** a confident decision in under ten seconds (go / marginal / no-go, and what to
  shoot), with every number one tap deeper.

## Art direction

The vernacular of this world is the **printed deep-sky atlas** (deep navy charts, white stars,
italic serif object labels, a small symbol per object type) and the **brass setting circles** of a
telescope mount. The app should feel like a modern atlas you can operate, not a weather dashboard
with a space background.

- **Navy, not black.** Pages sit on atlas navy. Pure black is reserved for night mode and the sky
  canvas.
- **Atlas symbols carry meaning.** Every object type has the symbol printed atlases use (ellipse =
  galaxy, square = bright nebula, dashed square = dark nebula, dotted circle = open cluster, circle
  with cross = globular, circle with four rays = planetary nebula, ring = remnant). Symbols appear
  in lists, search, the sky and charts, so type never depends on colour alone.
- **Object names are set like atlas labels**: italic serif. Everything else is a highly legible
  sans. That pairing is the typographic signature.
- **One bold element: the night ribbon.** A full-width band in the header from sunset to sunrise:
  twilight gradients, astronomical darkness, Moon-up bar, cloud cover as a translucent overlay, the
  best imaging window marked in brass, and a needle for the shown time. It is the time scrubber
  for both pages and the first thing a returning user reads. Everything around it stays quiet.
- **Brass is the only accent** (actions, the selected state, the best window). Status uses
  glyph + word + colour together.

What was rejected and why: a near-black page with one neon accent (generic), glassmorphism over a
star photo (illegible at night, and decoration), SaaS card grids with identical radii and shadows
(hides hierarchy), monospace data labels everywhere (template tell; we use tabular figures).

## Tokens

Defined once in `src/styles/tokens.css` as CSS custom properties; three themes swap values only.

### Colour — dark (default)

| Token         | Hex       | Use                                                                           |
| ------------- | --------- | ----------------------------------------------------------------------------- |
| `--ink-0`     | `#0B1430` | page (atlas navy)                                                             |
| `--ink-1`     | `#121E44` | raised surface (sections, dock)                                               |
| `--ink-2`     | `#1B2A5A` | hover / selected row / inputs                                                 |
| `--rule`      | `#2B3C72` | hairlines, chart grid                                                         |
| `--text`      | `#E7EBF6` | primary text (star white, 15.2:1 on ink-0)                                    |
| `--text-2`    | `#A3AECD` | secondary text (7.3:1 on ink-1)                                               |
| `--brass`     | `#E0AE4F` | the accent: primary buttons, focus ring, best window, needle (8.9:1 on ink-0) |
| `--brass-ink` | `#1A1300` | text on brass (9.1:1)                                                         |
| `--go`        | `#7ED9A8` | verdict "go" (always with ● glyph + word; 9.6:1 on ink-1)                     |
| `--maybe`     | `#E0AE4F` | verdict "marginal" (◐)                                                        |
| `--nogo`      | `#F08A7E` | verdict "no-go" (○; 6.7:1 on ink-1)                                           |
| `--sky`       | `#000000` | sky canvas background only                                                    |

Object types (atlas convention, checked for deuteranopia/protanopia with shapes as the primary
code): galaxy `#F29A8A`, bright/emission nebula `#7ED9A8`, reflection nebula `#8FB8F2`, dark
nebula `#8C93AD`, planetary `#9FD0F5`, open cluster `#EBCF6E`, globular `#F2B98A`, remnant
`#C9A6F0`, star `#E7EBF6`, planet `#E0AE4F`.

Charts: sequential = navy → brass (`#1B2A5A → #E0AE4F`), cloud cover = white at opacity (0 → 0.85)
on the ribbon; diverging (model agreement) = `#8FB8F2 ↔ #F29A8A`. Never red/green pairs alone.

### Colour — light (optional, "chart paper")

`--ink-0 #EDF0F7`, `--ink-1 #FFFFFF`, `--ink-2 #E1E6F2`, `--rule #C5CDE0`, `--text #111A35`,
`--text-2 #46527A` (6.7:1 on ink-0), `--brass #8E6210` (5.4:1 on white), `--go #1F7A4D` (5.3:1),
`--maybe #8E6210`, `--nogo #B03A2E` (6.0:1). The sky canvas stays black.

### Colour — night (red only)

Every token has G = B = 0. Pure red is dim to the eye, so only two red values reach AA text
contrast on black (#FF0000 = 5.25:1, #F00000 = 4.71:1; #D00000 is only 3.68:1). Hierarchy in night
mode therefore comes from size and weight, not from dimmer reds:
`--ink-0 #000000`, `--ink-1 #120000`, `--ink-2 #200000`, `--rule #600000` (decorative),
`--ui-line #C00000` (control borders and icons, 3.2:1), `--text #FF0000`, `--text-2 #F00000`,
`--brass #FF0000` (selected state shown by fill/underline, not hue), `--go/maybe/nogo` collapse to
`#F00000` (glyphs ● ◐ ○ carry the state), object types to `#F00000` (symbols carry the type).
The brightness slider below 100 % trades contrast for dark adaptation; that is the user's choice
and the default stays at 100 %.
Images, map tiles and the WebGL sky go through an SVG filter that maps luminance to the red channel:
`feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"`.
A brightness slider (20–100 %) dims everything further. QA: a screenshot pixel scan must find no
pixel with G > 0 or B > 0.

### Type

| Role                         | Face                                                        | Notes                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| UI, body, numbers            | **Atkinson Hyperlegible Next** (Braille Institute, OFL 1.1) | designed for low vision: unambiguous I/l/1, 0/O — what a tired, dark-adapted eye needs. Tabular figures for data columns. |
| Object names, section titles | **Spectral** italic, 500/600 (Production Type, OFL 1.1)     | the atlas-label voice; screen-first serif, holds up on dark backgrounds                                                   |

Self-hosted WOFF2 subsets in `public/fonts/` (no Google Fonts request; works offline). Budget
≤ 120 KB for all faces.

Scale (px, based on the classical 16-step scale): 12 · 14 · 16 · 18 · 21 · 24 · 30 · 36.
Body 16 (never below 16 for running text on phones), dense tables 14, captions 12 (expert mode
only). Line height 1.5 body, 1.25 headings. Measure ≤ 72 characters for prose. Sentence case
everywhere; no all-caps labels, no eyebrow labels above headings.

### Space, radius, elevation, motion

- **Space** (4 px base): `--s1 4 · --s2 8 · --s3 12 · --s4 16 · --s5 24 · --s6 32 · --s7 48 · --s8 64`.
- **Radius by role** (not one radius everywhere): inputs/chips `6`, rows none, sections `12`,
  dock/drawers `18` (top corners only on phones), pills `999` only for toggles.
- **Elevation:** on dark themes depth is lightness (`ink-0 → ink-1 → ink-2`), not shadows. One
  shadow exists, for floating layers over the sky: `0 12px 32px rgb(0 0 0 / 0.45)`.
- **Motion:** `--t-fast 120ms` (hover/press), `--t-mid 200ms` (drawers, sheets),
  `--t-slow 320ms` (page switch); easing `cubic-bezier(0.2, 0.7, 0.2, 1)`. The one orchestrated
  moment: on first load the ribbon needle sweeps from sunset to "now" (600 ms). Everything else
  moves only in response to the user. `prefers-reduced-motion: reduce` → no sweeps, instant
  sheets, no sky auto-animation.

## Layout

- **Plan (`#/plan`)**: one left-aligned column; prose and verdict at ≤ 720 px measure, data tables
  may widen to 1200 px. Desktop ≥ 1100 px adds a left section index (sticky). Phones get a sticky
  row of section chips under the header. Sections are separated by space and a hairline, not
  boxed cards; only interactive groups (a target row, a profile) get a surface.
- **Sky (`#/sky`)**: canvas fills the viewport. The dock is a bottom sheet on phones (peek 64 px,
  half, full; thumb-reachable buttons at the bottom edge) and a 380 px right drawer on desktop.
  No horizontally scrolling toolbars anywhere.
- **Header**: one row on desktop (brand, location, profile, search, mode, night, page switch) over
  the ribbon; on phones the row collapses to location · search · menu, ribbon stays.
- Breakpoints: 360 (min), 600, 900, 1100, 1440, 2560 (content max 1440, sky unlimited).
- Touch targets ≥ 44 × 44 px; spacing between adjacent targets ≥ 8 px.

## Beginner / Expert

Same data. Beginner hides columns (keeps name, type symbol, when, why), replaces units with words
("high in the south at 21:40"), shows one-line "why" for every recommendation and puts jargon
behind "?" popovers linked to the glossary. Expert shows all columns, units, decimals and the
score breakdown inline.

## Accessibility floor

WCAG 2.2 AA: contrast ≥ 4.5:1 text / 3:1 UI (all themes, night included at the default
brightness), visible 2 px brass focus ring with 2 px offset, full keyboard paths (Ctrl/Cmd-K
search, `[`/`]` time, `?` shortcuts), ARIA landmarks and live regions for verdict changes,
colour-blind-safe charts (shape + pattern + label), no information in colour alone.

## Copy

Plain verbs, sentence case, the user's words ("Is tonight worth it?", "Best targets tonight").
Errors say what failed and what to do ("NINA isn't answering at localhost:1888. Is the Advanced API
plugin enabled?"). Empty states invite an action. Every number shows its source on hover/tap.
