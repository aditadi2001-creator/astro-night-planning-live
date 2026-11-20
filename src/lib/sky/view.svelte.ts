/**
 * Display settings of the 3D sky, shared by the sky itself (SkyView applies them to the engine)
 * and the dock's layers sheet (which edits them). Remembered on this device.
 */

export interface View {
  conLines: boolean;
  conLabels: boolean;
  conBounds: boolean;
  eqGrid: boolean;
  azGrid: boolean;
  meridian: boolean;
  ecliptic: boolean;
  ground: boolean;
  cardinals: boolean;
  atmosphere: boolean;
  dsos: boolean;
  planetLabels: boolean;
  starLabels: boolean;
  eqMount: boolean;
  crosshair: boolean;
  projection: 1 | 2;
  starBrightness: number;
  starSize: number;
  starLabelAmount: number;
  dsoLabelAmount: number;
  milkyWay: boolean;
  scaleMoon: boolean;
  flipH: boolean;
  flipV: boolean;
  info: 'all' | 'short' | 'none';
  autoHideBars: boolean;
}

export const VIEW_KEY = 'anp.view.v2';

/**
 * The sky's default field of view: about what both human eyes take in at once without moving
 * (the binocular field is ~114–120° wide). Used at start and when the camera frame is closed.
 */
export const EYE_FOV_DEG = 120;

export function viewDefaults(): View {
  return {
    conLines: true,
    conLabels: true,
    conBounds: false,
    eqGrid: false,
    azGrid: false,
    meridian: false,
    ecliptic: false,
    ground: true,
    cardinals: true,
    atmosphere: true,
    dsos: true,
    planetLabels: true,
    starLabels: true,
    eqMount: false,
    crosshair: true,
    projection: 2,
    starBrightness: 1,
    starSize: 1,
    starLabelAmount: 0,
    dsoLabelAmount: 0,
    milkyWay: true,
    scaleMoon: false,
    flipH: false,
    flipV: false,
    info: 'all',
    autoHideBars: false,
  };
}

function loadView(): View {
  try {
    return {
      ...viewDefaults(),
      ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<View>),
    };
  } catch {
    return viewDefaults();
  }
}

export const skyView: View = $state(loadView());

export type BoolKey = { [K in keyof View]: View[K] extends boolean ? K : never }[keyof View];

/** Grouped, labelled switches for the layers sheet (replaces the old unlabeled icon bar). */
export const VIEW_GROUPS: {
  title: string;
  items: { key: BoolKey; label: string; hint: string; shortcut?: string }[];
}[] = [
  {
    title: 'Lines and labels',
    items: [
      {
        key: 'conLines',
        label: 'Constellation lines',
        hint: 'Stick figures joining the bright stars.',
        shortcut: 'C',
      },
      {
        key: 'conLabels',
        label: 'Constellation names',
        hint: 'Names of the 88 constellations.',
        shortcut: 'V',
      },
      {
        key: 'conBounds',
        label: 'Constellation borders',
        hint: 'Official IAU boundaries.',
        shortcut: 'B',
      },
      { key: 'starLabels', label: 'Star names', hint: 'Proper names of bright stars.' },
      {
        key: 'planetLabels',
        label: 'Planet names',
        hint: 'Labels for the Sun, Moon and planets.',
        shortcut: 'P',
      },
    ],
  },
  {
    title: 'Grids',
    items: [
      {
        key: 'eqGrid',
        label: 'Equatorial grid (RA/Dec)',
        hint: 'The sky coordinates telescopes use.',
        shortcut: 'E',
      },
      {
        key: 'azGrid',
        label: 'Altitude/azimuth grid',
        hint: 'Height above the horizon and compass direction.',
        shortcut: 'Z',
      },
      {
        key: 'meridian',
        label: 'Meridian',
        hint: 'North–south line through the zenith: objects are highest here.',
        shortcut: ';',
      },
      {
        key: 'ecliptic',
        label: 'Ecliptic',
        hint: 'The path of the Sun and (roughly) the planets.',
        shortcut: ',',
      },
    ],
  },
  {
    title: 'Ground and atmosphere',
    items: [
      {
        key: 'ground',
        label: 'Ground',
        hint: 'Hide the ground to see below the horizon.',
        shortcut: 'G',
      },
      {
        key: 'cardinals',
        label: 'Compass points',
        hint: 'N, E, S, W on the horizon.',
        shortcut: 'Q',
      },
      {
        key: 'atmosphere',
        label: 'Atmosphere',
        hint: 'Sky colour, twilight and daylight.',
        shortcut: 'A',
      },
      { key: 'milkyWay', label: 'Milky Way', hint: 'The glow of our galaxy (Gaia map).' },
    ],
  },
  {
    title: 'Objects',
    items: [
      {
        key: 'dsos',
        label: 'Deep-sky objects',
        hint: 'Galaxies, nebulae and clusters with their outlines.',
        shortcut: 'D',
      },
      {
        key: 'scaleMoon',
        label: 'Enlarge the Moon',
        hint: 'Draw the Moon bigger than real, for finding it.',
      },
      {
        key: 'crosshair',
        label: 'Centre crosshair',
        hint: 'A small cross at the middle of the view.',
      },
      {
        key: 'eqMount',
        label: 'Equatorial view',
        hint: 'Keep north up, like a telescope on an equatorial mount.',
      },
    ],
  },
];

export type PresetId = 'beginner' | 'imager' | 'survey' | 'full';

/** Presets set view switches and the page's layers together. */
export const VIEW_PRESETS: {
  id: PresetId;
  label: string;
  hint: string;
  view: Partial<View>;
  layers: Record<string, boolean>;
}[] = [
  {
    id: 'beginner',
    label: 'Simple',
    hint: 'Constellation figures and names, compass points, planet and star names; no grids.',
    view: {
      conLines: true,
      conLabels: true,
      conBounds: false,
      eqGrid: false,
      azGrid: false,
      meridian: false,
      ecliptic: false,
      ground: true,
      cardinals: true,
      atmosphere: true,
      dsos: true,
      planetLabels: true,
      starLabels: true,
      scaleMoon: true,
    },
    layers: {
      clouds: true,
      lightpollution: true,
      haze: true,
      terrain: true,
      longExposure: false,
      deepSky: true,
      surveys: false,
    },
  },
  {
    id: 'imager',
    label: 'Imager',
    hint: 'Equatorial grid and meridian for framing, deep-sky outlines, real horizon and sky glow; fewer labels.',
    view: {
      conLines: false,
      conLabels: false,
      conBounds: false,
      eqGrid: true,
      azGrid: false,
      meridian: true,
      ecliptic: false,
      ground: true,
      cardinals: true,
      atmosphere: true,
      dsos: true,
      planetLabels: true,
      starLabels: false,
      scaleMoon: false,
    },
    layers: {
      clouds: true,
      lightpollution: true,
      haze: true,
      terrain: true,
      longExposure: true,
      deepSky: true,
      surveys: false,
    },
  },
  {
    id: 'survey',
    label: 'Survey',
    hint: 'A sky survey under the stars, no atmosphere or ground, minimal overlays.',
    view: {
      conLines: false,
      conLabels: false,
      conBounds: false,
      eqGrid: false,
      azGrid: false,
      meridian: false,
      ecliptic: false,
      ground: false,
      cardinals: false,
      atmosphere: false,
      dsos: false,
      planetLabels: false,
      starLabels: false,
    },
    layers: {
      clouds: false,
      lightpollution: false,
      haze: false,
      terrain: false,
      longExposure: false,
      deepSky: false,
      surveys: true,
    },
  },
  {
    id: 'full',
    label: 'Full',
    hint: 'Everything on: all lines, grids, labels and physical layers.',
    view: {
      conLines: true,
      conLabels: true,
      conBounds: true,
      eqGrid: true,
      azGrid: true,
      meridian: true,
      ecliptic: true,
      ground: true,
      cardinals: true,
      atmosphere: true,
      dsos: true,
      planetLabels: true,
      starLabels: true,
    },
    layers: {
      clouds: true,
      lightpollution: true,
      haze: true,
      terrain: true,
      longExposure: false,
      deepSky: true,
      surveys: false,
    },
  },
];

export function applyPreset(id: PresetId): Record<string, boolean> {
  const p = VIEW_PRESETS.find((x) => x.id === id);
  if (!p) return {};
  Object.assign(skyView, p.view);
  return p.layers;
}
