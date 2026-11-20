#!/usr/bin/env node
/**
 * Astro Night Planning — telescope bridge (AGPL-3.0, no dependencies, Node 18+).
 *
 * Runs on the computer next to the telescope (the NINA mini PC). It serves the built app and
 * forwards an allow-list of telescope requests on the SAME origin, so any browser (Safari and
 * iPhone included) can show the live telescope without mixed-content or CORS problems.
 *
 *   node tools/bridge/bridge.mjs --dist dist                      # read-only (default)
 *   node tools/bridge/bridge.mjs --dist dist --allow-control      # also slew / sync / stop
 *
 * Options: --port 8080  --dist <folder>  --nina 127.0.0.1:1888  --alpaca 127.0.0.1:11111
 *          --host 0.0.0.0 (listen address)  --allow-control
 * Never forward this port to the internet: NINA's API has no password.
 */
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Same lists as src/lib/telescope/allow.ts (tests/telescope.test.ts checks they agree).
export const NINA_READ = [
  '/version',
  '/equipment/mount/info',
  '/equipment/rotator/info',
  '/sequence/json',
  '/sequence/list-available',
];
export const NINA_CONTROL = [
  '/equipment/mount/slew',
  '/equipment/mount/slew/stop',
  '/equipment/mount/sync',
  '/equipment/mount/park',
  '/equipment/mount/unpark',
  '/equipment/mount/tracking',
  '/sequence/set-target',
  '/sequence/load',
  '/framing/set-coordinates',
  '/framing/set-rotation',
];
export const ALPACA_READ = [
  'connected',
  'devicestate',
  'rightascension',
  'declination',
  'altitude',
  'azimuth',
  'sideofpier',
  'tracking',
  'slewing',
  'atpark',
  'siderealtime',
  'equatorialsystem',
];
export const ALPACA_CONTROL = [
  'slewtocoordinatesasync',
  'synctocoordinates',
  'abortslew',
  'park',
  'unpark',
  'tracking',
];

/**
 * Where a request goes, or null when it is not allowed.
 * "/nina/equipment/mount/info" → { target: 'nina', path: '/v2/api/equipment/mount/info' }
 * "/alpaca/telescope/0/declination" → { target: 'alpaca', path: '/api/v1/telescope/0/declination' }
 */
export function route(method, url, allowControl) {
  const [path, query = ''] = url.split('?');
  const q = query ? `?${query}` : '';
  if (path.startsWith('/nina/')) {
    const p = path.slice(5);
    const read = NINA_READ.includes(p) && method === 'GET';
    const ctl = allowControl && NINA_CONTROL.includes(p) && method === 'GET';
    return read || ctl ? { target: 'nina', path: `/v2/api${p}${q}` } : null;
  }
  const m = /^\/alpaca\/telescope\/(\d{1,2})\/([a-z]+)$/.exec(path);
  if (m) {
    const name = m[2];
    const read = ALPACA_READ.includes(name) && method === 'GET';
    const ctl = allowControl && ALPACA_CONTROL.includes(name) && method === 'PUT';
    return read || ctl ? { target: 'alpaca', path: `/api/v1/telescope/${m[1]}/${name}${q}` } : null;
  }
  return null;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function parseArgs(argv) {
  const o = {
    port: 8080,
    host: '0.0.0.0',
    dist: 'dist',
    nina: '127.0.0.1:1888',
    alpaca: '127.0.0.1:11111',
    allowControl: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-control') o.allowControl = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--dist') o.dist = argv[++i];
    else if (a === '--nina') o.nina = argv[++i];
    else if (a === '--alpaca') o.alpaca = argv[++i];
  }
  return o;
}

function forward(req, res, hostPort, path) {
  const [hostname, port] = hostPort.split(':');
  const up = request(
    {
      hostname,
      port: Number(port),
      path,
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      timeout: 5000,
    },
    (r) => {
      res.writeHead(r.statusCode ?? 502, {
        'content-type': r.headers['content-type'] ?? 'application/json',
        'cache-control': 'no-store',
      });
      r.pipe(res);
    },
  );
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({
        Success: false,
        Error: `bridge could not reach ${hostPort}: ${e.message}`,
        ErrorNumber: 1031,
        ErrorMessage: `bridge could not reach ${hostPort}`,
      }),
    );
  });
  req.pipe(up);
}

async function serveStatic(res, root, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  let file = resolve(root, rel);
  // Stay inside the app folder ("../dist-other" must not pass a plain prefix check).
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html'); // single-page app
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

export function start(opts) {
  const root = resolve(opts.dist);
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/bridge.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ bridge: 1, control: opts.allowControl }));
      return;
    }
    if (url.startsWith('/nina/') || url.startsWith('/alpaca/')) {
      const r = route(req.method ?? 'GET', url, opts.allowControl);
      if (!r) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            Success: false,
            Error: 'not on the bridge allow-list',
            ErrorNumber: 1036,
            ErrorMessage: 'not on the bridge allow-list',
          }),
        );
        return;
      }
      forward(req, res, r.target === 'nina' ? opts.nina : opts.alpaca, r.path);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    void serveStatic(res, root, url);
  });
  server.listen(opts.port, opts.host, () => {
    console.log(
      `Astro Night Planning bridge on http://${opts.host === '0.0.0.0' ? '<this-computer>' : opts.host}:${opts.port}`,
    );
    console.log(
      `  NINA ${opts.nina} · Alpaca ${opts.alpaca} · control ${opts.allowControl ? 'ALLOWED' : 'off (read-only)'}`,
    );
    console.log('  Do not forward this port to the internet.');
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  start(parseArgs(process.argv.slice(2)));
