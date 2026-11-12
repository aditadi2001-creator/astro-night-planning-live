/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Dev only: the Copernicus DEM bucket sends no CORS headers. In production
    // the browser goes through our Cloudflare Worker (VITE_DEM_BASE).
    proxy: {
      '/dem': {
        target: 'https://copernicus-dem-30m.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/dem/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
