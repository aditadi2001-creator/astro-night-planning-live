/**
 * Single source of truth for every data source and library we use, with the
 * exact attribution each one requires. The Credits page renders this list and
 * data displays pull their short credit line from here.
 *
 * `status` lets the page be honest about what is live today versus planned.
 */
export interface Credit {
  id: string;
  name: string;
  url: string;
  license: string;
  /** Exact attribution text the source asks for. */
  attribution: string;
  /** Short line shown next to the data on screen. */
  shortCredit: string;
  usage: string;
  kind: 'data' | 'library' | 'survey';
  status: 'live' | 'planned';
  notes?: string;
}

export const CREDITS: Credit[] = [
  {
    id: 'stellarium-web-engine',
    name: 'Stellarium Web Engine',
    url: 'https://github.com/Stellarium/stellarium-web-engine',
    license: 'AGPL-3.0',
    attribution:
      'Stellarium Web Engine — Copyright (c) Stellarium Labs SRL / Noctua Software Ltd, AGPL-3.0.',
    shortCredit: 'Sky rendering: Stellarium Web Engine (AGPL-3.0)',
    usage:
      '3D planetarium renderer compiled to WebAssembly. This whole site is AGPL-3.0 because of it.',
    kind: 'library',
    status: 'planned',
  },
  {
    id: 'astronomy-engine',
    name: 'Astronomy Engine',
    url: 'https://github.com/cosinekitty/astronomy',
    license: 'MIT',
    attribution: 'Astronomy Engine by Don Cross, MIT License.',
    shortCredit: 'Positions: Astronomy Engine',
    usage: 'Sun, Moon and planet positions, Moon phase, rise/set and twilight times.',
    kind: 'library',
    status: 'live',
  },
  {
    id: 'svelte',
    name: 'Svelte',
    url: 'https://svelte.dev',
    license: 'MIT',
    attribution: 'Svelte, MIT License.',
    shortCredit: 'UI: Svelte',
    usage: 'User interface framework.',
    kind: 'library',
    status: 'live',
  },
  {
    id: 'open-meteo',
    name: 'Open-Meteo Forecast API',
    url: 'https://open-meteo.com',
    license: 'CC BY 4.0 (data), free non-commercial API',
    attribution: 'Weather data by Open-Meteo.com (https://open-meteo.com), licensed CC BY 4.0.',
    shortCredit: 'Weather data by Open-Meteo.com',
    usage:
      'Temperature, humidity, dew point, pressure, wind, visibility, low/mid/high cloud cover, upper-air winds.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'open-meteo-aq',
    name: 'Open-Meteo Air Quality API (Copernicus CAMS)',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    license: 'CC BY 4.0',
    attribution:
      'Air quality data by Open-Meteo.com, based on CAMS ENSEMBLE data provider (Copernicus Atmosphere Monitoring Service).',
    shortCredit: 'Air quality: Open-Meteo.com, CAMS ENSEMBLE data provider',
    usage: 'Aerosol optical depth, dust, PM2.5, PM10, US/European AQI.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: '7timer',
    name: '7Timer! ASTRO',
    url: 'https://www.7timer.info',
    license: 'Free for non-commercial use',
    attribution: 'Seeing/transparency forecast by 7Timer! (https://www.7timer.info).',
    shortCredit: 'Second opinion: 7Timer!',
    usage: 'Seeing and transparency forecast classes, used as a second opinion.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'nasa-gibs',
    name: 'NASA GIBS (GOES-East, GOES-West, Himawari, VIIRS, MODIS)',
    url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
    license: 'NASA open data (no restrictions)',
    attribution:
      "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
    shortCredit: 'Satellite imagery: NASA GIBS / ESDIS',
    usage: 'Live infrared cloud imagery every 10 minutes.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'noaa-gmgsi',
    name: 'NOAA GMGSI (Global Mosaic of Geostationary Satellite Imagery)',
    url: 'https://registry.opendata.aws/noaa-gmgsi/',
    license: 'Public domain (U.S. Government work)',
    attribution: 'Global infrared mosaic: NOAA GMGSI via the NOAA Open Data Dissemination Program.',
    shortCredit: 'Global IR mosaic: NOAA GMGSI',
    usage:
      'Hourly global infrared mosaic, including Meteosat coverage over Europe, Africa and India.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'black-marble',
    name: 'NASA Black Marble VNP46A4',
    url: 'https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A4/',
    license: 'NASA open data (no restrictions)',
    attribution:
      'Night lights: NASA Black Marble VNP46A4 (Román et al.), distributed by NASA LAADS DAAC. Sky brightness modelled by this project.',
    shortCredit: 'Light pollution model from NASA Black Marble (yearly)',
    usage:
      'Yearly night-lights radiance used to model artificial sky brightness, SQM and Bortle class.',
    kind: 'data',
    status: 'planned',
    notes: 'Yearly data, not live. Satellite sensors underestimate blue/white LED light.',
  },
  {
    id: 'noaa-swpc',
    name: 'NOAA SWPC OVATION aurora forecast',
    url: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
    license: 'Public domain (U.S. Government work)',
    attribution: 'Aurora forecast: NOAA Space Weather Prediction Center.',
    shortCredit: 'Aurora: NOAA SWPC',
    usage: 'Aurora probability for high latitudes.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'celestrak',
    name: 'CelesTrak orbital data',
    url: 'https://celestrak.org',
    license: 'Free public data',
    attribution: 'Orbital elements: CelesTrak (Dr. T.S. Kelso).',
    shortCredit: 'Orbits: CelesTrak',
    usage: 'ISS and satellite pass predictions.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'gaia',
    name: 'ESA Gaia DR3 (magnitude-limited subset)',
    url: 'https://www.cosmos.esa.int/web/gaia/dr3',
    license: 'CC BY-SA 3.0 IGO',
    attribution:
      'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC). Credit: ESA/Gaia/DPAC.',
    shortCredit: 'Stars: ESA/Gaia/DPAC',
    usage: 'Star positions, magnitudes and colours down to a magnitude limit.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'hipparcos',
    name: 'Hipparcos catalogue',
    url: 'https://www.cosmos.esa.int/web/hipparcos',
    license: 'ESA open data',
    attribution: 'Hipparcos catalogue, ESA (1997), ESA SP-1200.',
    shortCredit: 'Bright stars: Hipparcos (ESA)',
    usage: 'Bright-star positions and identifiers.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'bsc',
    name: 'Yale Bright Star Catalogue (5th rev.)',
    url: 'http://tdc-www.harvard.edu/catalogs/bsc5.html',
    license: 'Public domain',
    attribution: 'Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren, 1991).',
    shortCredit: 'Star names: Yale BSC',
    usage: 'Bright-star names and designations.',
    kind: 'data',
    status: 'planned',
  },
  {
    id: 'openngc',
    name: 'OpenNGC',
    url: 'https://github.com/mattiaverga/OpenNGC',
    license: 'CC BY-SA 4.0',
    attribution: 'Deep-sky objects: OpenNGC by Mattia Verga, CC BY-SA 4.0.',
    shortCredit: 'Deep-sky: OpenNGC',
    usage: 'NGC/IC deep-sky object positions, types and sizes.',
    kind: 'data',
    status: 'planned',
  },
];

export function creditLine(id: string): string {
  return CREDITS.find((c) => c.id === id)?.shortCredit ?? '';
}
