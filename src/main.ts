import { mount } from 'svelte';
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
