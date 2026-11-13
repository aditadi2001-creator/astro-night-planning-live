// Vite plugin: writes dist/sw.js from src/pwa/sw-template.js with this build's
// exact file list (page, entry scripts and their static imports, styles, workers,
// sky engine, icons). Lazily loaded chunks (the satellite map, GeoTIFF decoders)
// are left out of the install download and cached when first used.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

export function pwa() {
  let base = '/';
  return {
    name: 'anp-service-worker',
    apply: 'build',
    configResolved(cfg) {
      base = cfg.base;
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
      const source = template
        .replace('__VERSION__', version)
        .replace('/* __PRECACHE__ */ []', JSON.stringify(list, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
