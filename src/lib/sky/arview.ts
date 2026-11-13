/**
 * Camera ("look through the phone") view: where a sky direction appears on the
 * phone screen, from the device orientation sensors (W3C DeviceOrientation:
 * alpha about z, beta about x, gamma about y; earth frame x = east, y = north,
 * z = up). The back camera looks along the device's −z axis.
 */

export type Vec3 = [number, number, number];

export interface Pose {
  /** Camera axis, screen-right and screen-up as earth (east, north, up) unit vectors. */
  look: Vec3;
  right: Vec3;
  up: Vec3;
}

const D2R = Math.PI / 180;

/**
 * Pose from device orientation (degrees). `alpha` must be absolute (0 = device
 * top towards north, increasing counter-clockwise seen from above).
 * `screenAngle` is screen.orientation.angle (0, 90, 180, 270).
 */
export function poseFromOrientation(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0,
): Pose {
  const a = alpha * D2R;
  const b = beta * D2R;
  const g = gamma * D2R;
  const cX = Math.cos(b);
  const sX = Math.sin(b);
  const cY = Math.cos(g);
  const sY = Math.sin(g);
  const cZ = Math.cos(a);
  const sZ = Math.sin(a);
  // R = Rz(α) Rx(β) Ry(γ): device → earth.
  const m11 = cZ * cY - sZ * sX * sY;
  const m12 = -cX * sZ;
  const m13 = cY * sZ * sX + cZ * sY;
  const m21 = cY * sZ + cZ * sX * sY;
  const m22 = cZ * cX;
  const m23 = sZ * sY - cZ * cY * sX;
  const m31 = -cX * sY;
  const m32 = sX;
  const m33 = cX * cY;
  const devRight: Vec3 = [m11, m21, m31];
  const devUp: Vec3 = [m12, m22, m32];
  const look: Vec3 = [-m13, -m23, -m33];
  // Rotate screen axes for landscape orientations.
  const th = screenAngle * D2R;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const right: Vec3 = [
    c * devRight[0] + s * devUp[0],
    c * devRight[1] + s * devUp[1],
    c * devRight[2] + s * devUp[2],
  ];
  const up: Vec3 = [
    -s * devRight[0] + c * devUp[0],
    -s * devRight[1] + c * devUp[1],
    -s * devRight[2] + c * devUp[2],
  ];
  return { look, right, up };
}

/** Earth (east, north, up) unit vector of an azimuth (from north towards east) and altitude. */
export function enu(azDeg: number, altDeg: number): Vec3 {
  const az = azDeg * D2R;
  const alt = altDeg * D2R;
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

/** Azimuth/altitude the camera points at. */
export function lookAzAlt(p: Pose): { az: number; alt: number } {
  const [e, n, u] = p.look;
  return {
    az: (((Math.atan2(e, n) / D2R) % 360) + 360) % 360,
    alt: Math.asin(Math.max(-1, Math.min(1, u))) / D2R,
  };
}

/**
 * Screen position (pixels) of a direction, or null if behind the camera.
 * `hfovDeg` is the camera's horizontal field of view across `width`.
 */
export function project(
  p: Pose,
  v: Vec3,
  width: number,
  height: number,
  hfovDeg: number,
): [number, number] | null {
  const z = v[0] * p.look[0] + v[1] * p.look[1] + v[2] * p.look[2];
  if (z <= 0.02) return null;
  const x = v[0] * p.right[0] + v[1] * p.right[1] + v[2] * p.right[2];
  const y = v[0] * p.up[0] + v[1] * p.up[1] + v[2] * p.up[2];
  const f = width / 2 / Math.tan((hfovDeg / 2) * D2R);
  return [width / 2 + (f * x) / z, height / 2 - (f * y) / z];
}

/** Absolute alpha from an iOS compass heading (degrees clockwise from north). */
export function alphaFromCompass(heading: number): number {
  return (360 - heading) % 360;
}
