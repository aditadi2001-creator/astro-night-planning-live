<script lang="ts">
  /**
   * Planets · Sun · Moon (Plan §3): each body as a first-class target — when it is best tonight,
   * how big and bright it is, phase, distance, rise/transit/set; Jupiter's moons, Saturn's ring
   * tilt, capture tips for the planetary profile; the Moon's phase, age, libration, next phases
   * and what lies on the terminator; the Sun with live NOAA space weather and the safety warning.
   */
  import { onMount } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import type { TwilightTimes } from '../lib/conditions';
  import type { Profile } from '../lib/profiles';
  import { profileStats } from '../lib/profiles';
  import { bodyCurve } from '../lib/plan/curves';
  import { ribbonSpan } from '../lib/ribbon';
  import {
    bestBetween,
    bodyNow,
    jupiterMoons,
    moonInfo,
    onTerminator,
    planetCapture,
    saturnRingTilt,
  } from '../lib/plan/solarsystem';
  import { loadSunData, type SunData } from '../lib/space/sun';
  import { fmtTime, fmtDateTime } from '../lib/time/format';
  import TypeSymbol from './TypeSymbol.svelte';

  interface Props {
    place: Place;
    tz: string | undefined;
    tw: TwilightTimes;
    shown: number;
    expert: boolean;
    profile: Profile | null;
    seeing: number | null;
    onshow: (name: string) => void;
  }
  let { place, tz, tw, shown, expert, profile, seeing, onshow }: Props = $props();

  const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const site = $derived({ lat: place.lat, lon: place.lon, elevation: place.elevation });
  // Recompute every 10 minutes of shown time at most.
  const at = $derived(new Date(Math.floor(shown / 600_000) * 600_000));
  const span = $derived(ribbonSpan(tw, at.getTime()));
  // "Tonight" for planets: from the end of civil twilight to its start in the morning.
  const night = $derived({
    from: tw.civilEnd?.getTime() ?? span.start,
    to: tw.civilStart?.getTime() ?? span.end,
  });

  const cards = $derived(
    PLANETS.map((name) => {
      const now = bodyNow(name, site, at);
      const best = bestBetween(name, site, night.from, night.to);
      const curve = bodyCurve(name, site, span.start, span.end, 20);
      return { name, now, best, curve };
    }),
  );
  const moon = $derived(bodyNow('Moon', site, at));
  const minfo = $derived(moonInfo(at));
  const terminator = $derived(onTerminator(minfo));
  const sun = $derived(bodyNow('Sun', site, at));
  const jm = $derived(jupiterMoons(at));
  const tilt = $derived(saturnRingTilt(at));
  const stats = $derived(profile ? profileStats(profile) : null);

  let sunData = $state<SunData | null>(null);
  let sunState = $state<'loading' | 'ok' | 'error'>('loading');
  onMount(() => {
    const ctrl = new AbortController();
    loadSunData(ctrl.signal)
      .then((d) => {
        sunData = d;
        sunState = d.flux || d.regions || d.ssn ? 'ok' : 'error';
      })
      .catch(() => (sunState = 'error'));
    return () => ctrl.abort();
  });

  const t = (d: Date | number | null | undefined) => (d == null ? 'n/a' : fmtTime(d, tz));
  const deg = (x: number | null, digits = 0) => (x == null ? 'n/a' : `${x.toFixed(digits)}°`);
  function spark(curve: { t: number; alt: number }[]): string {
    const n = curve.length;
    return curve
      .map(
        (p, i) =>
          `${((i / (n - 1)) * 100).toFixed(1)},${(30 - ((Math.max(-5, p.alt) + 5) / 95) * 28).toFixed(1)}`,
      )
      .join(' ');
  }
  function status(c: (typeof cards)[number]): string {
    if (c.best && c.best.alt >= 10) return `Best at ${t(c.best.t)}, ${Math.round(c.best.alt)}° up`;
    if (c.best) return `Low tonight: at most ${Math.round(c.best.alt)}° (${t(c.best.t)})`;
    return `Not up at night (rises ${t(c.now.rise)}, sets ${t(c.now.set)})`;
  }
  /**
   * Lit part of the Moon (r = 9, lit limb on the right while waxing): the limb semicircle, then
   * back along the terminator, an ellipse of x-radius 9·|cos p|. In SVG (y down) a path from
   * the bottom to the top that passes on the right is anticlockwise (sweep 0).
   */
  function phasePath(p: number): string {
    const rx = (9 * Math.abs(Math.cos((p * Math.PI) / 180))).toFixed(2);
    const waxing = p < 180;
    const limb = waxing ? 1 : 0;
    const term = waxing ? (p < 90 ? 0 : 1) : p > 270 ? 1 : 0;
    return `M0,-9 A9,9 0 0 ${limb} 0,9 A${rx},9 0 0 ${term} 0,-9Z`;
  }
  const sizeText = (arcsec: number) =>
    arcsec >= 120 ? `${(arcsec / 60).toFixed(1)}′` : `${arcsec.toFixed(1)}″`;
</script>

<div class="ss">
  <p class="solar-warning" role="note">
    <strong>Never look at or image the Sun</strong> without a certified full-aperture solar filter on
    the front of the telescope or lens. Permanent eye and camera damage happens in a fraction of a second.
  </p>

  <div class="grid">
    {#each cards as c (c.name)}
      <article class="card" class:down={!c.best}>
        <header>
          <TypeSymbol kind="planet" />
          <h3 class="obj-name">{c.name}</h3>
          <span class="mag">{c.now.mag != null ? `mag ${c.now.mag.toFixed(1)}` : ''}</span>
        </header>
        <p class="status">{status(c)}</p>
        <svg class="spark" viewBox="0 0 100 32" aria-hidden="true">
          <line x1="0" x2="100" y1={30 - (5 / 95) * 28} y2={30 - (5 / 95) * 28} class="hz" />
          <polyline points={spark(c.curve)} />
        </svg>
        <dl>
          <div>
            <dt>Size</dt>
            <dd>{sizeText(c.now.diameter)}</dd>
          </div>
          <div>
            <dt>Lit</dt>
            <dd>{c.now.phase != null ? `${Math.round(c.now.phase * 100)} %` : 'n/a'}</dd>
          </div>
          <div>
            <dt>From the Sun</dt>
            <dd>{deg(c.now.elongation)}</dd>
          </div>
          {#if expert}
            <div>
              <dt>Distance</dt>
              <dd>{c.now.distAu.toFixed(2)} AU</dd>
            </div>
            <div>
              <dt>Rise / transit / set</dt>
              <dd>{t(c.now.rise)} · {t(c.now.transit?.t)} · {t(c.now.set)}</dd>
            </div>
          {/if}
        </dl>
        {#if c.name === 'Jupiter'}
          <svg
            class="moons"
            viewBox="-30 -4 60 8"
            role="img"
            aria-label={`Galilean moons: ${jm.map((m) => `${m.name} ${m.x > 0 ? 'east' : 'west'} ${Math.abs(m.x).toFixed(1)} radii`).join(', ')}`}
          >
            <circle cx="0" cy="0" r="1" class="jup" />
            {#each jm as m (m.name)}
              <!-- Sky view, east to the left (as seen with north up). -->
              <circle
                cx={-Math.max(-29, Math.min(29, m.x))}
                cy={-m.y}
                r="0.45"
                class:behind={m.behind}
                class="gm"
              />
              <text x={-Math.max(-29, Math.min(29, m.x))} y="3.6" class="gml">{m.name[0]}</text>
            {/each}
          </svg>
          <p class="note">Moons I E G C; east is left (north up).</p>
        {/if}
        {#if c.name === 'Saturn'}
          <p class="note">
            Rings tilted {Math.abs(tilt).toFixed(1)}° {Math.abs(tilt) < 4
              ? '(nearly edge-on: thin line)'
              : 'toward Earth'}.
          </p>
        {/if}
        {#if stats && ['Mars', 'Jupiter', 'Saturn', 'Venus', 'Mercury'].includes(c.name) && (expert || c.best)}
          <details>
            <summary>Capture tips ({profile?.name})</summary>
            <ul class="tips">
              {#each planetCapture(c.now.diameter, stats.pixelScale, stats.fRatio, (profile?.pixelUm ?? 3) * (profile?.binning ?? 1), seeing, profile?.filters ?? []) as tip (tip)}
                <li>{tip}</li>
              {/each}
            </ul>
          </details>
        {/if}
        <button class="show" onclick={() => onshow(c.name)}>Show in sky</button>
      </article>
    {/each}

    <article class="card wide">
      <header>
        <svg viewBox="-10 -10 20 20" width="22" height="22" aria-hidden="true" class="phase">
          <circle r="9" class="dark" />
          <path d={phasePath(minfo.phaseAngle)} class="lit" />
        </svg>
        <h3 class="obj-name">Moon</h3>
        <span class="mag">{minfo.phaseName}</span>
      </header>
      <dl>
        <div>
          <dt>Lit</dt>
          <dd>{Math.round(minfo.illum * 100)} %</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{Number.isFinite(minfo.ageDays) ? `${minfo.ageDays.toFixed(1)} days` : 'n/a'}</dd>
        </div>
        <div>
          <dt>Rises / sets</dt>
          <dd>{t(moon.rise)} · {t(moon.set)}</dd>
        </div>
        <div>
          <dt>Altitude now</dt>
          <dd>{deg(moon.alt)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{sizeText(moon.diameter)}</dd>
        </div>
        {#if expert}<div>
            <dt>Libration</dt>
            <dd>lat {minfo.libration.lat.toFixed(1)}°, lon {minfo.libration.lon.toFixed(1)}°</dd>
          </div>{/if}
      </dl>
      <p class="sub">
        Next: {minfo.next.map((n) => `${n.name} ${fmtDateTime(n.t, tz)}`).join(' · ')}
      </p>
      <h4>On the terminator tonight</h4>
      {#if terminator.length}
        <p>
          {minfo.terminator === 'sunrise' ? 'Sunrise' : 'Sunset'} line near longitude {Math.abs(
            minfo.terminatorLon,
          ).toFixed(0)}° {minfo.terminatorLon >= 0 ? 'E' : 'W'}:
          {terminator
            .slice(0, 6)
            .map((f) => f.name)
            .join(', ')}.
        </p>
      {:else}
        <p class="note">
          {minfo.illum > 0.97
            ? 'Full Moon: no shadows, little relief.'
            : minfo.illum < 0.03
              ? 'New Moon: not visible.'
              : 'No listed feature near the terminator right now.'}
        </p>
      {/if}
      <p class="note">
        Terminator position is approximate (±3°, libration ignored); features from the IAU
        Gazetteer.
      </p>
      <button class="show" onclick={() => onshow('Moon')}>Show in sky</button>
    </article>

    <article class="card wide sun">
      <header>
        <svg viewBox="-10 -10 20 20" width="22" height="22" aria-hidden="true"
          ><circle r="6" class="sunc" /></svg
        >
        <h3 class="obj-name">Sun</h3>
        <span class="mag">{sun.alt > 0 ? `${Math.round(sun.alt)}° up` : 'below the horizon'}</span>
      </header>
      <dl>
        <div>
          <dt>Rises / noon / sets</dt>
          <dd>{t(sun.rise)} · {t(sun.transit?.t)} · {t(sun.set)}</dd>
        </div>
        <div>
          <dt>10.7 cm flux</dt>
          <dd>
            {sunData?.flux ? `${sunData.flux.value} sfu` : sunState === 'loading' ? '…' : 'n/a'}
          </dd>
        </div>
        <div>
          <dt>Sunspot number</dt>
          <dd>
            {sunData?.ssn
              ? `${sunData.ssn.value} (${sunData.ssn.month})`
              : sunState === 'loading'
                ? '…'
                : 'n/a'}
          </dd>
        </div>
        <div>
          <dt>Active regions</dt>
          <dd>
            {#if sunData?.regions}
              {sunData.regions.count} on {sunData.regions.date}{sunData.regions.largest
                ? `, largest AR ${sunData.regions.largest.region} (${sunData.regions.largest.cls})`
                : ''}
            {:else}{sunState === 'loading' ? '…' : 'n/a'}{/if}
          </dd>
        </div>
        {#if expert && sunData?.regions?.mFlareMax != null}
          <div>
            <dt>M-flare chance</dt>
            <dd>up to {sunData.regions.mFlareMax} %</dd>
          </div>
        {/if}
      </dl>
      {#if sunState === 'error'}<p class="note">
          NOAA SWPC data could not be loaded right now.
        </p>{/if}
      <figure class="sdo">
        <img
          src="https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg"
          alt="The Sun today in visible light from NASA's Solar Dynamics Observatory, with its sunspots"
          loading="lazy"
          width="160"
          height="160"
        />
        <figcaption>
          Latest HMI image. Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams. Space
          weather: NOAA SWPC.
        </figcaption>
      </figure>
    </article>
  </div>
</div>

<style>
  .ss {
    display: grid;
    gap: var(--s4);
  }
  .solar-warning {
    margin: 0;
    padding: var(--s3) var(--s4);
    border: 1px solid var(--nogo);
    border-radius: var(--r-input);
    background: var(--ink-1);
    max-width: var(--measure);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    gap: var(--s3);
  }
  .card {
    display: grid;
    gap: var(--s2);
    align-content: start;
    padding: var(--s4);
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
  }
  .card.down {
    opacity: 0.75;
  }
  .card.wide {
    grid-column: span 2;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-21);
    font-weight: 600;
  }
  h4 {
    margin: var(--s2) 0 0;
    font-size: var(--fs-14);
  }
  .mag {
    margin-left: auto;
    color: var(--text-2);
    font-size: var(--fs-14);
  }
  .status,
  .sub,
  p {
    margin: 0;
  }
  .status {
    font-size: var(--fs-16);
  }
  .sub,
  .note {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .spark {
    width: 100%;
    height: 32px;
  }
  .spark polyline {
    fill: none;
    stroke: var(--brass);
    stroke-width: 1.5;
  }
  .hz {
    stroke: var(--rule);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: var(--s2) var(--s3);
  }
  dt {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  dd {
    margin: 0;
    font-size: var(--fs-14);
  }
  .moons {
    width: 100%;
    height: 34px;
  }
  .jup {
    fill: var(--obj-planet);
  }
  .gm {
    fill: var(--text);
  }
  .gm.behind {
    fill: var(--text-2);
    opacity: 0.5;
  }
  .gml {
    font-size: 2.2px;
    fill: var(--text-2);
    text-anchor: middle;
  }
  .tips {
    margin: var(--s1) 0 0;
    padding-left: 1.2em;
    font-size: var(--fs-14);
  }
  details summary {
    cursor: pointer;
    color: var(--brass);
    font-size: var(--fs-14);
  }
  .show {
    justify-self: start;
    font-size: var(--fs-14);
  }
  .phase .dark {
    fill: var(--ink-2);
  }
  .phase .lit {
    fill: var(--text);
  }
  .sunc {
    fill: var(--brass);
  }
  .sdo {
    margin: 0;
    display: flex;
    gap: var(--s3);
    align-items: center;
  }
  .sdo img {
    border-radius: 50%;
    flex: none;
  }
  .sdo figcaption {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  @media (max-width: 599px) {
    .card.wide {
      grid-column: auto;
    }
  }
</style>
