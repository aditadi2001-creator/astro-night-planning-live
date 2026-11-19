<script lang="ts">
  /** Dock "More": place, display settings, calculations, full screen, camera view and shortcuts. */
  import type { Place } from '../lib/astro/sky';
  import { skyView, viewDefaults } from '../lib/sky/view.svelte';
  import LocationPicker from './LocationPicker.svelte';
  import SkyEphem from './SkyEphem.svelte';

  interface Props {
    place: Place;
    time: Date;
    tz: string | undefined;
    onplace: (p: Place) => void;
    onpick: (name: string) => void;
    onfull: () => void;
    oncamera: () => void;
  }
  let { place, time, tz, onplace, onpick, onfull, oncamera }: Props = $props();
  let section = $state<'place' | 'display' | 'calc' | 'keys'>('place');
</script>

<div class="more">
  <div class="seg" role="tablist" aria-label="More">
    <button role="tab" aria-selected={section === 'place'} onclick={() => (section = 'place')}
      >Place</button
    >
    <button role="tab" aria-selected={section === 'display'} onclick={() => (section = 'display')}
      >Display</button
    >
    <button role="tab" aria-selected={section === 'calc'} onclick={() => (section = 'calc')}
      >Sun &amp; planets</button
    >
    <button role="tab" aria-selected={section === 'keys'} onclick={() => (section = 'keys')}
      >Keys</button
    >
  </div>

  <div class="row">
    <button onclick={onfull}>Full screen</button>
    <button onclick={oncamera} title="Phone camera with the horizon and your target's path"
      >Camera view</button
    >
  </div>

  {#if section === 'place'}
    <LocationPicker {place} {onplace} onclose={() => {}} embedded />
  {:else if section === 'display'}
    <fieldset>
      <legend>Projection</legend>
      <label
        ><input type="radio" bind:group={skyView.projection} value={2} /> Stereographic (default)</label
      >
      <label><input type="radio" bind:group={skyView.projection} value={1} /> Perspective</label>
    </fieldset>
    <fieldset>
      <legend>Stars</legend>
      <label class="rng"
        >Brightness <input
          type="range"
          min="0.4"
          max="3"
          step="0.05"
          bind:value={skyView.starBrightness}
        /><output>{skyView.starBrightness.toFixed(2)}×</output></label
      >
      <label class="rng"
        >Size <input
          type="range"
          min="0.6"
          max="1.6"
          step="0.05"
          bind:value={skyView.starSize}
        /><output>{skyView.starSize.toFixed(2)}×</output></label
      >
    </fieldset>
    <fieldset>
      <legend>Labels</legend>
      <label class="rng"
        >Star labels <input
          type="range"
          min="-3"
          max="3"
          step="0.5"
          bind:value={skyView.starLabelAmount}
        /><output>{skyView.starLabelAmount}</output></label
      >
      <label class="rng"
        >Deep-sky labels <input
          type="range"
          min="-3"
          max="3"
          step="0.5"
          bind:value={skyView.dsoLabelAmount}
        /><output>{skyView.dsoLabelAmount}</output></label
      >
    </fieldset>
    <fieldset>
      <legend>View</legend>
      <label
        ><input type="checkbox" bind:checked={skyView.flipH} /> Mirror left–right (star diagonal)</label
      >
      <label><input type="checkbox" bind:checked={skyView.flipV} /> Flip upside down</label>
      <label
        ><input type="checkbox" bind:checked={skyView.autoHideBars} /> Hide the bars in full screen when
        idle</label
      >
    </fieldset>
    <button
      onclick={() =>
        Object.assign(skyView, {
          ...viewDefaults(),
          conLines: skyView.conLines,
          conLabels: skyView.conLabels,
        })}>Restore defaults</button
    >
  {:else if section === 'calc'}
    <SkyEphem {place} {time} {tz} {onpick} />
  {:else}
    <dl class="keys">
      <dt>Drag / arrows</dt>
      <dd>look around</dd>
      <dt>Wheel, pinch, + / −</dt>
      <dd>zoom</dd>
      <dt>Ctrl/Cmd K, F3</dt>
      <dd>search</dd>
      <dt>Space, double-click</dt>
      <dd>centre on the selected object</dd>
      <dt>C V B</dt>
      <dd>constellation lines, names, borders</dd>
      <dt>E Z ; ,</dt>
      <dd>equatorial grid, alt/az grid, meridian, ecliptic</dd>
      <dt>G Q A</dt>
      <dd>ground, compass points, atmosphere</dd>
      <dt>D P</dt>
      <dd>deep-sky objects, planet names</dd>
      <dt>J K L 8</dt>
      <dd>slower, normal speed, faster, now</dd>
      <dt>Ctrl+O</dt>
      <dd>camera frame (ocular view)</dd>
      <dt>[ ]</dt>
      <dd>rotate the frame 1° (Shift: 15°)</dd>
      <dt>F4 F5 F2 F1</dt>
      <dd>layers, time, settings, this help</dd>
      <dt>Esc</dt>
      <dd>close the panel, then clear the selection</dd>
    </dl>
    <p class="note">Shortcuts work while the sky has focus (click it once).</p>
  {/if}
</div>

<style>
  .more {
    display: grid;
    gap: var(--s3);
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2px;
  }
  .seg button {
    font-size: var(--fs-12);
    padding: 6px 2px;
  }
  .seg button[aria-selected='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  fieldset {
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    display: grid;
    gap: 6px;
    padding: var(--s2) var(--s3);
    margin: 0;
  }
  legend {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  label {
    font-size: var(--fs-14);
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .rng input {
    flex: 1;
    accent-color: var(--brass);
  }
  output {
    min-width: 3.5em;
    text-align: right;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: var(--fs-14);
  }
  .keys dt {
    color: var(--brass);
  }
  .keys dd {
    margin: 0;
  }
  .note {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
</style>
