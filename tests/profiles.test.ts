import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_DB,
  DEFAULT_PROFILES,
  effectiveFocal,
  isProfile,
  loadActiveProfileId,
  loadProfiles,
  profileStats,
  saveActiveProfileId,
  type Profile,
} from '../src/lib/profiles';

const byId = (id: string) => DEFAULT_PROFILES.find((p) => p.id === id) as Profile;
const arcmin = (deg: number) => deg * 60;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

// Expected values from manufacturer specifications (field = 2·atan(sensor / 2F)).
describe('starter equipment profiles', () => {
  it('80 mm f/6 + ASI2600MC: 480 mm, 2.80° × 1.87°, 1.62″/px', () => {
    const st = profileStats(byId('r80-2600'));
    expect(st.fRatio).toBeCloseTo(6, 5);
    expect(st.fovW).toBeCloseTo(2.8, 2);
    expect(st.fovH).toBeCloseTo(1.87, 2);
    expect(st.pixelScale).toBeCloseTo(1.616, 3);
  });

  it('8″ SCT + 2× Barlow + ASI462MC: 4064 mm (f/20), 4.7′ × 2.7′, 0.147″/px', () => {
    const p = byId('c8-462');
    expect(effectiveFocal(p)).toBe(4064);
    const st = profileStats(p);
    expect(st.fRatio).toBeCloseTo(20, 1);
    expect(arcmin(st.fovW)).toBeCloseTo(4.75, 2);
    expect(arcmin(st.fovH)).toBeCloseTo(2.69, 2);
    expect(st.pixelScale).toBeCloseTo(0.147, 3);
  });

  it('60 mm f/4 (240 mm) + ASI585MC: 2.66° × 1.50°', () => {
    const st = profileStats(byId('g60-585'));
    expect(st.fovW).toBeCloseTo(2.66, 2);
    expect(st.fovH).toBeCloseTo(1.5, 2);
  });

  it('APS-C (23.5 × 15.6 mm) + 14 mm: 80.0° × 58.2°', () => {
    const st = profileStats(byId('aps14'));
    expect(st.fovW).toBeCloseTo(80.0, 1);
    expect(st.fovH).toBeCloseTo(58.2, 1);
  });

  it('a plate-solved focal length overrides focal × reducer', () => {
    expect(effectiveFocal({ focalMm: 2350, factor: 0.63, measuredFocalMm: 1210 })).toBe(1210);
    expect(effectiveFocal({ focalMm: 2350, factor: 0.63 })).toBeCloseTo(1480.5, 5);
  });

  it('binning 2× doubles the pixel scale and keeps the field', () => {
    const one = profileStats(byId('r80-2600'));
    const two = profileStats({ ...byId('r80-2600'), binning: 2 });
    expect(two.pixelScale).toBeCloseTo(one.pixelScale * 2, 6);
    expect(two.fovW).toBeCloseTo(one.fovW, 2);
  });

  it('the camera database keeps the ToupTek ATR585M (IMX585 mono)', () => {
    const c = CAMERA_DB.find((x) => x.id === 'atr585m');
    expect(c).toMatchObject({ widthPx: 3840, heightPx: 2160, pixelUm: 2.9, mono: true });
  });

  it('validates imported profiles', () => {
    for (const p of DEFAULT_PROFILES) expect(isProfile(p)).toBe(true);
    expect(isProfile({ id: 'x', name: 'x', focalMm: 0 })).toBe(false);
  });
});

describe('profile choice is remembered per browser', () => {
  it('first visit starts on the 80 mm refractor; a choice comes back next visit', () => {
    expect(loadActiveProfileId()).toBe('r80-2600');
    saveActiveProfileId('aps14');
    expect(loadActiveProfileId()).toBe('aps14');
  });

  it('an id saved by an older build (rig no longer shipped) falls back to the default', () => {
    saveActiveProfileId('c925r');
    expect(loadActiveProfileId()).toBe('r80-2600');
    expect(loadProfiles().map((p) => p.id)).not.toContain('c925r');
  });
});

describe('"My setup": the visitor\'s own equipment', () => {
  it('is a deep-sky profile built from the Equipment setup and comes back next visit', async () => {
    const { MINE_ID, loadMySetup, mineProfile, profileSetup, saveMySetup } =
      await import('../src/lib/profiles');
    expect(loadMySetup()).toBeNull();
    const mine = { ...profileSetup(byId('r80-2600')), telescope: 'My 102 mm', focalMm: 714 };
    saveMySetup(mine);
    expect(loadMySetup()).toEqual(mine);
    const p = mineProfile(mine);
    expect(p).toMatchObject({ id: MINE_ID, name: 'My setup · My 102 mm', focalMm: 714 });
    expect(isProfile(p)).toBe(true);
    saveActiveProfileId(MINE_ID);
    expect(loadActiveProfileId()).toBe(MINE_ID);
  });

  it('"mine" without a saved setup falls back to the default rig', async () => {
    const { MINE_ID } = await import('../src/lib/profiles');
    saveActiveProfileId(MINE_ID);
    expect(loadActiveProfileId()).toBe('r80-2600');
  });

  it('notices a changed telescope or camera, not a turned frame', async () => {
    const { profileSetup, sameRig } = await import('../src/lib/profiles');
    const a = profileSetup(byId('r80-2600'));
    expect(sameRig({ ...a, rotationDeg: 90, telescope: 'renamed' }, a)).toBe(true);
    expect(sameRig({ ...a, focalMm: 600 }, a)).toBe(false);
    expect(sameRig({ ...a, factor: 0.8 }, a)).toBe(false);
    expect(sameRig({ ...a, pixelUm: 2.9 }, a)).toBe(false);
  });
});
