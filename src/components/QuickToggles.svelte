<script lang="ts">
  /**
   * The few switches people reach for all night, kept on the sky itself (not inside a panel):
   * camera frame, sky survey, constellation lines, coordinate grid, ground and atmosphere.
   * Everything else stays in Layers. Same switches as the Layers panel, so both stay in step.
   */
  import type { LayerState, SurveyStatus } from './LayerBar.svelte';
  import { skyView } from '../lib/sky/view.svelte';
  import { shortSurveyLabel } from '../lib/sky/surveys';

  interface Props {
    frameOn: boolean;
    ontoggleframe: () => void;
    layers: LayerState;
    surveyLabel: string;
    surveyStatus: SurveyStatus;
    full: boolean;
    onfull: () => void;
  }
  let {
    frameOn,
    ontoggleframe,
    layers = $bindable(),
    surveyLabel,
    surveyStatus,
    full,
    onfull,
  }: Props = $props();

  const short = $derived(shortSurveyLabel(surveyLabel));
  const surveyTitle = $derived(
    `Sky survey: ${surveyLabel}${
      surveyStatus.state === 'down'
        ? ' (its servers are not answering)'
        : surveyStatus.state === 'loading'
          ? ' (finding a server…)'
          : ''
    }. Choose another in Layers or in an object's Info.`,
  );
</script>

<div class="qt" role="group" aria-label="Quick switches">
  <button aria-pressed={frameOn} onclick={ontoggleframe} title="Camera frame (Ctrl+O)">
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><rect x="4" y="7" width="16" height="10" rx="1" /></svg
    >
    <span>Frame</span>
  </button>
  <button
    aria-pressed={layers.surveys}
    onclick={() => (layers = { ...layers, surveys: !layers.surveys })}
    title={surveyTitle}
    class:warn={layers.surveys && surveyStatus.state === 'down'}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="12" cy="12" r="8" /><path
        d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"
      /></svg
    >
    <span class="lbl">{layers.surveys ? short : 'Survey'}</span>
  </button>
  <button
    aria-pressed={skyView.conLines}
    onclick={() => (skyView.conLines = !skyView.conLines)}
    title="Constellation lines"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-8 6 3 5-8" /></svg>
    <span>Lines</span>
  </button>
  <button
    aria-pressed={skyView.eqGrid}
    onclick={() => (skyView.eqGrid = !skyView.eqGrid)}
    title="Equatorial (RA/Dec) grid"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16M4 15h16M9 4v16M15 4v16" /></svg>
    <span>Grid</span>
  </button>
  <button
    aria-pressed={skyView.eqMount}
    onclick={() => (skyView.eqMount = !skyView.eqMount)}
    title="Equatorial view: the sky turns about the celestial pole, like an equatorial mount sees it (Ctrl+M)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="12" cy="12" r="8" /><path d="M12 4v16M5 9c4 2 10 2 14 0" /></svg
    >
    <span>EQ view</span>
  </button>
  <button
    aria-pressed={skyView.meridian}
    onclick={() => (skyView.meridian = !skyView.meridian)}
    title="Meridian line (where objects are highest and mounts flip)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M8 6h8" /></svg>
    <span>Meridian</span>
  </button>
  <button
    aria-pressed={skyView.ground}
    onclick={() => (skyView.ground = !skyView.ground)}
    title="Ground and horizon"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-6 4 3 4-5 5 8z" /></svg>
    <span>Ground</span>
  </button>
  <button
    aria-pressed={skyView.atmosphere}
    onclick={() => (skyView.atmosphere = !skyView.atmosphere)}
    title="Atmosphere (daylight and twilight sky)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /></svg
    >
    <span>Air</span>
  </button>
  <button aria-pressed={full} onclick={onfull} title="Full screen (F11)">
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg
    >
    <span>{full ? 'Exit full' : 'Full screen'}</span>
  </button>
</div>

<style>
  .qt {
    display: grid;
    gap: 4px;
  }
  button {
    display: grid;
    justify-items: center;
    gap: 1px;
    width: 58px;
    min-height: 44px;
    padding: 4px 2px;
    font-size: 10.5px;
    line-height: 1.1;
    color: var(--text-2);
    background: color-mix(in srgb, var(--ink-1) 85%, transparent);
    border-color: var(--rule);
    backdrop-filter: blur(6px);
  }
  button[aria-pressed='true'] {
    color: var(--text);
    border-color: var(--brass);
    background: color-mix(in srgb, var(--brass) 18%, var(--ink-1));
  }
  button.warn {
    border-style: dashed;
  }
  .lbl {
    max-width: 54px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (max-width: 599px) {
    button {
      width: 48px;
      min-height: 44px;
      font-size: 10px;
    }
    .lbl {
      max-width: 44px;
    }
  }
</style>
