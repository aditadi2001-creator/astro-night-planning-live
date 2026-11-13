/**
 * Colours for the light-pollution map (Maps tab). Our yearly sky-brightness
 * tiles store, per pixel, grey = magnitudes brighter than the natural sky × 40
 * (lightpollution.ts); here each grey value becomes a colour on the usual
 * Bortle-style ramp: black → grey → blue → green → yellow → orange → red → white.
 */
import { bortle } from './lightpollution';

/** Colour stops by zenith sky brightness (mag/arcsec², V): [sqm, r, g, b, alpha]. */
export const LP_STOPS: readonly (readonly [number, number, number, number, number])[] = [
  [22.0, 0, 0, 0, 0],
  [21.9, 34, 34, 34, 110],
  [21.75, 66, 66, 72, 150],
  [21.5, 18, 44, 130, 170],
  [21.0, 28, 96, 200, 180],
  [20.5, 34, 150, 64, 190],
  [20.0, 120, 190, 40, 195],
  [19.5, 232, 220, 40, 205],
  [19.0, 244, 150, 30, 212],
  [18.4, 232, 58, 30, 218],
  [17.8, 255, 136, 150, 226],
  [17.0, 255, 255, 255, 236],
];

/** RGBA for a zenith sky brightness (linear between the stops). */
export function lpColor(sqm: number): [number, number, number, number] {
  let prev = LP_STOPS[0] ?? [22, 0, 0, 0, 0];
  if (sqm >= prev[0]) return [prev[1], prev[2], prev[3], prev[4]];
  for (const b of LP_STOPS) {
    if (sqm >= b[0]) {
      const t = (prev[0] - sqm) / (prev[0] - b[0]);
      const a = prev;
      const mix = (k: 1 | 2 | 3 | 4) => Math.round(a[k] + (b[k] - a[k]) * t);
      return [mix(1), mix(2), mix(3), mix(4)];
    }
    prev = b;
  }
  return [prev[1], prev[2], prev[3], prev[4]];
}

/** Zenith SQM from a tile's grey value. */
export const sqmFromGrey = (grey: number, magPerStep = 0.025, natural = 22.0) =>
  natural - grey * magPerStep;

/** Lookup table grey (0–255) → RGBA, built once per tile set. */
export function paletteTable(magPerStep = 0.025, natural = 22.0): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) t.set(lpColor(sqmFromGrey(v, magPerStep, natural)), v * 4);
  return t;
}

/** Recolour a decoded grey tile in place. */
export function recolor(rgba: Uint8ClampedArray, table: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const v = rgba[i] ?? 0;
    // Pixels with no data (transparent) stay transparent.
    if ((rgba[i + 3] ?? 255) === 0) continue;
    rgba[i] = table[v * 4] ?? 0;
    rgba[i + 1] = table[v * 4 + 1] ?? 0;
    rgba[i + 2] = table[v * 4 + 2] ?? 0;
    rgba[i + 3] = table[v * 4 + 3] ?? 0;
  }
}

/** Legend rows: one per Bortle class with its SQM range and colour. */
export const LEGEND: { bortle: number; sqm: string; color: string }[] = [
  { b: 1, from: 22.0, to: 21.99 },
  { b: 2, from: 21.99, to: 21.89 },
  { b: 3, from: 21.89, to: 21.69 },
  { b: 4, from: 21.69, to: 20.49 },
  { b: 5, from: 20.49, to: 19.5 },
  { b: 6, from: 19.5, to: 18.94 },
  { b: 7, from: 18.94, to: 18.38 },
  { b: 8, from: 18.38, to: 17.8 },
  { b: 9, from: 17.8, to: 16.5 },
].map(({ b, from, to }) => {
  const mid = (from + to) / 2;
  const [r, g, bl] = lpColor(b === 1 ? 21.95 : mid);
  return {
    bortle: b,
    sqm:
      b === 1
        ? '≥ 21.99'
        : b === 9
          ? `< ${from.toFixed(2)}`
          : `${to.toFixed(2)}–${from.toFixed(2)}`,
    color: b === 1 ? '#000' : `rgb(${r} ${g} ${bl})`,
  };
});

export { bortle };
