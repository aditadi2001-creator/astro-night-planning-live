/**
 * Best targets tonight, on the full catalog (public/catalog/dso-core-v1.json). Runs in a Web
 * Worker (targets.worker.ts). The score is the documented method from src/lib/targets.ts,
 * unchanged in its factors (docs/methods.md, About):
 *
 *   score = 100 × time × moon × contrast × framing × brightness
 *     time       usable dark hours above the minimum altitude (and above the horizon profile),
 *                each weighted by the hour's cloud factor; full marks at 4 h
 *     moon       1 − 0.8 · illumination · (share of those hours the Moon is up) · closeness
 *     contrast   object over sky from surface brightness vs the site's SQM
 *     framing    how much of the frame's short side the object spans (ideal 20–90 %)
 *     brightness integrated magnitude
 *
 * What is new here: the minimum altitude and a horizon profile (terrain or custom) define
 * "usable", filters narrow the list before scoring, the "any type" ranking keeps variety
 * (no near-duplicates, at most a quarter of the list from one type), and every result explains
 * itself (factors, one-line why, filter advice for the profile's filters, difficulty).
 * Surface brightness is computed from the catalog magnitude and size, the mean over the
 * ellipse (the same definition OpenNGC uses).
 */
import * as Astronomy from 'astronomy-engine';
import { brightnessFactor, framingFactor } from '../targets';

export type ScoreKind =
  | 'galaxy'
  | 'nebula'
  | 'planetary'
  | 'remnant'
  | 'dark'
  | 'reflection'
  | 'cluster'
  | 'globular'
  | 'other';

/** Catalog kind (build_catalogs.py KIND) → scoring kind. */
export function scoreKind(kind: string): ScoreKind {
  if (/^galaxy|radio-galaxy|quasar/.test(kind)) return 'galaxy';
  if (kind === 'planetary') return 'planetary';
  if (kind === 'remnant') return 'remnant';
  if (kind === 'dark') return 'dark';
  if (kind === 'reflection') return 'reflection';
  if (/emission|nebula|bipolar|cluster-nebula/.test(kind)) return 'nebula';
  if (kind === 'globular') return 'globular';
  if (/open|cluster|association|star-cloud/.test(kind)) return 'cluster';
  return 'other';
}

export interface Obj {
  /** Primary designation ("M 31"). */
  name: string;
  common: string;
  ids: string[];
  badges: string[];
  kind: string;
  sk: ScoreKind;
  con: string;
  ra: number;
  dec: number;
  mag: number | null;
  maj: number | null;
  min: number | null;
  pa: number | null;
  /** Mean surface brightness, mag/arcsec² (null when magnitude or size is unknown). */
  sb: number | null;
}

/** Mean surface brightness over the ellipse: m + 2.5 log10(π/4 · a · b) with a, b in arcsec. */
export function surfaceBrightness(
  mag: number | null,
  maj: number | null,
  min: number | null,
): number | null {
  if (mag == null || !maj) return null;
  const area = (Math.PI / 4) * (maj * 60) * ((min || maj) * 60);
  return mag + 2.5 * Math.log10(area);
}

/** Same contrast factor as targets.ts, extended to the new kinds. */
export function contrast(
  sb: number | null,
  sqm: number,
  sk: ScoreKind,
  mag: number | null,
  maj: number | null,
): number {
  let s = sb;
  // Bright-cored emission nebulae: rate on the brightest tenth of the area (targets.ts
  // effectiveSb applies it to nebulae only; reflection nebulae are faint and even).
  if (sk === 'nebula' && mag != null && maj) {
    const core = mag + 2.5 * Math.log10(0.1 * (Math.PI / 4) * (maj * 60) * (maj * 60));
    s = s == null ? core : Math.min(s, core);
  }
  if (s == null) return sk === 'dark' ? 0.35 : 0.6;
  const c = 10 ** (-0.4 * (s - sqm));
  const f = c / (c + 0.04);
  return sk === 'cluster' || sk === 'globular' ? 0.5 + 0.5 * f : f;
}

export interface Filters {
  text?: string;
  catalogs?: string[];
  kinds?: ScoreKind[];
  constellation?: string;
  magMax?: number | null;
  sizeMin?: number | null;
  sizeMax?: number | null;
  sbMax?: number | null;
  minAlt?: number;
  minHours?: number;
  moonSepMin?: number;
  fitMin?: number | null;
  fitMax?: number | null;
  /** Only objects above the minimum altitude at this time (ms). */
  visibleAt?: number | null;
  raMin?: number | null;
  raMax?: number | null;
  decMin?: number | null;
  decMax?: number | null;
}

export type Tab = 'any' | 'galaxy' | 'nebula' | 'cluster';

export interface RankInput {
  lat: number;
  lon: number;
  elevation: number;
  darkStart: number;
  darkEnd: number;
  /** Hourly cloud factor (0–1, 1 = clear) by hour start (ms). */
  clear: [number, number][];
  sqm: number;
  frameW: number;
  frameH: number;
  /** Horizon profile: altitude (°) every 0.5° of azimuth from north (720 values), or null. */
  horizon: number[] | null;
  filters: Filters;
  tab: Tab;
  limit: number;
  /** Filter ids in the active profile (src/lib/profiles.ts FILTER_DB). */
  myFilters: string[];
}

export interface Ranked {
  o: Obj;
  score: number;
  factors: { time: number; moon: number; contrast: number; framing: number; brightness: number };
  hours: number;
  clearHours: number;
  transit: { t: number; alt: number } | null;
  best: { t: number; alt: number } | null;
  window: { start: number; end: number } | null;
  moonSep: number;
  fill: number | null;
  /** Altitude every 30 min across the dark window (sparkline). */
  alts: number[];
  why: string;
  strategy: string;
  difficulty: 'Easy' | 'Moderate' | 'Hard';
  cloudLimited: boolean;
}

const D = Math.PI / 180;
const STEP = 15 * 60_000;

export interface Night {
  samples: {
    t: number;
    lst: number;
    clear: number;
    moonUp: boolean;
    mv: [number, number, number];
  }[];
  illum: number;
}

export function nightSamples(
  inp: Pick<RankInput, 'lat' | 'lon' | 'elevation' | 'darkStart' | 'darkEnd' | 'clear'>,
): Night {
  const obs = new Astronomy.Observer(inp.lat, inp.lon, inp.elevation);
  const clearAt = (t: number) => {
    let f = 1;
    for (const [h, c] of inp.clear) if (t >= h && t < h + 3600_000) f = c;
    return Math.min(1, Math.max(0, f));
  };
  const samples: Night['samples'] = [];
  for (let t = inp.darkStart; t <= inp.darkEnd; t += STEP) {
    const d = new Date(t);
    const lst = (Astronomy.SiderealTime(d) + inp.lon / 15) * 15 * D;
    const m = Astronomy.Equator(Astronomy.Body.Moon, d, obs, false, true);
    const h = Astronomy.Horizon(d, obs, m.ra, m.dec, 'normal');
    const ra = m.ra * 15 * D;
    const de = m.dec * D;
    samples.push({
      t,
      lst,
      clear: clearAt(t),
      moonUp: h.altitude > 0,
      mv: [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)],
    });
  }
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    new Date((inp.darkStart + inp.darkEnd) / 2),
  ).phase_fraction;
  return { samples, illum };
}

function horizonAt(h: number[] | null, az: number): number {
  if (!h || !h.length) return 0;
  const i = Math.round((((az % 360) + 360) % 360) / (360 / h.length)) % h.length;
  return Math.max(0, h[i] ?? 0);
}

function passes(o: Obj, f: Filters, tab: Tab): boolean {
  if (tab === 'galaxy' && o.sk !== 'galaxy') return false;
  if (tab === 'nebula' && !['nebula', 'planetary', 'remnant', 'dark', 'reflection'].includes(o.sk))
    return false;
  if (tab === 'cluster' && o.sk !== 'cluster' && o.sk !== 'globular') return false;
  if (f.kinds?.length && !f.kinds.includes(o.sk)) return false;
  if (f.catalogs?.length && !f.catalogs.some((c) => o.badges.includes(c))) return false;
  if (f.constellation && o.con !== f.constellation) return false;
  if (f.magMax != null && (o.mag == null || o.mag > f.magMax)) return false;
  if (f.sizeMin != null && (o.maj == null || o.maj < f.sizeMin)) return false;
  if (f.sizeMax != null && o.maj != null && o.maj > f.sizeMax) return false;
  if (f.sbMax != null && (o.sb == null || o.sb > f.sbMax)) return false;
  if (f.raMin != null && f.raMax != null) {
    const inRa =
      f.raMin <= f.raMax ? o.ra >= f.raMin && o.ra <= f.raMax : o.ra >= f.raMin || o.ra <= f.raMax;
    if (!inRa) return false;
  }
  if (f.decMin != null && o.dec < f.decMin) return false;
  if (f.decMax != null && o.dec > f.decMax) return false;
  if (f.text) {
    const q = f.text.toLowerCase().replace(/\s+/g, '');
    const hay = (o.ids.join('|') + '|' + o.common).toLowerCase().replace(/\s+/g, '');
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function strategy(
  o: Obj,
  illum: number,
  moonUpShare: number,
  sqm: number,
  mine: string[],
): string {
  const has = (id: string) => mine.includes(id);
  const nb = has('ha') || has('oiii');
  const brightMoon = illum > 0.5 && moonUpShare > 0.3;
  const city = sqm < 18.5;
  switch (o.sk) {
    case 'nebula':
    case 'planetary':
    case 'remnant':
      if (nb) {
        const set =
          o.sk === 'planetary'
            ? 'OIII + Hα'
            : o.sk === 'remnant'
              ? 'Hα + OIII + SII'
              : 'Hα + OIII (SII for colour)';
        return `Narrowband ${set}: ignores the ${brightMoon ? 'Moon and ' : ''}${city ? 'city glow' : 'sky glow'}.`;
      }
      return `Broadband${has('lpro') ? ' with the L-Pro' : ''}; ${brightMoon ? 'wait for a darker night if you can' : 'longer total time from a city sky'}.`;
    case 'galaxy':
      if (brightMoon || city)
        return has('irpass')
          ? `IR-pass as luminance (cuts ${brightMoon ? 'moonlight' : 'city glow'} and seeing) + short RGB.`
          : 'Galaxies suffer most from moonlight and city glow: wait for a darker night or travel.';
      return has('lpro') ? 'L-Pro as luminance + RGB.' : 'LRGB.';
    case 'reflection':
    case 'dark':
      return `Broadband LRGB only (no narrowband signal); needs a dark, moonless sky${city ? ' — hard from the city' : ''}.`;
    case 'cluster':
    case 'globular':
      return 'Short RGB subs: bright stars saturate quickly.';
    default:
      return has('lpro') ? 'L-Pro + RGB.' : 'LRGB.';
  }
}

function difficulty(c: number, mag: number | null): Ranked['difficulty'] {
  if (c > 0.6 && mag != null && mag <= 9) return 'Easy';
  if (c > 0.3) return 'Moderate';
  return 'Hard';
}

/** Rank one object; null when it is never usable tonight. */
export function rankOne(o: Obj, inp: RankInput, night: Night): Ranked | null {
  const minAlt = inp.filters.minAlt ?? 30;
  const sinLat = Math.sin(inp.lat * D);
  const cosLat = Math.cos(inp.lat * D);
  // Never high enough: skip without sampling.
  if (90 - Math.abs(inp.lat - o.dec) < minAlt) return null;
  const ra = o.ra * D;
  const dec = o.dec * D;
  const sinD = Math.sin(dec);
  const cosD = Math.cos(dec);
  const v: [number, number, number] = [cosD * Math.cos(ra), cosD * Math.sin(ra), sinD];
  const stepH = STEP / 3600_000;
  let hours = 0;
  let weighted = 0;
  let moonUp = 0;
  let minSep = 180;
  let best: Ranked['best'] = null;
  let run: { start: number; end: number } | null = null;
  let longest: Ranked['window'] = null;
  const alts: number[] = [];
  let visibleAtOk = inp.filters.visibleAt == null;
  for (let i = 0; i < night.samples.length; i++) {
    const s = night.samples[i] as Night['samples'][number];
    const H = s.lst - ra;
    const alt = Math.asin(sinLat * sinD + cosLat * cosD * Math.cos(H)) / D;
    if (i % 2 === 0) alts.push(Math.round(alt * 10) / 10);
    if (!best || alt > best.alt) best = { t: s.t, alt };
    let ok = alt >= minAlt;
    if (ok && inp.horizon) {
      const az =
        (Math.atan2(Math.sin(H), Math.cos(H) * sinLat - Math.tan(dec) * cosLat) / D + 180) % 360;
      ok = alt >= horizonAt(inp.horizon, az);
    }
    if (inp.filters.visibleAt != null && Math.abs(s.t - inp.filters.visibleAt) <= STEP / 2 && ok)
      visibleAtOk = true;
    if (!ok) {
      run = null;
      continue;
    }
    hours += stepH;
    weighted += stepH * s.clear;
    if (s.moonUp) {
      moonUp += stepH;
      const dot = v[0] * s.mv[0] + v[1] * s.mv[1] + v[2] * s.mv[2];
      minSep = Math.min(minSep, Math.acos(Math.min(1, Math.max(-1, dot))) / D);
    }
    run = run ? { start: run.start, end: s.t + STEP } : { start: s.t, end: s.t + STEP };
    if (!longest || run.end - run.start > longest.end - longest.start) longest = { ...run };
  }
  if (!visibleAtOk || hours < Math.max(0.5, inp.filters.minHours ?? 0)) return null;
  const moonSep = moonUp > 0 ? minSep : 180;
  if (inp.filters.moonSepMin && moonUp > 0 && moonSep < inp.filters.moonSepMin) return null;
  const short = Math.min(inp.frameW, inp.frameH);
  const fill = o.maj != null ? o.maj / 60 / short : null;
  if (inp.filters.fitMin != null && (fill == null || fill * 100 < inp.filters.fitMin)) return null;
  if (inp.filters.fitMax != null && fill != null && fill * 100 > inp.filters.fitMax) return null;
  const closeness = Math.max(0, 1 - moonSep / 100);
  const factors = {
    time: Math.min(1, weighted / 4),
    moon: 1 - 0.8 * night.illum * (moonUp / hours) * closeness,
    contrast: contrast(o.sb, inp.sqm, o.sk, o.mag, o.maj),
    framing: framingFactor(fill),
    brightness: brightnessFactor(o.mag),
  };
  const score = Math.round(
    100 * factors.time * factors.moon * factors.contrast * factors.framing * factors.brightness,
  );
  // Transit (highest point of the day) from the hour angle, whether or not it is dark then.
  const lst0 = night.samples[0]?.lst ?? 0;
  const t0 = night.samples[0]?.t ?? inp.darkStart;
  const dH = (((((ra - lst0) / D) % 360) + 540) % 360) - 180; // degrees until transit, −180..180
  const transitT = t0 + (dH / 15) * 3600_000 * 0.99727;
  const transit = { t: transitT, alt: 90 - Math.abs(inp.lat - o.dec) };
  const limits: string[] = [];
  if (factors.time < 0.5) limits.push(weighted < hours * 0.6 ? 'clouds' : 'short window');
  if (factors.moon < 0.7) limits.push(`Moon ${Math.round(moonSep)}° away`);
  if (factors.contrast < 0.35) limits.push('faint against this sky');
  if (fill != null && fill > 1.1) limits.push('needs a mosaic');
  if (fill != null && fill < 0.15) limits.push('small in this frame');
  const good: string[] = [];
  good.push(`${(Math.round(hours * 2) / 2).toFixed(1)} h usable`);
  if (best) good.push(`up to ${Math.round(best.alt)}°`);
  if (fill != null && fill >= 0.2 && fill <= 0.9)
    good.push(`fills ${Math.round(fill * 100)} % of the frame`);
  const why = limits.length
    ? `${good.join(', ')}; limited by ${limits.join(', ')}.`
    : `${good.join(', ')}.`;
  return {
    o,
    score,
    factors,
    hours,
    clearHours: weighted,
    transit,
    best,
    window: longest,
    moonSep,
    fill,
    alts,
    why,
    strategy: strategy(o, night.illum, moonUp / hours, inp.sqm, inp.myFilters),
    difficulty: difficulty(factors.contrast, o.mag),
    cloudLimited: weighted < hours * 0.6,
  };
}

/** Angular distance in degrees. */
function sep(a: Obj, b: Obj): number {
  const c =
    Math.sin(a.dec * D) * Math.sin(b.dec * D) +
    Math.cos(a.dec * D) * Math.cos(b.dec * D) * Math.cos((a.ra - b.ra) * D);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D;
}

/**
 * Rank everything that passes the filters. "Any type" keeps variety: an object within half the
 * larger size (at least 0.25°) of one already listed is skipped (NGC 1980 next to M 42), and no
 * single type takes more than a quarter of the list.
 */
export function rankAll(
  objs: readonly Obj[],
  inp: RankInput,
  night = nightSamples(inp),
): { list: Ranked[]; considered: number; cloudLimitedShare: number } {
  const out: Ranked[] = [];
  let considered = 0;
  for (const o of objs) {
    if (!passes(o, inp.filters, inp.tab)) continue;
    considered++;
    const r = rankOne(o, inp, night);
    if (r && r.score > 0) out.push(r);
  }
  out.sort((a, b) => b.score - a.score);
  const list: Ranked[] = [];
  const perKind = new Map<ScoreKind, number>();
  const cap = inp.tab === 'any' ? Math.max(3, Math.ceil(inp.limit / 4)) : inp.limit;
  for (const r of out) {
    if (list.length >= inp.limit) break;
    const k = r.o.sk;
    if ((perKind.get(k) ?? 0) >= cap) continue;
    const ni = list.findIndex(
      (x) => sep(x.o, r.o) < Math.max(0.25, Math.max(x.o.maj ?? 0, r.o.maj ?? 0) / 120),
    );
    if (ni >= 0) {
      // Near-duplicate: keep the larger object that contains the other (M 42 over M 43).
      const x = list[ni] as Ranked;
      if ((r.o.maj ?? 0) > (x.o.maj ?? 0) * 1.5 && r.score >= x.score * 0.6 && r.o.sk === x.o.sk) {
        perKind.set(x.o.sk, (perKind.get(x.o.sk) ?? 1) - 1);
        perKind.set(k, (perKind.get(k) ?? 0) + 1);
        list[ni] = r;
      }
      continue;
    }
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
    list.push(r);
  }
  const cloudLimitedShare = list.length
    ? list.filter((r) => r.cloudLimited).length / list.length
    : 0;
  return { list, considered, cloudLimitedShare };
}

/** Catalog shard rows → objects (constellations via Astronomy Engine, J2000 positions). */
export function objectsFromShard(shard: { columns: string[]; rows: unknown[][] }): Obj[] {
  const c = (n: string) => shard.columns.indexOf(n);
  const [iRa, iDec, iKind, iMag, iMaj, iMin, iPa, iIds, iNames] = [
    'ra',
    'dec',
    'kind',
    'mag',
    'maj',
    'min',
    'pa',
    'ids',
    'names',
  ].map(c) as number[];
  const out: Obj[] = [];
  for (const r of shard.rows) {
    const kind = String(r[iKind as number]);
    const sk = scoreKind(kind);
    if (sk === 'other') continue;
    const allIds = String(r[iIds as number] ?? '')
      .split('|')
      .filter(Boolean);
    const ids = allIds.filter((x) => x !== 'H400');
    const names = String(r[iNames as number] ?? '')
      .split('|')
      .filter(Boolean);
    const ra = r[iRa as number] as number;
    const dec = r[iDec as number] as number;
    const mag = r[iMag as number] as number | null;
    const maj = r[iMaj as number] as number | null;
    const min = r[iMin as number] as number | null;
    const badges = [
      ...new Set(
        allIds.map((d) =>
          d === 'H400'
            ? 'H400'
            : d.startsWith('Sh 2-')
              ? 'Sh2'
              : d.startsWith('PN G')
                ? 'PN G'
                : d.startsWith('SNR G')
                  ? 'SNR G'
                  : (d.split(' ')[0] ?? d),
        ),
      ),
    ];
    out.push({
      name: ids[0] ?? allIds[0] ?? '?',
      common: names[0] ?? '',
      ids,
      badges,
      kind,
      sk,
      con: Astronomy.Constellation(ra / 15, dec).symbol,
      ra,
      dec,
      mag,
      maj,
      min,
      pa: r[iPa as number] as number | null,
      sb: surfaceBrightness(mag, maj, min),
    });
  }
  return out;
}
