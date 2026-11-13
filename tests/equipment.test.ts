import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUPS,
  eyepieceStats,
  fitFov,
  fmtFov,
  frameFill,
  framePolygon,
  normRotation,
  plateScale,
  setupStats,
} from '../src/lib/equipment';

describe('setup statistics', () => {
  it('80 mm f/6 + ASI2600 (deep sky)', () => {
    const st = setupStats(DEFAULT_SETUPS.deepsky, 2.5);
    // 206.265 × 3.76 / 480 = 1.6157 ″/px
    expect(st.pixelScale).toBeCloseTo(1.6157, 3);
    // Sensor 23.49 × 15.70 mm at 480 mm: 2.80° × 1.87°
    expect(st.fovW).toBeCloseTo(2.804, 2);
    expect(st.fovH).toBeCloseTo(1.874, 2);
    expect(st.fRatio).toBeCloseTo(6, 5);
    expect(st.dawes).toBeCloseTo(1.45, 2);
    expect(st.rayleigh).toBeCloseTo(1.725, 3);
    // 2.5″ seeing over 1.62″ pixels = 1.55 px: a little undersampled.
    expect(st.sampling).toBe('undersampled');
    expect(fmtFov(st)).toBe('2.80° × 1.87°');
  });

  it('8″ SCT with a 2× Barlow + ASI462 (planetary)', () => {
    const st = setupStats(DEFAULT_SETUPS.planetary, null);
    expect(st.effFocalMm).toBe(4064);
    expect(st.fRatio).toBeCloseTo(20.02, 1);
    expect(st.pixelScale).toBeCloseTo(0.1472, 3);
    // Critical sampling rule: f ≈ 5 × 2.9 µm = f/14.5.
    expect(st.idealFRatio).toBeCloseTo(14.5, 5);
    expect(st.sampling).toBe('well sampled');
    expect(fmtFov(st)).toMatch(/′ × /);
  });

  it('measures how much of the frame an object fills', () => {
    const st = setupStats(DEFAULT_SETUPS.deepsky);
    // M31 is ~190′ long; the short side is 1.87° = 112′.
    expect(frameFill(190, st)).toBeGreaterThan(1.6);
    expect(frameFill(8, st)).toBeLessThan(0.1);
  });
});

describe('frame on the sky', () => {
  const rad = Math.PI / 180;
  const sep = (a: [number, number], b: [number, number]) =>
    Math.acos(
      Math.sin(a[1]) * Math.sin(b[1]) + Math.cos(a[1]) * Math.cos(b[1]) * Math.cos(a[0] - b[0]),
    ) / rad;

  it('has the right size at the celestial equator and near the pole', () => {
    for (const dec0 of [0, 60, 85]) {
      const pts = framePolygon(10 * rad, dec0 * rad, 2, 1, 0, 1);
      expect(pts).toHaveLength(4);
      const [a, b, c] = pts as [[number, number], [number, number], [number, number]];
      // Bottom edge (long side) and right edge (short side), as angles on the sky.
      expect(sep(a, b)).toBeCloseTo(2, 1);
      expect(sep(b, c)).toBeCloseTo(1, 1);
    }
  });

  it('turns the long side north–south at 90°', () => {
    const [a, b] = framePolygon(0, 0, 2, 1, 90, 1) as [[number, number], [number, number]];
    // The long edge now changes declination, not right ascension.
    expect(Math.abs(b[1] - a[1]) / rad).toBeCloseTo(2, 1);
    expect(Math.abs(b[0] - a[0]) / rad).toBeLessThan(0.01);
  });
});

describe('ocular view maths', () => {
  it('eyepiece true field = apparent field / magnification', () => {
    // 8" SCT f/10 (2032 mm) with a 2× Barlow and a 25 mm 52° Plössl: 162.6×, 0.32°.
    const st = eyepieceStats(DEFAULT_SETUPS.planetary, { focalMm: 25, afovDeg: 52 });
    expect(st.magnification).toBeCloseTo(162.56, 2);
    expect(st.trueFovDeg).toBeCloseTo(52 / 162.56, 4);
    expect(st.exitPupilMm).toBeCloseTo(203 / 162.56, 3);
  });
  it('80 mm f/6 with a 32 mm 52° eyepiece shows 3.47°', () => {
    const st = eyepieceStats(DEFAULT_SETUPS.deepsky, { focalMm: 32, afovDeg: 52 });
    expect(st.magnification).toBe(15);
    expect(st.trueFovDeg).toBeCloseTo(3.4667, 3);
  });
  it('rotation wraps to −180…180', () => {
    expect(normRotation(0)).toBe(0);
    expect(normRotation(195)).toBe(-165);
    expect(normRotation(-181)).toBe(179);
    expect(normRotation(360 + 15)).toBe(15);
  });
  it('plate scale and zoom-to-fit', () => {
    expect(plateScale(DEFAULT_SETUPS.deepsky)).toBeCloseTo(429.72, 1);
    // A 2° frame at 100 px/° on a 800 px view: 80 % fill needs 320 px/°, so fov / 3.2.
    expect(fitFov(40, 100, 2, 800)).toBeCloseTo(12.5, 6);
  });
});
