/**
 * NOAA GMGSI hourly infrared mosaic, published by our own pipeline
 * (pipelines/clouds/gmgsi.py) as one PMTiles file per hour in R2 and served
 * tile by tile by the data Worker. Grey level g → T = (660 − g) / 2 kelvin;
 * alpha 0 = no data (beyond ~72.7° latitude).
 *
 * Here: the list of published hours, and reading pixel values at given places
 * (the site and the 16 cloud-ring points) to measure cloud from the satellite.
 */
import { DATA_BASE } from '../config';
import { fetchJson, type Cached } from '../data/cache';
import { kelvinFromGrey } from './ir';
import { decodeTile, pixelFor } from '../data/tiles';

export { pixelFor };

export interface GmgsiIndex {
  hours: { hour: string; time: string }[];
  maxzoom: number;
}

export const GMGSI_INDEX_URL = DATA_BASE ? `${DATA_BASE}/data/clouds-latest.json` : '';

export const gmgsiTiles = (hour: string): string =>
  `${DATA_BASE}/tiles/clouds-${hour}/{z}/{x}/{y}.webp`;

export async function loadGmgsiIndex(
  signal: AbortSignal,
  force = false,
): Promise<Cached<GmgsiIndex>> {
  return fetchJson<GmgsiIndex>('gmgsi.index', GMGSI_INDEX_URL, {
    maxAgeMs: force ? 0 : 10 * 60_000,
    signal,
  });
}

/**
 * Brightness temperatures (K) of the (2r+1)² pixels around each place, at zoom
 * 4 (~10 km pixels; r = 1 covers ~30 km). Places outside the data get [].
 */
export async function samplePlaces(
  hour: string,
  places: readonly { lat: number; lon: number }[],
  signal: AbortSignal,
  z = 4,
  r = 1,
): Promise<number[][]> {
  const tpl = gmgsiTiles(hour);
  const n = 2 ** z;
  return Promise.all(
    places.map(async ({ lat, lon }) => {
      const c = pixelFor(lat, lon, z);
      const out: number[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          // Global pixel coordinates, wrapping in longitude.
          const gx = (((c.tx * 256 + c.px + dx) % (n * 256)) + n * 256) % (n * 256);
          const gy = c.ty * 256 + c.py + dy;
          if (gy < 0 || gy >= n * 256) continue;
          const tx = Math.floor(gx / 256);
          const ty = Math.floor(gy / 256);
          const img = await decodeTile(
            tpl.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty)),
            signal,
          );
          if (!img) continue;
          const i = ((gy % 256) * 256 + (gx % 256)) * 4;
          if ((img.data[i + 3] ?? 0) === 0) continue; // no data
          out.push(kelvinFromGrey(img.data[i] ?? 0));
        }
      }
      return out;
    }),
  );
}
