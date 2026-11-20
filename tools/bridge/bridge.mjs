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
 *   node tools/bridge/bridge.mjs --dist dist --indi 127.0.0.1:7624   # an INDI server (Linux, Pi)
 *   node tools/bridge/bridge.mjs --dist dist --tcp 192.168.4.1:4030 --tcp-protocol lx200
 *                                              # a Wi-Fi / Ethernet mount (ZWO AM5, OnStep…)
 *
 * Options: --port 8080  --dist <folder>  --nina 127.0.0.1:1888  --alpaca 127.0.0.1:11111
 *          --indi host:7624  --tcp host:port  --tcp-protocol lx200|nexstar
 *          --host 0.0.0.0 (listen address)  --allow-control
 * Never forward this port to the internet: NINA's API has no password.
 */
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IndiClient, INDI_CONTROL, serialAllowed, TcpLink } from './mounts.mjs';

export { INDI_CONTROL, SERIAL_CONTROL, SERIAL_READ } from './mounts.mjs';

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
    indi: null,
    tcp: null,
    tcpProtocol: 'lx200',
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
    else if (a === '--indi') o.indi = argv[++i];
    else if (a === '--tcp') o.tcp = argv[++i];
    else if (a === '--tcp-protocol') o.tcpProtocol = argv[++i] === 'nexstar' ? 'nexstar' : 'lx200';
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

/**
 * Pages allowed to call the bridge from another origin (the published app and local
 * development). Any other website gets no CORS headers, so it cannot drive the mount.
 */
export const ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?astro-night-planning-live\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1):(5173|4173)$/,
];
export function corsOrigin(origin) {
  return origin && ORIGINS.some((r) => r.test(origin)) ? origin : null;
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let b = '';
    req.on('data', (d) => {
      b += d;
      if (b.length > 4096) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(b || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function start(opts) {
  const root = resolve(opts.dist);
  const hp = (s) => {
    const i = s.lastIndexOf(':');
    return [s.slice(0, i), Number(s.slice(i + 1))];
  };
  const tcp = opts.tcp ? new TcpLink(...hp(opts.tcp)) : null;
  const indi = opts.indi ? new IndiClient(...hp(opts.indi)) : null;
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    const allowed = corsOrigin(req.headers.origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', allowed);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      // Chrome's private/local network access preflight.
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403).end();
      return;
    }
    if (url === '/bridge.json') {
      json(res, 200, {
        bridge: 2,
        control: opts.allowControl,
        tcp: tcp ? opts.tcpProtocol : null,
        indi: !!indi,
      });
      return;
    }
    // Wi-Fi / Ethernet mount: one LX200 or NexStar command per request.
    if (url === '/mount/tcp' && req.method === 'POST') {
      if (!tcp) return json(res, 404, { error: 'start the bridge with --tcp host:port' });
      void readBody(req)
        .then(async (b) => {
          const cmd = String(b.cmd ?? '');
          if (!serialAllowed(opts.tcpProtocol, cmd, opts.allowControl))
            return json(res, 403, { error: 'not on the bridge allow-list' });
          const reply = await tcp.send(cmd, {
            chars: Number.isInteger(b.chars) ? b.chars : undefined,
            none: b.none === true,
          });
          json(res, 200, { reply });
        })
        .catch((e) => json(res, 502, { error: `mount: ${e.message}` }));
      return;
    }
    // INDI: the latest properties, and change requests for the allow-listed ones.
    if (url === '/mount/indi' && req.method === 'GET') {
      if (!indi) return json(res, 404, { error: 'start the bridge with --indi host:7624' });
      return json(res, 200, indi.snapshot());
    }
    if (url === '/mount/indi' && req.method === 'POST') {
      if (!indi) return json(res, 404, { error: 'start the bridge with --indi host:7624' });
      void readBody(req)
        .then((b) => {
          const kind = b.kind === 'Number' ? 'Number' : 'Switch';
          if (!opts.allowControl || !INDI_CONTROL.includes(b.name))
            return json(res, 403, { error: 'not on the bridge allow-list' });
          indi.send(String(b.device), String(b.name), kind, b.values ?? {});
          json(res, 200, { ok: true });
        })
        .catch((e) => json(res, 502, { error: `indi: ${e.message}` }));
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
      `  NINA ${opts.nina} · Alpaca ${opts.alpaca}${opts.indi ? ` · INDI ${opts.indi}` : ''}${opts.tcp ? ` · ${opts.tcpProtocol} mount ${opts.tcp}` : ''} · control ${opts.allowControl ? 'ALLOWED' : 'off (read-only)'}`,
    );
    console.log('  Do not forward this port to the internet.');
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  start(parseArgs(process.argv.slice(2)));
