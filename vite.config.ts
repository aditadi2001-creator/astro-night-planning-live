/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Dev only: the Copernicus DEM bucket sends no CORS headers. In production
    // the browser goes through our data Worker (VITE_DATA_BASE + /dem).
    proxy: {
      '/dem': {
        target: 'https://copernicus-dem-30m.s3.amazonaws.com',
        changeOrigin: true,
        // The app sends byte ranges as ?r=a-b (the production Worker's format);
        // turn that back into a Range header for Amazon S3.
        rewrite: (p) => p.replace(/^\/dem/, '').replace(/\?.*$/, ''),
        configure: (proxy) => {
          // Narrow local type: the project has no Node typings (browser code only).
          type ReqEvents = {
            on(
              e: 'proxyReq',
              cb: (
                out: { setHeader(k: string, v: string): void },
                req: { url?: string; originalUrl?: string },
              ) => void,
            ): void;
          };
          (proxy as unknown as ReqEvents).on('proxyReq', (out, req) => {
            // `rewrite` has already stripped the query from req.url; connect keeps the original.
            const r = /[?&]r=(\d+-\d+)/.exec(req.originalUrl ?? req.url ?? '')?.[1];
            if (r) out.setHeader('Range', `bytes=${r}`);
          });
        },
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // MapLibre (~1.1 MB, ~300 KB gzipped) is its own chunk, loaded only when the
    // satellite map is switched on; everything on the first screen stays small.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
