import { describe, expect, it } from 'vitest';
import coreRaw from '../public/catalog/dso-core-v1.json?raw';
import starsRaw from '../public/catalog/stars-v1.json?raw';
import notableRaw from '../public/catalog/notable-v1.json?raw';
import manifestRaw from '../public/catalog/manifest-v1.json?raw';
import {
  browse,
  catalogEntries,
  dsoEntries,
  editDistance,
  norm,
  notableEntries,
  search,
  solarSystemEntries,
  starEntries,
  surveyEntries,
  type Entry,
} from '../src/lib/search/index';
import { SURVEYS } from '../src/lib/sky/surveys';

const manifest = JSON.parse(manifestRaw) as { catalogs: Record<string, number> };
const entries: Entry[] = [
  ...solarSystemEntries(),
  ...catalogEntries(manifest.catalogs),
  ...surveyEntries(SURVEYS),
  ...dsoEntries(JSON.parse(coreRaw)),
  ...starEntries(JSON.parse(starsRaw)),
  ...notableEntries(JSON.parse(notableRaw)),
];
const top = (q: string) => search(entries, q)[0]?.entry;

describe('normalisation', () => {
  it('treats spacing, Greek letters and catalog spellings alike', () => {
    expect(norm('M 31')).toBe('m31');
    expect(norm('Messier 31')).toBe('m31');
    expect(norm('Sh 2-129')).toBe(norm('Sh2-129'));
    expect(norm('α Lyr')).toBe('alflyr');
    expect(norm('alpha Lyr')).toBe('alflyr');
    expect(norm('Caldwell 20')).toBe('c20');
    expect(norm('messier')).toBe('messier');
  });
  it('edit distance stops early', () => {
    expect(editDistance('andromda', 'andromeda')).toBe(1);
    expect(editDistance('orion', 'cygnus')).toBe(2);
  });
});

describe('unified search', () => {
  it.each([
    ['M31', 'M 31'],
    ['m 31', 'M 31'],
    ['NGC 224', 'M 31'],
    ['ngc224', 'M 31'],
    ['Andromeda Galaxy', 'M 31'],
    ['north america', 'C 20'],
    ['Sh2-129', 'Sh 2-129'],
    ['Caldwell 14', 'C 14'],
  ])('%s → %s', (q, label) => {
    expect(top(q)?.label.startsWith(label)).toBe(true);
  });

  it('ranks both objects named Horsehead Nebula (B 33, IC 434) above the Blue Horsehead', () => {
    const labels = search(entries, 'Horsehead')
      .slice(0, 3)
      .map((h) => h.entry.label);
    expect(labels.slice(0, 2).sort()).toEqual([
      'B 33 · Horsehead Nebula',
      'IC 434 · Horsehead Nebula',
    ]);
    expect(labels[2]).toContain('Blue Horsehead');
  });

  it('cross-identifies M 31 = NGC 224 = Andromeda Galaxy in one entry', () => {
    const e = top('M31');
    expect(e?.ids).toEqual(expect.arrayContaining(['m31', 'ngc224', 'ugc454', 'pgc2557']));
    expect(e?.label).toContain('Andromeda Galaxy');
  });

  it('finds stars by name, Bayer letter (Greek or Latin) and HIP', () => {
    expect(top('Vega')?.engineId).toBe('HIP 91262');
    expect(top('alf Lyr')?.engineId).toBe('HIP 91262');
    expect(top('α Lyr')?.engineId).toBe('HIP 91262');
    expect(top('HIP 91262')?.label).toBe('Vega');
  });

  it('finds planets, catalogs and surveys', () => {
    expect(top('Saturn')?.kind).toBe('planet');
    expect(top('messier')?.kind).toBe('catalog');
    expect(top('herschel 400')?.ref).toBe('H400');
    expect(search(entries, '2MASS').some((h) => h.entry.kind === 'survey')).toBe(true);
    expect(search(entries, 'radio').some((h) => h.entry.kind === 'survey')).toBe(true);
  });

  it('finds curated notable objects resolved by Sesame', () => {
    expect(top('3C 273')?.kind).toBe('notable');
    expect(top('Albireo')).toBeDefined();
  });

  it('tolerates one typo in a name', () => {
    expect(search(entries, 'andromda galaxy').some((h) => h.entry.label.startsWith('M 31'))).toBe(
      true,
    );
  });

  it('lists the 110 Messier objects in order when browsing the catalog', () => {
    const m = browse(entries, 'M');
    expect(m.length).toBe(110);
    expect(m[0]?.label.startsWith('M 1 ')).toBe(true);
    expect(m.at(-1)?.label.startsWith('M 110')).toBe(true);
  });

  it('answers in under 100 ms over the whole core index', () => {
    expect(entries.length).toBeGreaterThan(30_000);
    const t0 = performance.now();
    for (const q of ['m31', 'orion neb', 'ngc 70', 'vega', 'sh2', 'andromda']) search(entries, q);
    const per = (performance.now() - t0) / 6;
    expect(per).toBeLessThan(100);
  });
});
