/**
 * Time formatting in the observing site's own time zone (IANA name from
 * Open-Meteo or the geocoder), falling back to the browser's zone.
 */

function safeZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export function fmtTime(d: Date | number | null | undefined, tz?: string, seconds = false): string {
  if (d == null) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    timeZone: safeZone(tz),
  }).format(d);
}

export function fmtDateTime(d: Date | number, tz?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: safeZone(tz),
  }).format(d);
}

export function fmtHour(d: Date | number, tz?: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: safeZone(tz) }).format(d);
}

/** Short zone label, e.g. "GMT", "GMT+5:30", "CET". */
export function zoneLabel(d: Date | number, tz?: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZoneName: 'short',
    timeZone: safeZone(tz),
  }).formatToParts(d);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * Value for an <input type="datetime-local"> showing `d` in zone `tz`, and the
 * inverse. datetime-local has no zone, so we convert by the zone's offset.
 */
export function toLocalInput(d: Date, tz?: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: safeZone(tz),
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromLocalInput(value: string, tz?: string): Date | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(value);
  if (!m) return null;
  const [, y, mo, da, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  // Guess as UTC, then correct by the zone offset at that moment (twice, for DST edges).
  let t = Date.UTC(y, mo - 1, da, h, mi);
  for (let i = 0; i < 2; i++) {
    const shown = toLocalInput(new Date(t), tz);
    const sm = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(shown);
    if (!sm) return null;
    const [, sy, smo, sda, sh, smi] = sm.map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    t += Date.UTC(y, mo - 1, da, h, mi) - Date.UTC(sy, smo - 1, sda, sh, smi);
  }
  return new Date(t);
}
