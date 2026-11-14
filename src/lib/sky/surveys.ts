/**
 * Optional HiPS image surveys (off by default). They are streamed straight from
 * CDS Strasbourg or one of the official mirrors CDS lists for each survey; we
 * host nothing, so they cost no R2 storage or Worker requests.
 *
 * Each survey lists its servers in order of preference. The first one whose
 * `properties` file answers and names the expected survey is used. CDS's own
 * servers come first; the mirrors (ESA ESDC, NASA MAST, NASA IRSA, CSIRO CASDA,
 * China-VO) take over when CDS is unreachable, as during the CDS outage of
 * November 2026.
 */

export interface Survey {
  /** Our short key. */
  id: string;
  /** CDS HiPS identifier (creator_did without "ivo://"). */
  hipsId: string;
  /** Menu label. */
  label: string;
  /** What the image shows, in plain words. */
  shows: string;
  /** Coordinate frame of the tiles (galactic ones are rotated by the engine). */
  frame: 'equatorial' | 'galactic';
  /** Fraction of the sky covered (1 = all sky). */
  coverage: number;
  /** Coverage note shown under the menu when the sky is not fully covered. */
  coverageNote?: string;
  /** Servers in order of preference (no trailing slash). */
  servers: string[];
  /** Matching entry in CREDITS (src/lib/credits.ts). */
  creditId: string;
  /** Famous fields the survey covers (for small surveys): go-to buttons. */
  fields?: { label: string; ra: number; dec: number; fovDeg: number }[];
}

export const SURVEYS: readonly Survey[] = [
  {
    id: 'dss',
    hipsId: 'CDS/P/DSS2/color',
    label: 'DSS2 colour (optical)',
    shows: 'Photographic sky survey from Palomar and UK Schmidt plates, coloured by CDS.',
    frame: 'equatorial',
    coverage: 1,
    servers: [
      'https://alasky.cds.unistra.fr/DSS/DSSColor',
      'https://skies.esac.esa.int/DSSColor',
      'https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor',
      'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color',
      'https://casda.csiro.au/hips/DSS2/color',
    ],
    creditId: 'survey-dss',
  },
  {
    id: 'halpha',
    hipsId: 'CDS/P/Finkbeiner',
    label: 'H-alpha (Finkbeiner)',
    shows: 'Glowing hydrogen gas (emission nebulae) across the whole sky, low resolution.',
    frame: 'galactic',
    coverage: 1,
    servers: [
      'https://alasky.cds.unistra.fr/FinkbeinerHalpha',
      'https://skies.esac.esa.int/FinkbeinerHa',
    ],
    creditId: 'survey-finkbeiner',
  },
  {
    id: '2mass',
    hipsId: 'CDS/P/2MASS/color',
    label: '2MASS colour (near-infrared)',
    shows: 'Near-infrared J, H and Ks light: sees through much of the Milky Way dust.',
    frame: 'equatorial',
    coverage: 1,
    servers: [
      'https://alasky.cds.unistra.fr/2MASS/Color',
      'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color',
      'https://skies.esac.esa.int/2MASSColor',
      'https://casda.csiro.au/hips/2MASS/Color',
    ],
    creditId: 'survey-2mass',
  },
  {
    id: 'allwise',
    hipsId: 'CDS/P/allWISE/color',
    label: 'AllWISE colour (mid-infrared)',
    shows: 'Mid-infrared W1, W2 and W4 light: warm dust and star-forming regions.',
    frame: 'equatorial',
    coverage: 1,
    servers: [
      'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1',
      'https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1',
      'https://skies.esac.esa.int/AllWISEColor',
      'https://hips.china-vo.org/m/CDS_P_allWISE_color',
    ],
    creditId: 'survey-allwise',
  },
  {
    id: 'panstarrs',
    hipsId: 'CDS/P/PanSTARRS/DR1/color-i-r-g',
    label: 'Pan-STARRS DR1 colour (optical)',
    shows: 'Deep modern CCD survey in i, r and g bands; the sharpest optical layer here.',
    frame: 'equatorial',
    coverage: 0.75,
    coverageNote: 'Covers only the sky north of declination −30° (about three-quarters).',
    servers: [
      'https://alasky.cds.unistra.fr/Pan-STARRS/DR1/color-i-r-g',
      'https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/PanSTARRS',
    ],
    creditId: 'survey-panstarrs',
  },
  {
    id: 'gaia',
    hipsId: 'CDS/P/DM/I/355/gaiadr3',
    label: 'Gaia DR3 star density',
    shows: 'How many Gaia stars fall in each patch of sky: the Milky Way structure in stars.',
    frame: 'equatorial',
    coverage: 1,
    servers: [
      'https://alasky.cds.unistra.fr/ancillary/GaiaDR3/density-map',
      'https://alaskybis.cds.unistra.fr/ancillary/GaiaDR3/density-map',
    ],
    creditId: 'survey-gaia-density',
  },
  {
    id: 'sdss',
    hipsId: 'CDS/P/SDSS9/color',
    label: 'SDSS DR9 colour (optical)',
    shows: 'Sloan Digital Sky Survey CCD images in g, r, i: sharp and deep, galaxies in colour.',
    frame: 'equatorial',
    coverage: 0.36,
    coverageNote:
      'Covers about a third of the sky, mostly the northern sky away from the Milky Way.',
    servers: [
      'https://alasky.cds.unistra.fr/SDSS/DR9/color',
      'https://skies.esac.esa.int/SDSS9Color',
      'https://irsa.ipac.caltech.edu/data/hips/CDS/SDSS/DR9/color',
    ],
    creditId: 'survey-sdss',
    fields: [
      { label: 'Whirlpool Galaxy (M51)', ra: 202.47, dec: 47.195, fovDeg: 0.15 },
      { label: 'Pinwheel Galaxy (M101)', ra: 210.8, dec: 54.35, fovDeg: 0.3 },
    ],
  },
  {
    id: 'hst-acs',
    hipsId: 'ESAVO/P/HST/ACS-blue',
    label: 'Hubble ACS (all bands)',
    shows: 'Hubble Space Telescope Advanced Camera for Surveys images, including the deep fields.',
    frame: 'equatorial',
    coverage: 0.0000066,
    coverageNote: 'Only the small patches Hubble observed: use a field below, then zoom in.',
    servers: ['https://skies.esac.esa.int/HST/ACS'],
    creditId: 'survey-hst',
    fields: [
      { label: 'Hubble Ultra Deep Field', ra: 53.1625, dec: -27.7914, fovDeg: 0.07 },
      { label: 'Hubble Deep Field North', ra: 189.2058, dec: 62.2161, fovDeg: 0.06 },
      { label: 'Pillars of Creation (M16)', ra: 274.7, dec: -13.81, fovDeg: 0.06 },
      { label: 'Whirlpool Galaxy (M51)', ra: 202.47, dec: 47.195, fovDeg: 0.15 },
      { label: 'Crab Nebula (M1)', ra: 83.633, dec: 22.0145, fovDeg: 0.12 },
      { label: "Stephan's Quintet", ra: 339.01, dec: 33.96, fovDeg: 0.08 },
      { label: 'Orion Bar', ra: 83.84, dec: -5.42, fovDeg: 0.06 },
    ],
  },
  {
    id: 'hst-wfc3',
    hipsId: 'ESAVO/P/HST/WFC3',
    label: 'Hubble WFC3 (all bands)',
    shows: 'Hubble Wide Field Camera 3, visible and near-infrared, including the Ultra Deep Field.',
    frame: 'equatorial',
    coverage: 0.00014,
    coverageNote: 'Only the small patches Hubble observed: use a field below, then zoom in.',
    servers: ['https://skies.esac.esa.int/HST/WFC3'],
    creditId: 'survey-hst',
    fields: [
      { label: 'Hubble Ultra Deep Field', ra: 53.1625, dec: -27.7914, fovDeg: 0.07 },
      { label: 'Hubble Deep Field North', ra: 189.2058, dec: 62.2161, fovDeg: 0.06 },
      { label: 'Pillars of Creation (M16)', ra: 274.7, dec: -13.81, fovDeg: 0.06 },
      { label: "Stephan's Quintet", ra: 339.01, dec: 33.96, fovDeg: 0.08 },
      { label: 'Whirlpool Galaxy (M51)', ra: 202.47, dec: 47.195, fovDeg: 0.15 },
      { label: 'Pinwheel Galaxy (M101)', ra: 210.8, dec: 54.35, fovDeg: 0.3 },
    ],
  },
  {
    id: 'jwst-nircam',
    hipsId: 'ESAVO/P/JWST/NIRCam_Imaging',
    label: 'JWST NIRCam (near-infrared)',
    shows: 'James Webb Space Telescope NIRCam images: deep fields, nebulae and galaxies.',
    frame: 'equatorial',
    coverage: 0.00001,
    coverageNote: 'Only the small patches Webb observed: use a field below, then zoom in.',
    servers: ['https://skies.esac.esa.int/JWST/NIRCam_Imaging'],
    creditId: 'survey-jwst',
    fields: [
      { label: "Webb's First Deep Field (SMACS 0723)", ra: 110.83, dec: -73.4545, fovDeg: 0.06 },
      { label: 'Cosmic Cliffs (Carina, NGC 3324)', ra: 159.23, dec: -58.62, fovDeg: 0.15 },
      { label: 'Pillars of Creation (M16)', ra: 274.7, dec: -13.81, fovDeg: 0.06 },
      { label: "Stephan's Quintet", ra: 339.01, dec: 33.96, fovDeg: 0.08 },
      { label: 'Cartwheel Galaxy', ra: 9.42, dec: -33.72, fovDeg: 0.05 },
      { label: 'Southern Ring Nebula', ra: 151.76, dec: -40.44, fovDeg: 0.04 },
      { label: 'Hubble Ultra Deep Field', ra: 53.1625, dec: -27.7914, fovDeg: 0.07 },
      { label: 'Crab Nebula (M1)', ra: 83.633, dec: 22.0145, fovDeg: 0.12 },
      { label: 'Orion Bar', ra: 83.84, dec: -5.42, fovDeg: 0.06 },
    ],
  },
  {
    id: 'jwst-miri',
    hipsId: 'ESAVO/P/JWST/P/MIRI_Imaging',
    label: 'JWST MIRI (mid-infrared)',
    shows: 'James Webb Space Telescope MIRI images: warm dust and gas in mid-infrared light.',
    frame: 'equatorial',
    coverage: 0.0000055,
    coverageNote: 'Only the small patches Webb observed: use a field below, then zoom in.',
    servers: ['https://skies.esac.esa.int/JWST/MIRI_Imaging'],
    creditId: 'survey-jwst',
    fields: [
      { label: "Webb's First Deep Field (SMACS 0723)", ra: 110.83, dec: -73.4545, fovDeg: 0.06 },
      { label: 'Cosmic Cliffs (Carina, NGC 3324)', ra: 159.23, dec: -58.62, fovDeg: 0.15 },
      { label: 'Pillars of Creation (M16)', ra: 274.7, dec: -13.81, fovDeg: 0.06 },
      { label: "Stephan's Quintet", ra: 339.01, dec: 33.96, fovDeg: 0.08 },
      { label: 'Cartwheel Galaxy', ra: 9.42, dec: -33.72, fovDeg: 0.05 },
      { label: 'Southern Ring Nebula', ra: 151.76, dec: -40.44, fovDeg: 0.04 },
      { label: 'Hubble Ultra Deep Field', ra: 53.1625, dec: -27.7914, fovDeg: 0.07 },
    ],
  },
];

export function surveyById(id: string): Survey | undefined {
  return SURVEYS.find((s) => s.id === id);
}

/** Parse a HiPS `properties` file ("key = value" lines, # comments). */
export function parseHipsProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key && !(key in out)) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Does this properties file describe the survey we asked for? A mirror that
 * answers with an HTML error page, another survey, or another frame is skipped.
 */
export function propertiesMatch(props: Record<string, string>, survey: Survey): boolean {
  const did = (props.creator_did ?? props.publisher_did ?? props.ID ?? '').replace(/^ivo:\/\//, '');
  if (!did && !props.hips_order) return false; // not a HiPS properties file
  if (did && did !== survey.hipsId) return false;
  const frame = (props.hips_frame ?? 'equatorial').toLowerCase();
  return frame === survey.frame;
}

export interface SurveySource {
  url: string;
  host: string;
  properties: Record<string, string>;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const chosen = new Map<string, SurveySource>();

/**
 * Find the first server that serves this survey. Each probe is one small text
 * request (~2 KB) with a timeout; the answer is remembered for the session.
 * Returns null when every server is down (the UI then says so).
 */
export async function pickServer(
  survey: Survey,
  opts: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<SurveySource | null> {
  const hit = chosen.get(survey.id);
  if (hit) return hit;
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  for (const url of survey.servers) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
    try {
      const res = await fetcher(`${url}/properties`, { signal: ctl.signal, mode: 'cors' });
      if (!res.ok) continue;
      const props = parseHipsProperties(await res.text());
      if (!propertiesMatch(props, survey)) continue;
      const src = { url, host: new URL(url).host, properties: props };
      chosen.set(survey.id, src);
      return src;
    } catch {
      // Timeout, network or CORS failure: try the next server.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Forget remembered servers (tests, or a retry after an outage). */
export function resetServerChoice(): void {
  chosen.clear();
}

/** Readable name of the organisation behind a server, for the credit line. */
export function hostLabel(host: string): string {
  if (host.endsWith('cds.unistra.fr')) return 'CDS Strasbourg';
  if (host === 'skies.esac.esa.int') return 'ESA ESDC mirror';
  if (host.startsWith('stpubdata.s3')) return 'NASA MAST mirror';
  if (host === 'irsa.ipac.caltech.edu') return 'NASA IRSA mirror';
  if (host === 'casda.csiro.au') return 'CSIRO CASDA mirror';
  if (host === 'hips.china-vo.org') return 'China-VO mirror';
  return host;
}
