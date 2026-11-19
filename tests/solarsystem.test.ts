import { describe, expect, it } from 'vitest';
import {
  bodyNow,
  jupiterMoons,
  moonInfo,
  onTerminator,
  planetCapture,
  saturnRingTilt,
} from '../src/lib/plan/solarsystem';

const blr = { lat: 12.97, lon: 77.59, elevation: 920 };
const t = new Date('2026-11-19T16:00:00Z');

describe('planets, Sun and Moon', () => {
  it('gives sensible apparent diameters', () => {
    const sun = bodyNow('Sun', blr, t);
    expect(sun.diameter / 60).toBeGreaterThan(31.5); // arcmin, November
    expect(sun.diameter / 60).toBeLessThan(32.7);
    const moon = bodyNow('Moon', blr, t);
    expect(moon.diameter / 60).toBeGreaterThan(29);
    expect(moon.diameter / 60).toBeLessThan(34.2);
    const jup = bodyNow('Jupiter', blr, t);
    expect(jup.diameter).toBeGreaterThan(29);
    expect(jup.diameter).toBeLessThan(51);
    expect(jup.mag).toBeLessThan(-1.5);
  });

  it('Saturn ring tilt is a small angle in late 2026 (rings near edge-on in 2025)', () => {
    expect(Math.abs(saturnRingTilt(t))).toBeLessThan(15);
  });

  it('places the Galilean moons within ~30 Jupiter radii', () => {
    const m = jupiterMoons(t);
    expect(m.map((x) => x.name)).toEqual(['Io', 'Europa', 'Ganymede', 'Callisto']);
    expect(Math.abs(m[0]?.x ?? 99)).toBeLessThan(6.5);
    expect(Math.abs(m[3]?.x ?? 99)).toBeLessThan(28);
  });

  it('describes the Moon and finds terminator features', () => {
    const fq = moonInfo(new Date('2026-11-17T12:00:00Z'));
    expect(fq.ageDays).toBeGreaterThan(0);
    expect(fq.ageDays).toBeLessThan(30);
    expect(fq.next).toHaveLength(4);
    // At first quarter the sunrise terminator is near longitude 0°.
    const q = moonInfo(
      new Date((fq.next.find((n) => n.name === 'First quarter')?.t ?? new Date(0)).getTime()),
    );
    expect(Math.abs(q.terminatorLon)).toBeLessThan(2);
    expect(q.terminator).toBe('sunrise');
    expect(
      onTerminator(q).some((f) =>
        ['Ptolemaeus', 'Arzachel', 'Alphonsus', 'Walter'].includes(f.name),
      ),
    ).toBe(true);
  });

  it('gives capture advice from the profile', () => {
    const tips = planetCapture(45, 0.2545, 10, 2.9, 2.5, ['irpass']);
    expect(tips[0]).toMatch(/177 px/);
    expect(tips.join(' ')).toMatch(/f\/15/);
    expect(tips.join(' ')).toMatch(/IR-pass/);
  });
});
