/**
 * Where the site's own data Worker lives.
 *
 * Set at build time with VITE_DATA_BASE (e.g. the Worker's workers.dev URL, or
 * a custom domain later). Unset → features that need it fall back gracefully:
 * flat horizon, no deep (V > 10) star layer, no 7Timer! second opinion.
 * In development without VITE_DATA_BASE, the Vite dev server proxies the DEM.
 */
const raw = (import.meta.env.VITE_DATA_BASE as string | undefined)?.trim() ?? '';

export const DATA_BASE: string = raw.replace(/\/+$/, '');

/** Copernicus DEM pass-through. */
export const DEM_URL: string = DATA_BASE ? `${DATA_BASE}/dem` : import.meta.env.DEV ? '/dem' : '';

/** Deep Gaia star layer (HiPS) served from R2 by the Worker. */
export const GAIA_DEEP_URL: string = DATA_BASE ? `${DATA_BASE}/hips/gaia` : '';

/** Deeper Gaia layer (V 10–16); used when the Worker has it, else GAIA_DEEP_URL. */
export const GAIA_DEEPER_URL: string = DATA_BASE ? `${DATA_BASE}/hips/gaia16` : '';
