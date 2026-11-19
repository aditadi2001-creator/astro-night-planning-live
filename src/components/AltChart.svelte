<script lang="ts">
  /**
   * Altitude chart for one target tonight: twilight bands, the minimum-altitude line, the
   * horizon (terrain or custom) along the object's path as a shaded floor, the object (brass),
   * the Moon (dashed) and the shown time.
   */
  import type { TwilightTimes } from '../lib/conditions';
  import { ribbonSpan, twilightSegments, type Band } from '../lib/ribbon';
  import { horizonAlt, type CurvePoint } from '../lib/plan/curves';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    obj: CurvePoint[];
    moon: CurvePoint[];
    tw: TwilightTimes;
    minAlt: number;
    horizon: ArrayLike<number> | null;
    shown: number;
    tz: string | undefined;
    label: string;
  }
  let { obj, moon, tw, minAlt, horizon, shown, tz, label }: Props = $props();

  const W = 640;
  const H = 200;
  const L = 34;
  const R = 8;
  const T = 8;
  const B = 24;
  const span = $derived(ribbonSpan(tw, obj[0]?.t ?? shown));
  const x = (t: number) => L + ((t - span.start) / (span.end - span.start)) * (W - L - R);
  const y = (alt: number) => T + (1 - Math.max(0, Math.min(90, alt)) / 90) * (H - T - B);
  const BAND: Record<Band, string> = {
    day: 'var(--ink-2)',
    civil: 'var(--twilight-civil)',
    nautical: 'var(--twilight-nautical)',
    astro: 'var(--twilight-astro)',
    dark: 'var(--ink-0)',
  };
  const inSpan = (p: CurvePoint) => p.t >= span.start && p.t <= span.end;
  const path = (pts: CurvePoint[]) =>
    pts
      .filter(inSpan)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.alt).toFixed(1)}`)
      .join('');
  const floor = $derived.by(() => {
    if (!horizon) return '';
    const pts = obj.filter(inSpan);
    if (!pts.length) return '';
    const top = pts.map((p) => `${x(p.t).toFixed(1)},${y(horizonAlt(horizon, p.az)).toFixed(1)}`);
    const a = pts[0]?.t ?? span.start;
    const b = pts.at(-1)?.t ?? span.end;
    return `M${x(a).toFixed(1)},${y(0)}L${top.join('L')}L${x(b).toFixed(1)},${y(0)}Z`;
  });
  const ticks = $derived.by(() => {
    const out: number[] = [];
    const first = Math.ceil(span.start / 7200_000) * 7200_000;
    for (let t = first; t < span.end; t += 7200_000) out.push(t);
    return out;
  });
</script>

<svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label={label}>
  {#each twilightSegments(tw, span) as s (s.from)}
    <rect
      x={x(s.from)}
      y={T}
      width={Math.max(0, x(s.to) - x(s.from))}
      height={H - T - B}
      fill={BAND[s.band]}
    />
  {/each}
  {#if floor}<path d={floor} class="floor" />{/if}
  {#each [0, 30, 60, 90] as a (a)}
    <line x1={L} x2={W - R} y1={y(a)} y2={y(a)} class="grid" />
    <text x={L - 6} y={y(a) + 4} class="yl">{a}°</text>
  {/each}
  <line x1={L} x2={W - R} y1={y(minAlt)} y2={y(minAlt)} class="min" />
  <path d={path(moon)} class="moon" />
  <path d={path(obj)} class="obj" />
  {#if shown >= span.start && shown <= span.end}
    <line x1={x(shown)} x2={x(shown)} y1={T} y2={H - B} class="now" />
  {/if}
  {#each ticks as t (t)}
    <text x={x(t)} y={H - 6} class="xl">{fmtTime(t, tz)}</text>
  {/each}
</svg>
<p class="legend">
  <span class="k obj-k"></span> target <span class="k moon-k"></span> Moon
  <span class="k min-k"></span>
  {minAlt}° minimum {#if horizon}<span class="k floor-k"></span> horizon{/if}
</p>

<style>
  .chart {
    width: 100%;
    height: auto;
    display: block;
  }
  .grid {
    stroke: var(--rule);
    stroke-width: 0.5;
  }
  .yl,
  .xl {
    fill: var(--text-2);
    font-size: 11px;
    font-family: var(--font-ui);
  }
  .yl {
    text-anchor: end;
  }
  .xl {
    text-anchor: middle;
  }
  .min {
    stroke: var(--text-2);
    stroke-dasharray: 2 3;
  }
  .floor {
    fill: var(--ink-2);
    opacity: 0.9;
  }
  .obj {
    fill: none;
    stroke: var(--brass);
    stroke-width: 2.5;
  }
  .moon {
    fill: none;
    stroke: var(--text-2);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .now {
    stroke: var(--text);
    stroke-width: 1;
  }
  .legend {
    margin: var(--s1) 0 0;
    font-size: var(--fs-12);
    color: var(--text-2);
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;
  }
  .k {
    display: inline-block;
    width: 16px;
    height: 0;
    border-top: 2.5px solid var(--brass);
    vertical-align: middle;
    margin-right: 4px;
  }
  .moon-k {
    border-top: 1.5px dashed var(--text-2);
  }
  .min-k {
    border-top: 1px dotted var(--text-2);
  }
  .floor-k {
    height: 8px;
    border: 0;
    background: var(--ink-2);
  }
</style>
