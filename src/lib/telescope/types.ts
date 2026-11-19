/**
 * Live telescope position, shared by every adapter (simulator, NINA Advanced API, ASCOM Alpaca).
 * Angles in degrees, RA in degrees (0–360). Unknown values are null, never guessed.
 */
export type PierSide = 'east' | 'west' | 'unknown';

export interface MountState {
  connected: boolean;
  /** J2000 (ICRS) position, converted from the mount's own epoch when needed. */
  ra2000: number;
  dec2000: number;
  /** Position of date (JNow). */
  raNow: number;
  decNow: number;
  /** Which system the mount itself reports in. */
  epoch: 'J2000' | 'JNow' | 'unknown';
  alt: number | null;
  az: number | null;
  pier: PierSide;
  tracking: boolean | null;
  slewing: boolean;
  atPark: boolean | null;
  /** Local sidereal time reported by the mount (hours). */
  lstH: number | null;
  /** Hours until the mount's own meridian flip, when it reports one (NINA). */
  flipInH: number | null;
  /** Rotator sky angle, when a rotator reports one (degrees). */
  rotatorDeg: number | null;
  /** Time of the reading (ms). */
  at: number;
}

export type AdapterKind = 'simulator' | 'nina' | 'alpaca';

export interface TelescopeAdapter {
  kind: AdapterKind;
  /** Where it reads from, for messages ("NINA at 192.168.1.20:1888"). */
  label: string;
  read(signal?: AbortSignal): Promise<MountState>;
  /** Control: only called after "Enable control" and a confirmation (CLAUDE.md rule 8). */
  slew(ra2000: number, dec2000: number): Promise<void>;
  sync(ra2000: number, dec2000: number): Promise<void>;
  stop(): Promise<void>;
}

export class TelescopeError extends Error {
  constructor(
    message: string,
    /** What the user can do about it. */
    public hint: string,
  ) {
    super(message);
    this.name = 'TelescopeError';
  }
}
