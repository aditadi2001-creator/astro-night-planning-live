/**
 * Shared camera-frame settings between the dock's Telescope panel and the sky overlay
 * (Oculars.svelte): the mosaic grid, and requests to turn the frame to a position angle.
 */
export interface Mosaic {
  cols: number;
  rows: number;
  /** Overlap between neighbouring panes, 0–0.5. */
  overlap: number;
}

const KEY = 'anp.mosaic.v1';

function load(): Mosaic {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Mosaic>;
    const int = (n: unknown) =>
      Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6 ? (n as number) : 1;
    const ov = Number(v.overlap);
    return { cols: int(v.cols), rows: int(v.rows), overlap: ov >= 0 && ov <= 0.5 ? ov : 0.15 };
  } catch {
    return { cols: 1, rows: 1, overlap: 0.15 };
  }
}

export const mosaic: Mosaic = $state(load());

export function saveMosaic(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mosaic));
  } catch {
    /* not remembered */
  }
}

/** Bumping `seq` asks the frame to show its "up" side at position angle `paUp` (true PA). */
export const frameAlign = $state({ seq: 0, paUp: 0 });

export function alignFrame(paUp: number): void {
  frameAlign.paUp = paUp;
  frameAlign.seq++;
}

/**
 * The PA (east of north) for the frame's "up" side that puts the frame's long side along an
 * object's major axis. `landscape`: the frame is wider than tall.
 */
export function upPaForMajorAxis(objectPa: number, landscape: boolean): number {
  const up = landscape ? objectPa - 90 : objectPa;
  return ((up % 180) + 180) % 180;
}
