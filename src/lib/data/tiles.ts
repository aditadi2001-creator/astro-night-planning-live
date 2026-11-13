/**
 * Reading pixel values from the data Worker's WebP tiles (Web Mercator,
 * 256 px). Shared by the satellite (GMGSI) and light-pollution layers.
 */

/** Web Mercator tile and pixel (0–255) containing a place at zoom z. */
export function pixelFor(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * n;
  const tx = Math.min(n - 1, Math.floor(x));
  const ty = Math.min(n - 1, Math.floor(y));
  return {
    tx,
    ty,
    px: Math.min(255, Math.floor((x - tx) * 256)),
    py: Math.min(255, Math.floor((y - ty) * 256)),
  };
}

/** Latitude/longitude of the centre of pixel (px, py) of tile (z, tx, ty). */
export function pixelCenter(z: number, tx: number, ty: number, px: number, py: number) {
  const n = 256 * 2 ** z;
  const x = (tx * 256 + px + 0.5) / n;
  const y = (ty * 256 + py + 0.5) / n;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    lon: x * 360 - 180,
  };
}

const decoded = new Map<string, Promise<ImageData | null>>();

async function decode(url: string, signal: AbortSignal): Promise<ImageData | null> {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null; // no tile = "nothing here" for every layer we use
  if (!res.ok) throw new Error(`tile ${res.status}: ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bmp.width, bmp.height)
      : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Decoded RGBA of one tile (null if the Worker has no tile there); small in-memory cache. */
export function decodeTile(url: string, signal: AbortSignal): Promise<ImageData | null> {
  let p = decoded.get(url);
  if (!p) {
    p = decode(url, signal);
    decoded.set(url, p);
    p.catch(() => decoded.delete(url));
    while (decoded.size > 24) decoded.delete(decoded.keys().next().value as string);
  }
  return p;
}
