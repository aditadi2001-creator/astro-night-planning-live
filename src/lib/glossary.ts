/** Plain-language glossary for beginners (Help → Glossary). Keep each entry to two sentences. */
export interface Term {
  term: string;
  text: string;
}

export const GLOSSARY: Term[] = [
  {
    term: 'Airmass',
    text: 'How much air the light crosses: 1 straight up, about 2 at 30° altitude. Lower is sharper and brighter.',
  },
  {
    term: 'Altitude and azimuth',
    text: 'Altitude is the height above the horizon (0° to 90°). Azimuth is the compass direction: 0° north, 90° east, 180° south, 270° west.',
  },
  {
    term: 'Arcminute, arcsecond (′, ″)',
    text: 'Small angles: 60 arcminutes make a degree, 60 arcseconds an arcminute. The full Moon is about 30′ wide.',
  },
  {
    term: 'Astronomical twilight',
    text: 'While the Sun is 12° to 18° below the horizon the sky is still faintly lit. Real darkness starts when it is more than 18° down.',
  },
  {
    term: 'Bortle scale',
    text: 'A 1–9 rating of how dark a sky is: 1 is a pristine desert, 9 a city centre. A big-city centre is about 8–9; a rural village about 4.',
  },
  {
    term: 'Dark nebula',
    text: 'A cloud of dust that blocks the light behind it, seen as a dark shape against stars or glowing gas.',
  },
  {
    term: 'Declination (Dec)',
    text: 'Sky latitude: degrees north (+) or south (−) of the celestial equator.',
  },
  {
    term: 'Dew point',
    text: 'The temperature at which moisture condenses. When the air nears it, optics fog up: use a dew heater.',
  },
  {
    term: 'Emission nebula',
    text: 'Gas that glows by itself, mostly hydrogen (red Hα light). Narrowband filters make these easy to image from a city.',
  },
  {
    term: 'Field of view (FOV)',
    text: 'How much sky your camera or eyepiece sees at once. The frame on the Sky page shows it at true size.',
  },
  {
    term: 'Focal ratio (f/)',
    text: 'Focal length divided by aperture. A lower number (f/4) collects light faster than a higher one (f/10).',
  },
  {
    term: 'Galaxy',
    text: 'A system of billions of stars far beyond our own Milky Way. Most are faint and need dark skies and long exposures.',
  },
  {
    term: 'Globular cluster',
    text: 'A dense ball of hundreds of thousands of old stars. Bright and easy, even from light-polluted places.',
  },
  {
    term: 'GoTo',
    text: 'A mount that finds objects by itself: choose a target and it slews there. "Slew and centre" (with NINA) then takes a picture, plate-solves and corrects until the object is exactly in the middle.',
  },
  {
    term: 'Hour angle (HA)',
    text: 'How far an object is from the meridian, in hours: negative while it rises in the east, positive after it has crossed.',
  },
  {
    term: 'J2000 and JNow',
    text: 'Star coordinates drift slowly (precession). J2000 fixes them at the year 2000, as catalogs and NINA use; JNow is the position of date that many mounts use.',
  },
  {
    term: 'Light pollution',
    text: 'Artificial light scattered in the air that brightens the sky and hides faint objects.',
  },
  {
    term: 'Limiting magnitude',
    text: 'The faintest star you can see (or image). A higher number means a darker, clearer sky.',
  },
  {
    term: 'Magnitude',
    text: 'Brightness on a reversed scale: smaller is brighter. Sirius is −1.5; the faintest stars seen by eye from a dark site are about 6.5.',
  },
  {
    term: 'Meridian and transit',
    text: 'The meridian is the north–south line through the zenith. An object transits when it crosses it, at its highest point.',
  },
  {
    term: 'Meridian flip',
    text: 'A German equatorial mount must turn over when the object crosses the meridian, so the telescope does not hit the pier.',
  },
  {
    term: 'Mosaic',
    text: 'Several overlapping frames stitched together to cover something larger than your field of view.',
  },
  {
    term: 'Narrowband filter',
    text: 'A filter that passes only one glowing gas (Hα, OIII or SII). It cuts the Moon and city glow, so nebulae can be imaged from towns.',
  },
  { term: 'Open cluster', text: 'A loose group of young stars born together, like the Pleiades.' },
  {
    term: 'Park',
    text: 'The mount’s rest position at the end of a night. A parked mount does not track or slew until it is unparked.',
  },
  {
    term: 'Pier side',
    text: 'Which side of the mount the telescope is on. It changes at the meridian flip.',
  },
  {
    term: 'Pixel scale',
    text: 'How much sky one camera pixel covers, in arcseconds. About 1–2″ per pixel suits most nights.',
  },
  {
    term: 'Planetary nebula',
    text: 'A shell of gas thrown off by a dying star. Small and bright: good targets for long focal lengths.',
  },
  {
    term: 'Plate solving',
    text: 'Software that works out exactly where the camera points by matching the stars in an image.',
  },
  {
    term: 'Position angle (PA)',
    text: 'A direction on the sky measured from north through east (0° north, 90° east). Used for the frame rotation and an object’s long axis.',
  },
  {
    term: 'Reflection nebula',
    text: 'Dust lit by nearby stars, usually blue. Needs broadband filters and a dark, moonless sky.',
  },
  {
    term: 'Right ascension (RA)',
    text: 'Sky longitude, in hours (0 h to 24 h) eastward along the celestial equator.',
  },
  {
    term: 'Seeing',
    text: 'How much the air makes stars twinkle and blur, in arcseconds: 1″ is excellent, 3″ poor.',
  },
  {
    term: 'SQM (mag/arcsec²)',
    text: 'Sky Quality Meter reading of sky brightness. Higher is darker: 18 is a city, 21.5 a very dark site.',
  },
  {
    term: 'Sync',
    text: 'Telling the mount "you are pointing exactly here" once a star or object is centred. It improves every GoTo after it; a wrong sync spoils them.',
  },
  {
    term: 'Surface brightness',
    text: 'Brightness spread over an object’s area. A large galaxy can be bright in total yet very faint per square arcsecond.',
  },
  {
    term: 'Transparency',
    text: 'How clear the air is (haze, dust, thin cloud). Poor transparency dims faint objects even when the sky looks clear.',
  },
];
