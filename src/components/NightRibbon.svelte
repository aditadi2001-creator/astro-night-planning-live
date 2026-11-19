<script lang="ts">
  /**
   * The night ribbon: sunset → sunrise, twilight bands, Moon-up bar, cloud per
   * hour, best imaging window (brass) and a needle for the shown time. It is the
   * time scrubber for both pages: drag, click, or use the arrow keys.
   */
  import type { TwilightTimes } from '../lib/conditions';
  import {
    bestWindow,
    frac,
    moonUpSpans,
    ribbonSpan,
    twilightSegments,
    type Band,
    type RibbonHour,
  } from '../lib/ribbon';
  import { fmtTime } from '../lib/time/format';

  interface Props {
    tw: TwilightTimes;
    hours: RibbonHour[];
    shown: number;
    now: number;
    live: boolean;
    tz: string | undefined;
    onpick: (t: number, live: boolean) => void;
  }
  let { tw, hours, shown, now, live, tz, onpick }: Props = $props();

  const span = $derived(ribbonSpan(tw, now));
  const segs = $derived(twilightSegments(tw, span));
  const best = $derived(bestWindow(hours));
  const moonUp = $derived(moonUpSpans(hours));
  const pct = (t: number) => `${(frac(t, span) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${((frac(b, span) - frac(a, span)) * 100).toFixed(3)}%`;
  const inSpan = $derived(shown >= span.start && shown <= span.end);

  const BAND_VAR: Record<Band, string> = {
    day: 'var(--ink-2)',
    civil: 'var(--twilight-civil)',
    nautical: 'var(--twilight-nautical)',
    astro: 'var(--twilight-astro)',
    dark: 'var(--ink-0)',
  };

  let track: HTMLDivElement;
  let dragging = false;
  function timeAt(clientX: number): number {
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    // Snap to 5 minutes: precise enough, and the label stays readable.
    const t = span.start + f * (span.end - span.start);
    return Math.round(t / 300_000) * 300_000;
  }
  function down(e: PointerEvent) {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    onpick(timeAt(e.clientX), false);
  }
  function move(e: PointerEvent) {
    if (dragging) onpick(timeAt(e.clientX), false);
  }
  function up() {
    dragging = false;
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 3600_000 : 600_000;
    const base = inSpan ? shown : now;
    let t: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = base + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = base - step;
    else if (e.key === 'Home') t = span.start;
    else if (e.key === 'End') t = span.end;
    if (t == null) return;
    e.preventDefault();
    onpick(Math.min(span.end, Math.max(span.start, t)), false);
  }

  const label = $derived(
    `Shown time ${fmtTime(shown, tz)}${live ? ' (now)' : ''}. Sunset ${fmtTime(tw.sunset, tz)}, ` +
      `dark ${fmtTime(tw.astroEnd, tz)} to ${fmtTime(tw.astroStart, tz)}, sunrise ${fmtTime(tw.sunrise, tz)}` +
      (best ? `. Best window ${fmtTime(best.start, tz)} to ${fmtTime(best.end, tz)}` : ''),
  );
</script>

<div class="ribbon">
  <span class="edge">
    <span class="k">Sunset</span>
    <span class="v">{fmtTime(tw.sunset, tz)}</span>
  </span>
  <div
    class="track"
    bind:this={track}
    role="slider"
    tabindex="0"
    aria-label="Night timeline: drag or use the arrow keys to change the shown time"
    aria-valuemin={span.start}
    aria-valuemax={span.end}
    aria-valuenow={Math.min(span.end, Math.max(span.start, shown))}
    aria-valuetext={label}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  >
    {#each segs as s (s.from)}
      <span
        class="band"
        style:left={pct(s.from)}
        style:width={width(s.from, s.to)}
        style:background={BAND_VAR[s.band]}
      ></span>
    {/each}
    {#each hours as h (h.t)}
      {#if h.cloud != null && h.t + 3600_000 > span.start && h.t < span.end}
        <span
          class="cloud"
          style:left={pct(h.t)}
          style:width={width(h.t, h.t + 3600_000)}
          style:opacity={Math.min(0.85, (h.cloud / 100) * 0.85)}
        ></span>
      {/if}
    {/each}
    {#each moonUp as m (m.start)}
      <span class="moon" style:left={pct(m.start)} style:width={width(m.start, m.end)}></span>
    {/each}
    {#if best}
      <span class="best" style:left={pct(best.start)} style:width={width(best.start, best.end)}
      ></span>
    {/if}
    {#if now >= span.start && now <= span.end}
      <span class="now" style:left={pct(now)}></span>
    {/if}
    {#if inSpan}
      <span class="needle" style:left={pct(shown)}>
        <span class="tip">{fmtTime(shown, tz)}</span>
      </span>
    {/if}
  </div>
  <span class="edge right">
    <span class="k">Sunrise</span>
    <span class="v">{fmtTime(tw.sunrise, tz)}</span>
  </span>
  <button
    class="nowbtn"
    aria-pressed={live}
    onclick={() => onpick(Date.now(), true)}
    title="Back to the current time"
  >
    Now
  </button>
</div>

<style>
  .ribbon {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s4) var(--s3);
  }
  .edge {
    display: grid;
    line-height: 1.15;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .edge.right {
    text-align: right;
  }
  .edge .v {
    font-size: var(--fs-14);
    color: var(--text);
  }
  .track {
    position: relative;
    height: 30px;
    border-radius: var(--r-input);
    overflow: visible;
    background: var(--ink-2);
    cursor: ew-resize;
    touch-action: none;
    outline-offset: 3px;
  }
  .band,
  .cloud,
  .moon,
  .best {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .band:first-child {
    border-radius: var(--r-input) 0 0 var(--r-input);
  }
  .cloud {
    background: var(--cloud);
  }
  .moon {
    top: auto;
    height: 4px;
    bottom: 0;
    background: var(--text-2);
    opacity: 0.8;
  }
  .best {
    top: auto;
    height: 4px;
    top: 0;
    background: var(--brass);
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--text-2);
  }
  .needle {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--brass);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: -2px;
    left: 6px;
    padding: 0 4px;
    font-size: var(--fs-12);
    line-height: 16px;
    color: var(--brass-ink);
    background: var(--brass);
    border-radius: 3px;
    white-space: nowrap;
  }
  .nowbtn {
    min-height: 32px;
    padding: 2px 10px;
  }
  .nowbtn[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  @media (max-width: 599px) {
    .ribbon {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--s2);
      padding: var(--s1) var(--s3) var(--s2);
    }
    .edge {
      display: none;
    }
  }
</style>
