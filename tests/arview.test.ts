import { describe, expect, it } from 'vitest';
import {
  alphaFromCompass,
  enu,
  lookAzAlt,
  poseFromOrientation,
  project,
} from '../src/lib/sky/arview';

describe('phone camera pose', () => {
  it('upright, top towards north: the camera looks at the northern horizon', () => {
    const p = poseFromOrientation(0, 90, 0);
    const l = lookAzAlt(p);
    expect(l.alt).toBeCloseTo(0, 6);
    expect(Math.min(l.az, 360 - l.az)).toBeLessThan(1e-6);
    // Screen up is the zenith, screen right is east.
    expect(p.up[2]).toBeCloseTo(1, 6);
    expect(p.right[0]).toBeCloseTo(1, 6);
  });

  it('turning left (alpha +90) faces west', () => {
    expect(lookAzAlt(poseFromOrientation(90, 90, 0)).az).toBeCloseTo(270, 6);
    expect(lookAzAlt(poseFromOrientation(alphaFromCompass(90), 90, 0)).az).toBeCloseTo(90, 6);
  });

  it('tilted back 45° looks 45° up; lying flat looks at the ground', () => {
    expect(lookAzAlt(poseFromOrientation(0, 135, 0)).alt).toBeCloseTo(45, 6);
    expect(lookAzAlt(poseFromOrientation(0, 0, 0)).alt).toBeCloseTo(-90, 6);
  });

  it('projects the centre of view to the screen centre and 30° left to the left edge', () => {
    const p = poseFromOrientation(0, 90, 0);
    const c = project(p, enu(0, 0), 400, 800, 60);
    expect(c?.[0]).toBeCloseTo(200, 6);
    expect(c?.[1]).toBeCloseTo(400, 6);
    // Half the horizontal field of view to the west lands on the left edge.
    const left = project(p, enu(-30, 0), 400, 800, 60);
    expect(left?.[0]).toBeCloseTo(0, 4);
    // Above the horizon is higher on screen; behind the camera is not shown.
    expect((project(p, enu(0, 10), 400, 800, 60)?.[1] ?? 999) < 400).toBe(true);
    expect(project(p, enu(180, 0), 400, 800, 60)).toBeNull();
  });

  it('landscape (screen turned 90°) swaps the screen axes', () => {
    const p = poseFromOrientation(0, 90, 0, 90);
    // Device up (zenith) now points to screen-right.
    expect(p.right[2]).toBeCloseTo(1, 6);
  });
});
