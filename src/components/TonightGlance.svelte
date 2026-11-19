<script lang="ts">
  /**
   * Tonight at a glance: the go / marginal / no-go verdict in one sentence, why, and the
   * handful of numbers that decide a night. Details (hourly table, cards) follow below it.
   */
  import type { Verdict } from '../lib/plan/verdict';
  import type { MoonEvents } from '../lib/conditions';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    v: Verdict;
    moon: MoonEvents;
    tz: string | undefined;
    expert: boolean;
    sqm: { value: number | null; source: 'measured' | 'model' | 'none'; bortle: number | null };
  }
  let { v, moon, tz, expert, sqm }: Props = $props();

  const GLYPH: Record<Verdict['level'], string> = {
    go: '●',
    maybe: '◐',
    nogo: '○',
    nodark: '○',
    unknown: '…',
  };
  const WORD: Record<Verdict['level'], string> = {
    go: 'Go',
    maybe: 'Marginal',
    nogo: 'No-go',
    nodark: 'No darkness',
    unknown: 'Waiting',
  };
  const t = (ms: number | null | undefined) => (ms == null ? 'n/a' : fmtTime(ms, tz));
  const hours = (a: number, b: number) => ((b - a) / 3600_000).toFixed(1);
</script>

<div class="glance" data-level={v.level} aria-live="polite">
  <p class="verdict">
    <span class="tag"><span aria-hidden="true">{GLYPH[v.level]}</span> {WORD[v.level]}</span>
    <span class="head">{v.headline}</span>
  </p>
  <dl class="facts">
    <div>
      <dt>Darkness</dt>
      <dd>
        {#if v.dark}
          {t(v.dark.start)}–{t(v.dark.end)}
          <span class="sub">{hours(v.dark.start, v.dark.end)} h {v.dark.kind}</span>
        {:else}n/a{/if}
      </dd>
    </div>
    <div>
      <dt>Best hour</dt>
      <dd>
        {#if v.best}{t(v.best.t)} <span class="sub">score {v.best.score} / 100</span>{:else}n/a{/if}
      </dd>
    </div>
    <div>
      <dt>Moon</dt>
      <dd>
        {Math.round(moon.illumination * 100)} % lit
        <span class="sub">rises {t(moon.rise?.getTime())}, sets {t(moon.set?.getTime())}</span>
      </dd>
    </div>
    <div>
      <dt>Clouds</dt>
      <dd>
        {v.clouds == null ? 'n/a' : `${Math.round(v.clouds)} %`}
        <span class="sub">mean during darkness</span>
      </dd>
    </div>
    <div>
      <dt>Seeing</dt>
      <dd>
        {v.seeing == null ? 'n/a' : `${v.seeing.toFixed(1)}″`}
        <span class="sub">forecast (estimate)</span>
      </dd>
    </div>
    <div>
      <dt>Transparency</dt>
      <dd>
        {v.transparency == null ? 'n/a' : `${Math.round(v.transparency * 100)} %`}
        <span class="sub">of a clean sky's signal</span>
      </dd>
    </div>
    <div>
      <dt>Dew</dt>
      <dd>{v.dewHours ? `${v.dewHours} h high risk` : 'low risk'}</dd>
    </div>
    <div>
      <dt>Sky brightness</dt>
      <dd>
        {sqm.value == null ? 'n/a' : `${sqm.value.toFixed(2)} mag/arcsec²`}
        <span class="sub">
          {sqm.source === 'measured'
            ? 'your measurement'
            : sqm.source === 'model'
              ? 'light-pollution model'
              : 'no data'}{sqm.bortle ? `, Bortle ${sqm.bortle}` : ''}
        </span>
      </dd>
    </div>
  </dl>

  <!-- The reasons come last: they arrive with the forecast and must not push the figures. -->
  <ul class="why">
    {#each v.reasons.slice(0, expert ? 8 : 4) as r (r)}<li>{r}</li>{/each}
  </ul>
</div>

<style>
  .glance {
    display: grid;
    gap: var(--s3);
    padding: var(--s5);
    background: var(--ink-1);
    border: 1px solid var(--rule);
    border-radius: var(--r-section);
  }
  .verdict {
    margin: 0;
    /* The headline grows when the forecast arrives: hold room for two lines of it. */
    min-height: calc(var(--fs-18) * 1.4 + var(--s2) + 2 * var(--fs-21) * var(--lh-head));
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s2) var(--s3);
  }
  .tag {
    font-weight: 700;
    font-size: var(--fs-18);
  }
  [data-level='go'] .tag {
    color: var(--go);
  }
  [data-level='maybe'] .tag {
    color: var(--maybe);
  }
  [data-level='nogo'] .tag,
  [data-level='nodark'] .tag {
    color: var(--nogo);
  }
  .head {
    font-family: var(--font-name);
    font-style: italic;
    font-weight: 600;
    font-size: var(--fs-24);
    line-height: var(--lh-head);
  }
  .why {
    margin: 0;
    padding-left: 1.2em;
    max-width: var(--measure);
    color: var(--text);
  }
  .why li {
    margin: 2px 0;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
    gap: var(--s3) var(--s5);
  }
  .facts div {
    display: grid;
    gap: 2px;
  }
  dt {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  dd {
    margin: 0;
    font-size: var(--fs-18);
  }
  .sub {
    display: block;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  @media (max-width: 599px) {
    .glance {
      padding: var(--s4);
    }
    .head {
      font-size: var(--fs-21);
    }
  }
</style>
