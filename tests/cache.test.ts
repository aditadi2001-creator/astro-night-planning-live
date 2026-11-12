import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, roundCoord } from '../src/lib/data/cache';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('fetchJson', () => {
  it('serves fresh data from cache without a second request', async () => {
    const f = vi.fn(() => ok({ v: 1 }));
    vi.stubGlobal('fetch', f);
    await fetchJson('k1', 'https://example.test/a', { maxAgeMs: 60_000 });
    const again = await fetchJson<{ v: number }>('k1', 'https://example.test/a', {
      maxAgeMs: 60_000,
    });
    expect(again.data.v).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last good copy, marked stale, when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok({ v: 2 })),
    );
    const first = await fetchJson('k2', 'https://example.test/b', { maxAgeMs: 60_000 });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    // maxAge 0 forces a refresh attempt; retries 0 keeps the test fast.
    const r = await fetchJson<{ v: number }>('k2', 'https://example.test/b', {
      maxAgeMs: 0,
      retries: 0,
    });
    expect(r.stale).toBe(true);
    expect(r.data.v).toBe(2);
    expect(r.fetchedAt).toBe(first.fetchedAt);
    expect(r.error).toMatch(/Failed to fetch/);
  });

  it('throws when there is nothing cached and the source fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))),
    );
    await expect(
      fetchJson('k3', 'https://example.test/c', { maxAgeMs: 0, retries: 0 }),
    ).rejects.toThrow(/503/);
  });

  it('does not retry client errors (except 429)', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('bad', { status: 400 })));
    vi.stubGlobal('fetch', f);
    await expect(
      fetchJson('k4', 'https://example.test/d', { maxAgeMs: 0, retries: 3 }),
    ).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rounds coordinates to ~1 km for shared caches and privacy', () => {
    expect(roundCoord(51.47691)).toBe(51.48);
    expect(roundCoord(-0.0005)).toBe(-0);
  });
});
