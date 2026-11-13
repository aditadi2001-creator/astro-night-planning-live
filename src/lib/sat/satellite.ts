/**
 * "What the satellite sees right now" around a site: brightness temperatures
 * of the newest GMGSI hour at the site and at the 16 cloud-ring points (the
 * same points the forecast ring uses), so the sky view can put observed cloud
 * on the correct side of the sky.
 */
import type { Cached } from '../data/cache';
import { ringPoints } from '../data/openmeteo';
import { loadGmgsiIndex, samplePlaces } from './gmgsi';
import { loadCloudField, type CloudField } from './field';

export interface SatelliteSample {
  /** GMGSI hour, YYYYMMDDHH (UTC). */
  hour: string;
  /** Image time, ms since epoch. */
  time: number;
  /** Brightness temperatures (K) around the site. */
  site: number[];
  /** Same, at each ring point (order of ringPoints()). */
  ring: number[][];
  /** Site brightness temperatures for the newest and up to 4 earlier hours, newest first. */
  history: { hour: string; time: number; site: number[] }[];
  /** Cloud field ±300 km around the site for drawing real clouds (null if unavailable). */
  field: CloudField | null;
}

export async function loadSatellite(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<SatelliteSample>> {
  const idx = await loadGmgsiIndex(signal, force);
  const newest = idx.data.hours[0];
  if (!newest) throw new Error('No satellite hours published yet');
  const places = [{ lat, lon }, ...ringPoints(lat, lon)];
  const bt = await samplePlaces(newest.hour, places, signal);
  // Earlier hours at the site only (one tile each), for the "recorded" timeline hours.
  const earlier = await Promise.all(
    idx.data.hours.slice(1, 5).map(async (h) => {
      try {
        const v = await samplePlaces(h.hour, [{ lat, lon }], signal);
        return { hour: h.hour, time: Date.parse(h.time), site: v[0] ?? [] };
      } catch {
        return null;
      }
    }),
  );
  const time = Date.parse(newest.time);
  const field = await loadCloudField(newest.hour, time, lat, lon, signal).catch(() => null);
  return {
    data: {
      field,
      hour: newest.hour,
      time: Date.parse(newest.time),
      site: bt[0] ?? [],
      ring: bt.slice(1),
      history: [
        { hour: newest.hour, time: Date.parse(newest.time), site: bt[0] ?? [] },
        ...earlier.filter((x): x is NonNullable<typeof x> => !!x && x.site.length > 0),
      ],
    },
    fetchedAt: idx.fetchedAt,
    ...(idx.stale ? { stale: true } : {}),
  };
}
