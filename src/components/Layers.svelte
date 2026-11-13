<script lang="ts">
  export interface LayerState {
    clouds: boolean;
    haze: boolean;
    terrain: boolean;
    constellations: boolean;
    satmap: boolean;
  }
  let { layers = $bindable() }: { layers: LayerState } = $props();
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
  <label class="off"
    ><input type="checkbox" disabled /> Light pollution
    <span>(yearly map, coming later)</span></label
  >
  <label class="off"
    ><input type="checkbox" disabled /> Sky surveys
    <span>(off by default, coming later)</span></label
  >
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
  input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex: none;
  }
  .off {
    color: var(--muted);
  }
  .off span,
  .hint {
    font-size: 12px;
  }
  .hint {
    color: var(--muted);
  }
</style>
