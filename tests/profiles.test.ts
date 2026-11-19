import { describe, expect, it } from 'vitest';
import {
  CAMERA_DB,
  DEFAULT_PROFILES,
  effectiveFocal,
  isProfile,
  profileStats,
  type Profile,
} from '../src/lib/profiles';

const byId = (id: string) => DEFAULT_PROFILES.find((p) => p.id === id) as Profile;
const arcmin = (deg: number) => deg * 60;

// Expected values from the owner's brief (plate solve and manufacturer specs).
describe("owner's equipment profiles", () => {
  it('C9.25 + 0.63× + ATR585M: 1210 mm (f/5.15), 31.6′ × 17.8′, 0.494″/px', () => {
    const p = byId('c925r');
    expect(effectiveFocal(p)).toBe(1210);
    const st = profileStats(p);
    expect(st.fRatio).toBeCloseTo(5.15, 2);
    expect(arcmin(st.fovW)).toBeCloseTo(31.6, 1);
    expect(arcmin(st.fovH)).toBeCloseTo(17.8, 1);
    expect(st.pixelScale).toBeCloseTo(0.494, 3);
  });

  it('C9.25 native + ATR585M: 2350 mm (f/10), 16.3′ × 9.2′, 0.255″/px', () => {
    const st = profileStats(byId('c925'));
    expect(st.effFocalMm).toBe(2350);
    expect(st.fRatio).toBeCloseTo(10, 5);
    expect(arcmin(st.fovW)).toBeCloseTo(16.3, 1);
    expect(arcmin(st.fovH)).toBeCloseTo(9.2, 1);
    expect(st.pixelScale).toBeCloseTo(0.255, 3);
  });

  it('Angeleyes 60 mm (230 mm) + ASI585MC Pro: 2.77° × 1.56°', () => {
    const st = profileStats(byId('guide60'));
    expect(st.fovW).toBeCloseTo(2.77, 2);
    expect(st.fovH).toBeCloseTo(1.56, 2);
  });

  it('Sony a6100 (23.5 × 15.6 mm) + 11 mm: 93.8° × 70.7°', () => {
    const st = profileStats(byId('a6100w'));
    expect(st.fovW).toBeCloseTo(93.8, 1);
    expect(st.fovH).toBeCloseTo(70.7, 1);
  });

  it('binning 2× doubles the pixel scale and keeps the field', () => {
    const p = { ...byId('c925r'), binning: 2 };
    const st = profileStats(p);
    expect(st.pixelScale).toBeCloseTo(0.9886, 3);
    expect(arcmin(st.fovW)).toBeCloseTo(31.6, 1);
  });

  it('the camera database has the ToupTek ATR585M (IMX585 mono)', () => {
    const c = CAMERA_DB.find((x) => x.id === 'atr585m');
    expect(c).toMatchObject({ widthPx: 3840, heightPx: 2160, pixelUm: 2.9, mono: true });
  });

  it('validates imported profiles', () => {
    expect(isProfile(byId('c925r'))).toBe(true);
    expect(isProfile({ id: 'x', name: 'x', focalMm: 0 })).toBe(false);
  });
});
