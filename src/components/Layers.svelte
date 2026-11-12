<script lang="ts">
  interface LayerState {
    constellations: boolean;
  }
  let { layers = $bindable() }: { layers: LayerState } = $props();
</script>

<fieldset class="card">
  <legend>Layers</legend>
  <label><input type="checkbox" bind:checked={layers.constellations} /> Constellations</label>
  <p class="hint">Clouds, haze and light pollution layers arrive with live data.</p>
</fieldset>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 14px 12px;
    margin: 0;
  }
  legend {
    font-size: 14px;
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
  }
  .hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
