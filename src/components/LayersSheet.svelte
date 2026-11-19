<script lang="ts">
  /**
   * Layers sheet: presets (Beginner / Imager / Survey / Full), the sky's display switches in
   * labelled groups, the physically based layers with one-line explanations, and the sky-survey
   * picker (thumbnails, opacity, host status). Replaces the old row of 25 unlabeled icons.
   */
  import type { LayerState, SurveyStatus } from './LayerBar.svelte';
  import {
    applyPreset,
    skyView,
    VIEW_GROUPS,
    VIEW_PRESETS,
    type PresetId,
  } from '../lib/sky/view.svelte';
  import { hostLabel, surveyById, surveysByBand } from '../lib/sky/surveys';
  import { thumbTileUrl } from '../lib/sky/healpix';
  import { creditLine } from '../lib/credits';

  interface Props {
    layers: LayerState;
    surveyStatus: SurveyStatus;
    expert: boolean;
  }
  let { layers = $bindable(), surveyStatus, expert }: Props = $props();

  let preset = $state<PresetId | null>(null);
  function usePreset(id: PresetId) {
    preset = id;
    layers = { ...layers, ...applyPreset(id) } as LayerState;
  }

  const PHYSICAL: { key: keyof LayerState; label: string; hint: string }[] = [
    {
      key: 'clouds',
      label: 'Live clouds',
      hint: 'Clouds where the satellite saw them, moving with the forecast winds.',
    },
    {
      key: 'lightpollution',
      label: 'Light pollution',
      hint: 'City sky glow from the yearly model, with light domes over towns.',
    },
    {
      key: 'haze',
      label: 'Haze and extinction',
      hint: 'Stars dim and redden near the horizon as dust and humidity forecast.',
    },
    {
      key: 'terrain',
      label: 'Real terrain',
      hint: 'Hills and mountains around you from elevation data (or your custom horizon).',
    },
    {
      key: 'longExposure',
      label: 'Long exposure',
      hint: 'Show what a camera records: about 4 magnitudes deeper than the eye.',
    },
    {
      key: 'deepSky',
      label: 'Deep-sky photos',
      hint: 'Survey photos of galaxies and nebulae fade in when you zoom in.',
    },
  ];

  // Thumbnails: the order-3 tile around the Orion Nebula from each survey's own server
  // (first non-CDS mirror), loaded lazily only while the picker is open.
  const ORION = { ra: 83.82, dec: -5.39 };
  const thumb = (s: ReturnType<typeof surveyById>) => {
    if (!s) return '';
    const server = s.servers.find((u) => !u.includes('cds.unistra.fr')) ?? s.servers[0] ?? '';
    return thumbTileUrl(server, ORION.ra, ORION.dec, s.frame === 'galactic', 'jpg');
  };
  const pngFallback = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement;
    if (img.src.endsWith('.jpg')) img.src = img.src.replace(/\.jpg$/, '.png');
    else img.classList.add('broken');
  };
  const current = $derived(surveyById(layers.survey));
</script>

<div class="sheet">
  <section>
    <h3>Presets</h3>
    <div class="presets" role="group" aria-label="Layer presets">
      {#each VIEW_PRESETS as p (p.id)}
        <button aria-pressed={preset === p.id} onclick={() => usePreset(p.id)} title={p.hint}
          >{p.label}</button
        >
      {/each}
    </div>
    {#if preset}<p class="hint">{VIEW_PRESETS.find((p) => p.id === preset)?.hint}</p>{/if}
  </section>

  {#each VIEW_GROUPS as g (g.title)}
    <section>
      <h3>{g.title}</h3>
      <ul class="sw">
        {#each g.items as it (it.key)}
          <li>
            <label>
              <input
                type="checkbox"
                bind:checked={skyView[it.key]}
                onchange={() => (preset = null)}
              />
              <span class="lbl"
                >{it.label}{#if expert && it.shortcut}<kbd>{it.shortcut}</kbd>{/if}</span
              >
              <span class="hint">{it.hint}</span>
            </label>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <section>
    <h3>Real-sky effects</h3>
    <ul class="sw">
      {#each PHYSICAL as it (it.key)}
        <li>
          <label>
            <input
              type="checkbox"
              bind:checked={layers[it.key] as boolean}
              onchange={() => (preset = null)}
            />
            <span class="lbl">{it.label}</span>
            <span class="hint">{it.hint}</span>
          </label>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h3>Sky surveys</h3>
    <label class="master">
      <input type="checkbox" bind:checked={layers.surveys} />
      <span class="lbl">Show a sky survey under the stars</span>
      <span class="hint"
        >Archival images from telescopes on the ground and in space, streamed from their public
        servers. Not tonight's sky.</span
      >
    </label>
    {#if layers.surveys}
      <div class="status" role="status">
        {#if surveyStatus.state === 'loading'}Connecting to the survey's servers…
        {:else if surveyStatus.state === 'ready'}Streaming from {hostLabel(
            surveyStatus.host ?? '',
          )}.
        {:else if surveyStatus.state === 'down'}All servers for this survey are down right now (CDS
          Strasbourg has been degraded since 9 Nov 2026). Pick another survey.
        {/if}
      </div>
      <label class="op"
        >Opacity
        <input type="range" min="0.1" max="1" step="0.05" bind:value={layers.surveyOpacity} />
        <output>{Math.round(layers.surveyOpacity * 100)} %</output>
      </label>
      {#if current}<p class="hint">
          {current.shows}{current.coverageNote ? ` ${current.coverageNote}` : ''}
          {creditLine(current.creditId)}
        </p>{/if}
    {/if}
    {#each surveysByBand() as g (g.band.id)}
      <h4>{g.band.label}</h4>
      <div class="thumbs">
        {#each g.surveys as s (s.id)}
          <button
            class="sv"
            aria-pressed={layers.surveys && layers.survey === s.id}
            onclick={() => (layers = { ...layers, surveys: true, survey: s.id })}
            title={s.shows}
          >
            <img
              src={thumb(s)}
              alt=""
              loading="lazy"
              width="72"
              height="72"
              onerror={pngFallback}
            />
            <span>{s.label}</span>
            {#if s.cdsOnly}<span class="warn">host often down</span>{/if}
          </button>
        {/each}
      </div>
    {/each}
    <p class="hint">Thumbnails show the area around the Orion Nebula.</p>
  </section>
</div>

<style>
  .sheet {
    display: grid;
    gap: var(--s4);
  }
  section {
    display: grid;
    gap: var(--s2);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-14);
    font-weight: 700;
    color: var(--text);
  }
  h4 {
    margin: var(--s2) 0 0;
    font-size: var(--fs-12);
    color: var(--text-2);
    font-weight: 600;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--s1);
  }
  .presets button {
    font-size: var(--fs-14);
    padding: 6px 4px;
  }
  .presets button[aria-pressed='true'] {
    background: var(--brass);
    color: var(--brass-ink);
    border-color: var(--brass);
  }
  .sw {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0 var(--s2);
    align-items: center;
    padding: 6px 4px;
    border-radius: var(--r-input);
    cursor: pointer;
  }
  label:hover {
    background: var(--ink-2);
  }
  input[type='checkbox'] {
    width: 20px;
    height: 20px;
    accent-color: var(--brass);
    grid-row: span 2;
  }
  .lbl {
    font-size: var(--fs-14);
  }
  .hint {
    grid-column: 2;
    font-size: var(--fs-12);
    color: var(--text-2);
    margin: 0;
  }
  section > .hint {
    grid-column: auto;
  }
  kbd {
    margin-left: 6px;
    font: inherit;
    font-size: 11px;
    color: var(--text-2);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0 4px;
  }
  .status {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .op {
    grid-template-columns: auto minmax(0, 1fr) auto;
    font-size: var(--fs-14);
  }
  .op input {
    accent-color: var(--brass);
  }
  .thumbs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: var(--s2);
  }
  .sv {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 6px;
    font-size: 11px;
    line-height: 1.25;
    text-align: center;
  }
  .sv img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: var(--r-input);
    background: var(--ink-0);
    filter: var(--media-filter);
  }
  .sv :global(img.broken) {
    opacity: 0.2;
  }
  .sv[aria-pressed='true'] {
    border-color: var(--brass);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .warn {
    color: var(--maybe);
  }
</style>
