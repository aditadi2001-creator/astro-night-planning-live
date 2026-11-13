/**
 * NASA GIBS (Global Imagery Browse Services) WMTS, Web Mercator endpoint.
 * No key. Layer names checked against GetCapabilities on 2026-11-13.
 *
 * The geostationary infrared layers are published every 10 minutes and do
 * not accept "current": a time that is not ready yet returns 404, and any time
 * inside a 10-minute slot is snapped down to it. So we ask for an explicit
 * slot and step back until one exists (HEAD requests, no image download).
 */
export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export interface GeoLayer {
  id: string;
  label: string;
  /** Where the satellite sees (lon/lat box; MapLibre bounds cannot cross 180°). */
  bounds: [number, number, number, number];
  /** A tile inside the disk, used to probe which times exist. */
  probe: { z: number; x: number; y: number };
}

export const GEO_LAYERS: readonly GeoLayer[] = [
  {
    id: 'GOES-East_ABI_Band13_Clean_Infrared',
    label: 'GOES-East',
    bounds: [-156, -81, 6, 81],
    probe: { z: 2, x: 1, y: 1 },
  },
  {
    id: 'GOES-West_ABI_Band13_Clean_Infrared',
    label: 'GOES-West',
    bounds: [-180, -81, -56, 81],
    probe: { z: 2, x: 0, y: 1 },
  },
  {
    id: 'Himawari_AHI_Band13_Clean_Infrared',
    label: 'Himawari',
    bounds: [60, -81, 180, 81],
    probe: { z: 2, x: 3, y: 1 },
  },
];

const MATRIX_GEO = 'GoogleMapsCompatible_Level6';

/** Night-lights base map (VIIRS Black Marble 2016) and coastline overlay. */
export const BASE_TILES = `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`;
export const COAST_TILES = `${GIBS}/Coastlines_15m/default/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;

const SLOT = 10 * 60_000;

/** Start of the 10-minute slot containing `ms`. */
export const floorSlot = (ms: number): number => Math.floor(ms / SLOT) * SLOT;

/** GIBS time string, e.g. 2026-11-13T03:20:00Z. */
export const gibsTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** Tile URL template for MapLibre (WMTS order is z/row/col = z/y/x). */
export const geoTiles = (layer: string, ms: number): string =>
  `${GIBS}/${layer}/default/${gibsTime(ms)}/${MATRIX_GEO}/{z}/{y}/{x}.png`;

/**
 * Newest available time for a layer: start 20 minutes back (publishing takes
 * ~35 min) and step back 10 minutes at a time. null if nothing in 2 hours.
 */
export async function latestTime(
  layer: GeoLayer,
  now: number,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  let t = floorSlot(now - 20 * 60_000);
  for (let i = 0; i < 12; i++, t -= SLOT) {
    const { z, x, y } = layer.probe;
    const url = geoTiles(layer.id, t)
      .replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));
    try {
      const r = await fetchFn(url, { method: 'HEAD', signal: signal ?? null });
      if (r.ok) return t;
    } catch (e) {
      if (signal?.aborted) throw e;
      return null; // network down: don't hammer GIBS
    }
  }
  return null;
}

/** Animation frames, oldest first: `count` steps of `stepMin` ending at `latest`. */
export function frameTimes(latest: number, count = 6, stepMin = 30): number[] {
  return Array.from({ length: count }, (_, i) => latest - (count - 1 - i) * stepMin * 60_000);
}
