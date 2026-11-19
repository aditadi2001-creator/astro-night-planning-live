import { describe, expect, it } from 'vitest';
import vega from './fixtures/sesame-vega.xml?raw';
import m31 from './fixtures/sesame-m31.xml?raw';
import { otypeWords, parseSesameDetails } from '../src/lib/info/details';

describe('SIMBAD details via Sesame', () => {
  it('reads Vega: type, spectral type, parallax, proper motion, velocity, aliases', () => {
    const d = parseSesameDetails(vega);
    expect(d?.name).toBe('alf Lyr');
    expect(d?.spType).toBe('A0V');
    expect(d?.plx).toBeCloseTo(130.23, 2);
    expect(d?.pmRa).toBeCloseTo(200.94, 2);
    expect(d?.rv).toBeCloseTo(-13.5, 1);
    expect(d?.aliases).toContain('HIP 91262');
    expect(otypeWords(d?.otype ?? null)).toBe('delta Scuti variable star');
  });
  it('reads M 31 and returns null for unknown names', () => {
    const d = parseSesameDetails(m31);
    expect(d?.otype).toBeTruthy();
    expect(d?.aliases.some((a) => /NGC 224/.test(a))).toBe(true);
    expect(parseSesameDetails('<Sesame><Target><name>zzz</name></Target></Sesame>')).toBeNull();
  });
});
