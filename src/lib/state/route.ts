/**
 * Two pages, one shareable state in the URL hash (PLAN.md §1):
 *
 *   #/plan?s=targets&t=M%2031&at=2026-11-19T16:00:00.000Z&loc=greenwich&p=r80-2600&l=con,eqgrid
 *   #/sky?t=M%2031
 *
 * Old tab links (#/tonight, #/week, #/targets, #/equipment, #/maps, #/space,
 * #/about, #/credits) map to the matching Plan section so they keep working.
 * Hashes that don't start with "#/" (e.g. the skip link "#main") are not routes.
 */

export type Page = 'plan' | 'sky';

export const PLAN_SECTIONS = [
  { id: 'tonight', label: 'Tonight', title: 'Tonight at a glance' },
  { id: 'week', label: 'Week', title: 'Week ahead' },
  { id: 'targets', label: 'Targets', title: 'Best targets tonight' },
  { id: 'planets', label: 'Planets', title: 'Planets, Sun and Moon' },
  { id: 'trips', label: 'Trips', title: 'Trip planner: months and years ahead' },
  { id: 'telescope', label: 'Telescope', title: 'Telescope and field of view' },
  { id: 'space', label: 'Space', title: 'Aurora and satellites' },
  { id: 'maps', label: 'Maps', title: 'Light pollution and cloud maps' },
  { id: 'about', label: 'About', title: 'About, methods and credits' },
] as const;
export type SectionId = (typeof PLAN_SECTIONS)[number]['id'];

const SECTION_IDS = new Set<string>(PLAN_SECTIONS.map((s) => s.id));

/** Old tab → Plan section. */
const LEGACY: Record<string, SectionId> = {
  tonight: 'tonight',
  week: 'week',
  targets: 'targets',
  equipment: 'telescope',
  maps: 'maps',
  space: 'space',
  about: 'about',
  credits: 'about',
};

/** Shared, shareable state. Absent = default (live time, saved location, …). */
export interface RouteParams {
  /** Plan section or sky dock panel. */
  s?: string;
  /** Selected target (catalog designation, e.g. "M 31"). */
  t?: string;
  /** Shown time, ISO 8601 (absent = live). */
  at?: string;
  /** Location preset id or rounded "lat,lon" (never more precise than 0.01°). */
  loc?: string;
  /** Equipment profile id. */
  p?: string;
  /** Sky layers, comma separated. */
  l?: string;
}

const PARAM_KEYS = ['s', 't', 'at', 'loc', 'p', 'l'] as const;

export interface Route {
  page: Page;
  params: RouteParams;
  /** True when the hash was an old tab link or not canonical: replace it in history. */
  redirected: boolean;
}

/** null for non-route hashes (skip links, in-page anchors). */
export function parseHash(hash: string): Route | null {
  if (hash && !hash.startsWith('#/')) return null;
  const body = hash.replace(/^#\//, '');
  const q = body.indexOf('?');
  const path = (q < 0 ? body : body.slice(0, q)).replace(/\/+$/, '');
  const params = parseParams(q < 0 ? '' : body.slice(q + 1));
  if (path === 'sky') return { page: 'sky', params, redirected: false };
  if (path === 'plan') {
    if (params.s && !SECTION_IDS.has(params.s)) {
      delete params.s;
      return { page: 'plan', params, redirected: true };
    }
    return { page: 'plan', params, redirected: false };
  }
  const legacy = LEGACY[path];
  if (legacy) return { page: 'plan', params: { ...params, s: legacy }, redirected: true };
  // '' and unknown paths open the Plan page.
  return { page: 'plan', params, redirected: path !== '' };
}

function parseParams(qs: string): RouteParams {
  const out: RouteParams = {};
  const sp = new URLSearchParams(qs);
  for (const k of PARAM_KEYS) {
    const v = sp.get(k);
    if (v != null && v !== '') out[k] = v.slice(0, 200);
  }
  if (out.loc && !validLoc(out.loc)) delete out.loc;
  if (out.at && Number.isNaN(Date.parse(out.at))) delete out.at;
  return out;
}

/** Preset ids, or "lat,lon" with at most two decimals (privacy: ~1 km). */
export function validLoc(loc: string): boolean {
  if (/^[a-z][a-z0-9-]{1,30}$/.test(loc)) return true;
  const m = /^(-?\d{1,2}(?:\.\d{1,2})?),(-?\d{1,3}(?:\.\d{1,2})?)$/.exec(loc);
  return !!m && Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180;
}

export function buildHash(page: Page, params: RouteParams = {}): string {
  const sp = new URLSearchParams();
  for (const k of PARAM_KEYS) {
    const v = params[k];
    if (v != null && v !== '') sp.set(k, v);
  }
  const qs = sp.toString();
  return `#/${page}${qs ? `?${qs}` : ''}`;
}

/** Rounded "lat,lon" for sharing a place that is not a preset. */
export function locParam(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}
