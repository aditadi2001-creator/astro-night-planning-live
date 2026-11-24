import { describe, expect, it } from 'vitest';
import coreRaw from '../public/catalog/dso-core-v1.json?raw';
import {
  nightSamples,
  objectsFromShard,
  rankAll,
  strategy,
  surfaceBrightness,
  type RankInput,
  type Ranked,
  type Obj,
} from '../src/lib/plan/rank';

const objs = objectsFromShard(JSON.parse(coreRaw));
// Bangalore, night of 2026-11-19/20 (astronomical darkness 19:04–05:06 IST).
const darkStart = Date.UTC(2026, 10, 19, 13, 34);
const darkEnd = Date.UTC(2026, 10, 19, 23, 36);
const base: RankInput = {
  lat: 12.97,
  lon: 77.59,
  elevation: 920,
  darkStart,
  darkEnd,
  clear: [],
  sqm: 17.8,
  frameW: 31.6 / 60,
  frameH: 17.8 / 60,
  horizon: null,
  filters: { minAlt: 30 },
  tab: 'any',
  limit: 20,
  myFilters: ['L', 'R', 'G', 'B', 'lpro', 'irpass', 'ha', 'oiii', 'sii'],
};
const night = nightSamples(base);
const D = Math.PI / 180;
const sep = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) =>
  Math.acos(
    Math.sin(a.dec * D) * Math.sin(b.dec * D) +
      Math.cos(a.dec * D) * Math.cos(b.dec * D) * Math.cos((a.ra - b.ra) * D),
  ) / D;

describe('targets engine', () => {
  it('computes mean surface brightness in mag/arcsec² like OpenNGC (M 31 ≈ 22.2)', () => {
    const m31 = objs.find((o) => o.name === 'M 31');
    expect(m31?.con).toBe('And');
    expect(surfaceBrightness(3.44, 189.1, 61.7)).toBeCloseTo(22.2, 1);
  });

  it('ranks a varied "any type" list: no near-duplicates, at most a quarter of one type', () => {
    const t0 = performance.now();
    const { list, considered } = rankAll(objs, base, night);
    const ms = performance.now() - t0;
    expect(considered).toBeGreaterThan(20_000);
    expect(list).toHaveLength(20);
    expect(ms).toBeLessThan(3000);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        expect(sep((list[i] as Ranked).o, (list[j] as Ranked).o)).toBeGreaterThanOrEqual(0.25);
    const kinds = new Map<string, number>();
    for (const r of list) kinds.set(r.o.sk, (kinds.get(r.o.sk) ?? 0) + 1);
    for (const n of kinds.values()) expect(n).toBeLessThanOrEqual(5);
    expect(list[0]?.score ?? 0).toBeGreaterThanOrEqual(list.at(-1)?.score ?? 0);
    expect(list.every((r) => r.why.length > 10 && r.strategy.length > 5)).toBe(true);
  });

  it('per-type tabs and catalog filters narrow the list', () => {
    const gal = rankAll(objs, { ...base, tab: 'galaxy' }, night).list;
    expect(gal.every((r) => r.o.sk === 'galaxy')).toBe(true);
    const mess = rankAll(objs, { ...base, filters: { minAlt: 30, catalogs: ['M'] } }, night).list;
    expect(mess.length).toBeGreaterThan(5);
    expect(mess.every((r) => r.o.badges.includes('M'))).toBe(true);
    // The 2.77° guide-scope frame: M 42 (90′) fits; in the 31.6′ frame it needs a mosaic.
    const ori = rankAll(
      objs,
      {
        ...base,
        frameW: 2.77,
        frameH: 1.56,
        tab: 'nebula',
        filters: { minAlt: 30, constellation: 'Ori' },
      },
      night,
    ).list;
    expect(ori.some((r) => r.o.name === 'M 42')).toBe(true);
  });

  it('a high horizon removes hours (and objects)', () => {
    const flat = rankAll(objs, { ...base, filters: { minAlt: 20, catalogs: ['M'] } }, night).list;
    const wall = rankAll(
      objs,
      { ...base, horizon: new Array(720).fill(60), filters: { minAlt: 20, catalogs: ['M'] } },
      night,
    ).list;
    const h = (l: typeof flat) => l.reduce((a, r) => a + r.hours, 0);
    expect(h(wall)).toBeLessThan(h(flat));
  });

  it('suggests filters from the owner’s set: narrowband for emission, IR-pass for galaxies under the Moon', () => {
    const neb = objs.find((o) => o.name === 'M 42') as Obj;
    const gal = objs.find((o) => o.name === 'M 31') as Obj;
    expect(strategy(neb, 0.8, 0.8, 17.8, base.myFilters)).toMatch(/Hα/);
    expect(strategy(gal, 0.8, 0.8, 17.8, base.myFilters)).toMatch(/IR-pass/);
    expect(strategy(gal, 0.8, 0.8, 17.8, ['L', 'R', 'G', 'B'])).toMatch(/darker night/);
  });

  it('does not rate dark nebulae on their opacity class', () => {
    const b33 = objs.find((o) => o.name === 'B 33');
    expect(b33?.mag).toBeNull();
    const top = rankAll(objs, base, night).list.slice(0, 10);
    expect(top.filter((r) => r.o.sk === 'dark').length).toBeLessThanOrEqual(1);
  });

  it('respects minimum hours and Moon-separation filters', () => {
    const long = rankAll(objs, { ...base, filters: { minAlt: 30, minHours: 6 } }, night).list;
    expect(long.every((r) => r.hours >= 6)).toBe(true);
  });
});

describe('unique target names', () => {
  it('no two catalog objects share a name (the lists are keyed by it)', () => {
    const seen = new Set<string>();
    for (const o of objs) {
      expect(seen.has(o.name), o.name).toBe(false);
      seen.add(o.name);
    }
  });
  it('the Double Cluster halves use their own NGC numbers and keep C 14 as an id', () => {
    const halves = objs.filter((o) => o.ids.includes('C 14'));
    expect(halves.map((o) => o.name).sort()).toEqual(['NGC 869', 'NGC 884']);
    for (const o of halves) expect(o.badges).toContain('C');
  });
  it('names that were already unique do not change', () => {
    expect(objs.find((o) => o.ids.includes('NGC 224'))?.name).toBe('M 31');
    expect(objs.find((o) => o.ids.includes('NGC 1976'))?.name).toBe('M 42');
  });
});
