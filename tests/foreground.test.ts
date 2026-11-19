import { describe, expect, it } from 'vitest';
import { FOREGROUNDS, foregroundProfile, thumbPath, tintGround } from '../src/lib/sky/foreground';

describe('foregrounds', () => {
  it('has the requested list', () => {
    expect(FOREGROUNDS.map((f) => f.id)).toEqual([
      'dem',
      'none',
      'flat',
      'ocean',
      'desert',
      'hills',
      'forest',
      'mountains',
      'himalaya',
      'city',
      'rooftop',
      'dome',
    ]);
  });
  it('generates deterministic 720-step silhouettes in sensible ranges', () => {
    for (const f of FOREGROUNDS) {
      const p = foregroundProfile(f.id);
      if (f.id === 'dem' || f.id === 'none') {
        expect(p).toBeNull();
        continue;
      }
      expect(p).toHaveLength(720);
      expect(Array.from(p ?? []).every((a) => a >= 0 && a <= 90)).toBe(true);
      expect(foregroundProfile(f.id)).toEqual(p);
    }
    const himal = Math.max(...(foregroundProfile('himalaya') ?? []));
    expect(himal).toBeGreaterThan(8);
    const dome = foregroundProfile('dome') ?? new Float32Array();
    expect(dome[360]).toBe(0); // south, in the slit
    expect(dome[0]).toBeGreaterThan(89); // north, closed
  });
  it('tints, brightens and fogs the ground colour', () => {
    expect(tintGround([10, 10, 10], { id: 'flat', brightness: 2, fog: 0 })).toEqual([20, 20, 20]);
    expect(tintGround([10, 10, 10], { id: 'flat', brightness: 1, fog: 1 })).toEqual([28, 30, 34]);
    expect(thumbPath(null)).toMatch(/^M0,/);
  });
});
