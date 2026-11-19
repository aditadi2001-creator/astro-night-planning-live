import { mount } from 'svelte';
// Self-hosted fonts (OFL 1.1): no third-party font request, works offline at dark sites.
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import '@fontsource/spectral/latin-500-italic.css';
import '@fontsource/spectral/latin-600-italic.css';
import './styles/tokens.css';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing');

export default mount(App, { target });

// Installable app / offline shell (production builds only; see src/pwa/sw-template.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* no offline support in this browser: the site works the same online */
    });
  });
}
