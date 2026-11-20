/**
 * "Is tonight worth it?" — a plain-English go / marginal / no-go verdict for imaging tonight,
 * built only from the hourly rows the app already computes (clouds, transparency, Moon,
 * darkness, seeing as relative signal-to-noise factors; dew risk; model agreement).
 *
 *   usable hour  = an hour of darkness whose imaging score is at least 40 / 100
 *   go           = 3 or more usable hours
 *   marginal     = 1–3 usable hours, or the best hour scores 25–40
 *   no-go        = nothing usable
 *   no darkness  = the Sun never gets 12° below the horizon (high-latitude summer)
 *
 * Every reason names its cause and, when it helps, the time it changes ("clouds clear after
 * 01:00"). Nothing is invented: a missing input is reported as unknown.
 */
import type { HourRow, TwilightTimes } from '../conditions';

export type Level = 'go' | 'maybe' | 'nogo' | 'nodark' | 'unknown';

export interface Verdict {
  level: Level;
  headline: string;
  /** Short reasons, most important first (beginner text). */
  reasons: string[];
  /** Darkness used for the verdict (astronomical, else nautical). */
  dark: { start: number; end: number; kind: 'astronomical' | 'nautical' } | null;
  usableHours: number;
  best: { t: number; score: number } | null;
  /** Mean values over the dark hours (null = unknown). */
  clouds: number | null;
  seeing: number | null;
  transparency: number | null;
  moonIllum: number | null;
  moonUpHours: number;
  dewHours: number;
  agreementLow: boolean;
}

const USABLE = 40;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function darkWindow(tw: TwilightTimes): Verdict['dark'] {
  if (tw.astroEnd && tw.astroStart && tw.astroStart > tw.astroEnd)
    return { start: tw.astroEnd.getTime(), end: tw.astroStart.getTime(), kind: 'astronomical' };
  if (tw.nauticalEnd && tw.nauticalStart && tw.nauticalStart > tw.nauticalEnd)
    return { start: tw.nauticalEnd.getTime(), end: tw.nauticalStart.getTime(), kind: 'nautical' };
  return null;
}

export function verdict(
  rows: readonly HourRow[],
  tw: TwilightTimes,
  moonIllum: number | null,
  fmt: (t: number) => string,
): Verdict {
  const dark = darkWindow(tw);
  const base = {
    dark,
    usableHours: 0,
    best: null,
    clouds: null,
    seeing: null,
    transparency: null,
    moonIllum,
    moonUpHours: 0,
    dewHours: 0,
    agreementLow: false,
  };
  if (!dark) {
    return {
      ...base,
      level: 'nodark',
      headline: 'No real darkness tonight',
      reasons: [
        'The Sun stays less than 12° below the horizon all night: the sky never gets dark.',
      ],
    };
  }
  // Hours that overlap the dark window (rows start on the hour, local grid).
  const hours = rows.filter((r) => r.t + 3600_000 > dark.start && r.t < dark.end);
  const scored = hours.filter((r) => r.score);
  if (!scored.length) {
    return {
      ...base,
      level: 'unknown',
      headline: 'Waiting for the forecast',
      reasons: ['The weather forecast has not loaded yet, so tonight cannot be rated.'],
    };
  }
  const usable = scored.filter((r) => (r.score?.score ?? 0) >= USABLE);
  const best = scored.reduce((a, b) => ((b.score?.score ?? 0) > (a.score?.score ?? 0) ? b : a));
  const bestScore = best.score?.score ?? 0;
  const clouds = mean(
    hours.map((r) => r.cloud?.total ?? r.weather?.cloud).filter((x): x is number => x != null),
  );
  const seeing = mean(hours.map((r) => r.seeing?.arcsec).filter((x): x is number => x != null));
  const transparency = mean(scored.map((r) => r.score?.transparency ?? 0));
  const moonUpHours = hours.filter((r) => r.moonAlt > 0).length;
  const dewHours = hours.filter((r) => r.dew?.risk === 'high').length;
  const agreementLow =
    hours.filter((r) => r.agreement === 'low').length >= Math.ceil(hours.length / 2);
  const usableHours = usable.length;

  const level: Level =
    usableHours >= 3 ? 'go' : usableHours >= 1 || bestScore >= 25 ? 'maybe' : 'nogo';
  const reasons: string[] = [];

  // Clouds first: they decide most nights.
  const cloudy = hours.filter((r) => (r.cloud?.total ?? r.weather?.cloud ?? 0) >= 60);
  if (clouds != null) {
    if (cloudy.length === 0 && clouds < 25)
      reasons.push(`Mostly clear: about ${Math.round(clouds)} % cloud during darkness.`);
    else if (cloudy.length === hours.length)
      reasons.push(`Cloudy all night (about ${Math.round(clouds)} % cover).`);
    else {
      const firstClear = hours.find((r) => (r.cloud?.total ?? r.weather?.cloud ?? 100) < 40);
      const firstCloudy = cloudy[0];
      if (firstCloudy && firstClear && firstClear.t > firstCloudy.t)
        reasons.push(`Clouds early, clearing around ${fmt(firstClear.t)}.`);
      else if (firstCloudy)
        reasons.push(`Clear at first, clouds from about ${fmt(firstCloudy.t)}.`);
      else reasons.push(`Some cloud: about ${Math.round(clouds)} % on average.`);
    }
  } else reasons.push('Cloud forecast unknown.');

  if (moonIllum != null) {
    const pct = Math.round(moonIllum * 100);
    if (moonUpHours === 0 || pct < 15)
      reasons.push(
        pct < 15
          ? `Moon only ${pct} % lit: dark sky.`
          : `The Moon (${pct} % lit) is down during darkness.`,
      );
    else
      reasons.push(
        `Moon ${pct} % lit and up for ${moonUpHours} of ${hours.length} dark hours${pct > 50 ? ': narrowband targets work best' : ''}.`,
      );
  }
  if (seeing != null) {
    const s = seeing.toFixed(1);
    reasons.push(
      seeing <= 1.5
        ? `Steady air (seeing about ${s}″): good for planets and small galaxies.`
        : seeing <= 2.5
          ? `Average seeing (about ${s}″).`
          : `Turbulent air (seeing about ${s}″): stick to wide fields.`,
    );
  }
  if (transparency != null && transparency < 0.6)
    reasons.push('Hazy (fine particles in the air): faint targets lose contrast.');
  if (dewHours >= 2) reasons.push(`Dew likely for ${dewHours} hours: use a dew heater.`);
  if (agreementLow)
    reasons.push('The weather models disagree tonight: treat the cloud forecast with caution.');

  const window = usableHours
    ? `${fmt(usable[0]?.t ?? 0)}–${fmt((usable.at(-1)?.t ?? 0) + 3600_000)}`
    : '';
  const headline =
    level === 'go'
      ? `Yes — ${usableHours} good hours tonight${window ? `, ${window}` : ''}`
      : level === 'maybe'
        ? usableHours
          ? `Maybe — ${usableHours} usable hour${usableHours > 1 ? 's' : ''} (${window})`
          : `Marginal — best hour ${fmt(best.t)} scores ${bestScore}`
        : 'No — not worth setting up tonight';

  return {
    level,
    headline,
    reasons,
    dark,
    usableHours,
    best: { t: best.t, score: bestScore },
    clouds,
    seeing,
    transparency,
    moonIllum,
    moonUpHours,
    dewHours,
    agreementLow,
  };
}
