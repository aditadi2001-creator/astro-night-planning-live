#!/usr/bin/env node
/**
 * npm run check:budget — the data-budget gate (CLAUDE.md constraints 2–3, DATA_BUDGET.md).
 *
 * Fails (exit 1) when:
 *   - any shipped file in dist/ is over 20 MiB (Cloudflare Pages hard limit: 25 MiB),
 *   - dist/ has more than 15,000 files (Pages limit: 20,000 per deployment),
 *   - shipped static data (skydata/ + catalog/) exceeds its budget,
 *   - the initial JavaScript of the page (entry + modulepreloads, gzipped) exceeds 250 KB,
 *   - browser code (src/) contains anything that writes to or lists R2,
 *   - a recorded Worker request count (budget/requests.json) exceeds its fail limit.
 * Prints all numbers. Run after `npm run build`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const MiB = 1024 * 1024;
const LIMITS = {
  fileBytes: 20 * MiB,
  files: 15_000,
  staticDataBytes: 40 * MiB,
  initialJsGzip: 250 * 1024,
};

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`  FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg) => console.log(`  warn  ${msg}`);
const fmt = (b) => (b >= MiB ? `${(b / MiB).toFixed(2)} MiB` : `${(b / 1024).toFixed(1)} KiB`);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, size: st.size });
  }
  return out;
}

// ---- 1. shipped files ---------------------------------------------------------------
console.log('Static assets (dist/)');
if (!existsSync(DIST)) {
  fail('dist/ not found: run `npm run build` first');
} else {
  const files = walk(DIST);
  const shipped = files.filter((f) => !f.path.endsWith('.map'));
  const total = shipped.reduce((a, f) => a + f.size, 0);
  const biggest = shipped.reduce((a, f) => (f.size > a.size ? f : a), { path: '', size: 0 });
  const rel = (p) => relative(DIST, p).split(sep).join('/');
  (files.length > LIMITS.files ? fail : ok)(
    `${files.length} files (limit ${LIMITS.files}; Pages allows 20,000)`,
  );
  ok(`${fmt(total)} shipped (source maps excluded)`);
  (biggest.size > LIMITS.fileBytes ? fail : ok)(
    `largest file ${rel(biggest.path)} ${fmt(biggest.size)} (limit ${fmt(LIMITS.fileBytes)})`,
  );
  const data = shipped.filter((f) => /^(skydata|catalog)\//.test(rel(f.path)));
  const dataBytes = data.reduce((a, f) => a + f.size, 0);
  (dataBytes > LIMITS.staticDataBytes ? fail : ok)(
    `static data ${fmt(dataBytes)} in ${data.length} files (budget ${fmt(LIMITS.staticDataBytes)})`,
  );

  // Initial JS: the entry module and everything it modulepreloads.
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const srcs = [
    ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  ].map((m) => m[1]);
  let gz = 0;
  for (const s of new Set(srcs)) {
    const p = join(DIST, s.replace(/^\//, ''));
    if (existsSync(p)) gz += gzipSync(readFileSync(p)).length;
  }
  (gz > LIMITS.initialJsGzip ? fail : ok)(
    `initial JS ${fmt(gz)} gzipped (budget ${fmt(LIMITS.initialJsGzip)})`,
  );
}

// ---- 2. no R2 writes or listings from browser code -------------------------------------
console.log('Browser code never writes to or lists R2 (src/)');
const FORBIDDEN = [
  /ListObjects/,
  /PutObject/,
  /DeleteObject/,
  /list-type=2/,
  /r2\.cloudflarestorage\.com/,
  /\.r2\.dev\b/,
  /method:\s*['"](PUT|DELETE|POST)['"][^\n]*workers\.dev/,
];
const hits = [];
for (const f of walk(join(ROOT, 'src'))) {
  if (!/\.(ts|js|mjs|svelte)$/.test(f.path)) continue;
  const text = readFileSync(f.path, 'utf8');
  for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${relative(ROOT, f.path)}: ${re}`);
}
if (hits.length) for (const h of hits) fail(h);
else ok('no R2 write/list patterns');

// ---- 3. Worker requests per page load ---------------------------------------------------
console.log('Worker requests per page load (budget/requests.json)');
const rq = JSON.parse(readFileSync(join(ROOT, 'budget', 'requests.json'), 'utf8'));
const latest = new Map();
for (const m of rq.measurements) latest.set(m.page, m);
for (const [page, m] of latest) {
  const lim = rq.limits[page];
  const line = `${page}: ${m.requests} (${m.date}, ${m.build})`;
  if (!lim) ok(line);
  else if (m.requests > lim.fail) fail(`${line} > fail limit ${lim.fail}`);
  else if (m.requests > lim.target) warn(`${line}, target ${lim.target}`);
  else ok(`${line}, target ${lim.target}`);
}
const perVisit = Math.max(...[...latest.values()].map((m) => m.requests));
const share = 30_000;
console.log(
  `  info  at ${perVisit} requests per new visitor, the site's ${share.toLocaleString('en')}/day share ` +
    `covers ~${Math.floor(share / perVisit).toLocaleString('en')} new visitors/day ` +
    '(account limit 100,000/day, shared with the main site)',
);

// ---- night mode: every colour token is red-only, and the red filter drops green and blue ----
console.log('Night mode is red-only (G = B = 0)');
{
  const css = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');
  const start = css.indexOf(":root[data-night='true'] {");
  const block = start < 0 ? '' : css.slice(start, css.indexOf('\n}', start));
  const bad = [];
  let n = 0;
  for (const m of block.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    n++;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    if (h.slice(2) !== '0000') bad.push(m[0]);
  }
  for (const m of block.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/gi)) {
    n++;
    if (m[2] !== '0' || m[3] !== '0') bad.push(m[0]);
  }
  if (n < 20) fail(`night token block not found or too small (${n} colours)`);
  else if (bad.length) fail(`night colours with green or blue: ${bad.join(', ')}`);
  else ok(`${n} night colours, all red-only`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const f = /id="night-red"[\s\S]*?values="([^"]+)"/.exec(html)?.[1];
  const v = f ? f.trim().split(/\s+/).map(Number) : [];
  if (v.length === 20 && v.slice(5, 15).every((x) => x === 0))
    ok('#night-red filter outputs no green or blue');
  else fail('#night-red filter missing or lets green/blue through');
}

console.log(failed ? '\ncheck:budget FAILED' : '\ncheck:budget passed');
process.exit(failed ? 1 : 0);
