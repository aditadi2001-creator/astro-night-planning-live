/**
 * Combines the live sources (weather, cloud models, air quality) with
 * astronomy (Sun, Moon) into per-hour rows for the cards and the timeline.
 * Pure functions: everything is passed in, nothing is fetched here.
 */
import * as Astronomy from 'astronomy-engine';
import type { Place } from './astro/sky';
import {
  hourAt,
  type Air,
  type AirHour,
  type ModelClouds,
  type Weather,
  type WeatherHour,
} from './data/openmeteo';
import { zenithExtinction, type ExtinctionParts } from './physics/extinction';
import { dewRisk, type DewRisk } from './physics/dew';
import { imagingScore, modelAgreement, type Agreement, type ScoreParts } from './physics/score';
import { estimateSeeing, type SeeingEstimate, type WindAt } from './physics/seeing';

export interface HourRow {
  t: number;
  weather: WeatherHour | null;
  air: AirHour | null;
  aod: number | null;
  extinction: ExtinctionParts | null;
  sunAlt: number;
  moonAlt: number;
  moonPhaseAngle: number;
  agreement: Agreement;
  cloudSpread: number | null;
  modelClouds: Record<string, number | null>;
  dew: { risk: DewRisk; spread: number; margin: number } | null;
  /** Our seeing forecast (estimate) for this hour. */
  seeing: SeeingEstimate | null;
  score: ScoreParts | null;
}

const KMH = 1 / 3.6;

/** Seeing estimate from the hour's model winds (Open-Meteo gives km/h). */
export function seeingForHour(w: WeatherHour | null, elevation: number): SeeingEstimate | null {
  if (!w) return null;
  const at = (speed: number | null, dir: number | null): WindAt | null =>
    speed == null || dir == null ? null : { speed: speed * KMH, dir };
  const upper = ([500, 300, 250, 200] as const)
    .map((l) => at(w.upper[l].speed, w.upper[l].dir))
    .filter((x): x is WindAt => x != null);
  return estimateSeeing({
    upper,
    w850: at(w.upper[850].speed, w.upper[850].dir),
    w10: at(w.wind, w.windDir),
    elevation,
  });
}

function altitude(body: Astronomy.Body, obs: Astronomy.Observer, date: Date): number {
  const eq = Astronomy.Equator(body, date, obs, true, true);
  return Astronomy.Horizon(date, obs, eq.ra, eq.dec, 'normal').altitude;
}

export function buildRow(
  t: number,
  place: Place,
  weather: Weather | null,
  models: ModelClouds | null,
  air: Air | null,
): HourRow {
  const date = new Date(t);
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const sunAlt = altitude(Astronomy.Body.Sun, obs, date);
  const moonAlt = altitude(Astronomy.Body.Moon, obs, date);
  const moonPhaseAngle = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_angle;

  const w = weather ? hourAt(weather.hours, t) : null;
  const a = air ? hourAt(air.hours, t) : null;
  const m = models ? hourAt(models.hours, t) : null;
  const modelClouds: Record<string, number | null> = {
    best_match: w?.cloud ?? null,
    ...(m?.byModel ?? {}),
  };
  const { agreement, spread } = modelAgreement(Object.values(modelClouds));

  const aod = a?.aod ?? null;
  // Station pressure from the forecast; fall back to the barometric formula for the site.
  const pressure = w?.pressure ?? 1013.25 * Math.exp(-place.elevation / 8434);
  const extinction = aod != null ? zenithExtinction(pressure, aod) : null;

  const dew =
    w && w.temperature != null && w.dewPoint != null
      ? dewRisk(w.temperature, w.dewPoint, w.cloud ?? 0, w.wind ?? 0)
      : null;

  const seeing = seeingForHour(w, place.elevation);

  const score =
    w && w.cloudLow != null && w.cloudMid != null && w.cloudHigh != null
      ? imagingScore({
          cloudLow: w.cloudLow,
          cloudMid: w.cloudMid,
          cloudHigh: w.cloudHigh,
          // Without air-quality data assume a typical clear sea-level night (AOD 0.1).
          extinction: extinction?.total ?? zenithExtinction(pressure, 0.1).total,
          sunAlt,
          moonAlt,
          moonPhaseAngle,
          seeing: seeing?.arcsec ?? null,
        })
      : null;

  return {
    t,
    weather: w,
    air: a,
    aod,
    extinction,
    sunAlt,
    moonAlt,
    moonPhaseAngle,
    agreement,
    cloudSpread: spread,
    modelClouds,
    dew,
    seeing,
    score,
  };
}

export interface NightWindow {
  /** Sun at −6° going down (end of civil twilight), or now if already past. */
  start: number;
  /** Sun at −6° going up. */
  end: number;
}

/** The coming (or current) night, bounded by civil twilight. */
export function nightWindow(place: Place, from: Date): NightWindow | null {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const sunNow = altitude(Astronomy.Body.Sun, obs, from);
  let start: Date | null;
  if (sunNow < -6) {
    start = from;
  } else {
    start = Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, from, 1.5, -6)?.date ?? null;
  }
  if (!start) return null; // polar day
  const end = Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, 1, start, 1.5, -6)?.date ?? null;
  if (!end) return null;
  return { start: start.getTime(), end: end.getTime() };
}

/** Hourly rows across the night (starting on the hour that contains `start`). */
export function buildTimeline(
  place: Place,
  win: NightWindow,
  weather: Weather | null,
  models: ModelClouds | null,
  air: Air | null,
): HourRow[] {
  const rows: HourRow[] = [];
  // Align to the site's local hours (e.g. :30 UTC in India), which is also the
  // grid Open-Meteo returns with timezone=auto.
  const off = (weather?.utcOffsetSeconds ?? 0) * 1000;
  const first = Math.floor((win.start + off) / 3600_000) * 3600_000 - off;
  for (let t = first; t < win.end && rows.length < 24; t += 3600_000) {
    // Evaluate astronomy at the middle of the hour (or the window edges).
    const mid = Math.min(Math.max(t + 1800_000, win.start), win.end);
    const row = buildRow(mid, place, weather, models, air);
    rows.push({ ...row, t });
  }
  return rows;
}

export interface MoonEvents {
  rise: Date | null;
  set: Date | null;
  illumination: number;
  phaseAngle: number;
}

export function moonEvents(place: Place, from: Date): MoonEvents {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const start = new Date(from.getTime() - 12 * 3600_000);
  const rise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, 1, start, 2)?.date ?? null;
  const set = Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, -1, rise ?? start, 2)?.date ?? null;
  const ill = Astronomy.Illumination(Astronomy.Body.Moon, from);
  return { rise, set, illumination: ill.phase_fraction, phaseAngle: ill.phase_angle };
}

export interface TwilightTimes {
  sunset: Date | null;
  civilEnd: Date | null;
  nauticalEnd: Date | null;
  astroEnd: Date | null;
  astroStart: Date | null;
  nauticalStart: Date | null;
  civilStart: Date | null;
  sunrise: Date | null;
}

/** Twilight milestones for the evening/morning around `from` (searching forward from noon). */
export function twilight(place: Place, from: Date): TwilightTimes {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  // Start from the most recent local solar noon so "tonight" stays stable through the night.
  const noon = Astronomy.SearchHourAngle(
    Astronomy.Body.Sun,
    obs,
    0,
    new Date(from.getTime() - 24 * 3600_000),
  ).time.date;
  let base = noon;
  const next = Astronomy.SearchHourAngle(
    Astronomy.Body.Sun,
    obs,
    0,
    new Date(noon.getTime() + 3600_000),
  ).time.date;
  if (next <= from) base = next;
  const down = (alt: number) =>
    Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, base, 1, alt)?.date ?? null;
  const set = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, -1, base, 1)?.date ?? null;
  const astroEnd = down(-18);
  const up = (alt: number) =>
    Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, 1, astroEnd ?? set ?? base, 1, alt)?.date ??
    null;
  return {
    sunset: set,
    civilEnd: down(-6),
    nauticalEnd: down(-12),
    astroEnd,
    astroStart: up(-18),
    nauticalStart: up(-12),
    civilStart: up(-6),
    sunrise: Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, 1, set ?? base, 1)?.date ?? null,
  };
}
