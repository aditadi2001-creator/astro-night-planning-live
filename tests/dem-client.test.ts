import { afterEach, describe, expect, it, vi } from 'vitest';
import { SliceClient } from '../src/lib/sky/dem';

afterEach(() => vi.unstubAllGlobals());

describe('DEM slice client', () => {
  it('puts the range in the URL and presents the Worker 200 as a 206', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'X-File-Size': '30000000' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new SliceClient('https://w.example/dem/T/T.tif').request({
      headers: { Range: 'bytes=100-103' },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://w.example/dem/T/T.tif?r=100-103', {
      signal: null,
    });
    expect(res.status).toBe(206);
    expect(res.getHeader('content-range')).toBe('bytes 100-103/30000000');
    expect(new Uint8Array(await res.getData())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('passes real 206 responses (dev proxy) and errors through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('xx', { status: 206, headers: { 'Content-Range': 'bytes 0-1/99' } }),
      ),
    );
    const c = new SliceClient('/dem/T/T.tif');
    const res = await c.request({ headers: { Range: 'bytes=0-1' } });
    expect(res.status).toBe(206);
    expect(res.getHeader('Content-Range')).toBe('bytes 0-1/99');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 404 })),
    );
    expect((await c.request({ headers: { Range: 'bytes=0-1' } })).ok).toBe(false);
    await expect(c.request({ headers: { Range: 'bytes=0-1,5-6' } })).rejects.toThrow();
  });
});
