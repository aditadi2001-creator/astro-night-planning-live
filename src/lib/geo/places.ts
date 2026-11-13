/**
 * Extra place lookups for the location picker.
 *
 * - OpenStreetMap Nominatim (https://nominatim.org): finds villages, peaks,
 *   observatories and dark sites the city list lacks. Its usage policy allows
 *   at most one request per second, no search-as-you-type, and needs
 *   attribution ("© OpenStreetMap contributors", ODbL), so it is called only
 *   when the user presses a button, and results are cached.
 * - Open-Meteo elevation API (Copernicus DEM GLO-90, free): exact ground
 *   height for typed coordinates.
 */
import { fetchJson } from '../data/cache';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';

export interface OsmPlace {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  kind: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

function toPlace(r: NominatimRow): OsmPlace {
  const a = r.address ?? {};
  const name =
    r.name ||
    a.village ||
    a.town ||
    a.city ||
    a.hamlet ||
    a.suburb ||
    r.display_name.split(',')[0] ||
    'Place';
  // Region parts, without repeating the name or each other.
  const parts = [a.county || a.state_district, a.state, a.country].filter(
    (x): x is string => !!x && x !== name,
  );
  const detail = parts.filter((x, i) => parts.indexOf(x) === i).join(', ');
  return {
    name,
    detail,
    lat: Number(r.lat),
    lon: Number(r.lon),
    kind: (r.addresstype || r.type || '').replace(/_/g, ' '),
  };
}

let last = 0;
/** Keep to Nominatim's one request per second. */
async function politeDelay(): Promise<void> {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

export async function searchOsm(query: string, signal: AbortSignal): Promise<OsmPlace[]> {
  const q = query.trim();
  const key = `osm:${q.toLowerCase()}`;
  await politeDelay();
  const url = `${NOMINATIM}/search?${new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '10',
    'accept-language': 'en',
  })}`;
  const r = await fetchJson<NominatimRow[]>(key, url, {
    maxAgeMs: 30 * 86_400_000,
    retries: 0,
    signal,
  });
  return (Array.isArray(r.data) ? r.data : []).map(toPlace).filter((p) => Number.isFinite(p.lat));
}

export async function reverseOsm(
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<OsmPlace | null> {
  const la = lat.toFixed(4);
  const lo = lon.toFixed(4);
  await politeDelay();
  const url = `${NOMINATIM}/reverse?${new URLSearchParams({
    lat: la,
    lon: lo,
    format: 'jsonv2',
    zoom: '12',
    addressdetails: '1',
    'accept-language': 'en',
  })}`;
  try {
    const r = await fetchJson<NominatimRow & { error?: string }>(`osmrev:${la},${lo}`, url, {
      maxAgeMs: 30 * 86_400_000,
      retries: 0,
      signal,
    });
    return r.data && !r.data.error ? toPlace(r.data) : null;
  } catch {
    return null;
  }
}

export async function elevationAt(
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<number | null> {
  const url = `${ELEVATION}?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`;
  try {
    const r = await fetchJson<{ elevation?: number[] }>(
      `elev:${lat.toFixed(4)},${lon.toFixed(4)}`,
      url,
      {
        maxAgeMs: 365 * 86_400_000,
        retries: 1,
        signal,
      },
    );
    const e = r.data.elevation?.[0];
    return typeof e === 'number' && Number.isFinite(e) ? e : null;
  } catch {
    return null;
  }
}
