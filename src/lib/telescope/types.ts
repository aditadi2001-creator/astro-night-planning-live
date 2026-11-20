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

export type AdapterKind = 'simulator' | 'nina' | 'alpaca' | 'serial';

/** How to finish a GoTo (NINA only: plate solve and centre, then turn the rotator). */
export interface GotoOptions {
  /** Plate-solve and re-slew until the target is centred (NINA "Slew and center"). */
  centre?: boolean;
  /** Also turn the rotator to this position angle (degrees, NINA "Center and rotate"). */
  rotatePa?: number | null;
}

/** What a connection can do beyond reading, slewing and syncing. */
export interface Capabilities {
  centre: boolean;
  rotate: boolean;
  park: boolean;
  tracking: boolean;
  /** Set the target of a NINA Advanced Sequencer target container. */
  sequence: boolean;
  /** Send coordinates to NINA's framing assistant. */
  framing: boolean;
}

export const NO_CAPS: Capabilities = {
  centre: false,
  rotate: false,
  park: false,
  tracking: false,
  sequence: false,
  framing: false,
};

/** A target container of the sequence loaded in NINA (index as set-target expects it). */
export interface SequenceTarget {
  index: number;
  name: string;
  ra: number | null;
  dec: number | null;
}

export interface TelescopeAdapter {
  kind: AdapterKind;
  /** Where it reads from, for messages ("NINA at 192.168.1.20:1888"). */
  label: string;
  caps: Capabilities;
  read(signal?: AbortSignal): Promise<MountState>;
  /** Control: only called after "Enable control" and a confirmation (CLAUDE.md rule 8). */
  slew(ra2000: number, dec2000: number, opts?: GotoOptions): Promise<void>;
  sync(ra2000: number, dec2000: number): Promise<void>;
  stop(): Promise<void>;
  park?(): Promise<void>;
  unpark?(): Promise<void>;
  setTracking?(on: boolean): Promise<void>;
  /** NINA: the target containers of the loaded sequence (read-only). */
  sequenceTargets?(signal?: AbortSignal): Promise<SequenceTarget[]>;
  /** NINA: set one container's target (J2000 degrees, position angle in degrees). */
  setSequenceTarget?(
    index: number,
    name: string,
    ra: number,
    dec: number,
    pa: number,
  ): Promise<void>;
  /** NINA: sequences saved in its default folder, and loading one. */
  listSequences?(signal?: AbortSignal): Promise<string[]>;
  loadSequence?(name: string): Promise<void>;
  /** NINA: put coordinates and rotation into the framing assistant. */
  toFraming?(ra: number, dec: number, pa: number): Promise<void>;
  /** Close the link (serial port). */
  close?(): Promise<void>;
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
