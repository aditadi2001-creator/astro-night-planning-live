<script lang="ts">
  /**
   * Best targets tonight (Plan §2): ranked in a Web Worker from the full catalog, with per-type
   * tabs, presets, filters, an explainable score, filter advice for the active profile, and a
   * local "tonight plan" with NINA / JSON / calendar export.
   */
  import { onDestroy } from 'svelte';
  import TargetsWorker from '../lib/plan/targets.worker?worker';
  import type { TargetsResponse } from '../lib/plan/targets.worker';
  import type { Filters, Ranked, ScoreKind, Tab } from '../lib/plan/rank';
  import type { TwilightTimes } from '../lib/conditions';
  import type { Place } from '../lib/astro/sky';
  import type { Profile } from '../lib/profiles';
  import { profileStats } from '../lib/profiles';
  import { objectCurve, bodyCurve, yearCurve } from '../lib/plan/curves';
  import { ribbonSpan } from '../lib/ribbon';
  import { KIND_LABEL } from '../lib/search/index';
  import {
    autoOrder,
    decDms,
    download,
    raHms,
    savePlan,
    toIcs,
    toJson,
    toNinaCsv,
    type PlanItem,
  } from '../lib/plan/plan';
  import { fmtTime } from '../lib/time/format';
  import TypeSymbol from './TypeSymbol.svelte';
  import AltChart from './AltChart.svelte';

  interface Props {
    place: Place;
    tz: string | undefined;
    tw: TwilightTimes;
    dark: { start: number; end: number } | null;
    /** Cloud factor (0–1) per hour start. */
    clear: [number, number][];
    sqm: number;
    profile: Profile | null;
    horizon: ArrayLike<number> | null;
    shown: number;
    expert: boolean;
    plan: PlanItem[];
    onshow: (r: Ranked) => void;
  }
  let {
    place,
    tz,
    tw,
    dark,
    clear,
    sqm,
    profile,
    horizon,
    shown,
    expert,
    plan = $bindable(),
    onshow,
  }: Props = $props();

  type PresetId = 'none' | 'moonproof' | 'beginner' | 'frame' | 'narrowband';
  const PRESETS: { id: PresetId; label: string; hint: string; f: Filters }[] = [
    {
      id: 'moonproof',
      label: 'Moon-proof',
      hint: 'Emission and planetary nebulae, at least 40° from the Moon: narrowband works under moonlight.',
      f: { kinds: ['nebula', 'planetary', 'remnant'], moonSepMin: 40 },
    },
    {
      id: 'beginner',
      label: 'Beginner-friendly',
      hint: 'Bright (mag ≤ 9), large (≥ 5′) Messier and Caldwell objects.',
      f: { magMax: 9, sizeMin: 5, catalogs: ['M', 'C'] },
    },
    {
      id: 'frame',
      label: 'Fits my frame',
      hint: 'Objects filling 25–90 % of the short side of your camera frame.',
      f: { fitMin: 25, fitMax: 90 },
    },
    {
      id: 'narrowband',
      label: 'Narrowband tonight',
      hint: 'Emission, planetary nebulae and supernova remnants: best from a city sky.',
      f: { kinds: ['nebula', 'planetary', 'remnant'] },
    },
  ];
  const TABS: { id: Tab; label: string }[] = [
    { id: 'any', label: 'Any type' },
    { id: 'galaxy', label: 'Galaxies' },
    { id: 'nebula', label: 'Nebulae' },
    { id: 'cluster', label: 'Clusters' },
  ];
  const CATALOGS = [
    'M',
    'C',
    'H400',
    'NGC',
    'IC',
    'Sh2',
    'B',
    'LDN',
    'LBN',
    'vdB',
    'RCW',
    'Arp',
    'HCG',
    'Abell',
    'PN G',
    'SNR G',
    'Cr',
    'Mel',
    'Tr',
    'St',
    'UGC',
  ];
  const KINDS: { id: ScoreKind; label: string }[] = [
    { id: 'galaxy', label: 'Galaxy' },
    { id: 'nebula', label: 'Emission nebula' },
    { id: 'reflection', label: 'Reflection nebula' },
    { id: 'dark', label: 'Dark nebula' },
    { id: 'planetary', label: 'Planetary nebula' },
    { id: 'remnant', label: 'Supernova remnant' },
    { id: 'cluster', label: 'Open cluster' },
    { id: 'globular', label: 'Globular cluster' },
  ];

  let tab = $state<Tab>('any');
  let preset = $state<PresetId>('none');
  let showFilters = $state(false);
  let limit = $state(20);
  // Free filters (merged with the preset's).
  let f = $state({
    text: '',
    catalog: '',
    kinds: [] as ScoreKind[],
    constellation: '',
    magMax: '',
    sizeMin: '',
    sizeMax: '',
    sbMax: '',
    minAlt: '30',
    minHours: '',
    moonSepMin: '',
    fitMin: '',
    fitMax: '',
    visibleAt: '',
    raMin: '',
    raMax: '',
    decMin: '',
    decMax: '',
  });
  const n = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

  /** "21:30" (site-local, tonight) → ms. */
  function visibleAtMs(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m || !dark) return null;
    const off = (Number(m[1]) * 60 + Number(m[2])) * 60_000;
    // Search the night window for the moment whose local clock reads hh:mm.
    for (let t = dark.start - 6 * 3600_000; t < dark.end + 6 * 3600_000; t += 60_000) {
      const s = fmtTime(t, tz);
      const [h, mm] = s
        .replace(/\s?(AM|PM)/i, '')
        .split(':')
        .map(Number) as [number, number];
      const pm = /PM/i.test(s) && h !== 12 ? 12 : /AM/i.test(s) && h === 12 ? -12 : 0;
      if (((h + pm) * 60 + mm) * 60_000 === off) return t;
    }
    return null;
  }

  const filters = $derived.by<Filters>(() => {
    const p = PRESETS.find((x) => x.id === preset)?.f ?? {};
    const out: Filters = { ...p, minAlt: n(f.minAlt) ?? 30 };
    if (f.text.trim()) out.text = f.text.trim();
    if (f.catalog) out.catalogs = [f.catalog];
    if (f.kinds.length) out.kinds = f.kinds;
    if (f.constellation.trim())
      out.constellation =
        f.constellation.trim().slice(0, 1).toUpperCase() +
        f.constellation.trim().slice(1, 3).toLowerCase();
    const map: [keyof Filters, string][] = [
      ['magMax', f.magMax],
      ['sizeMin', f.sizeMin],
      ['sizeMax', f.sizeMax],
      ['sbMax', f.sbMax],
      ['minHours', f.minHours],
      ['moonSepMin', f.moonSepMin],
      ['fitMin', f.fitMin],
      ['fitMax', f.fitMax],
      ['decMin', f.decMin],
      ['decMax', f.decMax],
    ];
    for (const [k, v] of map) if (n(v) != null) (out as Record<string, unknown>)[k] = n(v);
    if (n(f.raMin) != null && n(f.raMax) != null) {
      out.raMin = (n(f.raMin) as number) * 15;
      out.raMax = (n(f.raMax) as number) * 15;
    }
    const va = visibleAtMs(f.visibleAt);
    if (va != null) out.visibleAt = va;
    return out;
  });

  const frame = $derived.by(() => {
    if (!profile) return { w: 1, h: 0.7 };
    const st = profileStats(profile);
    return { w: st.fovW, h: st.fovH };
  });

  // ---- worker ---------------------------------------------------------------------------
  let worker: Worker | null = null;
  let seq = 0;
  let list = $state<Ranked[]>([]);
  let considered = $state(0);
  let cloudShare = $state(0);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let error = $state('');
  let ms = $state(0);

  $effect(() => {
    if (!dark) {
      list = [];
      status = 'ready';
      return;
    }
    const input = {
      lat: place.lat,
      lon: place.lon,
      elevation: place.elevation,
      darkStart: dark.start,
      darkEnd: dark.end,
      clear: $state.snapshot(clear) as [number, number][],
      sqm,
      frameW: frame.w,
      frameH: frame.h,
      horizon: horizon ? Array.from(horizon) : null,
      filters: $state.snapshot(filters) as Filters,
      tab,
      limit,
      myFilters: profile ? [...profile.filters] : [],
    };
    const id = ++seq;
    status = list.length ? 'ready' : 'loading';
    const t = setTimeout(() => {
      worker ??= new TargetsWorker();
      worker.onmessage = (e: MessageEvent<TargetsResponse>) => {
        if (e.data.id !== seq) return;
        if (e.data.ok) {
          list = e.data.list;
          considered = e.data.considered;
          cloudShare = e.data.cloudLimitedShare;
          ms = e.data.ms;
          status = 'ready';
        } else {
          status = 'error';
          error = e.data.error;
        }
      };
      worker.postMessage({ id, input });
    }, 120);
    return () => clearTimeout(t);
  });
  onDestroy(() => worker?.terminate());

  // ---- rows ------------------------------------------------------------------------------
  let open = $state<string | null>(null);
  function where(r: Ranked): string {
    const dir = r.o.dec >= place.lat ? 'north' : 'south';
    return r.transit
      ? `highest at ${fmtTime(r.transit.t, tz)}, ${Math.round(r.transit.alt)}° up in the ${dir}`
      : '';
  }
  function spark(r: Ranked): string {
    const n = r.alts.length;
    if (n < 2) return '';
    return r.alts
      .map(
        (a, i) =>
          `${((i / (n - 1)) * 80).toFixed(1)},${(22 - (Math.max(0, a) / 90) * 20).toFixed(1)}`,
      )
      .join(' ');
  }
  function fit(r: Ranked) {
    // Frame drawn 44 px wide; object ellipse at the same scale (clipped when larger).
    const W = 44;
    const H = Math.max(12, Math.min(40, (W * frame.h) / frame.w));
    const k = W / frame.w;
    const rx = Math.max(1.5, ((r.o.maj ?? 1) / 60 / 2) * k);
    const ry = Math.max(1.5, ((r.o.min ?? r.o.maj ?? 1) / 60 / 2) * k);
    return { W, H, rx, ry, pa: r.o.pa ?? 0 };
  }
  const pct = (x: number) => `${Math.round(x * 100)} %`;

  // Details for the open row (computed on demand on the main thread: a few ms).
  const detail = $derived.by(() => {
    const r = list.find((x) => x.o.name === open);
    if (!r) return null;
    const span = ribbonSpan(tw, shown);
    const site = { lat: place.lat, lon: place.lon, elevation: place.elevation };
    return {
      r,
      obj: objectCurve(r.o.ra, r.o.dec, site, span.start, span.end, 10),
      moon: bodyCurve('Moon', site, span.start, span.end, 15),
      year: yearCurve(
        r.o.ra,
        r.o.dec,
        site,
        new Date(shown).getUTCFullYear(),
        filters.minAlt ?? 30,
        horizon,
      ),
    };
  });
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  // ---- plan ------------------------------------------------------------------------------
  const inPlan = (r: Ranked) => plan.some((p) => p.name === r.o.name);
  function togglePlan(r: Ranked) {
    plan = inPlan(r)
      ? plan.filter((p) => p.name !== r.o.name)
      : [
          ...plan,
          {
            name: r.o.name,
            common: r.o.common,
            type: KIND_LABEL[r.o.kind] ?? r.o.kind,
            ra: r.o.ra,
            dec: r.o.dec,
            pa: 0,
            window: r.window,
            transit: r.transit?.t ?? null,
          },
        ];
    savePlan(plan);
  }
  let copied = $state('');
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = ''), 1500);
    } catch {
      copied = 'Copy failed (clipboard blocked)';
    }
  }
  const dateTag = $derived(new Date(dark?.start ?? shown).toISOString().slice(0, 10));
</script>

<div class="targets">
  <div class="bar">
    <div class="tabs" role="tablist" aria-label="Object type">
      {#each TABS as t (t.id)}
        <button role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}
          >{t.label}</button
        >
      {/each}
      <a class="planets-link" href="#/plan?s=planets">Planets →</a>
    </div>
    <div class="presets" role="group" aria-label="Presets">
      {#each PRESETS as p (p.id)}
        <button
          aria-pressed={preset === p.id}
          title={p.hint}
          onclick={() => (preset = preset === p.id ? 'none' : p.id)}>{p.label}</button
        >
      {/each}
      <button
        class="ftoggle"
        aria-expanded={showFilters}
        onclick={() => (showFilters = !showFilters)}>Filters</button
      >
    </div>
  </div>
  {#if preset !== 'none'}
    <p class="hint">{PRESETS.find((p) => p.id === preset)?.hint}</p>
  {/if}

  {#if showFilters}
    <form class="filters" onsubmit={(e) => e.preventDefault()}>
      <label>Name contains<input bind:value={f.text} placeholder="e.g. veil, NGC 70" /></label>
      <label
        >Catalog
        <select bind:value={f.catalog}>
          <option value="">Any</option>
          {#each CATALOGS as c (c)}<option value={c}>{c}</option>{/each}
        </select>
      </label>
      <label
        >Constellation<input
          bind:value={f.constellation}
          placeholder="Ori, Cyg…"
          maxlength="3"
        /></label
      >
      <label>Minimum altitude (°)<input bind:value={f.minAlt} inputmode="numeric" /></label>
      <label
        >Minimum hours<input bind:value={f.minHours} inputmode="decimal" placeholder="any" /></label
      >
      <label>Visible at (site time)<input bind:value={f.visibleAt} placeholder="22:30" /></label>
      {#if expert}
        <label>Magnitude ≤<input bind:value={f.magMax} inputmode="decimal" /></label>
        <label>Size ≥ (′)<input bind:value={f.sizeMin} inputmode="decimal" /></label>
        <label>Size ≤ (′)<input bind:value={f.sizeMax} inputmode="decimal" /></label>
        <label
          >Surface brightness ≤ (mag/″²)<input bind:value={f.sbMax} inputmode="decimal" /></label
        >
        <label>Moon distance ≥ (°)<input bind:value={f.moonSepMin} inputmode="numeric" /></label>
        <label>Frame fit ≥ (%)<input bind:value={f.fitMin} inputmode="numeric" /></label>
        <label>Frame fit ≤ (%)<input bind:value={f.fitMax} inputmode="numeric" /></label>
        <label>RA from (h)<input bind:value={f.raMin} inputmode="decimal" /></label>
        <label>RA to (h)<input bind:value={f.raMax} inputmode="decimal" /></label>
        <label>Dec from (°)<input bind:value={f.decMin} inputmode="decimal" /></label>
        <label>Dec to (°)<input bind:value={f.decMax} inputmode="decimal" /></label>
      {/if}
      <fieldset class="kinds">
        <legend>Types</legend>
        {#each KINDS as k (k.id)}
          <label class="chk"
            ><input type="checkbox" value={k.id} bind:group={f.kinds} />
            <TypeSymbol kind={k.id} size={14} />
            {k.label}</label
          >
        {/each}
      </fieldset>
    </form>
  {/if}

  <p class="summary" role="status">
    {#if !dark}
      No astronomical or nautical darkness tonight, so there is nothing to rank.
    {:else if status === 'loading'}
      Ranking about 25,000 objects for tonight…
    {:else if status === 'error'}
      The catalog could not be loaded ({error}).
    {:else}
      {list.length} best of {considered.toLocaleString('en')} objects{expert ? ` (${ms} ms)` : ''},
      for
      {profile?.name ?? 'your frame'}, sky {sqm.toFixed(1)} mag/arcsec².
      {#if cloudShare > 0.5}<strong
          >Clouds are forecast for much of the night: most scores are held back by them.</strong
        >{/if}
    {/if}
  </p>

  <ol class="rows">
    {#each list as r, i (r.o.name)}
      <li class="row" class:open={open === r.o.name}>
        <div class="main">
          <span class="rank">{i + 1}</span>
          <TypeSymbol kind={r.o.sk} label={KIND_LABEL[r.o.kind] ?? r.o.kind} />
          <div class="id">
            <p class="name">
              <span class="obj-name">{r.o.name}</span>{#if r.o.common}<span class="common">
                  {r.o.common}</span
                >{/if}
            </p>
            <p class="meta">
              {KIND_LABEL[r.o.kind] ?? r.o.kind} in {r.o.con}
              {#if expert}
                · mag {r.o.mag ?? 'n/a'} · {r.o.maj ? `${r.o.maj}′` : 'size n/a'}{r.o.sb != null
                  ? ` · SB ${r.o.sb.toFixed(1)}`
                  : ''}
              {/if}
            </p>
            <p class="when">
              {where(r)} · {(Math.round(r.hours * 2) / 2).toFixed(1)} h usable{r.moonSep < 180
                ? ` · Moon ${Math.round(r.moonSep)}° away`
                : ''}
            </p>
            <p class="why">{r.why}</p>
            <p class="strat">
              <span class="lbl">Filters:</span>
              {r.strategy} <span class="diff" data-d={r.difficulty}>{r.difficulty}</span>
            </p>
          </div>
          <div class="viz" aria-hidden="true">
            {#if expert}
              <svg class="spark" viewBox="0 0 80 24"
                ><line
                  x1="0"
                  x2="80"
                  y1={22 - ((filters.minAlt ?? 30) / 90) * 20}
                  y2={22 - ((filters.minAlt ?? 30) / 90) * 20}
                  class="sl"
                /><polyline points={spark(r)} /></svg
              >
            {/if}
            {#if r.fill != null}
              {@const g = fit(r)}
              <svg class="fit" viewBox={`0 0 ${g.W} ${g.H}`} width={g.W} height={g.H}>
                <clipPath id={`c${i}`}><rect width={g.W} height={g.H} /></clipPath>
                <rect width={g.W} height={g.H} class="fr" />
                <ellipse
                  cx={g.W / 2}
                  cy={g.H / 2}
                  rx={g.rx}
                  ry={g.ry}
                  transform={`rotate(${-g.pa} ${g.W / 2} ${g.H / 2})`}
                  clip-path={`url(#c${i})`}
                  class="el"
                />
              </svg>
            {/if}
          </div>
          <div class="score" title="Score out of 100">{r.score}</div>
        </div>
        <div class="actions">
          <button onclick={() => onshow(r)}>Show in sky</button>
          <button aria-pressed={inPlan(r)} onclick={() => togglePlan(r)}
            >{inPlan(r) ? '✓ In plan' : '+ Plan'}</button
          >
          <button
            aria-expanded={open === r.o.name}
            onclick={() => (open = open === r.o.name ? null : r.o.name)}
            >{open === r.o.name ? 'Less' : 'Why this score?'}</button
          >
        </div>
        {#if open === r.o.name && detail}
          <div class="detail">
            <AltChart
              obj={detail.obj}
              moon={detail.moon}
              {tw}
              minAlt={filters.minAlt ?? 30}
              {horizon}
              {shown}
              {tz}
              label={`Altitude of ${r.o.name} tonight`}
            />
            <div class="cols">
              <div>
                <h4>Why this score ({r.score} / 100)</h4>
                <dl class="factors">
                  {#each [['Usable time (clouds weighted)', r.factors.time, `${r.clearHours.toFixed(1)} clear h of ${r.hours.toFixed(1)}; full marks at 4 h`], ['Moon', r.factors.moon, r.moonSep < 180 ? `${Math.round(r.moonSep)}° away at the closest` : 'down while usable'], ['Contrast against your sky', r.factors.contrast, r.o.sb != null ? `SB ${r.o.sb.toFixed(1)} vs sky ${sqm.toFixed(1)}` : 'surface brightness n/a'], ['Framing', r.factors.framing, r.fill != null ? `${Math.round(r.fill * 100)} % of the frame's short side` : 'size n/a'], ['Brightness', r.factors.brightness, r.o.mag != null ? `mag ${r.o.mag}` : 'magnitude n/a (catalog)']] as [label, v, note] (label)}
                    <div>
                      <dt>{label}</dt>
                      <dd>
                        <span class="barw"
                          ><span class="barf" style:width={pct(v as number)}></span></span
                        >
                        {pct(v as number)} <span class="note">{note}</span>
                      </dd>
                    </div>
                  {/each}
                </dl>
                <p class="note">
                  Score = 100 × time × Moon × contrast × framing × brightness (About → methods).
                </p>
              </div>
              <div>
                <h4>Best time of year</h4>
                <div
                  class="year"
                  role="img"
                  aria-label={`Hours of darkness above ${filters.minAlt ?? 30} degrees each month`}
                >
                  {#each detail.year as h, m (m)}
                    <span class="yb"
                      ><span class="yf" style:height={`${Math.min(100, (h / 10) * 100)}%`}
                      ></span><span class="ym">{MONTHS[m]}</span></span
                    >
                  {/each}
                </div>
                <p class="note">
                  Hours in astronomical darkness above {filters.minAlt ?? 30}° on the 15th of each
                  month.
                </p>
                <h4>Coordinates (J2000)</h4>
                <p class="coords">
                  RA {raHms(r.o.ra)} · Dec {decDms(r.o.dec)}
                  <button
                    onclick={() =>
                      copy(`${raHms(r.o.ra)} ${decDms(r.o.dec)}`, `Copied ${r.o.name}`)}
                    >Copy</button
                  >
                </p>
                {#if expert}<p class="note">
                    Also: {r.o.ids.slice(1, 8).join(' · ') || 'no other designations'}
                  </p>{/if}
              </div>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if list.length >= limit && limit < 60}
    <button class="more" onclick={() => (limit += 20)}>Show 20 more</button>
  {/if}

  <section class="plan" aria-labelledby="plan-h">
    <h3 id="plan-h">Tonight’s plan ({plan.length})</h3>
    {#if !plan.length}
      <p class="note">
        Add targets with “+ Plan”. The plan stays on this device and can be exported for NINA.
      </p>
    {:else}
      <ol class="plist">
        {#each plan as p (p.name)}
          <li>
            <span class="obj-name">{p.name}</span>{p.common ? ` ${p.common}` : ''}
            <span class="note"
              >{p.window
                ? `${fmtTime(p.window.start, tz)}–${fmtTime(p.window.end, tz)}`
                : 'window n/a'} · {raHms(p.ra)}
              {decDms(p.dec)}</span
            >
            <button
              class="x"
              aria-label={`Remove ${p.name} from the plan`}
              onclick={() => {
                plan = plan.filter((x) => x.name !== p.name);
                savePlan(plan);
              }}>×</button
            >
          </li>
        {/each}
      </ol>
      <div class="pactions">
        <button
          onclick={() => {
            plan = autoOrder(plan);
            savePlan(plan);
          }}>Order by best time</button
        >
        <button
          onclick={() => download(`targets-${dateTag}.csv`, toNinaCsv(plan), 'text/csv')}
          title="NINA 3.2+ sequencer “Import targets” and Target Scheduler">NINA CSV</button
        >
        <button
          onclick={() =>
            download(
              `plan-${dateTag}.json`,
              toJson(plan, { site: place.name, date: dateTag }),
              'application/json',
            )}>JSON</button
        >
        <button
          onclick={() =>
            download(`plan-${dateTag}.ics`, toIcs(plan, dark, place.name), 'text/calendar')}
          >Calendar (.ics)</button
        >
        <button
          onclick={() =>
            copy(
              plan.map((p) => `${p.name}\t${raHms(p.ra)}\t${decDms(p.dec)}`).join('\n'),
              'Plan copied',
            )}>Copy list</button
        >
        <button onclick={() => window.print()}>Print</button>
      </div>
    {/if}
    {#if copied}<p class="note" role="status">{copied}</p>{/if}
  </section>
</div>

<style>
  .targets {
    display: grid;
    gap: var(--s3);
    grid-template-columns: minmax(0, 1fr);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2) var(--s4);
    justify-content: space-between;
    align-items: center;
  }
  .tabs,
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
    align-items: center;
  }
  .tabs button {
    background: transparent;
    border-color: transparent;
  }
  .tabs button[aria-selected='true'] {
    border-color: var(--rule);
    background: var(--ink-2);
    box-shadow: inset 0 -2px 0 var(--brass);
  }
  .planets-link {
    color: var(--brass);
    font-size: var(--fs-14);
    margin-left: var(--s2);
  }
  .presets button {
    font-size: var(--fs-14);
    border-radius: var(--r-pill);
  }
  .presets button[aria-pressed='true'] {
    background: var(--brass);
    color: var(--brass-ink);
    border-color: var(--brass);
  }
  .hint,
  .note {
    margin: 0;
    font-size: var(--fs-14);
    color: var(--text-2);
  }
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
    gap: var(--s2) var(--s3);
    padding: var(--s4);
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
  }
  .filters label {
    display: grid;
    gap: 2px;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .filters input,
  .filters select {
    font: inherit;
    font-size: var(--fs-14);
    color: var(--text);
    background: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 6px 8px;
    min-height: 36px;
  }
  .kinds {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1) var(--s3);
    border: 0;
    padding: 0;
    margin: 0;
  }
  .kinds legend {
    font-size: var(--fs-12);
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .chk {
    display: flex !important;
    align-items: center;
    gap: 6px !important;
    color: var(--text) !important;
    font-size: var(--fs-14) !important;
  }
  .summary {
    margin: 0;
    color: var(--text-2);
  }
  .summary strong {
    color: var(--maybe);
    font-weight: 500;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s2);
  }
  .row {
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    padding: var(--s3) var(--s4);
    display: grid;
    gap: var(--s2);
  }
  .main {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto auto;
    gap: var(--s3);
    align-items: start;
  }
  .rank {
    color: var(--text-2);
    font-size: var(--fs-14);
    min-width: 1.5em;
    text-align: right;
    padding-top: 2px;
  }
  .id p {
    margin: 0;
  }
  .name {
    font-size: var(--fs-18);
  }
  .common {
    color: var(--text-2);
    margin-left: 0.35em;
  }
  .meta,
  .when {
    font-size: var(--fs-14);
    color: var(--text-2);
  }
  .why {
    font-size: var(--fs-14);
  }
  .strat {
    font-size: var(--fs-14);
  }
  .lbl {
    color: var(--text-2);
  }
  .diff {
    font-size: var(--fs-12);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 0 6px;
    margin-left: 4px;
    color: var(--text-2);
  }
  .viz {
    display: grid;
    gap: 6px;
    justify-items: end;
  }
  .spark {
    width: 80px;
    height: 24px;
  }
  .spark polyline {
    fill: none;
    stroke: var(--brass);
    stroke-width: 1.5;
  }
  .sl {
    stroke: var(--rule);
    stroke-dasharray: 2 2;
  }
  .fr {
    fill: var(--ink-0);
    stroke: var(--text-2);
    stroke-width: 1;
  }
  .el {
    fill: none;
    stroke: var(--brass);
    stroke-width: 1.2;
  }
  .score {
    font-size: var(--fs-21);
    font-weight: 700;
    min-width: 2.2em;
    text-align: center;
    padding: 2px 6px;
    border-radius: var(--r-input);
    background: var(--ink-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
    padding-left: calc(1.5em + 18px + 2 * var(--s3));
  }
  .actions button {
    font-size: var(--fs-14);
  }
  .actions button[aria-pressed='true'] {
    border-color: var(--go);
    color: var(--go);
  }
  .detail {
    border-top: 1px solid var(--rule);
    padding-top: var(--s3);
    display: grid;
    gap: var(--s3);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: var(--s4);
  }
  h4 {
    margin: 0 0 var(--s2);
    font-size: var(--fs-14);
    font-weight: 600;
  }
  .factors {
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .factors dt {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .factors dd {
    margin: 0;
    font-size: var(--fs-14);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .barw {
    width: 90px;
    height: 6px;
    background: var(--ink-2);
    border-radius: 3px;
    overflow: hidden;
  }
  .barf {
    display: block;
    height: 100%;
    background: var(--brass);
  }
  .year {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 3px;
    height: 70px;
    align-items: end;
  }
  .yb {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    align-items: end;
  }
  .yf {
    display: block;
    background: var(--brass);
    border-radius: 2px 2px 0 0;
    min-height: 1px;
  }
  .ym {
    font-size: 10px;
    color: var(--text-2);
    text-align: center;
  }
  .coords {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
  }
  .more {
    justify-self: start;
  }
  .plan {
    margin-top: var(--s4);
    padding: var(--s4);
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
    display: grid;
    gap: var(--s2);
  }
  .plan h3 {
    margin: 0;
    font-family: var(--font-name);
    font-style: italic;
    font-weight: 600;
    font-size: var(--fs-21);
  }
  .plist {
    margin: 0;
    padding-left: 1.4em;
    display: grid;
    gap: 4px;
  }
  .plist li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--s2);
    align-items: baseline;
  }
  .x {
    min-height: 28px;
    padding: 0 8px;
    margin-left: auto;
  }
  .pactions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  @media (max-width: 599px) {
    .main {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .rank {
      display: none;
    }
    .viz {
      display: none;
    }
    .actions {
      padding-left: 0;
    }
  }
  @media print {
    .bar,
    .filters,
    .actions,
    .pactions,
    .more {
      display: none;
    }
  }
</style>
