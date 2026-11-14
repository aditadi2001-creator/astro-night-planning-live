/**
 * Pixel-exact longitude clipping for GIBS tiles.
 *
 * MapLibre's source `bounds` work per tile, so a 45°-wide tile at zoom 3 would
 * still show a satellite far outside the region it sees well (its disk edge is
 * stretched and smeared). Tiles are fetched through the `gibsclip://` protocol
 * instead: tiles fully inside the region pass through untouched; edge tiles
 * get the outside columns made transparent so the layer below (GMGSI) shows.
 */
import { fetchRetry } from '../data/maptiles';

/** Columns [from, to) of a 256-px tile at zoom z, column x, that fall outside [west, east]. */
export function outsideColumns(
  z: number,
  x: number,
  west: number,
  east: number,
): [number, number][] {
  const n = 256 * 2 ** z;
  const lonOf = (px: number) => ((x * 256 + px + 0.5) / n) * 360 - 180;
  const out: [number, number][] = [];
  let start = -1;
  for (let px = 0; px < 256; px++) {
    const lon = lonOf(px);
    const outside = lon < west || lon > east;
    if (outside && start < 0) start = px;
    if (!outside && start >= 0) {
      out.push([start, px]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, 256]);
  return out;
}

/** gibsclip://… URL for a GIBS tile template, clipped to [west, east]. */
export const clipUrl = (httpsTemplate: string, west: number, east: number): string =>
  `${httpsTemplate.replace(/^https:\/\//, 'gibsclip://')}#${west},${east}`;

/** Parse a resolved gibsclip:// URL back into the real URL, tile address and region. */
export function parseClipUrl(url: string) {
  const [path = '', frag = ''] = url.split('#');
  const real = path.replace(/^gibsclip:\/\//, 'https://');
  const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(real); // WMTS order: z/row/col
  const [w, e] = frag.split(',').map(Number);
  if (!m || w == null || e == null || !Number.isFinite(w) || !Number.isFinite(e)) return null;
  return { real, z: Number(m[1]), y: Number(m[2]), x: Number(m[3]), west: w, east: e };
}

/** The protocol handler body: fetch, clip if needed, return PNG bytes. */
export async function loadClipped(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const p = parseClipUrl(url);
  if (!p) throw new Error(`bad gibsclip url: ${url}`);
  const res = await fetchRetry(p.real, signal);
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const cols = outsideColumns(p.z, p.x, p.west, p.east);
  if (!cols.length) return res.arrayBuffer();
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  for (const [a, b] of cols) ctx.clearRect(a, 0, b - a, canvas.height);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
