/**
 * Extra details for the info drawer, fetched when an object is opened and cached on the device
 * for 30 days: SIMBAD data through the Sesame resolver (CfA mirror, IDIA fallback — CDS itself
 * is degraded) and the Wikipedia summary. Only the object's name is sent. Any field a service
 * does not give stays unknown ("n/a").
 */
import { fetchJson } from '../data/cache';

export interface SimbadDetails {
  name: string | null;
  otype: string | null;
  spType: string | null;
  morph: string | null;
  /** Parallax, mas. */
  plx: number | null;
  /** Proper motion, mas/yr. */
  pmRa: number | null;
  pmDec: number | null;
  /** Radial velocity, km/s. */
  rv: number | null;
  z: number | null;
  mags: Record<string, number>;
  aliases: string[];
}

const num = (s: string | undefined) =>
  s != null && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1]?.trim();

/** Parse Sesame's XML (option -oxpI). Exported for tests. */
export function parseSesameDetails(xml: string): SimbadDetails | null {
  if (!/<jradeg>/.test(xml)) return null;
  const pm = /<pm>([\s\S]*?)<\/pm>/.exec(xml)?.[1] ?? '';
  const vel = /<Vel>([\s\S]*?)<\/Vel>/.exec(xml)?.[1] ?? '';
  const plx = /<plx>([\s\S]*?)<\/plx>/.exec(xml)?.[1] ?? '';
  const zBlock = /<z>([\s\S]*?)<\/z>/.exec(xml)?.[1] ?? '';
  const mags: Record<string, number> = {};
  for (const m of xml.matchAll(/<mag band="([^"]+)">\s*<v>([-\d.]+)<\/v>/g)) {
    const v = Number(m[2]);
    if (m[1] && Number.isFinite(v)) mags[m[1]] = v;
  }
  const aliases = [...xml.matchAll(/<alias>([^<]+)<\/alias>/g)].map((m) =>
    (m[1] ?? '').replace(/\s+/g, ' ').trim(),
  );
  return {
    name: tag(xml, 'oname')?.replace(/^\{Name\}\s*|^\*+\s*/g, '') ?? null,
    otype: tag(xml, 'otype') ?? null,
    spType: tag(xml, 'spType') ?? null,
    morph: tag(xml, 'MType') ?? null,
    plx: num(tag(plx, 'v')),
    pmRa: num(tag(pm, 'pmRA')),
    pmDec: num(tag(pm, 'pmDE')),
    rv: num(tag(vel, 'v')),
    z: num(tag(zBlock, 'v')),
    mags,
    aliases: aliases.slice(0, 40),
  };
}

const SESAME = [
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxpI/S?',
  'https://vizier.idia.ac.za/viz-bin/nph-sesame/-oxpI/S?',
];

export async function loadSimbad(
  name: string,
  signal?: AbortSignal,
): Promise<SimbadDetails | null> {
  let last: unknown = null;
  for (const base of SESAME) {
    try {
      const r = await fetchJson<{ d: SimbadDetails | null }, string>(
        `simbad:${name.toLowerCase()}`,
        base + encodeURIComponent(name),
        {
          maxAgeMs: 30 * 86400_000,
          retries: 0,
          text: true,
          ...(signal ? { signal } : {}),
          transform: (xml) => ({ d: parseSesameDetails(xml) }),
        },
      );
      return r.data.d;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('SIMBAD lookup failed');
}

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumb: string | null;
}

/** Wikipedia REST summary (CORS allowed); null when there is no article. */
export async function loadWikipedia(
  title: string,
  signal?: AbortSignal,
): Promise<WikiSummary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  try {
    const r = await fetchJson<
      WikiSummary | null,
      {
        type?: string;
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
        thumbnail?: { source?: string };
      }
    >(`wiki:${title.toLowerCase()}`, url, {
      maxAgeMs: 30 * 86400_000,
      retries: 0,
      ...(signal ? { signal } : {}),
      transform: (j) =>
        j.extract && j.type !== 'disambiguation'
          ? {
              title: j.title ?? title,
              extract: j.extract,
              url: j.content_urls?.desktop?.page ?? '',
              thumb: j.thumbnail?.source ?? null,
            }
          : null,
    });
    return r.data;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return null;
  }
}

/** Plain words for common SIMBAD object types. */
export const OTYPE_WORDS: Record<string, string> = {
  G: 'galaxy',
  GiG: 'galaxy in a group',
  GiC: 'galaxy in a cluster',
  SBG: 'starburst galaxy',
  AGN: 'active galaxy',
  QSO: 'quasar',
  BLL: 'BL Lacertae object',
  Sy1: 'Seyfert galaxy',
  Sy2: 'Seyfert galaxy',
  LIN: 'LINER galaxy',
  PN: 'planetary nebula',
  HII: 'HII (ionised hydrogen) region',
  RNe: 'reflection nebula',
  DNe: 'dark nebula',
  SNR: 'supernova remnant',
  OpC: 'open star cluster',
  GlC: 'globular star cluster',
  'Cl*': 'star cluster',
  '*': 'star',
  '**': 'double star',
  'SB*': 'spectroscopic binary',
  'EB*': 'eclipsing binary',
  'V*': 'variable star',
  'dS*': 'delta Scuti variable star',
  'Ce*': 'Cepheid variable',
  'Mi*': 'Mira variable',
  'RR*': 'RR Lyrae variable',
  'WD*': 'white dwarf',
  'Be*': 'Be star',
  'BS*': 'blue straggler',
  'RG*': 'red giant',
  'sg*': 'supergiant',
  'Em*': 'emission-line star',
  Pl: 'exoplanet',
  MoC: 'molecular cloud',
  ISM: 'interstellar matter',
};

export function otypeWords(o: string | null): string | null {
  if (!o) return null;
  return OTYPE_WORDS[o] ?? null;
}
