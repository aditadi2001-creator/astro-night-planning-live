/**
 * "What the satellite sees right now" around a site: brightness temperatures
 * of the newest GMGSI hour at the site and at the 16 cloud-ring points (the
 * same points the forecast ring uses), so the sky view can put observed cloud
 * on the correct side of the sky.
 */
import type { Cached } from '../data/cache';
import { ringPoints } from '../data/openmeteo';
import { loadGmgsiIndex, samplePlaces } from './gmgsi';

export interface SatelliteSample {
  /** GMGSI hour, YYYYMMDDHH (UTC). */
  hour: string;
  /** Image time, ms since epoch. */
  time: number;
  /** Brightness temperatures (K) around the site. */
  site: number[];
  /** Same, at each ring point (order of ringPoints()). */
  ring: number[][];
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
  return {
    data: {
      hour: newest.hour,
      time: Date.parse(newest.time),
      site: bt[0] ?? [],
      ring: bt.slice(1),
    },
    fetchedAt: idx.fetchedAt,
    ...(idx.stale ? { stale: true } : {}),
  };
}
