import { describe, expect, it } from 'vitest';
import { formatLatLon, parseCoordinates } from '../src/lib/geo/coords';

describe('coordinate parsing', () => {
  const close = (t: string, lat: number, lon: number) => {
    const p = parseCoordinates(t);
    expect(p, t).not.toBeNull();
    expect(p?.lat).toBeCloseTo(lat, 4);
    expect(p?.lon).toBeCloseTo(lon, 4);
  };

  it('reads decimal pairs', () => {
    close('12.9716, 77.5946', 12.9716, 77.5946);
    close('12.9716 77.5946', 12.9716, 77.5946);
    close('-33.8688, 151.2093', -33.8688, 151.2093);
    close('33.8688S 151.2093E', -33.8688, 151.2093);
    close('40.7128 N, 74.0060 W', 40.7128, -74.006);
  });

  it('reads degrees, minutes and seconds', () => {
    close(`12°58'17.8"N 77°35'40.6"E`, 12 + 58 / 60 + 17.8 / 3600, 77 + 35 / 60 + 40.6 / 3600);
    close('12 58 17.8 N, 77 35 40.6 E', 12 + 58 / 60 + 17.8 / 3600, 77 + 35 / 60 + 40.6 / 3600);
    close(`N 12° 58.297' E 77° 35.677'`, 12 + 58.297 / 60, 77 + 35.677 / 60);
    close(`51°28′38″N 0°0′5″W`, 51 + 28 / 60 + 38 / 3600, -(5 / 3600));
  });

  it('rejects names and impossible values', () => {
    expect(parseCoordinates('Bangalore')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('10, 190')).toBeNull();
    expect(parseCoordinates(`12°75'N 10E`)).toBeNull();
    expect(parseCoordinates('77E 12N')).toBeNull();
  });

  it('formats with hemispheres', () => {
    expect(formatLatLon({ lat: -33.86882, lon: 151.20929 })).toBe('33.8688° S, 151.2093° E');
  });
});
