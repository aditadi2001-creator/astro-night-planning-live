// Vite plugin: writes dist/sw.js from src/pwa/sw-template.js with this build's
// exact file list (page, entry scripts and their static imports, styles, workers,
// sky engine, icons). Lazily loaded chunks (the satellite map, GeoTIFF decoders)
// are left out of the install download and cached when first used.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { engineVersion } from './engine-version.mjs';

const STATIC = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];
// Same versioned URLs the page requests (scripts/engine-version.mjs).
const ENGINE = ['engine/stellarium-web-engine.js', 'engine/stellarium-web-engine.wasm'];

/** Static data a dark-site visit needs offline ("Save for offline"): Pages files, no Worker. */
const PACK_DIRS = ['skydata', 'catalog', 'data', 'horizons'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function pwa() {
  let base = '/';
  let publicDir = 'public';
  let dataOrigin = '';
  return {
    name: 'anp-service-worker',
    apply: 'build',
    configResolved(cfg) {
      base = cfg.base;
      publicDir = cfg.publicDir;
      try {
        dataOrigin = cfg.env.VITE_DATA_BASE ? new URL(cfg.env.VITE_DATA_BASE).origin : '';
      } catch {
        dataOrigin = '';
      }
    },
    generateBundle(_opts, bundle) {
      const files = new Set();
      const visit = (name) => {
        const c = bundle[name];
        if (!c || files.has(name)) return;
        files.add(name);
        if (c.type !== 'chunk') return;
        for (const css of c.viteMetadata?.importedCss ?? []) files.add(css);
        for (const imp of c.imports) visit(imp);
        // The Sky page is split off the entry but must work offline from the first install.
        for (const imp of c.dynamicImports) if (/(^|\/)sky-parts-/.test(imp)) visit(imp);
      };
      for (const [name, c] of Object.entries(bundle)) {
        if (c.type === 'chunk' && c.isEntry) visit(name);
        // Web Worker scripts (clouds, passes) are emitted as assets.
        if (c.type === 'asset' && /\.worker-[\w-]+\.js$/.test(name)) files.add(name);
      }
      const list = [
        ...STATIC.map((p) => base + p.replace(/^\//, '')),
        ...ENGINE.map((p) => `${base}${p}?v=${engineVersion()}`),
        ...[...files]
          .filter((f) => !f.endsWith('.map'))
          .sort()
          .map((f) => base + f),
      ];
      const hash = createHash('sha256');
      for (const f of [...files].sort()) {
        const c = bundle[f];
        hash.update(f);
        hash.update(c.type === 'chunk' ? c.code : String(c.source.length));
      }
      hash.update(engineVersion());
      // The worker's own code is part of the version too.
      const template = readFileSync(new URL('../src/pwa/sw-template.js', import.meta.url), 'utf8');
      hash.update(template);
      const version = hash.digest('hex').slice(0, 12);
      // The offline pack: every file under the data folders, with sizes for the progress bar.
      const pack = [];
      for (const d of PACK_DIRS) {
        let files;
        try {
          files = walk(join(publicDir, d));
        } catch {
          continue;
        }
        for (const f of files)
          pack.push([base + relative(publicDir, f).split(sep).join('/'), statSync(f).size]);
      }
      pack.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      this.emitFile({
        type: 'asset',
        fileName: 'offline-pack.json',
        source: JSON.stringify({
          files: pack.map(([u]) => u),
          bytes: pack.reduce((t, [, n]) => t + n, 0),
        }),
      });
      const source = template
        .replace('__VERSION__', version)
        .replace('__DATA_ORIGIN__', dataOrigin)
        .replace('/* __PRECACHE__ */ []', JSON.stringify(list, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
