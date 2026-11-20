import { describe, expect, it } from 'vitest';
import { FAMOUS_SDSS, parseSdssName, sdssFromRow, tilesAround } from '../src/lib/search/sdss';
import { famousSdssEntries, search } from '../src/lib/search/index';

describe('SDSS names', () => {
  it('reads the J2000 position from a full SDSS name', () => {
    const n = parseSdssName('SDSS J103843.59+484917.7');
    expect(n?.exact).toBe(true);
    expect(n?.ra).toBeCloseTo(159.681625, 5);
    expect(n?.dec).toBeCloseTo(48.821583, 5);
    expect(parseSdssName('sdss j224024.1-092748')?.dec).toBeCloseTo(-9.4633, 4);
    expect(parseSdssName('J103843.59+484917.7')?.name).toBe('SDSS J103843.59+484917.7');
  });
  it('turns a short name into a search area and the parts to match', () => {
    const n = parseSdssName('SDSS J1038+4849');
    expect(n?.exact).toBe(false);
    expect(n?.prefix).toBe('SDSS J1038');
    expect(n?.decPart).toBe('+4849');
    expect(n?.ra).toBeCloseTo(159.625, 3);
    expect(parseSdssName('M 31')).toBeNull();
    expect(parseSdssName('sdss')).toBeNull();
  });
  it('famous SDSS objects sit where their names say', () => {
    for (const f of FAMOUS_SDSS) {
      const n = parseSdssName(f.name);
      expect(n?.ra).toBeCloseTo(f.ra, 3);
      expect(n?.dec).toBeCloseTo(f.dec, 3);
    }
  });
  it('finds the smiley lens and others by nickname', () => {
    const e = famousSdssEntries(FAMOUS_SDSS);
    expect(search(e, 'smiley', 3)[0]?.entry.label).toMatch(/SDSS J103843\.59\+484917\.7/);
    expect(search(e, 'cheshire cat', 3)[0]?.entry.label).toMatch(/Cheshire/);
    expect(search(e, "hanny's voorwerp", 3)[0]?.entry.label).toMatch(/Voorwerp/);
    expect(search(e, 'sdss', 10)).toHaveLength(FAMOUS_SDSS.length);
  });
});

describe('installed SDSS tiles', () => {
  it('turns a tile row into an SDSS object (radians → degrees, redshift from "z=")', () => {
    const D = Math.PI / 180;
    const o = sdssFromRow({
      type: 'G',
      vmag: 18.7,
      ra: 159.68163 * D,
      de: 48.82158 * D,
      smax: (0.1 / 60) * D,
      morp: 'z=0.426',
      ids: 'SDSS J103843.59+484917.7',
    });
    expect(o?.name).toBe('SDSS J103843.59+484917.7');
    expect(o?.ra).toBeCloseTo(159.68163, 4);
    expect(o?.z).toBeCloseTo(0.426, 3);
    expect(o?.sizeArcmin).toBeCloseTo(0.1, 4);
    expect(sdssFromRow({ ids: 'NGC 3031|M 81', ra: 0, de: 0 })).toBeNull();
    // NGC galaxies that also have an SDSS name keep their other names.
    expect(
      sdssFromRow({ ids: 'NGC 3310|PGC 031650|SDSS J103845.85+533012.1', ra: 0, de: 0 })?.others,
    ).toEqual(['NGC 3310', 'PGC 031650']);
  });
  it('reads every order down to 7, a few pixels at the deep ones', () => {
    const t = tilesAround(159.68, 48.82, 0.3);
    expect(new Set(t.map((x) => x.order))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(t.filter((x) => x.order < 4)).toHaveLength(4);
    expect(t.length).toBeLessThanOrEqual(24);
  });
});

describe('installed SDSS descent', () => {
  it('asks for deeper tiles only under a full one (no requests for missing tiles)', async () => {
    const asked: string[] = [];
    const fake = ((url: string) => {
      asked.push(url);
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as unknown as typeof fetch;
    const { sdssInstalledAround } = await import('../src/lib/search/sdss');
    const r = await sdssInstalledAround('https://x/hips/dso2', 159.68, 48.82, 0.3, 300, fake);
    expect(r).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/Norder0\/Dir0\/Npix\d+\.eph$/);
  });
});
