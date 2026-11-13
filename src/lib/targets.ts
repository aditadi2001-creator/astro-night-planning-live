/**
 * "Best targets tonight": ranks deep-sky objects (OpenNGC) for this site,
 * tonight's darkness, the forecast clouds, the Moon, the sky brightness and
 * the deep-sky camera frame. Each factor is 0–1; the score is their product.
 *
 *   time       usable hours above 30° in darkness, each weighted by the hour's
 *              cloud factor (score.ts: high cloud blocks 60 %), full marks at 4 h
 *   moon       1 − 0.8 · illumination · (share of those hours the Moon is up)
 *              · closeness, closeness = 1 at the Moon falling to 0 at 100° away
 *   contrast   object over sky: c = 10^(−0.4 (SB − SQM)), factor c / (c + 0.04): long
 *              integrations still record objects a few magnitudes below the sky, and
 *              the mean surface brightness undersells bright-cored nebulae such as M42
 *              (star clusters use a milder version: their stars are point sources)
 *   framing    how much of the frame's short side the object spans:
 *              ideal 20–90 %, smaller or mosaic-sized objects score lower
 *   brightness integrated magnitude, full marks at mag ≤ 7, 0.3 at mag 13
 * Positions are J2000 (≈0.3° from today's: irrelevant for ranking).
 */
import * as Astronomy from 'astronomy-engine';
import type { Place } from './astro/sky';

export type TargetKind = 'galaxy' | 'nebula' | 'planetary' | 'remnant' | 'cluster' | 'globular';

export interface Target {
  name: string;
  common: string;
  kind: TargetKind;
  ra: number;
  dec: number;
  mag: number | null;
  maj: number | null;
  min: number | null;
  sb: number | null;
  con: string;
}

export interface RankedTarget extends Target {
  score: number;
  hours: number;
  best: { t: number; alt: number } | null;
  moonSep: number;
  fill: number | null;
  reasons: string[];
  factors: { time: number; moon: number; contrast: number; framing: number; brightness: number };
}

export interface RankInput {
  place: Place;
  /** Astronomical darkness tonight (ms); falls back to nautical by the caller. */
  darkStart: number;
  darkEnd: number;
  /** Cloud factor 0–1 at a time (1 = clear). */
  clearAt: (t: number) => number;
  /** Zenith sky brightness (mag/arcsec²) without the Moon. */
  sqm: number;
  /** Short side of the deep-sky frame (degrees). */
  frameShortDeg: number;
}

export function parseTargets(doc: { rows?: unknown[] }): Target[] {
  const out: Target[] = [];
  for (const r of doc.rows ?? []) {
    if (!Array.isArray(r) || r.length < 10) continue;
    const [name, common, kind, ra, dec, mag, maj, min, sb, con] = r as [
      string,
      string,
      TargetKind,
      number,
      number,
      number | null,
      number | null,
      number | null,
      number | null,
      string,
    ];
    out.push({ name, common, kind, ra, dec, mag, maj, min, sb, con });
  }
  return out;
}

const D2R = Math.PI / 180;

export function contrastFactor(sb: number | null, sqm: number, kind: TargetKind): number {
  if (sb == null) return 0.6;
  const c = 10 ** (-0.4 * (sb - sqm));
  const f = c / (c + 0.04);
  return kind === 'cluster' || kind === 'globular' ? 0.5 + 0.5 * f : f;
}

/**
 * Surface brightness used for the contrast. Emission and reflection nebulae have
 * bright cores that a mean over the whole outline hides (M 42: mean 22, core ~17),
 * so they are rated on their brightest tenth of the area; galaxies keep the mean.
 */
export function effectiveSb(t: Target): number | null {
  if (t.kind !== 'nebula' || t.mag == null || t.maj == null) return t.sb;
  const area = 0.1 * (Math.PI / 4) * (t.maj * 60) * ((t.min ?? t.maj) * 60);
  const core = t.mag + 2.5 * Math.log10(area);
  return t.sb == null ? core : Math.min(t.sb, core);
}

export function framingFactor(fill: number | null): number {
  if (fill == null) return 0.7;
  if (fill >= 0.2 && fill <= 0.9) return 1;
  if (fill < 0.2) return 0.35 + (0.65 * fill) / 0.2;
  return Math.max(0.45, 1 - (fill - 0.9) * 0.5);
}

export function brightnessFactor(mag: number | null): number {
  if (mag == null) return 0.6;
  return Math.min(1, Math.max(0.3, 1 - ((mag - 7) / 6) * 0.7));
}

export function rankTargets(
  targets: readonly Target[],
  inp: RankInput,
  limit = 20,
): RankedTarget[] {
  const { place } = inp;
  if (!(inp.darkEnd > inp.darkStart)) return [];
  const step = 15 * 60_000;
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  // Per-sample sidereal time, cloud factor and Moon position (shared by all targets).
  const samples: {
    t: number;
    lst: number;
    clear: number;
    moonUp: boolean;
    mx: number;
    my: number;
    mz: number;
  }[] = [];
  for (let t = inp.darkStart; t <= inp.darkEnd; t += step) {
    const d = new Date(t);
    const lst = (Astronomy.SiderealTime(d) + place.lon / 15) * 15 * D2R;
    const meq = Astronomy.Equator(Astronomy.Body.Moon, d, obs, false, true);
    const mh = Astronomy.Horizon(d, obs, meq.ra, meq.dec, 'normal');
    const mra = meq.ra * 15 * D2R;
    const mde = meq.dec * D2R;
    samples.push({
      t,
      lst,
      clear: Math.min(1, Math.max(0, inp.clearAt(t))),
      moonUp: mh.altitude > 0,
      mx: Math.cos(mde) * Math.cos(mra),
      my: Math.cos(mde) * Math.sin(mra),
      mz: Math.sin(mde),
    });
  }
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    new Date((inp.darkStart + inp.darkEnd) / 2),
  ).phase_fraction;
  const sinLat = Math.sin(place.lat * D2R);
  const cosLat = Math.cos(place.lat * D2R);
  const stepH = step / 3600_000;

  const ranked: RankedTarget[] = [];
  for (const tg of targets) {
    const ra = tg.ra * D2R;
    const dec = tg.dec * D2R;
    const sinD = Math.sin(dec);
    const cosD = Math.cos(dec);
    const vx = cosD * Math.cos(ra);
    const vy = cosD * Math.sin(ra);
    let hours = 0;
    let weighted = 0;
    let moonUpHours = 0;
    let best: RankedTarget['best'] = null;
    let sepSum = 0;
    for (const s of samples) {
      const alt = Math.asin(sinLat * sinD + cosLat * cosD * Math.cos(s.lst - ra)) / D2R;
      if (!best || alt > best.alt) best = { t: s.t, alt };
      if (alt < 30) continue;
      hours += stepH;
      weighted += stepH * s.clear;
      if (s.moonUp) moonUpHours += stepH;
      const dot = vx * s.mx + vy * s.my + sinD * s.mz;
      sepSum += Math.acos(Math.min(1, Math.max(-1, dot))) / D2R;
    }
    if (hours < 0.5) continue;
    const moonSep = sepSum / Math.max(1, hours / stepH);
    const closeness = Math.max(0, 1 - moonSep / 100);
    const moon = 1 - 0.8 * illum * (moonUpHours / hours) * closeness;
    const fill = tg.maj != null ? tg.maj / 60 / inp.frameShortDeg : null;
    const factors = {
      time: Math.min(1, weighted / 4),
      moon,
      contrast: contrastFactor(effectiveSb(tg), inp.sqm, tg.kind),
      framing: framingFactor(fill),
      brightness: brightnessFactor(tg.mag),
    };
    const score = Math.round(
      100 * factors.time * factors.moon * factors.contrast * factors.framing * factors.brightness,
    );
    const reasons: string[] = [];
    reasons.push(`${(Math.round(hours * 2) / 2).toFixed(1)} h above 30°`);
    if (weighted < hours * 0.6) reasons.push('clouds forecast for much of it');
    if (fill != null) {
      if (fill > 1.1) reasons.push(`mosaic (${Math.round(fill * 100)}% of the frame)`);
      else if (fill >= 0.2) reasons.push(`fills ${Math.round(fill * 100)}% of the frame`);
      else reasons.push('small in this frame');
    }
    if (factors.contrast < 0.35) reasons.push('faint against this sky');
    if (illum > 0.3 && closeness > 0.5 && moonUpHours > 0)
      reasons.push(`Moon ${Math.round(moonSep)}° away`);
    ranked.push({ ...tg, score, hours, best, moonSep, fill, reasons, factors });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
