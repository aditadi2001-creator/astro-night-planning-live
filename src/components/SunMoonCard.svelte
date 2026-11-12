<script lang="ts">
  import { Body } from 'astronomy-engine';
  import { bodyPosition, moonInfo, type Place } from '../lib/astro/sky';
  import { creditLine } from '../lib/credits';

  interface Props {
    place: Place;
    now: Date;
  }
  let { place, now }: Props = $props();

  const sun = $derived(bodyPosition(Body.Sun, place, now));
  const moon = $derived(bodyPosition(Body.Moon, place, now));
  const moonState = $derived(moonInfo(now));

  const deg = (v: number) => `${v.toFixed(1)}°`;
  function twilight(alt: number): string {
    if (alt > -0.833) return 'Daylight';
    if (alt > -6) return 'Civil twilight';
    if (alt > -12) return 'Nautical twilight';
    if (alt > -18) return 'Astronomical twilight';
    return 'Astronomical darkness';
  }
</script>

<article class="card">
  <h2>Sun &amp; Moon now</h2>
  <dl>
    <dt>Sun altitude</dt>
    <dd>{deg(sun.altitude)} <span class="tag">{twilight(sun.altitude)}</span></dd>
    <dt>Moon altitude</dt>
    <dd>{deg(moon.altitude)} · az {deg(moon.azimuth)}</dd>
    <dt>Moon phase</dt>
    <dd>{moonState.phaseName}, {(moonState.illumination * 100).toFixed(0)}% lit</dd>
  </dl>
  <p class="credit-line">{creditLine('astronomy-engine')} · refraction for 1010 hPa, 10 °C</p>
</article>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  h2 {
    font-size: 14px;
    margin: 0 0 8px;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 8px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .tag {
    font-size: 12px;
    color: var(--accent);
  }
</style>
