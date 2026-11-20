/**
 * Foregrounds for the 3D sky: horizon silhouettes generated in code (no image files, so nothing
 * to license and zero bytes to download), drawn by the engine's terrain layer. They are for
 * looks and practice only — planning always uses your custom horizon, or the real terrain
 * (Copernicus DEM) when you have none.
 */
import type { Rgb } from './horizon';

export type ForegroundId =
  | 'none'
  | 'flat'
  | 'ocean'
  | 'desert'
  | 'hills'
  | 'forest'
  | 'mountains'
  | 'himalaya'
  | 'city'
  | 'rooftop'
  | 'dome'
  | 'dem';

export interface ForegroundState {
  id: ForegroundId;
  /** Ground brightness multiplier (0.2–1.6). */
  brightness: number;
  /** Fog 0–1: hazes the ground and the low sky (looks only). */
  fog: number;
}

export const FOREGROUNDS: { id: ForegroundId; label: string; hint: string; tint: Rgb }[] = [
  {
    id: 'dem',
    label: 'Real terrain',
    hint: 'Hills and mountains around your site from elevation data (Copernicus DEM).',
    tint: [1, 1, 1],
  },
  {
    id: 'none',
    label: 'None',
    hint: 'No ground at all: see the sky below the horizon.',
    tint: [1, 1, 1],
  },
  {
    id: 'flat',
    label: 'Flat ground',
    hint: 'A perfectly flat, mathematical horizon.',
    tint: [1, 1, 1],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    hint: 'A sea horizon, darker and bluer.',
    tint: [0.55, 0.75, 1.3],
  },
  { id: 'desert', label: 'Desert', hint: 'Low dunes, sandy ground.', tint: [1.5, 1.25, 0.8] },
  {
    id: 'hills',
    label: 'Hills',
    hint: 'Rolling hills a few degrees high.',
    tint: [0.9, 1.15, 0.85],
  },
  { id: 'forest', label: 'Forest', hint: 'A ragged tree line around you.', tint: [0.6, 1, 0.6] },
  {
    id: 'mountains',
    label: 'Mountains',
    hint: 'A mountain range up to about 10°.',
    tint: [0.85, 0.9, 1],
  },
  {
    id: 'himalaya',
    label: 'Himalayan peaks',
    hint: 'High, jagged snow peaks, as seen from a high mountain site.',
    tint: [0.95, 0.95, 1.1],
  },
  {
    id: 'city',
    label: 'City',
    hint: 'A city skyline (the light dome comes from the light-pollution layer).',
    tint: [1.1, 1, 0.9],
  },
  {
    id: 'rooftop',
    label: 'Rooftop with parapet',
    hint: 'A city roof: a waist-high wall, a water tank and nearby buildings.',
    tint: [1.2, 1.1, 1],
  },
  {
    id: 'dome',
    label: 'Observatory dome',
    hint: 'Inside a dome: only the slit (facing south, 15° wide) is open.',
    tint: [0.8, 0.8, 0.85],
  },
];

const KEY = 'anp.foreground.v1';

export function loadForeground(): ForegroundState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ForegroundState> | null;
    if (v && FOREGROUNDS.some((f) => f.id === v.id))
      return {
        id: v.id as ForegroundId,
        brightness: Number(v.brightness) || 1,
        fog: Number(v.fog) || 0,
      };
  } catch {
    /* defaults */
  }
  return { id: 'dem', brightness: 1, fog: 0 };
}

export function saveForeground(f: ForegroundState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* private mode */
  }
}

/** Deterministic value noise in [0, 1) so a foreground looks the same on every visit. */
function noise(seed: number) {
  const h = (i: number) => {
    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return h(i) * (1 - u) + h(i + 1) * u;
  };
}

/**
 * The silhouette as 720 altitudes (0.5° of azimuth), or null for "real terrain" / "none"
 * (handled by the caller).
 */
export function foregroundProfile(id: ForegroundId): Float32Array | null {
  if (id === 'dem' || id === 'none') return null;
  const out = new Float32Array(720);
  const n1 = noise(1);
  const n2 = noise(2);
  const n3 = noise(3);
  for (let i = 0; i < 720; i++) {
    const az = i / 2;
    let alt = 0;
    switch (id) {
      case 'flat':
      case 'ocean':
        alt = 0;
        break;
      case 'desert':
        alt = 0.4 + 0.8 * n1(az / 25);
        break;
      case 'hills':
        alt = 1 + 3.5 * n1(az / 30) + 1.2 * n2(az / 9);
        break;
      case 'forest':
        alt = 3 + 2.5 * n1(az / 12) + 1.8 * Math.abs(Math.sin(az * 1.7)) * n2(az / 1.5);
        break;
      case 'mountains': {
        const r = 1 - Math.abs(2 * n1(az / 18) - 1);
        alt = 1.5 + 8 * r * r + 1.5 * n2(az / 4);
        break;
      }
      case 'himalaya': {
        // Ridged multi-scale noise: sharp crests, uneven valleys.
        const f = 0.6 * n1(az / 12) + 0.3 * n2(az / 5) + 0.1 * n3(az / 1.6);
        const r = 1 - Math.abs(2 * f - 1);
        alt = 2 + 12 * r ** 1.6 + 0.8 * n3(az / 0.7);
        break;
      }
      case 'city': {
        // Blocky buildings: steps of 1–4° azimuth with heights from noise.
        const block = Math.floor(az / (1.5 + 2 * n3(Math.floor(az / 4))));
        alt = 1 + 7 * n1(block * 3.1) ** 2;
        break;
      }
      case 'rooftop': {
        // Parapet about 1 m high, 6 m away ≈ 9.5°; a water tank to the north-west; buildings east.
        alt = 9.5;
        if (az > 300 && az < 318) alt = 24;
        if (az > 60 && az < 110) alt = Math.max(alt, 12 + 6 * n1(az / 6));
        if (az > 150 && az < 156) alt = 4; // gap where the roof door is
        break;
      }
      case 'dome':
        alt = Math.abs(((az - 180 + 540) % 360) - 180) <= 7.5 ? 0 : 89.5;
        break;
    }
    out[i] = alt;
  }
  return out;
}

/** Ground colour: the lighting's colour, tinted by the foreground, brightness and fog. */
export function tintGround(base: Rgb, fg: ForegroundState): Rgb {
  const t = FOREGROUNDS.find((f) => f.id === fg.id)?.tint ?? [1, 1, 1];
  const haze: Rgb = [28, 30, 34];
  return base.map((c, i) => {
    const lit = c * (t[i] ?? 1) * fg.brightness;
    return Math.max(0, Math.min(255, lit * (1 - fg.fog) + (haze[i] ?? 0) * fg.fog));
  }) as Rgb;
}

/** SVG path of a silhouette for picker thumbnails (width 120, height 40, 0–20° shown). */
export function thumbPath(profile: Float32Array | null): string {
  const W = 120;
  const H = 40;
  const y = (alt: number) => H - Math.min(H, (alt / 20) * H * 0.9) - 2;
  if (!profile) return `M0,${y(0)}L${W},${y(0)}L${W},${H}L0,${H}Z`;
  let d = `M0,${H}`;
  for (let x = 0; x <= W; x++) {
    const i = Math.min(719, Math.round((x / W) * 719));
    d += `L${x},${y(profile[i] ?? 0).toFixed(1)}`;
  }
  return `${d}L${W},${H}Z`;
}
