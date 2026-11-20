/**
 * Equipment profiles: a named telescope + camera (+ reducer, binning, filters).
 * The selected profile drives FOV frames, framing scores and filter advice.
 * Profiles are stored on the device only (CLAUDE.md constraint 5) and can be
 * exported/imported as JSON.
 *
 * All numbers come from manufacturer specifications. A profile can carry a
 * plate-solved focal length, which is what matters for framing (a 0.63× reducer
 * rarely gives exactly 0.63×).
 */
import { setupStats, type Setup, type SetupKind, type SetupStats } from './equipment';

export type ProfileKind = SetupKind | 'widefield';

export interface CameraSpec {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  pixelUm: number;
  /** Sensor size when pixels are not square or the active area differs from px × pitch. */
  sensorMm?: [number, number];
  mono: boolean;
  sensor?: string;
}

export interface TelescopeSpec {
  id: string;
  name: string;
  apertureMm: number;
  focalMm: number;
}

export interface FilterSpec {
  id: string;
  name: string;
  kind: 'luminance' | 'rgb' | 'broadband-lp' | 'ir-pass' | 'narrowband';
  /** Centre wavelength (nm), when it is a single band. */
  centreNm?: number;
  /** Bandwidth (nm). Unknown → undefined, shown as "n/a". */
  bandwidthNm?: number;
}

export const CAMERA_DB: readonly CameraSpec[] = [
  // ToupTek ATR585M: Sony IMX585 mono, 3840 × 2160, 2.9 µm (ToupTek specification).
  {
    id: 'atr585m',
    name: 'ToupTek ATR585M',
    widthPx: 3840,
    heightPx: 2160,
    pixelUm: 2.9,
    mono: true,
    sensor: 'Sony IMX585',
  },
  {
    id: 'asi585mc',
    name: 'ZWO ASI585MC Pro',
    widthPx: 3840,
    heightPx: 2160,
    pixelUm: 2.9,
    mono: false,
    sensor: 'Sony IMX585',
  },
  // Sony a6100: APS-C 23.5 × 15.6 mm, 6000 × 4000 effective pixels.
  {
    id: 'a6100',
    name: 'Sony a6100',
    widthPx: 6000,
    heightPx: 4000,
    pixelUm: 3.92,
    sensorMm: [23.5, 15.6],
    mono: false,
    sensor: 'APS-C Exmor CMOS',
  },
  {
    id: 'asi2600',
    name: 'ZWO ASI2600MC/MM Pro',
    widthPx: 6248,
    heightPx: 4176,
    pixelUm: 3.76,
    mono: false,
  },
  {
    id: 'asi533',
    name: 'ZWO ASI533MC Pro',
    widthPx: 3008,
    heightPx: 3008,
    pixelUm: 3.76,
    mono: false,
  },
  {
    id: 'asi294',
    name: 'ZWO ASI294MC Pro',
    widthPx: 4144,
    heightPx: 2822,
    pixelUm: 4.63,
    mono: false,
  },
  {
    id: 'asi183',
    name: 'ZWO ASI183MC/MM',
    widthPx: 5496,
    heightPx: 3672,
    pixelUm: 2.4,
    mono: false,
  },
  { id: 'asi678', name: 'ZWO ASI678MC', widthPx: 3840, heightPx: 2160, pixelUm: 2.0, mono: false },
  { id: 'asi462', name: 'ZWO ASI462MC', widthPx: 1936, heightPx: 1096, pixelUm: 2.9, mono: false },
  { id: 'asi224', name: 'ZWO ASI224MC', widthPx: 1304, heightPx: 976, pixelUm: 3.75, mono: false },
  { id: 'asi120', name: 'ZWO ASI120MM', widthPx: 1280, heightPx: 960, pixelUm: 3.75, mono: true },
  { id: 'qhy268', name: 'QHY268M/C', widthPx: 6280, heightPx: 4210, pixelUm: 3.76, mono: false },
];

export const TELESCOPE_DB: readonly TelescopeSpec[] = [
  { id: 'c925', name: 'Celestron C9.25 (SCT)', apertureMm: 235, focalMm: 2350 },
  { id: 'mini60', name: '60 mm f/4 guide scope', apertureMm: 60, focalMm: 240 },
  { id: 'lens14', name: '14 mm f/2.8 lens', apertureMm: 5, focalMm: 14 },
  { id: 'c8', name: 'Celestron C8 (SCT)', apertureMm: 203, focalMm: 2032 },
  { id: 'r80f6', name: '80 mm f/6 refractor', apertureMm: 80, focalMm: 480 },
];

export const FILTER_DB: readonly FilterSpec[] = [
  { id: 'L', name: 'ZWO L', kind: 'luminance' },
  { id: 'R', name: 'ZWO R', kind: 'rgb' },
  { id: 'G', name: 'ZWO G', kind: 'rgb' },
  { id: 'B', name: 'ZWO B', kind: 'rgb' },
  { id: 'lpro', name: 'Optolong L-Pro (as luminance)', kind: 'broadband-lp' },
  { id: 'irpass', name: 'IR-pass', kind: 'ir-pass' },
  { id: 'ha', name: 'Hα', kind: 'narrowband', centreNm: 656.3 },
  { id: 'oiii', name: 'OIII', kind: 'narrowband', centreNm: 500.7 },
  { id: 'sii', name: 'SII', kind: 'narrowband', centreNm: 671.6 },
];

export interface Profile extends Setup {
  id: string;
  name: string;
  profileKind: ProfileKind;
  /** Plate-solved effective focal length (mm); overrides focal × factor when set. */
  measuredFocalMm?: number;
  binning: number;
  filters: string[];
  mono: boolean;
}

function cam(id: string): CameraSpec {
  const c = CAMERA_DB.find((x) => x.id === id);
  if (!c) throw new Error(`camera ${id}`);
  return c;
}

function fromCamera(c: CameraSpec) {
  return {
    camera: c.name,
    widthPx: c.widthPx,
    heightPx: c.heightPx,
    pixelUm: c.pixelUm,
    mono: c.mono,
    ...(c.sensorMm ? { sensorMm: c.sensorMm } : {}),
  };
}

/**
 * Starter rigs for first-time visitors (common, generic equipment). Each visitor's own
 * choice is saved in their browser; their own telescope and camera go in the Equipment tab.
 */
export const DEFAULT_PROFILES: readonly Profile[] = [
  {
    id: 'r80-2600',
    name: '80 mm f/6 refractor · ASI2600MC',
    kind: 'deepsky',
    profileKind: 'deepsky',
    telescope: '80 mm f/6 refractor',
    apertureMm: 80,
    focalMm: 480,
    factor: 1,
    ...fromCamera(cam('asi2600')),
    binning: 1,
    rotationDeg: 0,
    filters: [],
  },
  {
    id: 'c8-462',
    name: '8″ SCT + 2× Barlow · ASI462MC',
    kind: 'planetary',
    profileKind: 'planetary',
    telescope: 'Celestron C8 (SCT) + 2× Barlow',
    apertureMm: 203,
    focalMm: 2032,
    factor: 2,
    ...fromCamera(cam('asi462')),
    binning: 1,
    rotationDeg: 0,
    filters: ['irpass'],
  },
  {
    id: 'g60-585',
    name: '60 mm f/4 · ASI585MC',
    kind: 'deepsky',
    profileKind: 'deepsky',
    telescope: '60 mm f/4 guide scope',
    apertureMm: 60,
    focalMm: 240,
    factor: 1,
    ...fromCamera(cam('asi585mc')),
    binning: 1,
    rotationDeg: 0,
    filters: [],
  },
  {
    id: 'aps14',
    name: 'APS-C camera · 14 mm f/2.8',
    kind: 'deepsky',
    profileKind: 'widefield',
    telescope: '14 mm f/2.8 lens',
    apertureMm: 14 / 2.8,
    focalMm: 14,
    factor: 1,
    ...fromCamera(cam('a6100')),
    binning: 1,
    rotationDeg: 0,
    filters: [],
  },
];

/** Effective focal length: the plate-solved value when known, else focal × reducer/Barlow. */
export function effectiveFocal(
  p: Pick<Profile, 'focalMm' | 'factor'> & { measuredFocalMm?: number },
): number {
  return p.measuredFocalMm && p.measuredFocalMm > 0
    ? p.measuredFocalMm
    : p.focalMm * (p.factor || 1);
}

/** Profile → the Setup the existing FOV / sampling code expects. */
export function profileSetup(p: Profile): Setup {
  const F = effectiveFocal(p);
  const bin = Math.max(1, Math.round(p.binning || 1));
  return {
    kind: p.kind,
    telescope: p.telescope,
    apertureMm: p.apertureMm,
    focalMm: F,
    factor: 1,
    camera: p.camera,
    widthPx: Math.floor(p.widthPx / bin),
    heightPx: Math.floor(p.heightPx / bin),
    pixelUm: p.pixelUm * bin,
    rotationDeg: p.rotationDeg,
    ...(p.sensorMm ? { sensorMm: p.sensorMm } : {}),
  };
}

export function profileStats(p: Profile, seeingArcsec: number | null = null): SetupStats {
  return setupStats(profileSetup(p), seeingArcsec);
}

// ---- storage (device only) ----------------------------------------------------------

const KEY = 'anp.profiles.v1';
const DEFAULT_ID = 'r80-2600';
const ACTIVE_KEY = 'anp.profile.active.v1';

export function isProfile(v: unknown): v is Profile {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const pos = (k: string) => typeof o[k] === 'number' && (o[k] as number) > 0;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    pos('focalMm') &&
    pos('apertureMm') &&
    pos('widthPx') &&
    pos('heightPx') &&
    pos('pixelUm')
  );
}

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = (JSON.parse(raw) as unknown[]).filter(isProfile);
      if (list.length) return list;
    }
  } catch {
    /* fall back to the defaults */
  }
  return structuredClone(DEFAULT_PROFILES) as Profile[];
}

export function saveProfiles(list: Profile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* private mode */
  }
}

export function loadActiveProfileId(): string {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id === MINE_ID && loadMySetup()) return id;
    // A saved id from an older build whose starter rig is gone falls back to the default.
    return id && loadProfiles().some((p) => p.id === id) ? id : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

export function saveActiveProfileId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* private mode */
  }
}

// ---- the visitor's own setup ("My setup") ----------------------------------------------

/** Profile id of the visitor's own deep-sky setup (edited in Plan → Telescope). */
export const MINE_ID = 'mine';
const MINE_KEY = 'anp.mysetup.v1';

/** The visitor's own setup as a profile for the header list and the framing scores. */
export function mineProfile(s: Setup): Profile {
  return {
    ...s,
    kind: 'deepsky',
    id: MINE_ID,
    name: `My setup · ${s.telescope || 'telescope'}`,
    profileKind: 'deepsky',
    binning: 1,
    filters: [],
    mono: false,
  };
}

/**
 * Same optics and sensor (rotation and naming aside)? Used to notice that the visitor edited
 * their equipment away from the chosen starter rig.
 */
export function sameRig(a: Setup, b: Setup): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
  return (
    close(a.focalMm * (a.factor || 1), b.focalMm * (b.factor || 1)) &&
    close(a.apertureMm, b.apertureMm) &&
    close(a.pixelUm, b.pixelUm) &&
    a.widthPx === b.widthPx &&
    a.heightPx === b.heightPx
  );
}

export function loadMySetup(): Setup | null {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    const v = raw ? (JSON.parse(raw) as Setup) : null;
    return v && v.focalMm > 0 && v.apertureMm > 0 && v.widthPx > 0 && v.pixelUm > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveMySetup(s: Setup): void {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** "1.4° × 0.9°, 1.62″/px" */
export function profileSummary(p: Profile): string {
  const st = profileStats(p);
  const fov =
    Math.max(st.fovW, st.fovH) >= 2
      ? `${st.fovW.toFixed(1)}° × ${st.fovH.toFixed(1)}°`
      : `${(st.fovW * 60).toFixed(1)}′ × ${(st.fovH * 60).toFixed(1)}′`;
  return `${fov}, ${st.pixelScale.toFixed(2)}″/px`;
}
