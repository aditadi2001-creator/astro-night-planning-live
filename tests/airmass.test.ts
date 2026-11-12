import { describe, expect, it } from 'vitest';
import { airmassKastenYoung } from '../src/lib/physics/airmass';

// Reference values from Kasten & Young (1989), Applied Optics 28, 4735, Table 2.
describe('Kasten–Young airmass', () => {
  it('is ~1 at the zenith', () => {
    expect(airmassKastenYoung(90)).toBeCloseTo(0.9997, 4);
  });
  it('is 1.994 at 30° altitude (z = 60°)', () => {
    expect(airmassKastenYoung(30)).toBeCloseTo(1.994, 2);
  });
  it('is 5.60 at 10° altitude (z = 80°)', () => {
    expect(airmassKastenYoung(10)).toBeCloseTo(5.6, 1);
  });
  it('is 37.92 at the horizon', () => {
    expect(airmassKastenYoung(0)).toBeCloseTo(37.92, 1);
  });
  it('is infinite below the horizon and NaN for bad input', () => {
    expect(airmassKastenYoung(-1)).toBe(Number.POSITIVE_INFINITY);
    expect(airmassKastenYoung(Number.NaN)).toBeNaN();
  });
});
