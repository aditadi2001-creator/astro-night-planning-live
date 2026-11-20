/**
 * Unified search index (runs inside a Web Worker, src/lib/search/search.worker.ts).
 *
 * One flat list of entries — deep-sky objects from every catalog, bright stars, constellations,
 * the Sun/Moon/planets, curated notable objects, and the catalogs and sky surveys themselves —
 * each with normalised search terms. Queries match designations exactly or by prefix
 * ("m31", "ngc 7000", "sh2-129", "alf lyr", "α Lyr"), common names by word prefix
 * ("andromeda", "north amer") and, when nothing else matches, with one typo allowed.
 */

export type EntryKind =
  'planet' | 'star' | 'dso' | 'constellation' | 'notable' | 'catalog' | 'survey' | 'online';

export interface Entry {
  kind: EntryKind;
  /** Main label (designation or proper name). */
  label: string;
  /** Second line: common names / type / magnitude. */
  sub: string;
  /** Normalised designations (exact/prefix matches). */
  ids: string[];
  /** Normalised name words (word-prefix and fuzzy matches). */
  words: string[];
  /** Normalised full names ("horseheadnebula"): exact or prefix matches rank above word matches. */
  names?: string[];
  /** Catalog badges ("M", "NGC", "Sh2", "H400", …). */
  badges: string[];
  ra?: number;
  dec?: number;
  /** Apparent size (degrees), to zoom the sky. */
  sizeDeg?: number;
  mag?: number | null;
  /** Object type for display ("galaxy", "planetary"…). */
  type?: string;
  /** What the sky engine understands ("M 31", "HIP 91262", "Saturn"). */
  engineId?: string;
  /** Catalog entries: the badge whose members to list. Survey entries: survey id. */
  ref?: string;
  /** Tie-break: lower is more important. */
  rank: number;
  /** Catalog facts for the info drawer (deep-sky objects). */
  info?: {
    designations: string[];
    common: string[];
    min: number | null;
    pa: number | null;
    z: number | null;
    distKpc: number | null;
    morph: string | null;
  };
}

const GREEK: Record<string, string> = {
  α: 'alf',
  β: 'bet',
  γ: 'gam',
  δ: 'del',
  ε: 'eps',
  ζ: 'zet',
  η: 'eta',
  θ: 'tet',
  ϑ: 'tet',
  ι: 'iot',
  κ: 'kap',
  λ: 'lam',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  ο: 'omi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sig',
  τ: 'tau',
  υ: 'ups',
  φ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'ome',
};
const GREEK_WORDS: Record<string, string> = {
  alpha: 'alf',
  beta: 'bet',
  gamma: 'gam',
  delta: 'del',
  epsilon: 'eps',
  zeta: 'zet',
  theta: 'tet',
  iota: 'iot',
  kappa: 'kap',
  lambda: 'lam',
  omicron: 'omi',
  sigma: 'sig',
  upsilon: 'ups',
  omega: 'ome',
};

/** Lower-case, Greek letters to their 3-letter codes, accents and separators removed. */
export function norm(s: string): string {
  let t = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[α-ωϑ]/g, (c) => GREEK[c] ?? c);
  t = t.replace(
    /\b(alpha|beta|gamma|delta|epsilon|zeta|theta|iota|kappa|lambda|omicron|sigma|upsilon|omega)\b/g,
    (w) => GREEK_WORDS[w] ?? w,
  );
  // "Sh 2-129" and "Sh2-129" both → "sh2129"; "Messier 31" → "m31"; "Caldwell 20" → "c20".
  // Only before a number: "messier" alone must still find the Messier catalog itself.
  t = t.replace(/\bmessier\s*(?=\d)/g, 'm').replace(/\bcaldwell\s*(?=\d)/g, 'c');
  return t.replace(/[^a-z0-9+]/g, '');
}

/** Name → words for word-prefix matching ("North America Nebula" → north, america, nebula). */
export function nameWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

export interface Hit {
  entry: Entry;
  score: number;
}

/** Levenshtein distance capped at max+1 (early exit). */
export function editDistance(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

function scoreEntry(e: Entry, q: string, qWords: string[]): number {
  let best = 0;
  for (const id of e.ids) {
    if (id === q) return 1000 - e.rank;
    if (id.startsWith(q)) best = Math.max(best, 700 - (id.length - q.length) * 5 - e.rank);
  }
  for (const n of e.names ?? []) {
    if (n === q) best = Math.max(best, 850 - e.rank);
    else if (n.startsWith(q)) best = Math.max(best, 650 - e.rank);
  }
  if (qWords.length) {
    // Every query word must be a prefix of some name word.
    let all = true;
    let exact = 0;
    for (const w of qWords) {
      let ok = false;
      for (const nw of e.words) {
        if (nw === w) {
          ok = true;
          exact++;
          break;
        }
        if (nw.startsWith(w)) ok = true;
      }
      if (!ok) {
        all = false;
        break;
      }
    }
    if (all) best = Math.max(best, 500 + exact * 40 - e.rank);
  }
  return best;
}

/**
 * Search the index. Returns hits sorted by score; at most `limit`. With fewer than 5 good
 * matches and a query of 5+ letters, name words within one edit are also accepted.
 */
export function search(entries: readonly Entry[], query: string, limit = 40): Hit[] {
  const q = norm(query);
  if (!q) return [];
  const qWords = nameWords(query);
  const hits: Hit[] = [];
  for (const e of entries) {
    const s = scoreEntry(e, q, qWords);
    if (s > 0) hits.push({ entry: e, score: s });
  }
  if (hits.length < 5 && q.length >= 5) {
    const seen = new Set(hits.map((h) => h.entry));
    for (const e of entries) {
      if (seen.has(e)) continue;
      // At least one real word (4+ letters) must be close: short words alone ("mrk", "421")
      // used to accept every entry in the index.
      const fuzzy =
        qWords.some((w) => w.length >= 4) &&
        qWords.every(
          (w) =>
            w.length < 4 ||
            e.words.some(
              (nw) =>
                editDistance(w, nw.slice(0, w.length + 1), 1) <= 1 || editDistance(w, nw, 1) <= 1,
            ),
        );
      if (fuzzy) hits.push({ entry: e, score: 200 - e.rank });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank);
  return hits.slice(0, limit);
}

/** Members of one catalog (badge), sorted by their number in it. */
export function browse(entries: readonly Entry[], badge: string, limit = 200): Entry[] {
  const num = (e: Entry) => {
    const id = e.label.startsWith(badge)
      ? e.label
      : (e.sub.split(' · ').find((x) => x.startsWith(badge)) ?? '');
    const m = /(\d+)/.exec(id.slice(badge.length));
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return entries
    .filter((e) => e.kind === 'dso' && e.badges.includes(badge))
    .sort((a, b) => num(a) - num(b))
    .slice(0, limit);
}

// ---- building entries from the static catalog shards ------------------------------------

export interface Shard {
  columns: string[];
  rows: unknown[][];
}

const PRIMARY_RANK: Record<string, number> = { M: 0, C: 2, H400: 3, NGC: 4, IC: 6, Sh2: 6, B: 7 };
const BADGE_OF = (designation: string): string => {
  if (designation === 'H400') return 'H400';
  if (designation.startsWith('Sh 2-')) return 'Sh2';
  if (designation.startsWith('PN G')) return 'PN G';
  if (designation.startsWith('SNR G')) return 'SNR G';
  if (designation.startsWith('vdB-Ha')) return 'vdB-Ha';
  return designation.split(' ')[0] ?? designation;
};

/** "galaxy" → "Galaxy", "cluster-nebula" → "Cluster with nebula". */
export const KIND_LABEL: Record<string, string> = {
  galaxy: 'Galaxy',
  'galaxy-pair': 'Interacting galaxies',
  'galaxy-group': 'Galaxy group',
  'galaxy-cluster': 'Galaxy cluster',
  'galaxy-part': 'Part of a galaxy',
  'radio-galaxy': 'Radio galaxy',
  quasar: 'Quasar / AGN',
  globular: 'Globular cluster',
  open: 'Open cluster',
  cluster: 'Star cluster',
  'star-cloud': 'Star cloud',
  'cluster-nebula': 'Cluster with nebula',
  association: 'Stellar association',
  emission: 'Emission nebula',
  nebula: 'Nebula',
  reflection: 'Reflection nebula',
  dark: 'Dark nebula',
  planetary: 'Planetary nebula',
  remnant: 'Supernova remnant',
  bipolar: 'Bipolar nebula',
  star: 'Star',
  double: 'Double star',
  other: 'Object',
};

export function dsoEntries(shard: Shard): Entry[] {
  const col = (n: string) => shard.columns.indexOf(n);
  const [cRa, cDec, cKind, cMag, cMaj, cIds, cNames] = [
    'ra',
    'dec',
    'kind',
    'mag',
    'maj',
    'ids',
    'names',
  ].map(col) as number[];
  const [cMin, cPa, cZ, cDist, cMorph] = ['min', 'pa', 'z', 'distKpc', 'morph'].map(
    col,
  ) as number[];
  const out: Entry[] = [];
  for (const r of shard.rows) {
    const ids = String(r[cIds as number] ?? '')
      .split('|')
      .filter(Boolean);
    const names = String(r[cNames as number] ?? '')
      .split('|')
      .filter(Boolean);
    const desig = ids.filter((d) => d !== 'H400');
    const primary = desig[0] ?? ids[0] ?? '?';
    const kind = String(r[cKind as number] ?? 'other');
    const mag = r[cMag as number] as number | null;
    const maj = r[cMaj as number] as number | null;
    const badges = [...new Set(ids.map(BADGE_OF))];
    const rank =
      Math.min(...badges.map((b) => PRIMARY_RANK[b] ?? 10)) +
      (mag == null ? 3 : Math.max(0, mag - 8) / 3);
    out.push({
      kind: 'dso',
      label: names[0] ? `${primary} · ${names[0]}` : primary,
      sub: [KIND_LABEL[kind] ?? kind, mag != null ? `mag ${mag}` : '', ...desig.slice(1, 6)]
        .filter(Boolean)
        .join(' · '),
      ids: ids.map(norm),
      words: [...new Set(names.flatMap(nameWords))],
      names: names.map(norm),
      badges,
      ra: r[cRa as number] as number,
      dec: r[cDec as number] as number,
      sizeDeg: maj ? maj / 60 : undefined,
      mag,
      type: kind,
      engineId: /^(M|NGC|IC) \d+$/.test(primary) ? primary : undefined,
      rank,
      info: {
        designations: desig,
        common: names,
        min: (r[cMin as number] as number | null) ?? null,
        pa: (r[cPa as number] as number | null) ?? null,
        z: (r[cZ as number] as number | null) ?? null,
        distKpc: (r[cDist as number] as number | null) ?? null,
        morph: (r[cMorph as number] as string | null) ?? null,
      },
    });
  }
  return out;
}

export function starEntries(shard: Shard): Entry[] {
  const col = (n: string) => shard.columns.indexOf(n);
  const [cHip, cRa, cDec, cV, cIds, cName] = ['hip', 'ra', 'dec', 'vmag', 'ids', 'name'].map(
    col,
  ) as number[];
  return shard.rows.map((r) => {
    const ids = String(r[cIds as number] ?? '')
      .split('|')
      .filter(Boolean);
    const name = String(r[cName as number] ?? '');
    const hip = r[cHip as number] as number | null;
    const v = r[cV as number] as number;
    const bayer = ids.find((i) => /^[α-ω]/.test(i));
    return {
      kind: 'star' as const,
      label: name || bayer || ids[0] || (hip ? `HIP ${hip}` : 'Star'),
      sub: [name && bayer ? bayer : '', `mag ${v}`, ...ids.filter((i) => /^(HD|HIP) /.test(i))]
        .filter(Boolean)
        .join(' · '),
      ids: ids.map(norm),
      words: nameWords(name),
      names: name ? [norm(name)] : [],
      badges: ids.some((i) => /^HIP /.test(i)) ? ['HIP'] : [],
      ra: r[cRa as number] as number,
      dec: r[cDec as number] as number,
      mag: v,
      type: 'star',
      engineId: hip ? `HIP ${hip}` : undefined,
      rank: name ? v / 2 : 4 + v / 2,
    };
  });
}

export function notableEntries(shard: Shard): Entry[] {
  const GROUP: Record<string, string> = {
    quasar: 'Quasar / AGN',
    double: 'Double star',
    variable: 'Variable star',
    'exoplanet-host': 'Exoplanet host star',
  };
  return shard.rows.map((r) => {
    const [name, group, ra, dec, vmag, simbad] = r as [
      string,
      string,
      number,
      number,
      number | null,
      string,
    ];
    return {
      kind: 'notable' as const,
      label: name,
      sub: [
        GROUP[group] ?? group,
        vmag != null ? `V ${vmag}` : '',
        simbad && simbad !== name ? simbad.replace(/^[*{]\S*\s*/, '') : '',
      ]
        .filter(Boolean)
        .join(' · '),
      ids: [norm(name), norm(simbad.replace(/^\{Name\}\s*/, '').replace(/^\*+\s*/, ''))],
      words: nameWords(name),
      badges: [
        group === 'exoplanet-host' ? 'Exoplanet' : ((GROUP[group] ?? group).split(' ')[0] ?? group),
      ],
      ra,
      dec,
      mag: vmag,
      type: group,
      rank: 3,
    };
  });
}

export const SOLAR_SYSTEM = [
  'Sun',
  'Moon',
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
  'Pluto',
];

export function solarSystemEntries(): Entry[] {
  return SOLAR_SYSTEM.map((n, i) => ({
    kind: 'planet' as const,
    label: n,
    sub:
      n === 'Sun'
        ? 'Star · never look at it without a certified solar filter'
        : n === 'Moon'
          ? "Earth's satellite"
          : n === 'Pluto'
            ? 'Dwarf planet'
            : 'Planet',
    ids: [norm(n)],
    words: nameWords(n),
    badges: ['Solar System'],
    engineId: n,
    type: 'planet',
    rank: i * 0.1,
  }));
}

/** Catalog → entry that lists its members when chosen. */
export const CATALOG_INFO: { badge: string; name: string; aka: string[] }[] = [
  { badge: 'M', name: 'Messier catalog', aka: ['messier'] },
  { badge: 'C', name: 'Caldwell catalog', aka: ['caldwell'] },
  { badge: 'H400', name: 'Herschel 400', aka: ['herschel', 'h400'] },
  { badge: 'NGC', name: 'New General Catalogue (NGC)', aka: ['ngc', 'new general'] },
  { badge: 'IC', name: 'Index Catalogue (IC)', aka: ['ic', 'index catalogue'] },
  { badge: 'Sh2', name: 'Sharpless HII regions (Sh 2)', aka: ['sharpless', 'sh2'] },
  { badge: 'B', name: 'Barnard dark nebulae', aka: ['barnard'] },
  { badge: 'LDN', name: 'Lynds dark nebulae (LDN)', aka: ['lynds', 'ldn'] },
  { badge: 'LBN', name: 'Lynds bright nebulae (LBN)', aka: ['lynds', 'lbn'] },
  { badge: 'vdB', name: 'van den Bergh reflection nebulae', aka: ['van den bergh', 'vdb'] },
  { badge: 'RCW', name: 'RCW Hα regions', aka: ['rcw', 'rodgers'] },
  { badge: 'Ced', name: 'Cederblad bright nebulae', aka: ['cederblad', 'ced'] },
  { badge: 'Abell', name: 'Abell clusters of galaxies', aka: ['abell', 'aco'] },
  {
    badge: 'PN G',
    name: 'Strasbourg-ESO planetary nebulae (PN G)',
    aka: ['planetary', 'png', 'strasbourg'],
  },
  { badge: 'PK', name: 'Perek-Kohoutek planetary nebulae', aka: ['perek', 'kohoutek', 'pk'] },
  { badge: 'SNR G', name: 'Galactic supernova remnants (Green)', aka: ['supernova', 'snr'] },
  { badge: 'Arp', name: 'Arp peculiar galaxies', aka: ['arp', 'peculiar'] },
  { badge: 'HCG', name: 'Hickson compact groups', aka: ['hickson', 'hcg'] },
  { badge: 'VV', name: 'Vorontsov-Velyaminov interacting galaxies', aka: ['vorontsov', 'vv'] },
  { badge: 'Cr', name: 'Collinder open clusters', aka: ['collinder', 'cr'] },
  { badge: 'Mel', name: 'Melotte clusters', aka: ['melotte', 'mel'] },
  { badge: 'Tr', name: 'Trumpler open clusters', aka: ['trumpler', 'tr'] },
  { badge: 'St', name: 'Stock open clusters', aka: ['stock'] },
  { badge: 'Ru', name: 'Ruprecht open clusters', aka: ['ruprecht'] },
  { badge: 'DWB', name: 'Dickel-Wendker-Bieritz HII regions', aka: ['dwb', 'dickel'] },
  { badge: 'vdBH', name: 'van den Bergh–Herbst nebulae', aka: ['vdbh', 'herbst'] },
  { badge: 'vdB-Ha', name: 'van den Bergh–Hagen clusters', aka: ['hagen'] },
  { badge: 'UGC', name: 'Uppsala General Catalogue (UGC)', aka: ['ugc', 'uppsala'] },
  { badge: 'PGC', name: 'Principal Galaxies Catalogue (PGC)', aka: ['pgc', 'leda'] },
  { badge: 'ESO', name: 'ESO/Uppsala galaxies', aka: ['eso'] },
];

export function catalogEntries(counts: Record<string, number>): Entry[] {
  return CATALOG_INFO.filter((c) => counts[c.badge]).map((c, i) => ({
    kind: 'catalog' as const,
    label: c.name,
    sub: `${(counts[c.badge] ?? 0).toLocaleString('en')} objects · choose to list them`,
    ids: [norm(c.name), ...c.aka.map(norm)],
    words: [...nameWords(c.name), ...c.aka.flatMap(nameWords)],
    badges: ['Catalog'],
    ref: c.badge,
    rank: 1 + i * 0.05,
  }));
}

export function surveyEntries(
  surveys: readonly {
    id: string;
    label: string;
    shows: string;
    band?: string;
    cdsOnly?: boolean;
  }[],
): Entry[] {
  return surveys.map((s, i) => ({
    kind: 'survey' as const,
    label: s.label,
    sub: `Sky survey layer · ${s.shows}${s.cdsOnly ? ' (host often down)' : ''}`,
    ids: [norm(s.label), norm(s.id)],
    words: [...nameWords(s.label), ...(s.band ? [s.band] : []), 'survey'],
    badges: ['Survey'],
    ref: s.id,
    rank: 2 + i * 0.05,
  }));
}

export interface Constellation {
  iau: string;
  name: string;
  native: string;
  /** Centre (degrees), from the mean direction of its line stars. */
  ra: number;
  dec: number;
}

export function constellationEntries(list: readonly Constellation[]): Entry[] {
  return list.map((c) => ({
    kind: 'constellation' as const,
    label: `${c.native} (${c.iau})`,
    sub: `Constellation · ${c.name}`,
    ids: [norm(c.iau), norm(c.native), norm(c.name)],
    words: [...nameWords(c.native), ...nameWords(c.name)],
    badges: ['Constellation'],
    ra: c.ra,
    dec: c.dec,
    sizeDeg: 30,
    engineId: `CON western ${c.iau}`,
    rank: 1,
  }));
}

// ---- the sky engine's own object lists (so everything drawn in the sky can be found) ------

/** OpenNGC type codes (public/skydata/dsonames.json) and nebula types → our kinds. */
const ENGINE_KIND: Record<string, string> = {
  G: 'galaxy',
  PaG: 'galaxy-pair',
  GrG: 'galaxy-group',
  OpC: 'open',
  GlC: 'globular',
  'As*': 'association',
  PN: 'planetary',
  SNR: 'remnant',
  HII: 'emission',
  RNe: 'reflection',
  ISM: 'nebula',
  DNe: 'dark',
};

/**
 * OpenNGC-style names to the catalog style used elsewhere: "ESO056-115" → "ESO 56-115",
 * "PGC088608" → "PGC 88608", "UGC05470" → "UGC 5470", "Mel071" → "Mel 71". Exported for tests.
 */
export function tidyDesignation(n: string): string {
  const m = /^(ESO|PGC|UGC|Mel|Cr|MWSC|H|Cl)0*(\d.*)$/.exec(n.trim());
  return m ? `${m[1]} ${m[2]}` : n.trim();
}

/**
 * Objects the sky engine draws (OpenNGC names, Sharpless/Lynds/Barnard/vdB nebulae) that the
 * catalog shards lack: Stellarium's catalog leaves out about 1,400 OpenNGC objects (NGC 3184,
 * NGC 5907, IC 27…). Only names not already indexed become new entries.
 */
export function engineEntries(
  known: ReadonlySet<string>,
  ngc: { rows: unknown[][] } | null,
  nebulae: { rows: unknown[][] } | null,
): Entry[] {
  const out: Entry[] = [];
  const add = (name: string, common: string, ra: number, dec: number, size: number, t: string) => {
    // The name field lists designations and common names joined by "|"
    // ("M 31|NGC 224|Andromeda Galaxy"): designations carry a number.
    const parts = name
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    const desig = parts.filter((x) => /\d/.test(x)).map(tidyDesignation);
    const label0 = desig[0] ?? parts[0] ?? name;
    const ids = [...new Set([...parts.filter((x) => /\d/.test(x)), ...desig].map(norm))];
    if (!ids.length || ids.some((i) => known.has(i))) return;
    const kind = ENGINE_KIND[t] ?? 'other';
    const names = [
      ...new Set([...parts.filter((x) => !/\d/.test(x)), ...(common ? [common] : [])]),
    ];
    out.push({
      kind: 'dso',
      label: names[0] ? `${label0} · ${names[0]}` : label0,
      sub: `${KIND_LABEL[kind] ?? 'Object'} · from the sky's own catalog`,
      ids,
      words: names.flatMap(nameWords),
      names: names.map(norm),
      badges: [BADGE_OF(label0)],
      ra,
      dec,
      sizeDeg: size ? size / 60 : undefined,
      mag: null,
      type: kind,
      engineId: /^(M|NGC|IC) \d+$/.test(label0) ? label0 : undefined,
      rank: 8,
      info: {
        designations: desig.length ? desig : [label0],
        common: names,
        min: null,
        pa: null,
        z: null,
        distKpc: null,
        morph: null,
      },
    });
    for (const i of ids) (known as Set<string>).add(i);
  };
  for (const r of ngc?.rows ?? []) {
    const [n, c, ra, dec, size, t] = r as [string, string, number, number, number, string];
    add(n, c, ra, dec, size, t);
  }
  for (const r of nebulae?.rows ?? []) {
    const [n, ra, dec, size, t] = r as [string, number, number, number, string];
    add(n, '', ra, dec, size, t);
  }
  return out;
}

// ---- designations only an online service knows ------------------------------------------

/** Catalog prefixes that are not in the local shards: a query starting with one goes online. */
export const ONLINE_PREFIX =
  /^\s*(sdss|2mass|2masx|gaia|tyc|tycho|ucac|wise|allwise|mrk|markarian|mcg|ugca|kug|cgcg|3c|4c|pks|qso|psr|hr|hd|hip|gsc|ngc\s*\d+[a-z]|lbqs|ton|pg|kids|des|ps1|ztf|sn\s*\d|at\s*\d)\b/i;

/** Does this query look like a designation (letters then digits) rather than a name? */
export const looksLikeDesignation = (q: string) =>
  /[a-z]\s*[+-]?\d/i.test(q) || ONLINE_PREFIX.test(q);

/** Catalogs too big to ship, listed around the view from VizieR (CfA mirror) when chosen. */
export const ONLINE_CATALOGS = [
  {
    ref: 'online:sdss',
    name: 'SDSS galaxies and quasars (online)',
    aka: ['sdss', 'sloan', 'sloan digital sky survey'],
    sub: 'Sloan Digital Sky Survey DR16 objects with spectra, listed around the view centre · from VizieR',
  },
] as const;

export function onlineCatalogEntries(): Entry[] {
  return ONLINE_CATALOGS.map((c, i) => ({
    kind: 'catalog' as const,
    label: c.name,
    sub: c.sub,
    ids: [norm(c.name), ...c.aka.map(norm)],
    words: [...nameWords(c.name), ...c.aka.flatMap(nameWords)],
    badges: ['Catalog', 'Online'],
    ref: c.ref,
    // Above the survey of the same name: someone typing "sdss" most likely wants objects.
    rank: 0.5 + i * 0.05,
  }));
}
