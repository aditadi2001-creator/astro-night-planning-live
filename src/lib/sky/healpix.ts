/**
 * HEALPix nested pixel index for a direction (Górski et al. 2005), used to fetch one survey tile
 * as a picker thumbnail. θ = colatitude, φ = longitude (radians).
 */
function spread(v: number): number {
  // Interleave: bit i of v goes to bit 2i.
  let x = v;
  let out = 0;
  for (let i = 0; x; i++, x >>= 1) if (x & 1) out += 2 ** (2 * i);
  return out;
}

export function ang2pixNest(order: number, theta: number, phi: number): number {
  const nside = 2 ** order;
  const z = Math.cos(theta);
  const za = Math.abs(z);
  let ph = phi % (2 * Math.PI);
  if (ph < 0) ph += 2 * Math.PI;
  const tt = (ph * 2) / Math.PI; // [0, 4)
  let face: number;
  let ix: number;
  let iy: number;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z > 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  return face * nside * nside + spread(ix) + 2 * spread(iy);
}

/** ICRS (J2000) → galactic longitude/latitude, degrees (IAU 1958 pole, ICRS rotation). */
export function toGalactic(raDeg: number, decDeg: number): { l: number; b: number } {
  const D = Math.PI / 180;
  const ra = raDeg * D;
  const dec = decDeg * D;
  const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  // Rows of the ICRS → galactic rotation matrix (Hipparcos, ESA 1997 vol. 1 §1.5.3).
  const M = [
    [-0.054875560416215, -0.873437090234885, -0.4838350155487132],
    [0.4941094278755837, -0.4448296299600112, 0.746982244497219],
    [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
  ];
  const g = M.map(
    (r) =>
      (r[0] as number) * (v[0] as number) +
      (r[1] as number) * (v[1] as number) +
      (r[2] as number) * (v[2] as number),
  );
  const l = Math.atan2(g[1] as number, g[0] as number) / D;
  return { l: (l + 360) % 360, b: Math.asin(Math.max(-1, Math.min(1, g[2] as number))) / D };
}

/** URL of the order-3 tile containing a direction (thumbnail), for a HiPS base URL. */
export function thumbTileUrl(
  base: string,
  raDeg: number,
  decDeg: number,
  galactic: boolean,
  ext: 'jpg' | 'png',
): string {
  const { l, b } = galactic ? toGalactic(raDeg, decDeg) : { l: raDeg, b: decDeg };
  const D = Math.PI / 180;
  const pix = ang2pixNest(3, (90 - b) * D, l * D);
  return `${base}/Norder3/Dir${Math.floor(pix / 10000) * 10000}/Npix${pix}.${ext}`;
}
