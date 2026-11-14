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
    id: 'osm-nominatim',
    name: 'OpenStreetMap Nominatim',
    url: 'https://nominatim.org',
    license: 'ODbL 1.0 (data); Nominatim usage policy',
    attribution: 'Place data © OpenStreetMap contributors, ODbL. Search by Nominatim.',
    shortCredit: 'Places: © OpenStreetMap contributors',
    usage:
      'Extra place search (villages, peaks, observatories) and the nearest place name for typed coordinates; only when asked, at most one request per second, cached.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'open-meteo-elevation',
    name: 'Open-Meteo Elevation API (Copernicus DEM GLO-90)',
    url: 'https://open-meteo.com/en/docs/elevation-api',
    license: 'CC BY 4.0 (Open-Meteo); Copernicus DEM © DLR/ESA',
    attribution: 'Elevation by Open-Meteo.com from the Copernicus DEM GLO-90.',
    shortCredit: 'Elevation: Open-Meteo (Copernicus DEM)',
    usage: 'Ground height for coordinates typed into the location picker.',
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
    usage:
      'Seeing and transparency forecast classes every 3 hours, shown as a second opinion next to our own seeing estimate (fetched through the data Worker, cached 3 h).',
    kind: 'data',
    status: 'live',
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
    status: 'live',
    notes: 'Yearly data, not live. Satellite sensors underestimate blue/white LED light.',
  },
  {
    id: 'globe-at-night',
    name: 'Globe at Night (NSF NOIRLab)',
    url: 'https://globeatnight.org/maps-data/',
    license: 'CC BY 4.0',
    attribution:
      'Sky brightness measurements: Globe at Night, a program of NSF NOIRLab, CC BY 4.0 (globeatnight.org).',
    shortCredit: 'Checked against Globe at Night SQM readings (CC BY 4.0)',
    usage:
      'Clear-sky SQM meter readings (2022–2025) used to calibrate and validate the light-pollution model.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'noaa-swpc',
    name: 'NOAA SWPC OVATION aurora forecast and Kp index',
    url: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
    license: 'Public domain (U.S. Government work)',
    attribution: 'Aurora forecast and planetary K-index: NOAA Space Weather Prediction Center.',
    shortCredit: 'Aurora: NOAA SWPC',
    usage:
      'Kp index (observed and 3-day forecast) for everyone; the OVATION aurora map (about 0.9 MB) only for sites 40° or more from the equator, reduced to the chance overhead and in view.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'celestrak',
    name: 'CelesTrak orbital data',
    url: 'https://celestrak.org',
    license: 'Free public data',
    attribution: 'Orbital elements: CelesTrak (Dr. T.S. Kelso).',
    shortCredit: 'Orbits: CelesTrak',
    usage:
      'Orbit elements (OMM) for the ISS, Tiangong and the brightest satellites, fetched at most every 6 hours per browser.',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'satellite-js',
    name: 'satellite.js',
    url: 'https://github.com/shashwatak/satellite-js',
    license: 'MIT',
    attribution: 'satellite.js (SGP4/SDP4), MIT License.',
    shortCredit: 'SGP4: satellite.js',
    usage:
      'Satellite positions from orbit elements for pass predictions, checked against Skyfield.',
    kind: 'library',
    status: 'live',
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
    usage:
      'NGC/IC deep-sky object positions, types and sizes in the sky, and the best-targets list (public/skydata/targets.json).',
    kind: 'data',
    status: 'live',
  },
  {
    id: 'dso-catalogues',
    name: 'HyperLEDA PGC, Sharpless, Lynds, van den Bergh and Barnard catalogues (VizieR)',
    url: 'https://vizier.cds.unistra.fr/',
    license: 'Public catalogues; citation requested',
    attribution:
      'Galaxies: PGC/HyperLEDA, Paturel et al. 2003 (VizieR VII/237; Makarov et al. 2014, HyperLEDA). Nebulae: Sharpless 1959 (VII/20), Lynds 1962 and 1965 (VII/7A, VII/9), van den Bergh 1966 (VII/21), Barnard 1927 (VII/220A). Galaxies with spectra: SDSS DR17 (Abdurro’uf et al. 2022); funding for SDSS-IV was provided by the Alfred P. Sloan Foundation, the U.S. Department of Energy Office of Science and the Participating Institutions. This research has made use of the VizieR catalogue access tool, CDS, Strasbourg (via the CfA mirror).',
    shortCredit: 'Deep-sky: PGC/HyperLEDA, Sharpless, Lynds, vdB, Barnard via VizieR',
    usage:
      'About 980,000 PGC galaxies, about 2.6 million SDSS DR17 galaxies with spectra and 3,700 nebulae in the 3D sky (from R2, alongside OpenNGC).',
    kind: 'data',
    status: 'live',
  },
  // Optional sky surveys (off by default). Streamed, never hosted by us.
  {
    id: 'survey-cds-hips',
    name: 'CDS HiPS image surveys and their mirrors',
    url: 'https://aladin.cds.unistra.fr/hips/',
    license: 'Free access; each survey keeps its own terms (below)',
    attribution:
      'This site uses HiPS image surveys produced and distributed by the CDS, Strasbourg Astronomical Observatory, France (HiPS: Fernique et al. 2015, A&A 578, A114), served by CDS and by the mirrors at ESA ESDC, NASA MAST, NASA IRSA, CSIRO CASDA and China-VO.',
    shortCredit: 'Surveys: HiPS by CDS Strasbourg',
    usage:
      'All optional surveys are streamed tile by tile from these servers only when you turn a survey on. Nothing is stored by this site.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-dss',
    name: 'Digitized Sky Survey (DSS2), colour HiPS',
    url: 'https://archive.stsci.edu/dss/copyright.html',
    license: 'CC BY-NC-SA 4.0 — non-commercial use only',
    attribution:
      'The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166. The images of these surveys are based on photographic data obtained using the Oschin Schmidt Telescope on Palomar Mountain and the UK Schmidt Telescope. The plates were processed into the present compressed digital form with the permission of these institutions. Colour composite and HiPS by CDS.',
    shortCredit:
      'DSS2: STScI/NASA, Palomar & UK Schmidt; colour by CDS (CC BY-NC-SA, non-commercial)',
    usage: 'Optional optical survey layer.',
    kind: 'survey',
    status: 'live',
    notes:
      'DSS images may be used for scientific, educational and non-profit purposes only; for-profit use is forbidden. This site is free and non-commercial. If you reuse this code commercially, remove this survey.',
  },
  {
    id: 'survey-finkbeiner',
    name: 'Finkbeiner full-sky H-alpha map',
    url: 'https://ui.adsabs.harvard.edu/abs/2003ApJS..146..407F',
    license: 'Public data; citation requested',
    attribution:
      'H-alpha composite map by Douglas Finkbeiner (2003, ApJS 146, 407), assembled from the Wisconsin H-Alpha Mapper (WHAM), the Virginia Tech Spectral-Line Survey (VTSS) and the Southern H-Alpha Sky Survey Atlas (SHASSA). HiPS by CDS.',
    shortCredit: 'H-alpha: Finkbeiner 2003 (WHAM, VTSS, SHASSA); HiPS by CDS',
    usage: 'Optional H-alpha (emission nebula) layer.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-2mass',
    name: 'Two Micron All Sky Survey (2MASS), colour HiPS',
    url: 'https://www.ipac.caltech.edu/2mass/',
    license: 'Public data; acknowledgement required',
    attribution:
      'This publication makes use of data products from the Two Micron All Sky Survey, which is a joint project of the University of Massachusetts and the Infrared Processing and Analysis Center/California Institute of Technology, funded by the National Aeronautics and Space Administration and the National Science Foundation. HiPS by CDS.',
    shortCredit: '2MASS: UMass & IPAC/Caltech (NASA, NSF); HiPS by CDS',
    usage: 'Optional near-infrared survey layer.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-allwise',
    name: 'AllWISE, colour HiPS',
    url: 'https://wise2.ipac.caltech.edu/docs/release/allwise/',
    license: 'Public data (NASA); acknowledgement required',
    attribution:
      'This uses data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, and NEOWISE, which is a project of the Jet Propulsion Laboratory/California Institute of Technology. WISE and NEOWISE are funded by the National Aeronautics and Space Administration. HiPS by CDS.',
    shortCredit: 'AllWISE: NASA/JPL-Caltech/UCLA; HiPS by CDS',
    usage: 'Optional mid-infrared survey layer.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-panstarrs',
    name: 'Pan-STARRS1 DR1, colour HiPS (i, r, g)',
    url: 'https://panstarrs.stsci.edu/',
    license: 'Public data (MAST); acknowledgement requested',
    attribution:
      "The Pan-STARRS1 Surveys (PS1) and the PS1 public science archive have been made possible through contributions by the Institute for Astronomy, the University of Hawaii, the Pan-STARRS Project Office, the Max-Planck Society and its participating institutes, the Max Planck Institute for Astronomy, Heidelberg and the Max Planck Institute for Extraterrestrial Physics, Garching, The Johns Hopkins University, Durham University, the University of Edinburgh, the Queen's University Belfast, the Harvard-Smithsonian Center for Astrophysics, the Las Cumbres Observatory Global Telescope Network Incorporated, the National Central University of Taiwan, the Space Telescope Science Institute, the National Aeronautics and Space Administration under Grant No. NNX08AR22G issued through the Planetary Science Division of the NASA Science Mission Directorate, the National Science Foundation Grant No. AST-1238877, the University of Maryland, Eotvos Lorand University (ELTE), the Los Alamos National Laboratory, and the Gordon and Betty Moore Foundation. Images retrieved from MAST at STScI; HiPS by CDS.",
    shortCredit: 'Pan-STARRS1: PS1 Science Consortium, via MAST/STScI; HiPS by CDS',
    usage: 'Optional deep optical survey layer (sky north of declination −30°).',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-sdss',
    name: 'Sloan Digital Sky Survey DR9, colour HiPS',
    url: 'https://www.sdss.org/',
    license: 'Public data; acknowledgement requested',
    attribution:
      'Funding for SDSS-III has been provided by the Alfred P. Sloan Foundation, the Participating Institutions, the National Science Foundation, and the U.S. Department of Energy Office of Science. HiPS by CDS; served by ESA ESDC and NASA/IPAC IRSA mirrors.',
    shortCredit: 'SDSS DR9 (Sloan Foundation, NSF, DOE); HiPS by CDS',
    usage: 'Optional deep optical survey layer (about a third of the sky).',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-hst',
    name: 'Hubble Space Telescope ACS and WFC3 (eHST HiPS)',
    url: 'https://www.cosmos.esa.int/web/hst',
    license: 'Public archive data; acknowledgement requested',
    attribution:
      'Based on observations made with the NASA/ESA Hubble Space Telescope, obtained from the ESA Hubble Science Archive (eHST). HiPS by the ESA ESDC (ESASky).',
    shortCredit: 'NASA/ESA Hubble Space Telescope; eHST, HiPS by ESA ESDC',
    usage:
      'Optional Hubble image layers with go-to buttons for the deep fields and famous targets.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-jwst',
    name: 'James Webb Space Telescope NIRCam and MIRI (ESA HiPS)',
    url: 'https://www.cosmos.esa.int/web/jwst',
    license: 'Public archive data; acknowledgement requested',
    attribution:
      'Based on observations made with the NASA/ESA/CSA James Webb Space Telescope, obtained from the ESA JWST Science Archive. HiPS by the ESA ESDC (ESASky).',
    shortCredit: 'NASA/ESA/CSA James Webb Space Telescope; HiPS by ESA ESDC',
    usage: 'Optional Webb image layers with go-to buttons for famous fields.',
    kind: 'survey',
    status: 'live',
  },
  {
    id: 'survey-gaia-density',
    name: 'Gaia DR3 star density map (HiPS)',
    url: 'https://www.cosmos.esa.int/web/gaia/dr3',
    license: 'ESA open data; credit required',
    attribution:
      'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC). Credit: ESA/Gaia/DPAC. Density map HiPS by CDS.',
    shortCredit: 'Gaia DR3 density: ESA/Gaia/DPAC; HiPS by CDS',
    usage: 'Optional star-density layer.',
    kind: 'survey',
    status: 'live',
    notes: 'Only CDS serves this map (no mirror), so it is unavailable while CDS is offline.',
  },
];

export function creditLine(id: string): string {
  return CREDITS.find((c) => c.id === id)?.shortCredit ?? '';
}
