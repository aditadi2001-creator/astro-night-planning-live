import template from '../src/pwa/sw-template.js?raw';
import { describe, expect, it } from 'vitest';

// Runs the real service-worker template against fake caches and network. Pages answers a path
// it does not know yet (moments after a deploy) with the HTML page and status 200; the worker
// must never keep that as a script, or the site stays blank until the next deploy.
type Handler = (e: {
  request?: Request;
  waitUntil(p: Promise<unknown>): void;
  respondWith?(p: Promise<Response>): void;
}) => void;

function load(precache: string[], answer: (url: string) => Response) {
  const store = new Map<string, Response>();
  const handlers: Record<string, Handler> = {};
  const cache = {
    put: async (k: string | Request, r: Response) =>
      void store.set(typeof k === 'string' ? new URL(k, 'https://x.test').href : k.url, r),
    match: async (k: string | Request) =>
      store.get(typeof k === 'string' ? new URL(k, 'https://x.test').href : k.url)?.clone(),
    delete: async (k: string | Request) => store.delete(typeof k === 'string' ? k : k.url),
  };
  const self = {
    location: { origin: 'https://x.test' },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fakeFetch = async (r: string | Request) =>
    answer(typeof r === 'string' ? new URL(r, 'https://x.test').href : r.url);
  const src = template.replace('/* __PRECACHE__ */ []', JSON.stringify(precache));
  new Function('self', 'caches', 'fetch', src)(
    self,
    { open: async () => cache, keys: async () => [] },
    fakeFetch,
  );
  const install = () =>
    new Promise<unknown>((res, rej) =>
      (handlers.install as Handler)({ waitUntil: (p) => void p.then(res, rej) }),
    );
  const get = (url: string) =>
    new Promise<Response>((res) =>
      (handlers.fetch as Handler)({
        request: new Request(url),
        waitUntil: () => undefined,
        respondWith: (p) => void p.then(res),
      }),
    );
  return { store, install, get };
}

const html = () =>
  new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
const js = () =>
  new Response('export {}', { headers: { 'content-type': 'application/javascript' } });

describe('service worker never stores the HTML page as a script', () => {
  it('install fails (old version keeps running) when a script comes back as HTML', async () => {
    const sw = load(['/', '/assets/index-a.js'], (u) => (u.endsWith('.js') ? html() : html()));
    await expect(sw.install()).rejects.toThrow(/precache/);
  });

  it('install keeps the page and the real scripts', async () => {
    const sw = load(['/', '/assets/index-a.js'], (u) => (u.endsWith('.js') ? js() : html()));
    await sw.install();
    expect(sw.store.size).toBe(2);
  });

  it('a lazily loaded chunk answered with HTML is passed on but not kept; a stored one heals', async () => {
    let deployed = false;
    const sw = load([], () => (deployed ? js() : html()));
    await sw.get('https://x.test/assets/chunk-b.js');
    expect(sw.store.size).toBe(0);
    sw.store.set('https://x.test/assets/chunk-b.js', html());
    deployed = true;
    const r = await sw.get('https://x.test/assets/chunk-b.js');
    expect(r.headers.get('content-type')).toBe('application/javascript');
    // The HTML copy is gone (a test Response is not same-origin "basic", so it is not re-stored).
    expect(sw.store.has('https://x.test/assets/chunk-b.js')).toBe(false);
  });
});
