import * as Astronomy from 'astronomy-engine';
import { apparentAltitude, STANDARD_ATMOSPHERE, type Atmosphere } from '../physics/refraction';

export interface Place {
  lat: number;
  lon: number;
  /** Metres above sea level. */
  elevation: number;
  name: string;
}

export interface BodyPosition {
  name: string;
  /** Apparent altitude in degrees (refraction applied for the given atmosphere). */
  altitude: number;
  /** Azimuth in degrees, measured from north through east. */
  azimuth: number;
}

function observer(p: Place): Astronomy.Observer {
  return new Astronomy.Observer(p.lat, p.lon, p.elevation);
}

/** Topocentric position of a solar-system body, with our own T/P-aware refraction. */
export function bodyPosition(
  body: Astronomy.Body,
  place: Place,
  date: Date,
  atm: Atmosphere = STANDARD_ATMOSPHERE,
): BodyPosition {
  const obs = observer(place);
  const eq = Astronomy.Equator(body, date, obs, true, true);
  // No refraction from astronomy-engine here: we apply ours with live T/P.
  const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec);
  return { name: body, altitude: apparentAltitude(hor.altitude, atm), azimuth: hor.azimuth };
}

export interface MoonInfo {
  /** Illuminated fraction 0–1. */
  illumination: number;
  /** Ecliptic phase angle in degrees: 0 = new, 90 = first quarter, 180 = full. */
  phaseDeg: number;
  phaseName: string;
}

export function moonInfo(date: Date): MoonInfo {
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phase = Astronomy.MoonPhase(date);
  return { illumination: illum.phase_fraction, phaseDeg: phase, phaseName: moonPhaseName(phase) };
}

export function moonPhaseName(eclipticPhaseDeg: number): string {
  const p = ((eclipticPhaseDeg % 360) + 360) % 360;
  if (p < 11.25 || p >= 348.75) return 'New Moon';
  if (p < 78.75) return 'Waxing crescent';
  if (p < 101.25) return 'First quarter';
  if (p < 168.75) return 'Waxing gibbous';
  if (p < 191.25) return 'Full Moon';
  if (p < 258.75) return 'Waning gibbous';
  if (p < 281.25) return 'Last quarter';
  return 'Waning crescent';
}
