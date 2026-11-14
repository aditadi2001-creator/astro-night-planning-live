import { describe, expect, it } from 'vitest';
import {
  DEM_MAX_SLICE,
  dispatchRequest,
  workflowForCron,
  hipsToTile,
  parse7timer,
  parseDem,
  parseDemSlice,
  parseHips,
  parseTile,
} from '../worker/src/routes';

describe('worker routes are strict allow-lists', () => {
  it('parses tile URLs and rejects anything else', () => {
    expect(parseTile('/tiles/lightpollution-2025/7/64/42.webp')).toEqual({
      dataset: { kind: 'lightpollution', year: 2025 },
      z: 7,
      x: 64,
      y: 42,
    });
    expect(parseTile('/tiles/clouds-2026111214/3/1/2.webp')?.dataset).toEqual({
      kind: 'clouds',
      hour: '2026111214',
    });
    expect(parseTile('/tiles/lprad-2025/6/40/22.webp')).toEqual({
      dataset: { kind: 'lprad', year: 2025 },
      z: 6,
      x: 40,
      y: 22,
    });
    expect(parseTile('/tiles/clouds-2026111214/3/8/2.webp')).toBeNull(); // x out of range
    expect(parseTile('/tiles/../secret/1/1/1.webp')).toBeNull();
    expect(parseTile('/tiles/anything-else/1/0/0.webp')).toBeNull();
  });

  it('parses HiPS star tiles and checks the Dir folder', () => {
    expect(parseHips('/hips/gaia/properties')).toEqual({ layer: 'gaia', kind: 'properties' });
    expect(parseHips('/hips/gaia16/properties')).toEqual({ layer: 'gaia16', kind: 'properties' });
    expect(parseHips('/hips/other/properties')).toBeNull();
    expect(parseHips('/hips/gaia/Norder6/Dir10000/Npix12345.eph')).toEqual({
      layer: 'gaia',
      kind: 'tile',
      order: 6,
      pix: 12345,
    });
    expect(parseHips('/hips/gaia/Norder6/Dir0/Npix12345.eph')).toBeNull(); // wrong Dir
    expect(parseHips('/hips/gaia/Norder0/Dir0/Npix12.eph')).toBeNull(); // order 0 has 12 pixels
    expect(parseHips('/hips/gaia/Norder5/Dir10000/Npix12345.eph')).toBeNull(); // order 5 has 12,288
  });

  it('maps HEALPix pixels into unique PMTiles z/x/y slots', () => {
    const seen = new Set<string>();
    for (const order of [0, 1, 2]) {
      for (let pix = 0; pix < 12 * 4 ** order; pix++) {
        const { z, x, y } = hipsToTile(order, pix);
        expect(x).toBeLessThan(2 ** z);
        expect(y).toBeLessThan(2 ** z);
        seen.add(`${z}/${x}/${y}`);
      }
    }
    expect(seen.size).toBe(12 + 48 + 192);
  });

  it('only proxies Copernicus DEM tile names', () => {
    const n = 'Copernicus_DSM_COG_10_N42_00_E000_00_DEM';
    expect(parseDem(`/dem/${n}/${n}.tif`)).toBe(n);
    expect(parseDem(`/dem/${n}/other.tif`)).toBeNull();
    expect(parseDem('/dem/../../etc/passwd')).toBeNull();
  });

  it('reads DEM byte slices from ?r= and caps them at 4 MiB', () => {
    expect(parseDemSlice('?r=0-65535')).toEqual({ start: 0, end: 65535 });
    expect(parseDemSlice(`?r=10-${10 + DEM_MAX_SLICE - 1}`)).not.toBeNull();
    expect(parseDemSlice(`?r=10-${10 + DEM_MAX_SLICE}`)).toBeNull();
    expect(parseDemSlice('')).toBeNull();
    expect(parseDemSlice('?r=5-4')).toBeNull();
    expect(parseDemSlice('?r=0-')).toBeNull();
    expect(parseDemSlice('?r=0-10,20-30')).toBeNull();
  });

  it('only proxies 7Timer with sane coordinates', () => {
    expect(parse7timer('/7timer/42.9/0.1')).toEqual({ lat: '42.9', lon: '0.1' });
    expect(parse7timer('/7timer/-33.9/151.2')).toEqual({ lat: '-33.9', lon: '151.2' });
    expect(parse7timer('/7timer/95/0')).toBeNull();
    expect(parse7timer('/7timer/1/2?x=evil')).toBeNull();
  });

  it('maps the Worker cron to the cloud workflow and builds the dispatch call', () => {
    expect(workflowForCron('47 * * * *')).toBe('clouds-hourly.yml');
    expect(workflowForCron('0 0 * * *')).toBeNull();
    const [url, init] = dispatchRequest('clouds-hourly.yml', 'tok');
    expect(url).toBe(
      'https://api.github.com/repos/aditadi2001-creator/astro-night-planning-live/actions/workflows/clouds-hourly.yml/dispatches',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
