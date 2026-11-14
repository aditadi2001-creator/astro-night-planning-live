<script lang="ts">
  import { onMount } from 'svelte';
  import * as Astronomy from 'astronomy-engine';
  import type { Place } from '../lib/astro/sky';
  import { parseTargets, rankTargets, type RankedTarget, type Target } from '../lib/targets';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    place: Place;
    tz: string | undefined;
    /** Darkness window tonight (ms); null when there is no darkness. */
    dark: { start: number; end: number } | null;
    /** Cloud factor 0–1 at a time. */
    clearAt: (t: number) => number;
    /** Zenith sky brightness (SQM) and whether it came from the light-pollution map. */
    sqm: number;
    sqmKnown: boolean;
    /** Deep-sky frame short side (degrees) and its label. */
    frameShortDeg: number;
    /** Recompute key (changes every ~10 minutes and when forecasts change). */
    stamp: number;
    onshow: (t: { ra: number; dec: number; sizeDeg: number; bestT?: number; id?: string }) => void;
  }
  let { place, tz, dark, clearAt, sqm, sqmKnown, frameShortDeg, stamp, onshow }: Props = $props();

  let catalog = $state<Target[]>([]);
  let failed = $state(false);
  onMount(() => {
    fetch(`${import.meta.env.BASE_URL}skydata/targets.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rows: unknown[] }) => (catalog = parseTargets(d)))
      .catch(() => (failed = true));
  });

  let kind = $state<'all' | 'galaxy' | 'nebula' | 'cluster'>('all');
  const ranked = $derived.by((): RankedTarget[] => {
    void stamp;
    if (!catalog.length || !dark) return [];
    const list =
      kind === 'all'
        ? catalog
        : catalog.filter((t) =>
            kind === 'nebula'
              ? t.kind === 'nebula' || t.kind === 'planetary' || t.kind === 'remnant'
              : kind === 'cluster'
                ? t.kind === 'cluster' || t.kind === 'globular'
                : t.kind === kind,
          );
    return rankTargets(
      list,
      { place, darkStart: dark.start, darkEnd: dark.end, clearAt, sqm, frameShortDeg },
      15,
    );
  });

  // Planets and the Moon tonight (for the planetary and lunar setups).
  const BODIES = [
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
  ] as const;
  const planets = $derived.by(() => {
    void stamp;
    if (!dark) return [];
    const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
    return BODIES.map((name) => {
      const body = Astronomy.Body[name];
      let best: { t: number; alt: number } | null = null;
      for (let t = dark.start; t <= dark.end; t += 15 * 60_000) {
        const d = new Date(t);
        const eq = Astronomy.Equator(body, d, obs, true, true);
        const alt = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal').altitude;
        if (!best || alt > best.alt) best = { t, alt };
      }
      const mid = new Date(best?.t ?? dark.start);
      const ill = Astronomy.Illumination(body, mid);
      const j2000 = Astronomy.Equator(body, mid, obs, false, true);
      return {
        name,
        best,
        mag: ill.mag,
        phase: ill.phase_fraction,
        ra: j2000.ra * 15,
        dec: j2000.dec,
      };
    }).filter((p) => p.best && p.best.alt > 10);
  });

  const KIND_LABEL: Record<string, string> = {
    galaxy: 'Galaxy',
    nebula: 'Nebula',
    planetary: 'Planetary nebula',
    remnant: 'Supernova remnant',
    cluster: 'Open cluster',
    globular: 'Globular cluster',
  };
  const size = (am: number | null) =>
    am == null ? '' : am >= 60 ? `${(am / 60).toFixed(1)}°` : `${am.toFixed(0)}′`;
  const cls = (s: number) => (s >= 60 ? 'great' : s >= 40 ? 'ok' : s >= 20 ? 'meh' : 'bad');
</script>

<section class="targets" aria-labelledby="bt-title">
  <header>
    <h2 id="bt-title">Best targets tonight</h2>
    <div class="filters" role="group" aria-label="Filter by type">
      {#each [['all', 'All'], ['galaxy', 'Galaxies'], ['nebula', 'Nebulae'], ['cluster', 'Clusters']] as const as [k, label] (k)}
        <button class="chip" aria-pressed={kind === k} onclick={() => (kind = k)}>{label}</button>
      {/each}
    </div>
  </header>

  {#if failed}
    <p class="note">The target list could not be loaded.</p>
  {:else if !dark}
    <p class="note">No astronomical darkness tonight at this site, so no deep-sky ranking.</p>
  {:else if !ranked.length}
    <p class="note">
      {catalog.length ? 'Nothing gets 30° high in darkness tonight.' : 'Loading targets…'}
    </p>
  {:else}
    <ol class="list">
      {#each ranked as t, i (t.name)}
        <li>
          <span class="rank">{i + 1}</span>
          <div class="main">
            <p class="name">
              <strong>{t.name}</strong>{#if t.common}<span class="common"> {t.common}</span>{/if}
            </p>
            <p class="meta">
              {KIND_LABEL[t.kind] ?? t.kind} in {t.con}{t.mag != null
                ? ` · mag ${t.mag}`
                : ''}{t.maj != null
                ? ` · ${size(t.maj)}${t.min != null && t.min !== t.maj ? ` × ${size(t.min)}` : ''}`
                : ''}{t.best
                ? ` · highest ${Math.round(t.best.alt)}° at ${fmtTime(t.best.t, tz)}`
                : ''}
            </p>
            <p class="why">{t.reasons.join(' · ')}</p>
          </div>
          <span class="score {cls(t.score)}" title="Score 0–100 for tonight">{t.score}</span>
          <button
            class="go"
            onclick={() =>
              onshow({
                id: t.name,
                ra: t.ra,
                dec: t.dec,
                sizeDeg: Math.max((t.maj ?? 10) / 60, 0.2),
                ...(t.best ? { bestT: t.best.t } : {}),
              })}>Show in sky</button
          >
        </li>
      {/each}
    </ol>
  {/if}

  {#if planets.length}
    <h3>Planets and the Moon tonight</h3>
    <ul class="planets">
      {#each planets as p (p.name)}
        <li>
          <button
            class="link"
            onclick={() =>
              onshow({
                ra: p.ra,
                dec: p.dec,
                sizeDeg: 0.1,
                ...(p.best ? { bestT: p.best.t } : {}),
              })}>{p.name}</button
          >
          <span class="meta">
            mag {p.mag.toFixed(1)}{p.name === 'Moon' || p.name === 'Venus' || p.name === 'Mercury'
              ? ` · ${Math.round(p.phase * 100)}% lit`
              : ''} · highest {Math.round(p.best?.alt ?? 0)}° at {fmtTime(p.best?.t ?? 0, tz)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="note">
    Ranked for this site's darkness, the cloud forecast hour by hour, the Moon, the sky brightness
    (SQM {sqm.toFixed(1)}{sqmKnown
      ? ', yearly light-pollution model'
      : ', assumed: light-pollution data not loaded'}) and your deep-sky camera frame (short side {frameShortDeg.toFixed(
      2,
    )}°). Catalogue: OpenNGC (CC BY-SA 4.0).
  </p>
</section>

<style>
  .targets {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
  }
  h2 {
    font-size: 13px;
    margin: 0;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h3 {
    font-size: 13px;
    color: var(--muted);
    margin: 12px 0 4px;
  }
  .filters {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    border-radius: 999px;
    min-height: 30px;
    padding: 2px 10px;
    font-size: 13px;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .list li {
    display: grid;
    grid-template-columns: 1.6em minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .rank {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .name,
  .meta,
  .why {
    margin: 0;
  }
  .common {
    color: var(--muted);
  }
  .meta,
  .why {
    font-size: 12px;
    color: var(--muted);
  }
  .why {
    color: var(--text);
    opacity: 0.85;
  }
  .score {
    min-width: 2.6em;
    text-align: center;
    border-radius: 6px;
    padding: 2px 6px;
    font-weight: 600;
    color: #000;
    font-variant-numeric: tabular-nums;
  }
  .score.great {
    background: var(--good);
  }
  .score.ok {
    background: var(--accent);
  }
  .score.meh {
    background: var(--warn);
  }
  .score.bad {
    background: var(--bad);
  }
  .go {
    font-size: 13px;
    padding: 4px 10px;
  }
  @media (max-width: 520px) {
    .list li {
      grid-template-columns: 1.4em minmax(0, 1fr) auto;
    }
    .go {
      grid-column: 2 / -1;
      justify-self: start;
    }
  }
  .planets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 14px;
  }
  .link {
    background: none;
    border: none;
    padding: 0 6px 0 0;
    min-height: 28px;
    color: var(--accent);
    text-decoration: underline;
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    margin: 10px 0 0;
  }
</style>
