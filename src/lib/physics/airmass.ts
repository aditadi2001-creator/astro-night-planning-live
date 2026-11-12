/**
 * Relative optical airmass.
 *
 * Kasten, F. & Young, A. T. (1989), "Revised optical air mass tables and
 * approximation formula", Applied Optics 28(22), 4735–4738.
 *
 *   X = 1 / (cos z + 0.50572 · (96.07995° − z)^−1.6364)
 *
 * with z the (apparent) zenith angle in degrees. Accurate to better than
 * 0.5 % up to z = 90°; at the horizon X ≈ 37.9.
 */
const DEG = Math.PI / 180;

export function airmassKastenYoung(altitudeDeg: number): number {
  if (!Number.isFinite(altitudeDeg)) return Number.NaN;
  // Below the horizon there is no sight line through the atmosphere to space.
  if (altitudeDeg < 0) return Number.POSITIVE_INFINITY;
  const z = 90 - Math.min(altitudeDeg, 90);
  return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}
