/**
 * Tonight's plan: targets the user picked, kept on this device only, with exports for NINA,
 * JSON and calendars.
 *
 * NINA formats (docs/RESEARCH.md §3, from NINA's SimpleSequenceVM.cs and the Target Scheduler
 * docs): the sequencer and Target Scheduler read "Familiar Name, Catalogue Entry,
 * Right Ascension (J2000), Declination (J2000), Position Angle (East)" (NINA 3.2+), header names
 * matched case-insensitively, sexagesimal J2000 coordinates.
 */

export interface PlanItem {
  /** Primary designation ("M 31"), also the key. */
  name: string;
  common: string;
  type: string;
  ra: number;
  dec: number;
  /** Frame rotation (position angle, degrees east of north). */
  pa: number;
  /** Best window tonight (ms), when known. */
  window: { start: number; end: number } | null;
  transit: number | null;
  note?: string;
}

const KEY = 'anp.plan.v1';

export function loadPlan(): PlanItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v)
      ? (v as PlanItem[]).filter((x) => x && typeof x.name === 'string' && Number.isFinite(x.ra))
      : [];
  } catch {
    return [];
  }
}

export function savePlan(items: PlanItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    /* private mode */
  }
}

/** Order by the start of each target's best window (then transit), so the night flows west. */
export function autoOrder(items: readonly PlanItem[]): PlanItem[] {
  const key = (i: PlanItem) => i.window?.start ?? i.transit ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => key(a) - key(b));
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** RA (degrees) → "HH:MM:SS.S". */
export function raHms(deg: number): string {
  let s = ((((deg / 15) % 24) + 24) % 24) * 3600;
  s = Math.round(s * 10) / 10;
  if (s >= 86400) s -= 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return `${pad(h)}:${pad(m)}:${sec.toFixed(1).padStart(4, '0')}`;
}

/** Dec (degrees) → "+DD:MM:SS". */
export function decDms(deg: number): string {
  const sign = deg < 0 ? '-' : '+';
  let s = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(s / 3600);
  s -= d * 3600;
  const m = Math.floor(s / 60);
  return `${sign}${pad(d)}:${pad(m)}:${pad(s - m * 60)}`;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV for NINA 3.2+ sequencer "Import targets" and Target Scheduler (Telescopius columns). */
export function toNinaCsv(items: readonly PlanItem[]): string {
  const head = [
    'Familiar Name',
    'Catalogue Entry',
    'Type',
    'Right Ascension (J2000)',
    'Declination (J2000)',
    'Position Angle (East)',
  ];
  const rows = items.map((i) =>
    [
      i.common || i.name,
      i.name,
      i.type,
      raHms(i.ra),
      decDms(i.dec),
      (((i.pa % 360) + 360) % 360).toFixed(1),
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

export function toJson(items: readonly PlanItem[], meta: { site: string; date: string }): string {
  return JSON.stringify(
    {
      app: 'Astro Night Planning',
      version: 1,
      ...meta,
      targets: items.map((i) => ({
        ...i,
        raHms: raHms(i.ra),
        decDms: decDms(i.dec),
        epoch: 'J2000',
      })),
    },
    null,
    2,
  );
}

const icsTime = (t: number) =>
  new Date(t)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const icsText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/[,;]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');

/** iCalendar with the dark window and each target's best window (times in UTC). */
export function toIcs(
  items: readonly PlanItem[],
  dark: { start: number; end: number } | null,
  site: string,
): string {
  const now = icsTime(Date.now());
  const ev = (uid: string, start: number, end: number, summary: string, desc: string) => [
    'BEGIN:VEVENT',
    `UID:${uid}@astro-night-planning`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(desc)}`,
    'END:VEVENT',
  ];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Astro Night Planning//EN',
    'CALSCALE:GREGORIAN',
  ];
  if (dark)
    lines.push(
      ...ev(
        `dark-${dark.start}`,
        dark.start,
        dark.end,
        `Astronomical darkness at ${site}`,
        'Darkness window from Astro Night Planning.',
      ),
    );
  for (const i of items) {
    if (!i.window) continue;
    lines.push(
      ...ev(
        `${i.name.replace(/\s+/g, '')}-${i.window.start}`,
        i.window.start,
        i.window.end,
        `Image ${i.common ? `${i.name} (${i.common})` : i.name}`,
        `RA ${raHms(i.ra)} Dec ${decDms(i.dec)} (J2000), PA ${i.pa.toFixed(0)}°. ${i.note ?? ''}`.trim(),
      ),
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Offer a text file to the user (no server involved). */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
