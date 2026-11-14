<script lang="ts">
  /**
   * Stellarium-style "Astronomical calculations" (F10) for the shown night:
   * Sun, Moon and planets with magnitude, constellation, where they are now and
   * rise / transit / set (Astronomy Engine, refraction included).
   */
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    place: Place;
    time: Date;
    tz: string | undefined;
    /** Select and centre a body in the sky (engine name, e.g. "Mars"). */
    onpick: (name: string) => void;
  }
  let { place, time, tz, onpick }: Props = $props();

  const BODIES = [
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
  ] as const;

  // Recompute once per minute of shown time.
  const minute = $derived(Math.floor(time.getTime() / 60_000));
  const rows = $derived.by(() => {
    const d = new Date(minute * 60_000);
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    // Events of "today" around the shown time: search from 12 h before.
    const from = new Date(d.getTime() - 12 * 3600_000);
    return BODIES.map((name) => {
      const body = Astronomy.Body[name];
      const eq = Astronomy.Equator(body, d, obs, true, true);
      const hor = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
      const j2000 = Astronomy.Equator(body, d, obs, false, true);
      let mag: number | null;
      try {
        mag = Astronomy.Illumination(body, d).mag;
      } catch {
        mag = null;
      }
      const rise = Astronomy.SearchRiseSet(body, obs, 1, from, 1.5)?.date ?? null;
      const set = Astronomy.SearchRiseSet(body, obs, -1, rise ?? from, 1.5)?.date ?? null;
      const transit = Astronomy.SearchHourAngle(body, obs, 0, from);
      return {
        name,
        mag,
        con: Astronomy.Constellation(j2000.ra, j2000.dec).symbol,
        alt: hor.altitude,
        az: hor.azimuth,
        rise,
        transit: transit.time.date,
        transitAlt: transit.hor.altitude,
        set,
      };
    });
  });
  const t = (x: Date | null) => (x ? fmtTime(x, tz) : '—');
  const compass = (az: number) =>
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];
</script>

<div class="wrap" role="region" aria-label="Sun, Moon and planets" tabindex="-1">
  <table>
    <caption class="visually-hidden">Sun, Moon and planets for the shown time</caption>
    <thead>
      <tr>
        <th scope="col">Object</th>
        <th scope="col">Mag</th>
        <th scope="col">Now</th>
        <th scope="col">Rise</th>
        <th scope="col">Transit</th>
        <th scope="col">Set</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.name)}
        <tr class:down={r.alt < 0}>
          <th scope="row">
            <button onclick={() => onpick(r.name)} title={`Select ${r.name} in the sky`}
              >{r.name}</button
            >
            <span class="con">{r.con}</span>
          </th>
          <td>{r.mag != null ? r.mag.toFixed(1) : '—'}</td>
          <td>{r.alt.toFixed(0)}° {compass(r.az)}</td>
          <td>{t(r.rise)}</td>
          <td>{t(r.transit)} <span class="sub">{r.transitAlt.toFixed(0)}°</span></td>
          <td>{t(r.set)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="note">
    For {fmtTime(time, tz)} at {place.name}; altitudes include refraction. Times are the events
    nearest the shown time. Astronomy Engine (MIT).
  </p>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  thead th {
    color: var(--muted);
    font-weight: 500;
  }
  tbody th {
    font-weight: 500;
  }
  tbody th button {
    min-height: 28px;
    padding: 2px 8px;
    font-size: 12px;
  }
  .down td {
    color: var(--muted);
  }
  .con,
  .sub {
    color: var(--muted);
    font-size: 11px;
    margin-left: 4px;
  }
  .note {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--muted);
  }
</style>
