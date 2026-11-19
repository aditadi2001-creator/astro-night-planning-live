/**
 * Path allow-lists for the telescope APIs. NINA's Advanced API v2 performs slews, syncs, parks
 * and flips on plain GET requests, so "GET = safe" does not hold: every request the app makes is
 * checked against these lists. Control paths pass only when the user has switched on
 * "Enable control" (CLAUDE.md rule 8). The bridge (tools/bridge/bridge.mjs) keeps the same lists;
 * tests/telescope.test.ts checks that they agree.
 */
export const NINA_READ = ['/version', '/equipment/mount/info', '/equipment/rotator/info'] as const;
export const NINA_CONTROL = [
  '/equipment/mount/slew',
  '/equipment/mount/slew/stop',
  '/equipment/mount/sync',
] as const;

export const ALPACA_READ = [
  'connected',
  'devicestate',
  'rightascension',
  'declination',
  'altitude',
  'azimuth',
  'sideofpier',
  'tracking',
  'slewing',
  'atpark',
  'siderealtime',
  'equatorialsystem',
] as const;
export const ALPACA_CONTROL = ['slewtocoordinatesasync', 'synctocoordinates', 'abortslew'] as const;

/** Is this NINA API path (after /v2/api) allowed? */
export function ninaAllowed(path: string, control: boolean): boolean {
  const p = path.split('?')[0] ?? '';
  return (
    (NINA_READ as readonly string[]).includes(p) ||
    (control && (NINA_CONTROL as readonly string[]).includes(p))
  );
}

/** Is this Alpaca telescope method allowed? */
export function alpacaAllowed(method: string, control: boolean): boolean {
  const m = method.toLowerCase();
  return (
    (ALPACA_READ as readonly string[]).includes(m) ||
    (control && (ALPACA_CONTROL as readonly string[]).includes(m))
  );
}
