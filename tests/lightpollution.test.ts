import { describe, expect, it } from 'vitest';
import {
  SECTORS,
  bortle,
  domeWeights,
  kernel,
  siteFromBrightening,
  type LightPixel,
} from '../src/lib/lp/lightpollution';
import { pixelCenter, pixelFor } from '../src/lib/data/tiles';

const model = { p: 2.5, d0Km: 0.5, DKm: 100, A: 0.01, rMaxKm: 150 };

describe('light pollution', () => {
  it('maps SQM to Bortle classes like the pipeline', () => {
    expect(bortle(22.0)).toBe(1);
    expect(bortle(21.3)).toBe(4);
    expect(bortle(19.0)).toBe(6);
    expect(bortle(17.0)).toBe(9);
  });

  it('turns brightening into SQM and a brightness ratio', () => {
    const q = siteFromBrightening(2.5);
    expect(q.sqm).toBeCloseTo(19.5, 9);
    expect(q.ratio).toBeCloseTo(9, 9);
    expect(q.bortle).toBe(5);
    expect(siteFromBrightening(0).ratio).toBe(0);
  });

  it('uses the pipeline kernel (Walker law slope, cut-off)', () => {
    const m = { ...model, d0Km: 0, DKm: 1e12 };
    expect(Math.log(kernel(10, m) / kernel(40, m)) / Math.log(4)).toBeCloseTo(2.5, 6);
    expect(kernel(151, model)).toBe(0);
  });

  it('puts a town 30 km east in the eastern sectors', () => {
    const town: LightPixel[] = [];
    for (let i = 0; i < 5; i++) {
      town.push({ lat: 0.0 + i * 0.01, lon: 0.27, L: 50, areaKm2: 4 });
    }
    const w = domeWeights(town, 0, 0, model);
    expect(w).toHaveLength(SECTORS);
    const east = w[9] ?? 0; // 90°–100°
    expect(east + (w[8] ?? 0)).toBeCloseTo(SECTORS, 6); // all light between 80° and 100°
    expect(w[27]).toBe(0); // nothing to the west
    expect(w.reduce((a, b) => a + b, 0) / SECTORS).toBeCloseTo(1, 9);
  });

  it('gives no domes without lights in range', () => {
    const far: LightPixel[] = [{ lat: 5, lon: 5, L: 100, areaKm2: 4 }];
    expect(domeWeights(far, 0, 0, model).every((x) => x === 0)).toBe(true);
  });

  it('finds tile pixels and their centres consistently', () => {
    const c = pixelFor(51.5, -0.1, 8);
    const back = pixelCenter(8, c.tx, c.ty, c.px, c.py);
    expect(Math.abs(back.lat - 51.5)).toBeLessThan(0.01);
    expect(Math.abs(back.lon + 0.1)).toBeLessThan(0.01);
  });
});
