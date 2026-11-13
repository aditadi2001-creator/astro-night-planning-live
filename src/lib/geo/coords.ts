/**
 * Parse typed or pasted coordinates in the common forms:
 *   12.9716, 77.5946            (Google Maps "lat, lon")
 *   12.9716 77.5946
 *   12.9716N 77.5946E           -33.86 151.21    33.86S, 151.21E
 *   12°58'17.8"N 77°35'40.6"E   (degrees, minutes, seconds)
 *   12 58 17.8 N, 77 35 40.6 E
 *   N 12° 58.297' E 77° 35.677' (degrees and decimal minutes)
 * Returns null when the text is not a coordinate pair or is out of range.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

const NUM = String.raw`[-+]?\d+(?:[.,]\d+)?`;

function parseOne(part: string, isLat: boolean): number | null {
  let s = part
    .trim()
    .toUpperCase()
    .replace(/[′’']/g, "'")
    .replace(/[″”"]|''/g, '"');
  let sign = 1;
  const hemi = /[NSEW]/.exec(s)?.[0];
  if (hemi) {
    if ((isLat && (hemi === 'E' || hemi === 'W')) || (!isLat && (hemi === 'N' || hemi === 'S')))
      return null;
    if (hemi === 'S' || hemi === 'W') sign = -1;
    s = s.replace(/[NSEW]/g, ' ');
  }
  const nums = s.match(new RegExp(NUM, 'g'))?.map((x) => Number(x.replace(',', '.')));
  if (!nums?.length || nums.length > 3 || nums.some((n) => !Number.isFinite(n))) return null;
  const [d = 0, m = 0, sec = 0] = nums;
  if (m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
  const neg = d < 0 || /^\s*-/.test(s);
  const v = Math.abs(d) + m / 60 + sec / 3600;
  return (neg ? -1 : 1) * sign * v;
}

/** Split "A, B" / "A B" / "12°N 77°E" into the latitude and longitude parts. */
function split(text: string): [string, string] | null {
  const t = text.trim();
  // Hemisphere letters mark the boundary: "12 58 17 N 77 35 40 E", "N 12 58 E 77 35".
  const lead = /^([NS][^EW]+)([EW].+)$/i.exec(t);
  if (lead?.[1] && lead[2]) return [lead[1], lead[2]];
  const trail = /^(.+?[NS])[\s,;]+(.+[EW])$/i.exec(t);
  if (trail?.[1] && trail[2]) return [trail[1], trail[2]];
  // Comma/semicolon between the two (decimal commas only if there are two separators).
  const parts = t.split(/\s*[;,]\s*/);
  if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
  // Two plain numbers separated by spaces.
  const sp = t.split(/\s+/);
  if (sp.length === 2 && sp[0] && sp[1]) return [sp[0], sp[1]];
  return null;
}

export function parseCoordinates(text: string): LatLon | null {
  if (!/\d/.test(text) || text.length > 80) return null;
  const parts = split(text);
  if (!parts) return null;
  const lat = parseOne(parts[0], true);
  const lon = parseOne(parts[1], false);
  if (lat == null || lon == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** "12.9716° N, 77.5946° E" */
export function formatLatLon(p: LatLon, digits = 4): string {
  return `${Math.abs(p.lat).toFixed(digits)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(digits)}° ${p.lon >= 0 ? 'E' : 'W'}`;
}
