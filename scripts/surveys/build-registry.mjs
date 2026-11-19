#!/usr/bin/env node
/**
 * Dev-time: build src/lib/sky/survey-registry.ts (extra HiPS sky surveys for the survey picker).
 *
 *   node scripts/surveys/build-registry.mjs
 *
 * For each chosen survey ID it asks the CDS MocServer (still online during the 2026-11 CDS outage)
 * for the official record — title, copyright, frame, max order, tile formats, sky coverage and every
 * registered mirror — then adds the mirrors that were tested for CORS on 2026-11-19
 * (docs/RESEARCH.md §6) and puts CDS Strasbourg last. Surveys are streamed from these public
 * servers at runtime and never copied to our storage (CLAUDE.md constraint 4).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MOC = 'https://alasky.cds.unistra.fr/MocServer/query';

/** id, HiPS ID, band, short label, plain-language description, extra CORS-tested mirrors. */
const CHOSEN = [
  [
    'fermi',
    'CDS/P/Fermi/color',
    'gamma',
    'Fermi (gamma rays)',
    'The whole sky in gamma rays: pulsars, blazars and the glowing Milky Way plane.',
    ['https://healpix.ias.u-psud.fr/CDS_P_Fermi_color'],
  ],
  [
    'integral',
    'ESAVO/P/INTEGRAL/color',
    'gamma',
    'INTEGRAL (hard X-rays)',
    'Hard X-ray / soft gamma-ray map from ESA’s INTEGRAL satellite.',
    [],
  ],
  [
    'erosita',
    'erosita/dr1/rate/rgb',
    'xray',
    'eROSITA DR1 (X-rays)',
    'X-ray colour map of the western Galactic hemisphere: hot gas, clusters of galaxies.',
    ['https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_RGB_Rate_c010'],
  ],
  [
    'rass',
    'CDS/P/RASS',
    'xray',
    'ROSAT all-sky survey (X-rays)',
    'The 1990s ROSAT X-ray survey of the whole sky.',
    [],
  ],
  [
    'xmm',
    'ESAVO/P/XMM/EPIC-RGB',
    'xray',
    'XMM-Newton EPIC (X-rays)',
    'Deep X-ray pointings by XMM-Newton (about 9 % of the sky).',
    ['https://esdchips.esac.esa.int/XMM-Newton/EPIC-RGB'],
  ],
  [
    'galex',
    'CDS/P/GALEXGR6_7/color',
    'uv',
    'GALEX (ultraviolet)',
    'Ultraviolet light from hot young stars, star-forming galaxies and white dwarfs.',
    ['https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/GALEXColor'],
  ],
  [
    'dssred',
    'CDS/P/DSS2/red',
    'optical',
    'DSS2 red (optical)',
    'Red photographic plates of the Digitized Sky Survey, the whole sky in black and white.',
    [],
  ],
  [
    'gaiargb',
    'ESAVO/P/GAIA/DR3-RGB',
    'optical',
    'Gaia DR3 colour (optical)',
    'The Milky Way built from 1.8 billion Gaia star measurements (CC BY-NC 3.0 IGO).',
    [],
  ],
  [
    'decaps',
    'CDS/P/DECaPS/DR2/color',
    'optical',
    'DECaPS DR2 (optical)',
    'Deep colour images of the southern Galactic plane from the Dark Energy Camera.',
    [],
  ],
  [
    'skymapper',
    'CDS/P/Skymapper/DR4/color',
    'optical',
    'SkyMapper DR4 (optical)',
    'Southern-sky colour survey from Siding Spring, Australia.',
    [],
  ],
  [
    'legacy',
    'CDS/P/DESI-Legacy-Surveys/DR10/color',
    'optical',
    'DESI Legacy Surveys DR10 (optical)',
    'Very deep colour images of two-thirds of the sky, used to map galaxies for DESI.',
    [],
  ],
  [
    'ztf',
    'CDS/P/ZTF/DR7/color',
    'optical',
    'ZTF DR7 (optical)',
    'Colour images of the northern sky from the Zwicky Transient Facility.',
    [],
  ],
  [
    'vtss',
    'CDS/P/VTSS/Ha',
    'halpha',
    'H-alpha (VTSS)',
    'Virginia Tech hydrogen-alpha survey of the northern Milky Way.',
    ['https://skies.esac.esa.int/VTSSHa'],
  ],
  [
    'shassa',
    'CDS/P/SHASSA/H',
    'halpha',
    'H-alpha (SHASSA)',
    'Southern H-alpha sky survey atlas.',
    [],
  ],
  [
    'wham',
    'ov-gso/P/WHAM',
    'halpha',
    'H-alpha (WHAM)',
    'Wisconsin H-alpha Mapper: faint ionised gas across the whole sky, very low resolution.',
    [],
  ],
  [
    'unwise',
    'CDS/P/unWISE/color-W2-W1W2-W1',
    'infrared',
    'unWISE (infrared)',
    'Deeper reprocessing of the WISE infrared images.',
    [],
  ],
  [
    'iris',
    'CDS/P/IRIS/color',
    'infrared',
    'IRIS / IRAS (far infrared)',
    'Warm dust across the sky from the 1983 IRAS satellite (reprocessed).',
    [],
  ],
  [
    'akari',
    'ESAVO/P/AKARI/color',
    'infrared',
    'AKARI (far infrared)',
    'Far-infrared dust emission from Japan’s AKARI satellite.',
    [],
  ],
  [
    'msx',
    'CDS/P/MSX/MSX_color',
    'infrared',
    'MSX (mid infrared)',
    'Mid-infrared Galactic plane survey from the Midcourse Space Experiment.',
    ['https://irsa.ipac.caltech.edu/data/hips/CDS/MSX/MSX_color'],
  ],
  [
    'planck',
    'CDS/P/PLANCK/R2/HFI/color',
    'submm',
    'Planck HFI (sub-millimetre)',
    'Cold dust and the cosmic microwave background from ESA’s Planck.',
    ['https://healpix.ias.u-psud.fr/CDS_P_PLANCK_R2_HFI_color'],
  ],
  [
    'nvss',
    'CDS/P/NVSS',
    'radio',
    'NVSS (radio, 1.4 GHz)',
    'Radio sources north of −40°: radio galaxies, quasars, supernova remnants.',
    ['https://casda.csiro.au/hips/NVSS', 'https://hips.china-vo.org/m/CDS_P_NVSS'],
  ],
  [
    'haslam',
    'ESAVO/P/Haslam408',
    'radio',
    'Haslam 408 MHz (radio)',
    'The classic all-sky radio map: synchrotron glow of the Milky Way.',
    [],
  ],
  [
    'hi4pi',
    'CDS/P/HI4PI/NHI',
    'radio',
    'HI4PI (neutral hydrogen)',
    'Column density of neutral hydrogen gas from the 21 cm line.',
    [],
  ],
  [
    'racs',
    'CSIRO/P/RACS/low/I',
    'radio',
    'RACS-low (radio, 888 MHz)',
    'ASKAP radio survey of the sky south of +41°.',
    ['https://casda.csiro.au/hips/RACS/low/I'],
  ],
  [
    'lotss',
    'ASTRON/P/lotss_dr2_low',
    'radio',
    'LoTSS DR2 (radio, 144 MHz)',
    'LOFAR low-frequency survey of the northern sky.',
    ['https://hips.astron.nl/ASTRON/P/lotss_dr2_low'],
  ],
];

async function record(id) {
  const q = new URLSearchParams({ ID: id, get: 'record', fmt: 'json' });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${MOC}?${q}`, { signal: AbortSignal.timeout(30_000) });
      const j = await r.json();
      const rec = Array.isArray(j) ? j[0] : j;
      if (rec && rec.ID) return rec;
      return null;
    } catch {
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  return null;
}

const strip = (u) => u.replace(/\/+$/, '');
const isCds = (u) => /cds\.unistra\.fr/.test(u);
const first = (v) => (Array.isArray(v) ? v[0] : v);

const out = [];
const credits = [];
for (const [id, hipsId, band, label, shows, extra] of CHOSEN) {
  const rec = await record(hipsId);
  const urls = [];
  if (rec) {
    for (const [k, v] of Object.entries(rec)) {
      if (/^hips_service_url(_\d+)?$/.test(k)) for (const u of [v].flat()) urls.push(strip(u));
    }
  }
  for (const u of extra) urls.push(strip(u));
  const unique = [...new Set(urls)].filter((u) => u.startsWith('https://'));
  const servers = [...unique.filter((u) => !isCds(u)), ...unique.filter(isCds)];
  if (!servers.length) {
    console.log(`skip ${hipsId}: no https server`);
    continue;
  }
  const frame = (first(rec?.hips_frame) ?? 'equatorial').toLowerCase().startsWith('gal')
    ? 'galactic'
    : 'equatorial';
  const coverage = Number(first(rec?.moc_sky_fraction) ?? 1);
  const formats = String(first(rec?.hips_tile_format) ?? 'jpeg');
  if (!/jpe?g|png|webp/.test(formats)) {
    console.log(`skip ${hipsId}: tile format ${formats} not drawable`);
    continue;
  }
  const copyright = String(first(rec?.obs_copyright) ?? '').trim();
  const title = String(first(rec?.obs_title) ?? label).trim();
  out.push({
    id,
    hipsId,
    band,
    label,
    shows,
    frame,
    coverage: Math.round(Math.min(1, coverage) * 1000) / 1000,
    ...(coverage < 0.95
      ? { coverageNote: `Covers about ${Math.round(coverage * 100)} % of the sky.` }
      : {}),
    servers,
    creditId: `survey-${id}`,
    cdsOnly: servers.every(isCds),
  });
  credits.push({
    id: `survey-${id}`,
    name: title,
    url: servers[0],
    license: String(first(rec?.hips_license) ?? 'see provider').trim() || 'see provider',
    attribution: copyright || `${title} (HiPS ${hipsId})`,
    shortCredit: copyright ? `${label}: ${copyright}` : `${label}: ${title}`,
    usage: `Optional sky survey layer (HiPS ${hipsId}), streamed from the provider's servers.`,
    kind: 'survey',
    status: 'live',
  });
  console.log(
    `ok ${hipsId}: ${servers.length} servers${servers.every(isCds) ? ' (CDS only)' : ''}`,
  );
}

const ts = `/**
 * Extra HiPS sky surveys for the survey picker — GENERATED by scripts/surveys/build-registry.mjs
 * from the CDS MocServer registry (${new Date().toISOString().slice(0, 10)}) plus CORS-tested mirrors.
 * Do not edit by hand: re-run the script.
 */
import type { Survey } from './surveys';
import type { Credit } from '../credits';

export const REGISTRY_SURVEYS: readonly Survey[] = ${JSON.stringify(out, null, 2)};

export const REGISTRY_CREDITS: readonly Credit[] = ${JSON.stringify(credits, null, 2)};
`;
const dest = fileURLToPath(new URL('../../src/lib/sky/survey-registry.ts', import.meta.url));
writeFileSync(dest, ts);
console.log(`wrote ${out.length} surveys to src/lib/sky/survey-registry.ts`);
