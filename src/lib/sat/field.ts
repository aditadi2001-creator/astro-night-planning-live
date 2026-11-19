/**
 * The satellite's cloud field around a site, for placing real clouds in the sky.
 *
 * A square grid ±RADIUS km around the site (5 km cells) of GMGSI infrared
 * brightness temperatures at zoom 5 (~5 km pixels). The sky renderer turns
 * each cell into a cloud fraction and a cloud-top height and draws it where a
 * line of sight meets that height (clouds.ts, `fieldCover`).
 */
import { decodeTile, pixelFor } from '../data/tiles';
import { gmgsiTiles } from './gmgsi';
import { kelvinFromGrey } from './ir';

export const FIELD_RADIUS_KM = 300;
export const FIELD_STEP_KM = 5;
export const FIELD_N = (2 * FIELD_RADIUS_KM) / FIELD_STEP_KM + 1; // 121

export interface CloudField {
  /** GMGSI hour (YYYYMMDDHH) and image time (ms). */
  hour: string;
  time: number;
  /** Cells per side; cell (ix, iy) is at x = (ix − c)·step km east, y = (iy − c)·step km north. */
  n: number;
  stepKm: number;
  /** Brightness temperature (K) per cell, row-major from south to north; NaN = no data. */
  bt: Float32Array;
}

const KM_PER_DEG = 111.32;

export async function loadCloudField(
  hour: string,
  time: number,
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<CloudField> {
  const z = 5;
  const n = FIELD_N;
  const c = (n - 1) / 2;
  const tpl = gmgsiTiles(hour);
  const world = 256 * 2 ** z;
  const bt = new Float32Array(n * n).fill(Number.NaN);
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  // Group the 121 × 121 cells by the tile they fall in: one wait per tile, not per cell.
  const byTile = new Map<string, { tx: number; ty: number; cells: number[] }>();
  for (let iy = 0; iy < n; iy++) {
    const la = lat + ((iy - c) * FIELD_STEP_KM) / KM_PER_DEG;
    if (la <= -85 || la >= 85) continue;
    for (let ix = 0; ix < n; ix++) {
      const lo = lon + ((ix - c) * FIELD_STEP_KM) / (KM_PER_DEG * cosLat);
      const p = pixelFor(la, ((((lo + 180) % 360) + 360) % 360) - 180, z);
      const gx = (p.tx * 256 + p.px) % world;
      const tx = Math.floor(gx / 256);
      const key = `${tx},${p.ty}`;
      let g = byTile.get(key);
      if (!g) {
        g = { tx, ty: p.ty, cells: [] };
        byTile.set(key, g);
      }
      // Cell index and the pixel offset inside the tile.
      g.cells.push(iy * n + ix, (p.py * 256 + (gx % 256)) * 4);
    }
  }
  await Promise.all(
    [...byTile.values()].map(async (g) => {
      const url = tpl
        .replace('{z}', String(z))
        .replace('{x}', String(g.tx))
        .replace('{y}', String(g.ty));
      const img = await decodeTile(url, signal).catch(() => null);
      if (!img) return;
      const d = img.data;
      for (let j = 0; j < g.cells.length; j += 2) {
        const i = g.cells[j + 1] as number;
        if ((d[i + 3] ?? 0) === 0) continue;
        bt[g.cells[j] as number] = kelvinFromGrey(d[i] ?? 0);
      }
    }),
  );
  return { hour, time, n, stepKm: FIELD_STEP_KM, bt };
}
