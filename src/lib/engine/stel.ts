/**
 * Thin typed wrapper around Stellarium Web Engine (AGPL-3.0), compiled to
 * WebAssembly by engine/build-engine.mjs and served from /engine/.
 *
 * All sky data comes from our own /skydata/ folder (see pipelines/catalogs);
 * nothing is loaded from Stellarium's servers.
 */

/* Minimal typings for the parts of the engine API we use. */
export interface SweObj {
  designations(): string[];
  culturalDesignations(): { name_english?: string; name_native?: string }[];
  getInfo(info: 'vmag' | 'distance' | 'phase' | 'radius' | 'type'): number | string | undefined;
  getInfo(info: 'radec' | 'azalt' | 'pvo', obs?: SweObserver): number[];
  readonly type?: string;
  [attr: string]: unknown;
}

export interface SweObserver extends SweObj {
  latitude: number;
  longitude: number;
  elevation: number;
  utc: number;
  yaw: number;
  pitch: number;
}

interface SweModule extends SweObj {
  addDataSource(args: { url: string; key?: string }): void;
  visible: boolean;
  lines_visible?: boolean;
  labels_visible?: boolean;
  boundaries_visible?: boolean;
  hints_visible?: boolean;
}

export interface SweCore extends SweObj {
  observer: SweObserver;
  fov: number;
  selection: SweObj | null;
  time_speed: number;
  bortle_index: number;
  display_limit_mag: number;
  stars: SweModule;
  dsos: SweModule;
  milkyway: SweModule;
  planets: SweModule;
  skycultures: SweModule & { current_id?: string };
  constellations: SweModule;
  atmosphere: SweModule;
  landscapes: SweModule;
  lines: Record<'azimuthal' | 'equatorial' | 'meridian' | 'ecliptic', SweModule>;
  cardinals: SweModule;
}

export interface Stel {
  core: SweCore;
  D2R: number;
  R2D: number;
  date2MJD(ms: number): number;
  MJD2date(mjd: number): Date;
  convertFrame(obs: SweObserver, from: string, to: string, v: number[]): number[];
  c2s(v: number[]): [number, number];
  s2c(lon: number, lat: number): number[];
  anp(a: number): number;
  anpm(a: number): number;
  otypeToStr(otype: string): string;
  designationCleanup(d: string, flags: number): string;
  pointAndLock(obj: SweObj, duration?: number): void;
  zoomTo(fov: number, duration?: number): void;
  lookAt(pos: number[], duration?: number): void;
  change(cb: (obj: SweObj, attr: string) => void): void;
  getObj(id: string): SweObj | null;
}

type EngineFactory = (opts: {
  wasmFile: string;
  canvas: HTMLCanvasElement;
  translateFn: (domain: string, str: string) => string;
  onReady: (stel: Stel) => void;
}) => void;

const BASE = import.meta.env.BASE_URL;
export const SKYDATA = `${BASE}skydata/`;

/** Load the engine module and initialise it on `canvas`. */
export async function startEngine(canvas: HTMLCanvasElement): Promise<Stel> {
  // The engine is a prebuilt static file in /public. Vite refuses to import
  // from there, so fetch it (cacheable like any asset) and import a Blob URL.
  const res = await fetch(`${BASE}engine/stellarium-web-engine.js`);
  if (!res.ok) throw new Error(`engine script: HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  let mod: { default: EngineFactory };
  try {
    mod = (await import(/* @vite-ignore */ blobUrl)) as { default: EngineFactory };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  return new Promise((resolve, reject) => {
    try {
      mod.default({
        wasmFile: `${BASE}engine/stellarium-web-engine.wasm`,
        canvas,
        translateFn: (_domain, str) => str,
        onReady: (stel) => {
          addSkyData(stel);
          resolve(stel);
        },
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function addSkyData(stel: Stel): void {
  const c = stel.core;
  c.stars.addDataSource({ url: `${SKYDATA}stars` });
  c.dsos.addDataSource({ url: `${SKYDATA}dso` });
  c.skycultures.addDataSource({ url: `${SKYDATA}skycultures/western`, key: 'western' });
  c.milkyway.addDataSource({ url: `${SKYDATA}surveys/milkyway` });
  c.planets.addDataSource({ url: `${SKYDATA}surveys/sso/moon`, key: 'moon' });
  // Flat mathematical horizon (no invented scenery). The real terrain
  // silhouette from elevation data replaces it in a later phase.
  c.landscapes.addDataSource({ url: `${SKYDATA}landscapes/zero`, key: 'zero' });
}

export function setObserver(
  stel: Stel,
  p: { lat: number; lon: number; elevation: number },
  date: Date,
): void {
  const o = stel.core.observer;
  o.latitude = p.lat * stel.D2R;
  o.longitude = p.lon * stel.D2R;
  o.elevation = p.elevation;
  o.utc = stel.date2MJD(date.getTime());
}

export interface ObjectInfo {
  name: string;
  otherNames: string[];
  type: string;
  vmag: number | null;
  /** Apparent altitude/azimuth in degrees (engine's refraction applied). */
  alt: number;
  az: number;
  ra: number;
  dec: number;
}

/** Human-readable info for the selected object. */
export function describe(stel: Stel, obj: SweObj): ObjectInfo {
  const obs = stel.core.observer;
  // Greek letter + short constellation, e.g. "α Aql", "53 Aql" (BAYER_CONST_SHORT).
  const BAYER_CONST_SHORT = 1 << 2;
  const cultural = obj
    .culturalDesignations()
    .map((n) => n.name_english ?? n.name_native)
    .filter((n): n is string => !!n);
  const catalog = obj.designations().map((d) => stel.designationCleanup(d, BAYER_CONST_SHORT));
  const names = [...new Set([...cultural, ...catalog])];
  const radec = obj.getInfo('radec', obs);
  const cirs = stel.convertFrame(obs, 'ICRF', 'CIRS', radec);
  const [ra, dec] = stel.c2s(cirs);
  const observed = stel.convertFrame(obs, 'CIRS', 'OBSERVED', cirs);
  const [az, alt] = stel.c2s(observed);
  const vmag = obj.getInfo('vmag');
  const t = typeof obj.type === 'string' ? obj.type : String(obj.getInfo('type') ?? '');
  return {
    name: names[0] ?? 'Unnamed object',
    otherNames: names.slice(1, 6),
    type: t ? stel.otypeToStr(t) : '',
    vmag: typeof vmag === 'number' && Number.isFinite(vmag) ? vmag : null,
    alt: stel.anpm(alt) * stel.R2D,
    az: stel.anp(az) * stel.R2D,
    ra: stel.anp(ra) * stel.R2D,
    dec: stel.anpm(dec) * stel.R2D,
  };
}
