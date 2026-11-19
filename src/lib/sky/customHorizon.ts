/**
 * Custom horizon (buildings, trees, parapet): azimuth/altitude points kept on this device only,
 * per site. Imports follow NINA's CustomHorizon parser (docs/RESEARCH.md §3): one "az alt" pair
 * per line in degrees, separators tab/space/comma/semicolon, "#" comments, at least two points,
 * sorted by azimuth, 0°/360° filled, linear interpolation. Exports NINA's .hrz text.
 *
 * The custom horizon drives everything that asks "is it above my horizon?": target hours and
 * scores, altitude charts, the drawn skyline in the 3D sky, and (Phase 5) the telescope HUD.
 */
import type { Place } from '../astro/sky';
import { siteKey } from '../location';

export type HorizonSource = 'hrz' | 'csv' | 'json' | 'panorama' | 'survey' | 'drawn' | 'nina';

export interface CustomHorizon {
  name: string;
  /** [azimuth°, altitude°], sorted by azimuth, 0 ≤ az < 360. */
  points: [number, number][];
  source: HorizonSource;
  updated: number;
}

/** Clean, sort and de-duplicate points; null when fewer than two valid points remain. */
export function normalisePoints(raw: [number, number][]): [number, number][] | null {
  const pts = raw
    .filter(([az, alt]) => Number.isFinite(az) && Number.isFinite(alt))
    .map(([az, alt]): [number, number] => [
      ((az % 360) + 360) % 360,
      Math.max(-5, Math.min(90, alt)),
    ]);
  pts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - p[0]) < 1e-6) last[1] = Math.max(last[1], p[1]);
    else out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/** NINA horizon text (.hrz / .txt) or CSV: "az alt" per line. */
export function parseHorizonText(text: string): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const az = Number(parts[0]);
    const alt = Number(parts[1]);
    // Skips CSV headers such as "azimuth,altitude".
    if (Number.isFinite(az) && Number.isFinite(alt)) pts.push([az, alt]);
  }
  return normalisePoints(pts);
}

/** JSON: [[az, alt]…], [{az, alt}…], {points: …}, or NINA's API {Azimuths: […], Altitudes: […]}. */
export function parseHorizonJson(text: string): [number, number][] | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const o = v as Record<string, unknown>;
  const fromPairs = (a: unknown[]): [number, number][] =>
    a.map((p): [number, number] =>
      Array.isArray(p)
        ? [Number(p[0]), Number(p[1])]
        : [
            Number((p as Record<string, unknown>).az ?? (p as Record<string, unknown>).azimuth),
            Number((p as Record<string, unknown>).alt ?? (p as Record<string, unknown>).altitude),
          ],
    );
  if (Array.isArray(v)) return normalisePoints(fromPairs(v));
  if (o && Array.isArray(o.points)) return normalisePoints(fromPairs(o.points));
  const az = (o?.Azimuths ?? o?.azimuths) as unknown;
  const alt = (o?.Altitudes ?? o?.altitudes) as unknown;
  if (Array.isArray(az) && Array.isArray(alt) && az.length === alt.length)
    return normalisePoints(az.map((a, i): [number, number] => [Number(a), Number(alt[i])]));
  return null;
}

export function parseHorizonFile(
  name: string,
  text: string,
): { points: [number, number][]; source: HorizonSource } | null {
  const isJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
  const pts = isJson ? parseHorizonJson(text) : parseHorizonText(text);
  if (!pts) return null;
  return { points: pts, source: isJson ? 'json' : /\.csv$/i.test(name) ? 'csv' : 'hrz' };
}

/** Altitude at an azimuth, linear interpolation with wrap-around (NINA's behaviour). */
export function altitudeAt(points: readonly [number, number][], az: number): number {
  if (!points.length) return 0;
  const a = ((az % 360) + 360) % 360;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as [number, number];
    const q = points[(i + 1) % points.length] as [number, number];
    const span = (q[0] - p[0] + 360) % 360 || 360;
    const d = (a - p[0] + 360) % 360;
    if (d <= span) return p[1] + ((q[1] - p[1]) * d) / span;
  }
  return points[0]?.[1] ?? 0;
}

/** Points → the 720-step profile (0.5° of azimuth) the sky, charts and ranking use. */
export function toProfile(points: readonly [number, number][], n = 720): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = altitudeAt(points, (i * 360) / n);
  return out;
}

/** NINA .hrz text. */
export function toHrz(h: CustomHorizon): string {
  const head = `# ${h.name} — custom horizon from Astro Night Planning (${new Date(h.updated).toISOString().slice(0, 10)})\n# azimuth altitude (degrees)\n`;
  return head + h.points.map(([az, alt]) => `${az.toFixed(1)} ${alt.toFixed(1)}`).join('\n') + '\n';
}

// ---- device storage, per site --------------------------------------------------------------

const KEY = 'anp.horizon.custom.v1';

function readAll(): Record<string, CustomHorizon> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CustomHorizon>) ?? {};
  } catch {
    return {};
  }
}

export function loadCustomHorizon(place: Place | null): CustomHorizon | null {
  if (!place) return null;
  const h = readAll()[siteKey(place)];
  return h && Array.isArray(h.points) && h.points.length >= 2 ? h : null;
}

export function saveCustomHorizon(place: Place, h: CustomHorizon | null): void {
  const key = siteKey(place);
  const all = Object.fromEntries(Object.entries(readAll()).filter(([k]) => k !== key));
  if (h) all[key] = h;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}
