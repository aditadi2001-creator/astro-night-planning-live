import { describe, expect, it } from 'vitest';
import {
  HV57_GROUND_J,
  HV_MID_J,
  estimateSeeing,
  friedR0,
  hvUpperJ,
  jFromSeeing,
  rateSeeing,
  seeingFactor,
  seeingFromJ,
  shear,
} from '../src/lib/physics/seeing';
import {
  SEEING_CLASSES,
  parseSevenTimer,
  seeingClassText,
  sevenTimerAt,
} from '../src/lib/data/seventimer';

const calm = (speed: number) => [500, 300, 250, 200].map(() => ({ speed, dir: 270 }));

describe('seeing physics', () => {
  it('reproduces the Hufnagel–Valley 5/7 reference profile (r0 = 5 cm, ~2″)', () => {
    // Published HV 5/7: v = 21 m/s, A = 1.7e-14 → r0 ≈ 5 cm at 0.5 µm.
    const J = hvUpperJ(21) + HV_MID_J + HV57_GROUND_J;
    expect(friedR0(J)).toBeCloseTo(0.05, 2);
    expect(seeingFromJ(J)).toBeGreaterThan(1.9);
    expect(seeingFromJ(J)).toBeLessThan(2.15);
  });

  it('inverts seeing and turbulence integral', () => {
    expect(seeingFromJ(jFromSeeing(1.3))).toBeCloseTo(1.3, 6);
  });

  it('integrates the upper HV term analytically', () => {
    // 0.00594 · 10! · 1e-50 · 1e33 = 2.1555e-13 at v = 27 m/s.
    expect(hvUpperJ(27)).toBeCloseTo(2.1555e-13, 16);
  });

  it('computes vector shear', () => {
    expect(shear({ speed: 10, dir: 270 }, { speed: 10, dir: 270 })).toBeCloseTo(0, 9);
    expect(shear({ speed: 10, dir: 270 }, { speed: 10, dir: 90 })).toBeCloseTo(20, 9);
    expect(shear({ speed: 3, dir: 0 }, { speed: 4, dir: 90 })).toBeCloseTo(5, 9);
  });
});

describe('seeing estimate', () => {
  const base = { w850: { speed: 6, dir: 260 }, w10: { speed: 3, dir: 250 } };

  it('gives good seeing under a weak jet at a mountain site', () => {
    const s = estimateSeeing({ ...base, upper: calm(10), elevation: 2800 });
    expect(s?.arcsec).toBeGreaterThan(0.7);
    expect(s?.arcsec).toBeLessThan(1.0);
    expect(s?.rating).toBe(5);
  });

  it('is worse under a strong jet stream and at sea level', () => {
    const calmSea = estimateSeeing({ ...base, upper: calm(10), elevation: 0 });
    const jetSea = estimateSeeing({ ...base, upper: calm(50), elevation: 0 });
    expect(calmSea?.arcsec).toBeGreaterThan(1.0);
    expect(calmSea?.arcsec).toBeLessThan(1.3);
    expect(jetSea?.arcsec ?? 0).toBeGreaterThan((calmSea?.arcsec ?? 9) + 0.3);
    expect(jetSea?.parts.jet ?? 0).toBeGreaterThan(calmSea?.parts.jet ?? 9);
  });

  it('gets worse with low-level wind shear', () => {
    const low = estimateSeeing({ ...base, upper: calm(15), elevation: 100 });
    const high = estimateSeeing({
      upper: calm(15),
      w850: { speed: 22, dir: 270 },
      w10: { speed: 2, dir: 90 },
      elevation: 100,
    });
    expect(high?.shearMs).toBeCloseTo(24, 6);
    expect(high?.arcsec ?? 0).toBeGreaterThan(low?.arcsec ?? 9);
  });

  it('gives a ±20 % range and needs upper winds', () => {
    const s = estimateSeeing({ ...base, upper: calm(20), elevation: 500 });
    expect(s?.range[0]).toBeCloseTo((s?.arcsec ?? 0) * 0.8, 1);
    expect(s?.range[1]).toBeCloseTo((s?.arcsec ?? 0) * 1.2, 1);
    expect(estimateSeeing({ ...base, upper: [], elevation: 0 })).toBeNull();
  });

  it('rates on a 1–5 scale', () => {
    expect(rateSeeing(0.9).rating).toBe(5);
    expect(rateSeeing(1.4).rating).toBe(4);
    expect(rateSeeing(1.8).rating).toBe(3);
    expect(rateSeeing(2.5).rating).toBe(2);
    expect(rateSeeing(3.4)).toEqual({ rating: 1, label: 'Bad' });
  });

  it('turns seeing into a relative SNR factor', () => {
    expect(seeingFactor(0.8)).toBeCloseTo(1, 9);
    expect(seeingFactor(0.5)).toBe(1);
    expect(seeingFactor(2)).toBeCloseTo(Math.hypot(0.8, 1.5) / 2.5, 9);
    expect(seeingFactor(3)).toBeLessThan(seeingFactor(2));
  });
});

describe('7Timer! second opinion', () => {
  const raw = {
    init: '2026111300',
    dataseries: [
      { timepoint: 6, seeing: 4, transparency: 3 },
      { timepoint: 3, seeing: 6, transparency: -9999 },
    ],
  };

  it('parses run time, 3-hour steps and classes', () => {
    const st = parseSevenTimer(raw);
    expect(st?.init).toBe(Date.UTC(2026, 10, 13, 0));
    expect(st?.points.map((p) => p.t)).toEqual([
      Date.UTC(2026, 10, 13, 3),
      Date.UTC(2026, 10, 13, 6),
    ]);
    expect(st?.points[0]?.transparency).toBeNull(); // -9999 = missing
    expect(parseSevenTimer({ init: 'x' })).toBeNull();
  });

  it('picks the nearest step within 90 minutes', () => {
    const st = parseSevenTimer(raw);
    if (!st) throw new Error('parse failed');
    expect(sevenTimerAt(st, Date.UTC(2026, 10, 13, 4))?.seeing).toBe(6);
    expect(sevenTimerAt(st, Date.UTC(2026, 10, 13, 5))?.seeing).toBe(4);
    expect(sevenTimerAt(st, Date.UTC(2026, 10, 13, 9))).toBeNull();
  });

  it('describes classes in arcseconds', () => {
    expect(seeingClassText(1)).toBe('<0.5″');
    expect(seeingClassText(4)).toBe('1–1.25″');
    expect(seeingClassText(8)).toBe('>2.5″');
    expect(SEEING_CLASSES).toHaveLength(8);
  });
});
