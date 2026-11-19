import { describe, expect, it } from 'vitest';
import { ang2pixNest, thumbTileUrl, toGalactic } from '../src/lib/sky/healpix';

const D = Math.PI / 180;

describe('HEALPix nested', () => {
  it('matches healpy reference pixels at the poles and the equator (order 0)', () => {
    expect(ang2pixNest(0, 0, 0)).toBe(0); // north pole
    expect(ang2pixNest(0, Math.PI, 0)).toBe(8); // south pole
    expect(ang2pixNest(0, Math.PI / 2, 0)).toBe(4); // equator, phi 0
  });
  it('children of a pixel share its parent (pix >> 2 per order)', () => {
    for (const [th, ph] of [
      [40, 10],
      [100, 200],
      [150, 300],
      [70, 359],
    ] as const) {
      const p5 = ang2pixNest(5, th * D, ph * D);
      const p3 = ang2pixNest(3, th * D, ph * D);
      expect(Math.floor(p5 / 16)).toBe(p3);
      expect(p3).toBeLessThan(768);
    }
  });
  it('converts the Galactic centre and builds tile URLs', () => {
    const gc = toGalactic(266.405, -28.936);
    expect(Math.min(gc.l, 360 - gc.l)).toBeLessThan(0.1);
    expect(Math.abs(gc.b)).toBeLessThan(0.1);
    expect(thumbTileUrl('https://x/DSS', 83.82, -5.39, false, 'jpg')).toMatch(
      /^https:\/\/x\/DSS\/Norder3\/Dir0\/Npix\d+\.jpg$/,
    );
  });
});
