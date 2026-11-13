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
  }

  export interface SurveyStatus {
    state: 'off' | 'loading' | 'ready' | 'down';
    /** Host the tiles come from, once one answered. */
    host?: string;
  }
</script>

<script lang="ts">
  import { creditLine } from '../lib/credits';
  import { hostLabel, SURVEYS, surveyById } from '../lib/sky/surveys';

  let {
    layers = $bindable(),
    surveyStatus = { state: 'off' },
  }: { layers: LayerState; surveyStatus?: SurveyStatus } = $props();

  const current = $derived(surveyById(layers.survey) ?? SURVEYS[0]);
  const statusText = $derived.by(() => {
    switch (surveyStatus.state) {
      case 'loading':
        return 'Finding a server…';
      case 'ready':
        return `Streaming from ${hostLabel(surveyStatus.host ?? '')}. Zoom in for detail.`;
      case 'down':
        return 'No server for this survey is answering right now. Try another survey or try again later.';
      default:
        return '';
    }
  });
</script>

<fieldset class="card">
  <legend>Layers</legend>
  <label><input type="checkbox" bind:checked={layers.clouds} /> Live clouds</label>
  <label
    ><input type="checkbox" bind:checked={layers.haze} /> Haze &amp; humidity (extinction, reddening,
    sky brightness)</label
  >
  <label><input type="checkbox" bind:checked={layers.terrain} /> Terrain horizon</label>
  <label><input type="checkbox" bind:checked={layers.constellations} /> Constellations</label>
  <label
    ><input type="checkbox" bind:checked={layers.lightpollution} /> Light pollution
    <span class="hint">(yearly map, light domes)</span></label
  >
  <label
    ><input type="checkbox" bind:checked={layers.surveys} /> Sky surveys
    <span class="hint">(archival images, streamed when on)</span></label
  >
  {#if layers.surveys}
    <div class="survey">
      <label class="field" for="survey-pick">Survey</label>
      <select id="survey-pick" bind:value={layers.survey}>
        {#each SURVEYS as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
      <label class="field" for="survey-opacity">Opacity</label>
      <div class="range">
        <input
          id="survey-opacity"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          bind:value={layers.surveyOpacity}
        />
        <output for="survey-opacity">{Math.round(layers.surveyOpacity * 100)}%</output>
      </div>
      <div class="about">
        {#if current}<p>{current.shows}</p>{/if}
        {#if current?.coverageNote}<p>{current.coverageNote}</p>{/if}
        <p>
          A survey is a photograph taken years ago, laid over the sky. It does not show tonight's
          sky or conditions.
        </p>
        {#if statusText}
          <p class="status" class:down={surveyStatus.state === 'down'} role="status">
            {statusText}
          </p>
        {/if}
        <p class="credit">
          {current ? creditLine(current.creditId) : ''} · <a href="#/credits">credits</a>
        </p>
      </div>
    </div>
  {/if}
  <label
    ><input type="checkbox" bind:checked={layers.satmap} /> Satellite cloud map
    <span class="hint">(infrared, last 2.5 hours)</span></label
  >
</fieldset>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 14px 12px;
    margin: 0;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  legend {
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 4px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex: none;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .survey {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 10px;
    margin: 2px 0 6px 26px;
    padding: 8px 10px;
    border-left: 2px solid var(--line);
  }
  .field {
    min-height: 32px;
    font-size: 13px;
    color: var(--muted);
  }
  select {
    min-height: 36px;
    min-width: 0;
    max-width: 100%;
    font: inherit;
    color: inherit;
    background: var(--bg, transparent);
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
    min-height: 32px;
    accent-color: var(--accent);
  }
  output {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    min-width: 3.5ch;
    text-align: right;
  }
  .about {
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--muted);
  }
  .about p {
    margin: 4px 0;
  }
  .status {
    color: var(--text, inherit);
  }
  .status.down {
    color: var(--warn, #e0a050);
  }
  .credit a {
    color: inherit;
  }
</style>
