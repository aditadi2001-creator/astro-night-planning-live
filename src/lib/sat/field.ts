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
  const tiles = new Map<string, Promise<ImageData | null>>();
  const tile = (tx: number, ty: number) => {
    const k = `${tx},${ty}`;
    let p = tiles.get(k);
    if (!p) {
      p = decodeTile(
        tpl.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty)),
        signal,
      ).catch(() => null);
      tiles.set(k, p);
    }
    return p;
  };
  const jobs: Promise<void>[] = [];
  for (let iy = 0; iy < n; iy++) {
    const la = lat + ((iy - c) * FIELD_STEP_KM) / KM_PER_DEG;
    if (la <= -85 || la >= 85) continue;
    for (let ix = 0; ix < n; ix++) {
      const lo = lon + ((ix - c) * FIELD_STEP_KM) / (KM_PER_DEG * cosLat);
      const p = pixelFor(la, ((((lo + 180) % 360) + 360) % 360) - 180, z);
      const gx = (p.tx * 256 + p.px) % world;
      const tx = Math.floor(gx / 256);
      const k = iy * n + ix;
      jobs.push(
        tile(tx, p.ty).then((img) => {
          if (!img) return;
          const i = (p.py * 256 + (gx % 256)) * 4;
          if ((img.data[i + 3] ?? 0) === 0) return;
          bt[k] = kelvinFromGrey(img.data[i] ?? 0);
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { hour, time, n, stepKm: FIELD_STEP_KM, bt };
}
