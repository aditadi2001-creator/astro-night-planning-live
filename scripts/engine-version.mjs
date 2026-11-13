// Vite plugin: a content hash of the sky engine (public/engine/*.js + .wasm),
// exposed as __ENGINE_V__ and as %ENGINE_V% in index.html. The engine is two
// files with fixed names; without a version in their URLs a browser can pair a
// new script with a cached old WebAssembly file after an update, and the engine
// then half-works (settings apply but nothing redraws) until a reload.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function engineVersion() {
  const read = (f) => readFileSync(new URL(`../public/engine/${f}`, import.meta.url));
  const h = createHash('sha256');
  h.update(read('stellarium-web-engine.js'));
  h.update(read('stellarium-web-engine.wasm'));
  return h.digest('hex').slice(0, 10);
}

export function engineVersionPlugin() {
  const v = engineVersion();
  return {
    name: 'anp-engine-version',
    config() {
      return { define: { __ENGINE_V__: JSON.stringify(v) } };
    },
    transformIndexHtml(html) {
      return html.replaceAll('%ENGINE_V%', v);
    },
  };
}
