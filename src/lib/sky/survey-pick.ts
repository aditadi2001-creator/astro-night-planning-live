/**
 * Which sky surveys show an object best: ranked by what the object is (glowing gas, dust,
 * galaxy, star cluster…), how big it is, and whether the survey covers its part of the sky.
 * Coverage limits are approximate footprints from each survey's description (a survey that
 * turns out to be empty there shows a faded preview, never a made-up picture).
 */
import { toGalactic } from './healpix';
import { surveyById, type Survey } from './surveys';

export interface SurveyPick {
  survey: Survey;
  /** Why it suits this object, in plain words. */
  why: string;
}

/** Rough footprints (J2000 degrees): false when the survey certainly misses the position. */
export function covers(id: string, ra: number, dec: number): boolean {
  const { l, b } = toGalactic(ra, dec);
  switch (id) {
    case 'panstarrs':
    case 'ztf':
      return dec >= -30;
    case 'skymapper':
    case 'shassa':
      return dec <= 10;
    case 'vtss':
      return dec >= -20 && Math.abs(b) <= 25;
    case 'decaps':
      return dec <= -25 && Math.abs(b) <= 12;
    case 'legacy':
      // DR10: DECam south of +32° in both Galactic caps, BASS/MzLS north of it only in the north
      // Galactic cap (so M 31 and M 33 are outside).
      return Math.abs(b) >= 15 && dec >= -70 && (dec <= 32 || b > 0);
    case 'sdss':
      // The main footprint: the northern Galactic cap and stripes near the celestial equator.
      return (b >= 25 && dec >= -12) || (b <= -25 && dec >= -12 && dec <= 36);
    case 'erosita':
      // DR1 is the western Galactic hemisphere (l from 180° to 360°).
      return l >= 180;
    default:
      return true;
  }
}

type Group =
  'gas' | 'snr' | 'pn' | 'dust' | 'reflection' | 'galaxy' | 'quasar' | 'cluster' | 'star';

export function groupOf(kind: string): Group {
  if (['emission', 'nebula', 'cluster-nebula', 'bipolar'].includes(kind)) return 'gas';
  if (kind === 'remnant') return 'snr';
  if (kind === 'planetary') return 'pn';
  if (kind === 'dark') return 'dust';
  if (kind === 'reflection') return 'reflection';
  if (kind === 'quasar' || kind === 'radio-galaxy') return 'quasar';
  if (kind.startsWith('galaxy')) return 'galaxy';
  if (['open', 'globular', 'cluster', 'star-cloud', 'association'].includes(kind)) return 'cluster';
  return 'star';
}

/** Ordered candidates per object group: [survey id, reason]. */
const BY_GROUP: Record<Group, [string, string][]> = {
  gas: [
    ['vtss', 'hydrogen-alpha: shows the glowing gas itself, in detail'],
    ['shassa', 'hydrogen-alpha of the southern sky: the glowing gas itself'],
    ['dss', 'colour photograph: the red glow of hydrogen as a camera sees it'],
    ['panstarrs', 'sharp modern colour: fine structure and stars'],
    ['decaps', 'very deep colour of the southern Milky Way'],
    ['halpha', 'hydrogen-alpha of the whole sky (low resolution): the full extent'],
    ['allwise', 'mid-infrared: warm dust mixed with the gas'],
  ],
  snr: [
    ['vtss', 'hydrogen-alpha: the shocked filaments'],
    ['shassa', 'hydrogen-alpha: the shocked filaments (south)'],
    ['dss', 'colour photograph of the filaments'],
    ['erosita', 'X-rays: the hot gas inside the shell'],
    ['rass', 'X-rays: the hot gas inside the shell'],
    ['panstarrs', 'sharp colour of the brighter filaments'],
    ['halpha', 'hydrogen-alpha, whole sky: the full shell'],
  ],
  pn: [
    ['panstarrs', 'the sharpest colour picture of the small shell'],
    ['legacy', 'very deep colour: faint outer halo'],
    ['dss', 'colour photograph'],
    ['hst-wfc3', 'Hubble, where it observed it'],
    ['allwise', 'mid-infrared: warm dust'],
    ['galex', 'ultraviolet: the hot central star'],
  ],
  dust: [
    ['dss', 'colour photograph: the dark cloud against the stars'],
    ['panstarrs', 'sharp colour: the dark lane edges'],
    ['decaps', 'deep colour of the southern Milky Way'],
    ['2mass', 'near-infrared: sees into the cloud (it fades here)'],
    ['allwise', 'mid-infrared: the dust glows'],
    ['planck', 'the dust itself, glowing in microwaves'],
    ['iris', 'far-infrared dust emission'],
  ],
  reflection: [
    ['dss', 'colour photograph: the blue scattered light'],
    ['panstarrs', 'sharp colour of the dust lit by its star'],
    ['legacy', 'very deep colour: faint outer dust'],
    ['skymapper', 'southern colour survey'],
    ['allwise', 'mid-infrared: the warm dust'],
  ],
  galaxy: [
    ['legacy', 'very deep colour: faint arms, tidal tails and halos'],
    ['sdss', 'sharp colour of galaxies (the survey was made for them)'],
    ['panstarrs', 'sharp modern colour'],
    ['dss', 'colour photograph (whole sky)'],
    ['galex', 'ultraviolet: where new stars are forming'],
    ['unwise', 'infrared: the old stars that hold the galaxy together'],
    ['skymapper', 'southern colour survey'],
  ],
  quasar: [
    ['sdss', 'the survey that found most quasars, with spectra'],
    ['legacy', 'very deep colour: the host galaxy'],
    ['panstarrs', 'sharp colour'],
    ['erosita', 'X-rays from the active nucleus'],
    ['nvss', 'radio: jets and lobes'],
    ['lotss', 'low-frequency radio: jets and lobes'],
  ],
  cluster: [
    ['panstarrs', 'sharp colour: star colours resolved'],
    ['dss', 'colour photograph (whole sky)'],
    ['2mass', 'near-infrared: stars hidden by dust'],
    ['gaiargb', 'Gaia colours of the stars'],
    ['skymapper', 'southern colour survey'],
    ['legacy', 'very deep colour'],
  ],
  star: [
    ['panstarrs', 'sharp colour of the star and its neighbours'],
    ['dss', 'colour photograph (whole sky)'],
    ['2mass', 'near-infrared'],
    ['skymapper', 'southern colour survey'],
  ],
};

function near(ra1: number, dec1: number, ra2: number, dec2: number, r: number): boolean {
  const D = Math.PI / 180;
  const c =
    Math.sin(dec1 * D) * Math.sin(dec2 * D) +
    Math.cos(dec1 * D) * Math.cos(dec2 * D) * Math.cos((ra1 - ra2) * D);
  return Math.acos(Math.min(1, c)) / D <= Math.max(r, 0.05);
}

/**
 * The best surveys for an object, best first (at most `n`), leaving out surveys that miss its
 * position. Very large nebulae (over 2°) put the whole-sky hydrogen-alpha map first.
 */
export function bestSurveys(
  kind: string,
  ra: number,
  dec: number,
  sizeArcmin: number | null,
  n = 4,
): SurveyPick[] {
  let list = BY_GROUP[groupOf(kind)];
  if ((sizeArcmin ?? 0) > 120 && groupOf(kind) === 'gas')
    list = [['halpha', 'hydrogen-alpha of the whole sky: all of this large nebula'], ...list];
  const out: SurveyPick[] = [];
  const seen = new Set<string>();
  for (const [id, why] of list) {
    if (seen.has(id) || !covers(id, ra, dec)) continue;
    const survey = surveyById(id);
    if (!survey) continue;
    // Hubble/Webb surveys only cover a few famous fields.
    if (survey.fields && !survey.fields.some((f) => near(f.ra, f.dec, ra, dec, f.fovDeg))) continue;
    seen.add(id);
    out.push({ survey, why: survey.cdsOnly ? `${why} (its only host, CDS, is often down)` : why });
    if (out.length >= n) break;
  }
  // Surveys served only by CDS go after those with an independent mirror: CDS outages are
  // common, and the first pick should load.
  return [...out.filter((p) => !p.survey.cdsOnly), ...out.filter((p) => p.survey.cdsOnly)].slice(
    0,
    n,
  );
}
