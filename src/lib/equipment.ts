/**
 * Imaging setups: telescope + camera → field of view, pixel scale, resolution.
 *
 *   effective focal length  F = focal × reducer/Barlow factor
 *   pixel scale (″/px)      = 206.265 × pixel size (µm) / F (mm)
 *   field of view           = sensor size / F (exact: 2·atan(size / 2F))
 *   Dawes limit (″)         = 116 / aperture (mm)
 *   Rayleigh limit (″)      = 138 / aperture (mm)   (1.22 λ/D at 550 nm)
 * Sampling: a star's blur (FWHM ≈ the seeing) should span about 2–3 pixels
 * (Nyquist). Planetary "lucky imaging" aims for f-ratio ≈ 5 × pixel size (µm)
 * at 550 nm, the usual critical-sampling rule.
 */

export type SetupKind = 'deepsky' | 'planetary' | 'lunarsolar';

export interface Setup {
  kind: SetupKind;
  telescope: string;
  apertureMm: number;
  focalMm: number;
  /** Reducer (<1) or Barlow (>1) factor; 1 = none. */
  factor: number;
  camera: string;
  widthPx: number;
  heightPx: number;
  pixelUm: number;
  /** Frame rotation (degrees): 0 = long side east–west with north up, 90 = long side north–south. */
  rotationDeg: number;
}

/** A camera frame drawn on the sky by the sky view. */
export interface SkyFrame {
  id: string;
  label: string;
  fovW: number;
  fovH: number;
  rotationDeg: number;
  color: string;
}

export interface Camera {
  name: string;
  widthPx: number;
  heightPx: number;
  pixelUm: number;
}

/** Common astronomy cameras and DSLR/mirrorless bodies (manufacturer specifications). */
export const CAMERAS: readonly Camera[] = [
  { name: 'ZWO ASI2600MC/MM Pro', widthPx: 6248, heightPx: 4176, pixelUm: 3.76 },
  { name: 'ZWO ASI6200MC/MM Pro', widthPx: 9576, heightPx: 6388, pixelUm: 3.76 },
  { name: 'ZWO ASI533MC Pro', widthPx: 3008, heightPx: 3008, pixelUm: 3.76 },
  { name: 'ZWO ASI294MC Pro', widthPx: 4144, heightPx: 2822, pixelUm: 4.63 },
  { name: 'ZWO ASI183MC/MM', widthPx: 5496, heightPx: 3672, pixelUm: 2.4 },
  { name: 'ZWO ASI1600MM', widthPx: 4656, heightPx: 3520, pixelUm: 3.8 },
  { name: 'QHY268M/C', widthPx: 6280, heightPx: 4210, pixelUm: 3.76 },
  { name: 'ZWO ASI585MC', widthPx: 3840, heightPx: 2160, pixelUm: 2.9 },
  { name: 'ZWO ASI678MC', widthPx: 3840, heightPx: 2160, pixelUm: 2.0 },
  { name: 'ZWO ASI462MC', widthPx: 1936, heightPx: 1096, pixelUm: 2.9 },
  { name: 'ZWO ASI224MC', widthPx: 1304, heightPx: 976, pixelUm: 3.75 },
  { name: 'ZWO ASI178MM/MC', widthPx: 3096, heightPx: 2080, pixelUm: 2.4 },
  { name: 'ZWO ASI120MM', widthPx: 1280, heightPx: 960, pixelUm: 3.75 },
  { name: 'Canon APS-C 24 MP (e.g. 2000D, 800D)', widthPx: 6000, heightPx: 4000, pixelUm: 3.72 },
  { name: 'Canon EOS 6D', widthPx: 5472, heightPx: 3648, pixelUm: 6.55 },
  { name: 'Nikon D5300', widthPx: 6000, heightPx: 4000, pixelUm: 3.89 },
  { name: 'Sony A7 III', widthPx: 6000, heightPx: 4000, pixelUm: 5.93 },
];

export const DEFAULT_SETUPS: Record<SetupKind, Setup> = {
  deepsky: {
    kind: 'deepsky',
    telescope: '80 mm f/6 refractor',
    apertureMm: 80,
    focalMm: 480,
    factor: 1,
    camera: 'ZWO ASI2600MC/MM Pro',
    widthPx: 6248,
    heightPx: 4176,
    pixelUm: 3.76,
    rotationDeg: 0,
  },
  planetary: {
    kind: 'planetary',
    telescope: '8″ SCT (203 mm f/10)',
    apertureMm: 203,
    focalMm: 2032,
    factor: 2,
    camera: 'ZWO ASI462MC',
    widthPx: 1936,
    heightPx: 1096,
    pixelUm: 2.9,
    rotationDeg: 0,
  },
  lunarsolar: {
    kind: 'lunarsolar',
    telescope: '100 mm f/7 refractor',
    apertureMm: 100,
    focalMm: 700,
    factor: 1,
    camera: 'ZWO ASI178MM/MC',
    widthPx: 3096,
    heightPx: 2080,
    pixelUm: 2.4,
    rotationDeg: 0,
  },
};

export const SETUP_LABELS: Record<SetupKind, string> = {
  deepsky: 'Deep sky',
  planetary: 'Planetary',
  lunarsolar: 'Lunar & solar',
};

export interface SetupStats {
  effFocalMm: number;
  fRatio: number;
  /** Field of view (degrees), width × height and diagonal. */
  fovW: number;
  fovH: number;
  fovDiag: number;
  /** Arcseconds per pixel. */
  pixelScale: number;
  dawes: number;
  rayleigh: number;
  /** Seeing blur across pixels (FWHM / pixel scale), when the seeing is known. */
  pxPerFwhm: number | null;
  sampling: 'undersampled' | 'well sampled' | 'oversampled' | null;
  /** Planetary: f-ratio for critical sampling (≈ 5 × pixel size in µm). */
  idealFRatio: number;
}

const ARCSEC_PER_RAD = 206_264.806;

export function setupStats(s: Setup, seeingArcsec: number | null = null): SetupStats {
  const F = Math.max(1, s.focalMm * (s.factor || 1));
  const wMm = (s.widthPx * s.pixelUm) / 1000;
  const hMm = (s.heightPx * s.pixelUm) / 1000;
  const ang = (mm: number) => (2 * Math.atan(mm / (2 * F)) * 180) / Math.PI;
  const pixelScale = (ARCSEC_PER_RAD * s.pixelUm) / 1000 / F;
  // Planetary images are limited by the optics, not the seeing, so compare with the Dawes limit.
  const blur = s.kind === 'deepsky' ? seeingArcsec : Math.max(116 / Math.max(1, s.apertureMm), 0);
  const pxPerFwhm = blur != null && blur > 0 ? blur / pixelScale : null;
  const sampling =
    pxPerFwhm == null
      ? null
      : pxPerFwhm < 1.6
        ? 'undersampled'
        : pxPerFwhm > (s.kind === 'deepsky' ? 3.5 : 4.5)
          ? 'oversampled'
          : 'well sampled';
  return {
    effFocalMm: F,
    fRatio: F / Math.max(1, s.apertureMm),
    fovW: ang(wMm),
    fovH: ang(hMm),
    fovDiag: ang(Math.hypot(wMm, hMm)),
    pixelScale,
    dawes: 116 / Math.max(1, s.apertureMm),
    rayleigh: 138 / Math.max(1, s.apertureMm),
    pxPerFwhm,
    sampling,
    idealFRatio: 5 * s.pixelUm,
  };
}

/** How much of the frame's short side an object of `sizeArcmin` fills (0–1+). */
export function frameFill(sizeArcmin: number, st: SetupStats): number {
  return sizeArcmin / 60 / Math.min(st.fovW, st.fovH);
}

/** "2.61° × 1.75°" or "38.4′ × 21.7′" for small fields. */
export function fmtFov(st: SetupStats): string {
  if (Math.max(st.fovW, st.fovH) >= 2) return `${st.fovW.toFixed(2)}° × ${st.fovH.toFixed(2)}°`;
  return `${(st.fovW * 60).toFixed(1)}′ × ${(st.fovH * 60).toFixed(1)}′`;
}

const KEY = 'anp.setups.v1';

export function loadSetups(): Record<SetupKind, Setup> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record<SetupKind, Partial<Setup>>>;
      return {
        deepsky: { ...DEFAULT_SETUPS.deepsky, ...v.deepsky, kind: 'deepsky' },
        planetary: { ...DEFAULT_SETUPS.planetary, ...v.planetary, kind: 'planetary' },
        lunarsolar: { ...DEFAULT_SETUPS.lunarsolar, ...v.lunarsolar, kind: 'lunarsolar' },
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return structuredClone(DEFAULT_SETUPS);
}

export function saveSetups(s: Record<SetupKind, Setup>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: not remembered */
  }
}

/**
 * Corners/edge points of a camera frame on the sky (RA/Dec in radians) around a
 * centre, by the inverse gnomonic projection. `stepsPerEdge` points per side.
 */
export function framePolygon(
  ra0: number,
  dec0: number,
  fovWDeg: number,
  fovHDeg: number,
  rotationDeg: number,
  stepsPerEdge = 8,
): [number, number][] {
  const hw = Math.tan(((fovWDeg / 2) * Math.PI) / 180);
  const hh = Math.tan(((fovHDeg / 2) * Math.PI) / 180);
  const th = (rotationDeg * Math.PI) / 180;
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const pts: [number, number][] = [];
  for (let c = 0; c < 4; c++) {
    const [x0, y0] = corners[c] ?? [0, 0];
    const [x1, y1] = corners[(c + 1) % 4] ?? [0, 0];
    for (let k = 0; k < stepsPerEdge; k++) {
      const t = k / stepsPerEdge;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      // x = long side (east–west at 0°), y = short side (north); rotate by th.
      const xi = x * Math.cos(th) - y * Math.sin(th);
      const eta = x * Math.sin(th) + y * Math.cos(th);
      const den = Math.cos(dec0) - eta * Math.sin(dec0);
      const ra = ra0 + Math.atan2(xi, den);
      const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(xi, den));
      pts.push([ra, dec]);
    }
  }
  return pts;
}

// ---- Stellarium-style ocular view (sky overlay) ------------------------------------

export type OcularMode = 'sensor' | 'eyepiece' | 'telrad' | 'nightscape';

export interface Eyepiece {
  name: string;
  focalMm: number;
  /** Apparent field of view, degrees. */
  afovDeg: number;
}

/** Common eyepieces (typical published apparent fields). */
export const EYEPIECES: readonly Eyepiece[] = [
  { name: '40 mm Plössl', focalMm: 40, afovDeg: 44 },
  { name: '32 mm Plössl', focalMm: 32, afovDeg: 52 },
  { name: '25 mm Plössl', focalMm: 25, afovDeg: 52 },
  { name: '20 mm wide 68°', focalMm: 20, afovDeg: 68 },
  { name: '15 mm Plössl', focalMm: 15, afovDeg: 52 },
  { name: '13 mm ultra-wide 82°', focalMm: 13, afovDeg: 82 },
  { name: '10 mm Plössl', focalMm: 10, afovDeg: 52 },
  { name: '9 mm wide 66°', focalMm: 9, afovDeg: 66 },
  { name: '6 mm ultra-wide 82°', focalMm: 6, afovDeg: 82 },
  { name: '4 mm planetary 58°', focalMm: 4, afovDeg: 58 },
];

/** Telrad finder rings, degrees (diameters). */
export const TELRAD_RINGS = [0.5, 2, 4] as const;

export interface EyepieceStats {
  magnification: number;
  /** True field of view, degrees (apparent field ÷ magnification). */
  trueFovDeg: number;
  /** Exit pupil, mm. */
  exitPupilMm: number;
}

/** Visual use: magnification = telescope focal (× Barlow) ÷ eyepiece focal; true field = AFOV ÷ magnification. */
export function eyepieceStats(s: Setup, ep: { focalMm: number; afovDeg: number }): EyepieceStats {
  const F = Math.max(1, s.focalMm * (s.factor || 1));
  const magnification = F / Math.max(0.5, ep.focalMm);
  return {
    magnification,
    trueFovDeg: ep.afovDeg / magnification,
    exitPupilMm: Math.max(1, s.apertureMm) / magnification,
  };
}

/** Rotation normalised to −180…+180 degrees. */
export function normRotation(deg: number): number {
  const r = (((deg + 180) % 360) + 360) % 360;
  return Math.round((r - 180) * 100) / 100;
}

/** Plate scale, arcseconds per millimetre at the focal plane. */
export const plateScale = (s: Setup) => ARCSEC_PER_RAD / Math.max(1, s.focalMm * (s.factor || 1));

/**
 * Field of view that makes an object of angular size `sizeDeg` fill `fill`
 * (0–1) of `viewPx` screen pixels, given the current view (`fovNow` with
 * `pxPerDeg` at the centre). Scale ∝ 1/fov for the small fields where this is used.
 */
export function fitFov(
  fovNow: number,
  pxPerDeg: number,
  sizeDeg: number,
  viewPx: number,
  fill = 0.8,
) {
  const want = (fill * viewPx) / Math.max(1e-6, sizeDeg);
  return fovNow * (pxPerDeg / want);
}

// ---- Nightscape / time-lapse (camera + lens on a fixed tripod) ----------------------

export interface Sensor {
  name: string;
  widthMm: number;
  heightMm: number;
  /** Typical pixel pitch, µm (for the NPF rule). */
  pixelUm: number;
}

export const SENSORS: readonly Sensor[] = [
  { name: 'Full frame (36 × 24 mm)', widthMm: 36, heightMm: 24, pixelUm: 5.9 },
  { name: 'APS-C Canon (22.3 × 14.9 mm)', widthMm: 22.3, heightMm: 14.9, pixelUm: 3.7 },
  { name: 'APS-C Nikon/Sony/Fuji (23.5 × 15.6 mm)', widthMm: 23.5, heightMm: 15.6, pixelUm: 3.9 },
  { name: 'Micro Four Thirds (17.3 × 13 mm)', widthMm: 17.3, heightMm: 13, pixelUm: 3.3 },
  { name: '1-inch (13.2 × 8.8 mm)', widthMm: 13.2, heightMm: 8.8, pixelUm: 2.4 },
];

export const LENSES_MM = [8, 10, 12, 14, 16, 20, 24, 28, 35, 50, 85, 135, 200] as const;

export interface NightscapeStats {
  /** Field of view in degrees (width, height, diagonal) for the given orientation. */
  fovW: number;
  fovH: number;
  fovDiag: number;
  /** Longest untracked exposure, seconds: the classic 500 rule and the simple NPF rule. */
  rule500: number;
  npf: number;
}

/** Field of view and longest sharp exposure for a camera + lens on a fixed tripod. */
export function nightscapeStats(
  sensor: Sensor,
  focalMm: number,
  fNumber: number,
  portrait = false,
): NightscapeStats {
  const f = Math.max(1, focalMm);
  const w = portrait ? sensor.heightMm : sensor.widthMm;
  const h = portrait ? sensor.widthMm : sensor.heightMm;
  const ang = (mm: number) => (2 * Math.atan(mm / (2 * f)) * 180) / Math.PI;
  const crop = 43.27 / Math.hypot(sensor.widthMm, sensor.heightMm);
  return {
    fovW: ang(w),
    fovH: ang(h),
    fovDiag: ang(Math.hypot(w, h)),
    rule500: 500 / (f * crop),
    // Simplified NPF rule (Frédéric Michaud, Société Astronomique de France).
    npf: (35 * Math.max(0.7, fNumber) + 30 * sensor.pixelUm) / f,
  };
}

export interface TimelapseStats {
  /** Shooting time, seconds. */
  durationS: number;
  /** Length of the finished clip, seconds. */
  clipS: number;
  /** Rotation of the sky about the celestial pole during the sequence, degrees. */
  skyRotationDeg: number;
}

/** A time-lapse: `frames` photos taken every `intervalS` seconds, played at `fps`. */
export function timelapseStats(intervalS: number, frames: number, fps = 25): TimelapseStats {
  const durationS = Math.max(0, intervalS) * Math.max(0, frames);
  return {
    durationS,
    clipS: frames / Math.max(1, fps),
    // Sidereal rate: 360° in 23 h 56 min 4 s.
    skyRotationDeg: (durationS / 86164.0905) * 360,
  };
}
