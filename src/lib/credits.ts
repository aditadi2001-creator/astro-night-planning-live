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
    status: 'live',
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
    status: 'live',
  },
  {
    id: 'open-meteo-geocoding',
    name: 'Open-Meteo Geocoding API (GeoNames)',
    url: 'https://open-meteo.com/en/docs/geocoding-api',
    license: 'CC BY 4.0',
    attribution:
      'Location search by Open-Meteo.com, based on GeoNames (https://www.geonames.org), CC BY 4.0.',
    shortCredit: 'Search: Open-Meteo geocoding (GeoNames, CC BY 4.0)',
    usage: 'Place-name search with coordinates, elevation and time zone.',
    kind: 'data',
    status: 'live',
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
    status: 'live',
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
    name: 'NASA GIBS (GOES-East, GOES-West, Himawari; VIIRS Black Marble base map)',
    url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
    license: 'NASA open data (no restrictions)',
    attribution:
      "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
    shortCredit: 'Satellite imagery: NASA GIBS / ESDIS',
    usage:
      'Satellite cloud map: GOES-East/West (NOAA) and Himawari (JMA) band 13 infrared every 10 minutes; NASA Black Marble night lights as the base map; coastlines.',
    kind: 'data',
    status: 'live',
    notes: 'Explicit 10-minute times are requested; the newest is found by stepping back from now.',
  },
  {
    id: 'noaa-gmgsi',
    name: 'NOAA GMGSI (Global Mosaic of Geostationary Satellite Imagery)',
    url: 'https://registry.opendata.aws/noaa-gmgsi/',
    license: 'Public domain (U.S. Government work)',
    attribution: 'Global infrared mosaic: NOAA GMGSI via the NOAA Open Data Dissemination Program.',
    shortCredit: 'Global IR mosaic: NOAA GMGSI',
    usage:
      'Hourly global infrared mosaic (incl. Meteosat over Europe, Africa and India): converted by this project to map tiles each hour, used on the satellite map and to measure cloud around your site.',
    kind: 'data',
    status: 'live',
    notes:
      'Infrared cannot separate low fog/stratus from the ground; the cloud estimate is blended with the forecast.',
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
    license: 'ESA open data; credit required',
    attribution:
      'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC). Credit: ESA/Gaia/DPAC.',
    shortCredit: 'Stars: ESA/Gaia/DPAC',
    usage: 'Star positions, magnitudes and colours down to a magnitude limit.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'gaia-sky-map',
    name: 'Gaia EDR3 all-sky colour map (Milky Way background)',
    url: 'https://www.esa.int/ESA_Multimedia/Images/2020/12/The_colour_of_the_sky_from_Gaia_s_Early_Data_Release_3',
    license: 'CC BY-SA 3.0 IGO',
    attribution: 'ESA/Gaia/DPAC; CC BY-SA 3.0 IGO. Acknowledgement: A. Moitinho.',
    shortCredit: 'Milky Way: ESA/Gaia/DPAC (CC BY-SA 3.0 IGO)',
    usage:
      'Reprojected by this project into sky tiles for the Milky Way background; the derived tiles are shared under the same license.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'iau-wgsn',
    name: 'IAU Catalog of Star Names',
    url: 'https://www.iau.org/public/themes/naming_stars/',
    license: 'IAU (CC BY 4.0)',
    attribution: 'Star names: IAU Working Group on Star Names (WGSN), IAU Catalog of Star Names.',
    shortCredit: 'Star names: IAU WGSN',
    usage: 'Official proper names of stars (Sirius, Vega, Altair …).',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'skyculture-western',
    name: 'Stellarium “Western” sky culture',
    url: 'https://github.com/Stellarium/stellarium-skycultures',
    license: 'CC BY-SA',
    attribution:
      'Constellation lines, names and boundaries: Stellarium “Western” sky culture, CC BY-SA.',
    shortCredit: 'Constellations: Stellarium sky culture (CC BY-SA)',
    usage: 'Constellation stick figures, names and IAU boundaries.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'moon-texture',
    name: 'Moon texture',
    url: 'https://github.com/Stellarium/stellarium-web-engine',
    license: 'CC BY 4.0',
    attribution:
      'Moon texture by Oleg Pluton (a.k.a. Helleformer), CC BY 4.0, from NASA public-domain data.',
    shortCredit: 'Moon texture: Oleg Pluton, CC BY 4.0',
    usage: 'Surface texture of the Moon in the 3D sky.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'cds-vizier',
    name: 'VizieR catalogue service (CDS, Strasbourg; CfA mirror)',
    url: 'https://vizier.cds.unistra.fr',
    license: 'Free service; acknowledgement requested',
    attribution:
      'This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France (Ochsenbein et al. 2000, A&AS 143, 23).',
    shortCredit: 'Catalog access: VizieR (CDS)',
    usage: 'Used by the build pipeline to download the Hipparcos catalogue.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'gavo',
    name: 'GAVO Data Center (Heidelberg)',
    url: 'https://dc.g-vo.org',
    license: 'Free service; acknowledgement requested',
    attribution: 'Gaia DR3 subset retrieved through the GAVO Data Center TAP service.',
    shortCredit: 'Catalog access: GAVO DC',
    usage: 'Used by the build pipeline to download the Gaia DR3 bright-star subset.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'copernicus-dem',
    name: 'Copernicus DEM GLO-30 (terrain horizon)',
    url: 'https://registry.opendata.aws/copernicus-dem/',
    license: 'Copernicus DEM GLO-30 public licence (free of charge, any use)',
    attribution:
      'Terrain horizon produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.',
    shortCredit: 'Terrain: Copernicus WorldDEM-30 © DLR e.V., © Airbus DS',
    usage:
      'The browser reads a few overview blocks around the site (via our Worker, since the bucket has no CORS) to compute the real horizon silhouette. Nothing is stored by us.',
    kind: 'data',
    status: 'live',
    notes: 'Modified data: the elevation model is resampled and turned into a horizon profile.',
  },
  {
    id: 'maplibre',
    name: 'MapLibre GL JS',
    url: 'https://maplibre.org/',
    license: 'BSD-3-Clause',
    attribution: 'MapLibre GL JS — Copyright (c) MapLibre contributors, BSD-3-Clause.',
    shortCredit: 'Map: MapLibre GL JS',
    usage: 'Satellite cloud map (loaded only when the map is switched on).',
    kind: 'library',
    status: 'live',
  },
  {
    id: 'pmtiles',
    name: 'PMTiles',
    url: 'https://github.com/protomaps/PMTiles',
    license: 'BSD-3-Clause',
    attribution: 'PMTiles — Copyright (c) Protomaps LLC, BSD-3-Clause.',
    shortCredit: 'Tile archives: PMTiles',
    usage:
      'Single-file tile archives in R2 (deep stars, hourly satellite clouds), read by the data Worker.',
    kind: 'library',
    status: 'live',
  },
  {
    id: 'geotiff-js',
    name: 'geotiff.js',
    url: 'https://github.com/geotiffjs/geotiff.js',
    license: 'MIT',
    attribution: 'geotiff.js, MIT License.',
    shortCredit: 'GeoTIFF reading: geotiff.js',
    usage: 'Reads the elevation model with HTTP range requests.',
    kind: 'library',
    status: 'live',
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
    status: 'live',
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
    status: 'live',
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
    status: 'live',
  },
];

export function creditLine(id: string): string {
  return CREDITS.find((c) => c.id === id)?.shortCredit ?? '';
}
