/**
 * Requests to a telescope on the local network. These are live device readings, so they bypass
 * the data cache (src/lib/data/cache.ts) by design: there is exactly one poll loop and nothing
 * to share or reuse (DECISIONS D36). Chrome 142+ needs `targetAddressSpace: 'local'` to let an
 * HTTPS page reach a LAN address after its permission prompt.
 */
import { TelescopeError } from './types';

export function sameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

export async function localFetch(
  url: string,
  init: RequestInit = {},
  where: string,
  signal?: AbortSignal,
  timeoutMs = 4000,
  /** What to check when the device does not answer at all. */
  offlineHint = 'Check the address and port, and that the program allows connections from other devices.',
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const opts: RequestInit & { targetAddressSpace?: string } = {
      ...init,
      signal: ctrl.signal,
      cache: 'no-store',
    };
    if (!sameOrigin(url)) opts.targetAddressSpace = 'local';
    const r = await fetch(url, opts);
    if (!r.ok && r.status !== 400 && r.status !== 409) {
      // The bridge (and NINA) explain failures in JSON: show that rather than a bare status.
      const body = (await r.json().catch(() => null)) as { Error?: string } | null;
      throw new TelescopeError(
        body?.Error ? `${where}: ${body.Error}.` : `${where} answered HTTP ${r.status}.`,
        r.status === 502 ? offlineHint : 'Check the address and port.',
      );
    }
    return r;
  } catch (e) {
    if (e instanceof TelescopeError) throw e;
    if (signal?.aborted) throw e;
    if (ctrl.signal.aborted)
      throw new TelescopeError(
        `${where} did not answer within ${timeoutMs / 1000} s.`,
        'Is the program running and the computer on the same network?',
      );
    const mixed = location.protocol === 'https:' && url.startsWith('http:');
    throw new TelescopeError(
      `Could not reach ${where}.`,
      mixed
        ? 'This browser may block a secure page from talking to your local network. Allow the "local network" prompt (Chrome, Edge), or open the app through the bridge on your mini PC (see "How to connect").'
        : offlineHint,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
