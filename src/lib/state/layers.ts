/**
 * The sky's layer switches (clouds, terrain, surveys…), remembered in this browser so a
 * returning visitor sees the sky the way they left it. Stored on the device only.
 * The satellite map is never restored: turning it on opens the Maps tab.
 */
const KEY = 'anp.layers.v1';

export interface StoredLayers {
  clouds: boolean;
  haze: boolean;
  terrain: boolean;
  constellations: boolean;
  satmap: boolean;
  lightpollution: boolean;
  surveys: boolean;
  survey: string;
  surveyOpacity: number;
  longExposure: boolean;
  deepSky: boolean;
}

/** Saved values merged over the defaults; anything missing or of the wrong type keeps its default. */
export function mergeLayers<T extends StoredLayers>(
  defaults: T,
  saved: unknown,
  validSurvey: (id: string) => boolean = () => true,
): T {
  const out = { ...defaults };
  if (!saved || typeof saved !== 'object') return out;
  const s = saved as Record<string, unknown>;
  for (const k of Object.keys(defaults) as (keyof StoredLayers)[]) {
    if (k === 'satmap') continue;
    const v = s[k];
    if (typeof v !== typeof defaults[k]) continue;
    if (k === 'survey' && !validSurvey(v as string)) continue;
    if (k === 'surveyOpacity' && !(Number(v) >= 0.05 && Number(v) <= 1)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function loadLayers<T extends StoredLayers>(
  defaults: T,
  validSurvey?: (id: string) => boolean,
): T {
  try {
    const raw = localStorage.getItem(KEY);
    return mergeLayers(defaults, raw ? JSON.parse(raw) : null, validSurvey);
  } catch {
    return { ...defaults };
  }
}

export function saveLayers(l: StoredLayers): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...l, satmap: false }));
  } catch {
    /* private mode: not remembered */
  }
}
