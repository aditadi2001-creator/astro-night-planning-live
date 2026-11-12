import { describe, expect, it } from 'vitest';
import { dewPoint, dewRisk, undercooling } from '../src/lib/physics/dew';

describe('dew point (Magnus, Alduchov & Eskridge 1996)', () => {
  it('equals the air temperature at 100% humidity', () => {
    expect(dewPoint(15, 100)).toBeCloseTo(15, 6);
  });
  it('20 °C at 50% RH → 9.3 °C (standard psychrometric tables: 9.3 °C)', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1);
  });
  it('5.3 °C at 67% RH → −0.3 °C (matches Open-Meteo for London, 2026-11-12 20:00)', () => {
    expect(dewPoint(5.3, 67)).toBeCloseTo(-0.3, 0);
  });
});

describe('dew risk heuristic', () => {
  it('clear calm skies cool optics ~3 °C; clouds and wind reduce it', () => {
    expect(undercooling(0, 0)).toBeCloseTo(3, 6);
    expect(undercooling(100, 0)).toBe(0);
    expect(undercooling(0, 40)).toBeCloseTo(0.9, 6);
  });
  it('flags high risk when the spread is within the clear-sky undercooling', () => {
    expect(dewRisk(8, 6, 0, 3).risk).toBe('high');
  });
  it('no risk with a large spread', () => {
    expect(dewRisk(10, 0, 0, 5).risk).toBe('none');
  });
  it('overcast reduces the risk for the same spread (no radiative cooling: margin = spread)', () => {
    const r = dewRisk(8, 6, 100, 3);
    expect(r.margin).toBeCloseTo(2, 6);
    expect(r.risk).toBe('low');
  });
});
