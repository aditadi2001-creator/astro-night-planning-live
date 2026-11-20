/**
 * SDSS objects in search. The app's deep-sky layer (R2 via the data Worker, /hips/dso2) holds
 * the SDSS DR17 spectroscopic galaxies, about 2.6 million, drawn in the 3D sky. They are far too
 * many to download for searching, so:
 *  - "SDSS J103843.59+484917.7" carries its own position (IAU name = J2000 coordinates): found
 *    with no download;
 *  - short names ("SDSS J1038+4849") and "list SDSS objects around here" read the same tiles the
 *    sky draws from (a few Worker requests, cached);
 *  - famous SDSS discoveries are found by their nicknames (smiley lens, Hanny's Voorwerp…).
 */
import { ang2pixNest } from '../sky/healpix';
import { decodeEph, type EphRow } from './eph';

export interface SdssName {
  /** Full IAU-style name, or the short form as typed (e.g. "SDSS J1038+4849"). */
  name: string;
  ra: number;
  dec: number;
  /** Short forms are only good to about a minute of RA and an arcminute of Dec. */
  exact: boolean;
  /** For short forms: the name prefix and the declination part to match in the catalog. */
  prefix?: string;
  decPart?: string;
}

/**
 * "SDSS J103843.59+484917.7" (or without "SDSS", or with a space) → its J2000 position.
 * "SDSS J1038+4849" → approximate position and the parts to match. Exported for tests.
 */
export function parseSdssName(q: string): SdssName | null {
  const t = q.trim().replace(/\s+/g, '').toUpperCase().replace(/^SDSS/, '');
  const full = /^J(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([+-−])(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(t);
  if (full) {
    const [, h, m, s, sg, d, dm, ds] = full as unknown as string[];
    const ra = (Number(h) + Number(m) / 60 + Number(s) / 3600) * 15;
    const dec = (sg === '+' ? 1 : -1) * (Number(d) + Number(dm) / 60 + Number(ds) / 3600);
    const name = `SDSS J${h}${m}${s}${sg === '+' ? '+' : '-'}${d}${dm}${ds}`;
    return { name, ra, dec, exact: true };
  }
  const short = /^J(\d{2})(\d{2})(\d?)([+-−])(\d{2})(\d{2})?$/.exec(t);
  if (short) {
    const [, h, m, s1, sg, d, dm] = short as unknown as string[];
    const ra = (Number(h) + (Number(m) + 0.5) / 60) * 15;
    const dec = (sg === '+' ? 1 : -1) * (Number(d) + (Number(dm ?? 30) + 0.5) / 60);
    const sign = sg === '+' ? '+' : '-';
    return {
      name: `SDSS J${h}${m}${s1}${sign}${d}${dm ?? ''}`,
      ra,
      dec,
      exact: false,
      prefix: `SDSS J${h}${m}${s1}`,
      decPart: `${sign}${d}${dm ?? ''}`,
    };
  }
  return null;
}

/** Famous SDSS discoveries, positions from their IAU names (J2000). */
export const FAMOUS_SDSS: {
  name: string;
  nick: string;
  sub: string;
  ra: number;
  dec: number;
  keys: string[];
}[] = [
  {
    name: 'SDSS J103843.59+484917.7',
    nick: 'Cheshire Cat "smiley face" lens',
    sub: 'Galaxy group in Ursa Major whose gravity bends background galaxies into a smile (Hubble images show it best)',
    ra: 159.68163,
    dec: 48.82158,
    keys: ['smiley', 'smiley face', 'smile', 'cheshire cat', 'sdss j1038+4849'],
  },
  {
    name: 'SDSS J094103.80+344334.2',
    nick: "Hanny's Voorwerp",
    sub: 'Glowing gas cloud beside IC 2497 in Leo Minor, found by Galaxy Zoo volunteer Hanny van Arkel',
    ra: 145.26583,
    dec: 34.72617,
    keys: ['hanny', 'voorwerp', 'hannys voorwerp'],
  },
  {
    name: 'SDSS J114833.15+193003.2',
    nick: 'Cosmic Horseshoe',
    sub: 'Near-complete Einstein ring in Leo: a distant galaxy lensed into a horseshoe',
    ra: 177.13813,
    dec: 19.50089,
    keys: ['cosmic horseshoe', 'horseshoe lens'],
  },
  {
    name: 'SDSS J100434.91+411242.8',
    nick: 'Five-image lensed quasar',
    sub: 'One quasar seen five times through a galaxy cluster in Leo Minor',
    ra: 151.14546,
    dec: 41.21189,
    keys: ['lensed quasar', 'sdss j1004+4112', 'five image quasar'],
  },
  {
    name: 'SDSS J143029.88+133912.0',
    nick: 'Teacup galaxy',
    sub: 'Galaxy in Boötes with a teacup-shaped loop of glowing gas lit by its active nucleus',
    ra: 217.6245,
    dec: 13.65333,
    keys: ['teacup', 'teacup galaxy'],
  },
  {
    name: 'SDSS J224024.1-092748',
    nick: 'Green Bean galaxy',
    sub: 'Galaxy in Aquarius whose surrounding gas glows green, lit by a fading quasar',
    ra: 340.10042,
    dec: -9.46333,
    keys: ['green bean', 'green bean galaxy'],
  },
];

// ---- reading the installed tiles ---------------------------------------------------------

export interface SdssObject {
  /** The SDSS name (the first one when an object has several). */
  name: string;
  /** Other names of the same object (NGC, PGC, UGC…). */
  others: string[];
  ra: number;
  dec: number;
  /** Petrosian r magnitude (SDSS) or the catalog magnitude. */
  mag: number | null;
  /** Redshift, when the catalog has it. */
  z: number | null;
  /** Major axis, arcminutes. */
  sizeArcmin: number | null;
}

const D = Math.PI / 180;
const MAX_ORDER = 7;
/** Objects in a full tile of the deep-sky layer (more live in its four children). */
const TILE_FULL = 512;

function sep(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * D) * Math.sin(dec2 * D) +
    Math.cos(dec1 * D) * Math.cos(dec2 * D) * Math.cos((ra1 - ra2) * D);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D;
}

/** A tile row → an SDSS object (null when the object has no SDSS name). */
export function sdssFromRow(r: EphRow): SdssObject | null {
  const ids = String(r.ids ?? '')
    .split('|')
    .filter(Boolean);
  const sd = ids.find((n) => n.startsWith('SDSS J'));
  if (!sd) return null;
  const ra = (((Number(r.ra) / D) % 360) + 360) % 360;
  const dec = Number(r.de) / D;
  const mag = Number.isFinite(Number(r.vmag))
    ? Number(r.vmag)
    : Number.isFinite(Number(r.bmag))
      ? Number(r.bmag)
      : null;
  const zm = /z=([\d.]+)/.exec(String(r.morp ?? ''));
  const smax = Number(r.smax);
  return {
    name: sd,
    others: ids.filter((n) => !n.startsWith('SDSS J') && !n.startsWith('NAME ')).slice(0, 4),
    ra,
    dec,
    mag,
    z: zm ? Number(zm[1]) : null,
    sizeArcmin: Number.isFinite(smax) && smax > 0 ? (smax / D) * 60 : null,
  };
}

/** Tiles to read around a point: every order down to the deepest, the pixels the circle touches. */
export function tilesAround(
  ra: number,
  dec: number,
  radiusDeg: number,
): { order: number; pix: number }[] {
  const out: { order: number; pix: number }[] = [];
  const pts: [number, number][] = [[ra, dec]];
  const cd = Math.max(0.1, Math.cos(dec * D));
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    pts.push([ra + (dx * radiusDeg) / cd, Math.max(-89.9, Math.min(89.9, dec + dy * radiusDeg))]);
  for (let o = 0; o <= MAX_ORDER; o++) {
    const seen = new Set<number>();
    for (const [a, b] of o < 4 ? pts.slice(0, 1) : pts)
      seen.add(
        ang2pixNest(o, ((90 - b) * Math.PI) / 180, ((((a % 360) + 360) % 360) * Math.PI) / 180),
      );
    for (const pix of seen) out.push({ order: o, pix });
  }
  return out;
}

/**
 * The installed SDSS objects within `radiusDeg` of a point, brightest first (at most `limit`).
 * `base` is the data Worker's /hips/dso2 URL. Missing deeper tiles (404) just end the descent.
 */
export async function sdssInstalledAround(
  base: string,
  ra: number,
  dec: number,
  radiusDeg: number,
  limit = 300,
  fetcher: typeof fetch = fetch,
): Promise<SdssObject[]> {
  const found = new Map<string, SdssObject>();
  const tiles = tilesAround(ra, dec, radiusDeg);
  // A tile has children only when it is full (512 objects): descend order by order and ask
  // only for pixels under a full parent, so no request is made for a tile that does not exist.
  const full = new Set<string>();
  for (let order = 0; order <= MAX_ORDER; order++) {
    const want = tiles.filter(
      (t) =>
        t.order === order && (order === 0 || full.has(`${order - 1}/${Math.floor(t.pix / 4)}`)),
    );
    if (!want.length) break;
    await Promise.all(
      want.map(async ({ pix }) => {
        const url = `${base}/Norder${order}/Dir${Math.floor(pix / 10000) * 10000}/Npix${pix}.eph`;
        let r: Response;
        try {
          r = await fetcher(url);
        } catch {
          return;
        }
        if (!r.ok) return;
        const rows = await decodeEph(await r.arrayBuffer());
        if (rows.length >= TILE_FULL) full.add(`${order}/${pix}`);
        for (const row of rows) {
          const o = sdssFromRow(row);
          if (o && sep(ra, dec, o.ra, o.dec) <= radiusDeg && !found.has(o.name))
            found.set(o.name, o);
        }
      }),
    );
  }
  return [...found.values()].sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99)).slice(0, limit);
}
