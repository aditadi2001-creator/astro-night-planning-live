<script lang="ts">
  import type { Place } from '../lib/astro/sky';

  // Phase 1 placeholder. Phase 2 mounts Stellarium Web Engine (WebAssembly) here.
  interface Props {
    place: Place;
    now: Date;
  }
  let { place, now }: Props = $props();
</script>

<div class="sky-placeholder" role="img" aria-label="Sky view placeholder">
  <p>The 3D sky engine loads here in the next phase.</p>
  <p class="small">
    {place.lat.toFixed(3)}°, {place.lon.toFixed(3)}° — {now.toUTCString()}
  </p>
</div>

<style>
  .sky-placeholder {
    height: 100%;
    min-height: inherit;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: radial-gradient(
      ellipse at 50% 120%,
      var(--sky-horizon) 0%,
      var(--sky-mid) 60%,
      var(--sky-top) 100%
    );
    display: grid;
    place-content: center;
    text-align: center;
    padding: 24px;
    color: var(--muted);
  }
  .small {
    font-size: 12px;
    font-family: var(--mono);
  }
</style>
