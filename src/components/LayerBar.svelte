<script lang="ts" module>
  export interface LayerState {
    clouds: boolean;
    haze: boolean;
    terrain: boolean;
    constellations: boolean;
    satmap: boolean;
    lightpollution: boolean;
    /** Optional image survey (off by default). */
    surveys: boolean;
    survey: string;
    surveyOpacity: number;
    /** Long exposure (camera-like, ~4 mag deeper) instead of the naked-eye view. */
    longExposure: boolean;
    /** Real survey photos of nebulae and galaxies fade in when zoomed in. */
    deepSky: boolean;
  }

  export interface SurveyStatus {
    state: 'off' | 'loading' | 'ready' | 'down';
    /** Host the tiles come from, once one answered. */
    host?: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { creditLine } from '../lib/credits';
  import { hostLabel, SURVEYS, surveyById } from '../lib/sky/surveys';

  let {
    layers = $bindable(),
    surveyStatus = { state: 'off' },
    extra,
    compact = false,
  }: {
    layers: LayerState;
    surveyStatus?: SurveyStatus;
    /** More toggles from the page (equipment frame, camera view…). */
    extra?: Snippet;
    /** Inside the full-screen sky: transparent, own element ids. */
    compact?: boolean;
  } = $props();
  const pid = $derived(compact ? 'fs-' : '');

  type Key =
    | 'clouds'
    | 'haze'
    | 'terrain'
    | 'constellations'
    | 'lightpollution'
    | 'surveys'
    | 'satmap'
    | 'longExposure'
    | 'deepSky';
  const items: { key: Key; label: string; hint: string }[] = [
    {
      key: 'longExposure',
      label: 'Long exposure',
      hint: 'Camera-like view about 4 magnitudes deeper than the eye (still limited by the light pollution at the site)',
    },
    {
      key: 'deepSky',
      label: 'Deep-sky photos',
      hint: 'Real survey photos of nebulae and galaxies fade in as you zoom in (DSS2 colour)',
    },
    { key: 'clouds', label: 'Clouds', hint: 'Live clouds in the sky (forecast + satellite)' },
    {
      key: 'lightpollution',
      label: 'Light pollution',
      hint: 'Yearly sky-glow model and light domes',
    },
    {
      key: 'haze',
      label: 'Haze',
      hint: 'Extinction, reddening and sky brightness from humidity and aerosols',
    },
    { key: 'terrain', label: 'Terrain', hint: 'Real horizon from elevation data' },
    { key: 'constellations', label: 'Constellations', hint: 'Lines and names' },
    {
      key: 'surveys',
      label: 'Sky surveys',
      hint: 'Archival survey images over the sky (off by default)',
    },
    { key: 'satmap', label: 'Satellite map', hint: 'Infrared cloud map of the last 2.5 hours' },
  ];

  const current = $derived(surveyById(layers.survey) ?? SURVEYS[0]);
  const statusText = $derived.by(() => {
    switch (surveyStatus.state) {
      case 'loading':
        return 'Finding a server…';
      case 'ready':
        return `Streaming from ${hostLabel(surveyStatus.host ?? '')}. Zoom in for detail.`;
      case 'down':
        return 'No server for this survey is answering right now. Try another survey or later.';
      default:
        return '';
    }
  });
</script>

<nav class="bar" class:compact aria-label={compact ? 'Sky layers (full screen)' : 'Sky layers'}>
  <div class="chips" role="group" aria-label="Show or hide layers">
    {#each items as it (it.key)}
      <button
        class="chip"
        aria-pressed={layers[it.key]}
        title={it.hint}
        onclick={() => (layers[it.key] = !layers[it.key])}
      >
        <span class="tick" aria-hidden="true">{layers[it.key] ? '●' : '○'}</span>{it.label}
      </button>
    {/each}
    {@render extra?.()}
  </div>

  {#if layers.surveys}
    <div class="survey" role="group" aria-label="Sky survey options">
      <label class="field" for={`${pid}survey-pick`}>Survey</label>
      <select id={`${pid}survey-pick`} bind:value={layers.survey}>
        {#each SURVEYS as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
      <label class="field" for={`${pid}survey-opacity`}>Opacity</label>
      <span class="range">
        <input
          id={`${pid}survey-opacity`}
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          bind:value={layers.surveyOpacity}
        />
        <output for={`${pid}survey-opacity`}>{Math.round(layers.surveyOpacity * 100)}%</output>
      </span>
      <p class="about">
        {#if current}{current.shows}{current.coverageNote ? ` ${current.coverageNote}` : ''}{/if}
        An archival photograph laid over the sky, not tonight's conditions.
        {#if statusText}<span
            class="status"
            class:down={surveyStatus.state === 'down'}
            role="status">{statusText}</span
          >{/if}
        <span class="credit"
          >{current ? creditLine(current.creditId) : ''} · <a href="#/credits">credits</a></span
        >
      </p>
    </div>
  {/if}
</nav>

<style>
  .bar {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    padding: 6px 8px;
    min-width: 0;
  }
  .bar.compact {
    border: none;
    background: transparent;
    padding: 0;
  }
  .compact .chips {
    flex-wrap: wrap;
    overflow: visible;
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 2px;
  }
  .chip,
  .chips :global(.chip) {
    flex: none;
    min-height: 34px;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 14px;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .chips :global(.chip[aria-pressed='true']) {
    border-color: var(--accent);
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, var(--panel-2));
  }
  .chips :global(.chip[aria-pressed='false']) {
    color: var(--muted);
  }
  .tick {
    font-size: 10px;
    color: var(--accent);
  }
  .survey {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 10px;
    padding: 8px 2px 2px;
    max-width: 900px;
  }
  @media (max-width: 640px) {
    .survey {
      grid-template-columns: auto minmax(0, 1fr);
    }
  }
  .field {
    font-size: 13px;
    color: var(--muted);
  }
  select {
    min-height: 34px;
    min-width: 0;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 6px;
  }
  .range {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .range input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  output {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .about {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .status {
    display: block;
    color: var(--text);
  }
  .status.down {
    color: var(--warn);
  }
  .credit {
    display: block;
  }
  .credit a {
    color: inherit;
  }
</style>
