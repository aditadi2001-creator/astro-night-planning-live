<script lang="ts">
  /** "Go to coordinates" box for the maps: decimal or D M S, N/S/E/W, typed or pasted. */
  import { formatLatLon, parseCoordinates } from '../lib/geo/coords';

  interface Props {
    /** Unique id prefix (two maps can be on the page). */
    id: string;
    ongo: (lat: number, lon: number) => void;
  }
  let { id, ongo }: Props = $props();
  let text = $state('');
  let msg = $state('');

  function go(e: SubmitEvent) {
    e.preventDefault();
    const p = parseCoordinates(text);
    if (!p) {
      msg = 'Use latitude, longitude, e.g. 32.7794, 78.9642 or 32°46′46″N 78°57′51″E';
      return;
    }
    msg = `Showing ${formatLatLon(p)}`;
    ongo(p.lat, p.lon);
  }
</script>

<form class="cg" onsubmit={go}>
  <label for={`${id}-coords`}>Coordinates</label>
  <input
    id={`${id}-coords`}
    type="text"
    inputmode="text"
    autocomplete="off"
    spellcheck="false"
    placeholder="lat, lon (e.g. 32.7794, 78.9642)"
    bind:value={text}
  />
  <button type="submit">Go</button>
  {#if msg}<span class="msg" role="status">{msg}</span>{/if}
</form>

<style>
  .cg {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0 0 8px;
    font-size: 13px;
  }
  label {
    color: var(--muted);
  }
  input {
    flex: 1 1 200px;
    min-width: 0;
    min-height: 34px;
    font: inherit;
    font-family: var(--mono);
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 4px 8px;
  }
  button {
    min-height: 34px;
  }
  .msg {
    flex-basis: 100%;
    font-size: 12px;
    color: var(--muted);
  }
</style>
