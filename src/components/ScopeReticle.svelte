<script lang="ts">
  /**
   * Where the telescope points, drawn on the sky every frame: a ring with a cross and a label.
   * When it is off-screen, an arrow on the edge shows which way to look.
   */
  import { onMount } from 'svelte';
  import { icrfToScreen, type Stel } from '../lib/engine/stel';

  interface Props {
    stel: Stel | null;
    canvas: HTMLCanvasElement | undefined;
    /** J2000 degrees. */
    ra: number;
    dec: number;
    label: string;
    slewing: boolean;
  }
  let { stel, canvas, ra, dec, label, slewing }: Props = $props();

  let pos = $state<{ x: number; y: number; on: boolean; angle: number } | null>(null);
  let w = $state(0);
  let h = $state(0);

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const s = stel;
      if (s && canvas) {
        w = canvas.clientWidth;
        h = canvas.clientHeight;
        const r = (ra * Math.PI) / 180;
        const d = (dec * Math.PI) / 180;
        const p = icrfToScreen(s, [
          Math.cos(d) * Math.cos(r),
          Math.cos(d) * Math.sin(r),
          Math.sin(d),
        ]);
        const on = !!p && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h;
        if (p && on) pos = { x: p[0], y: p[1], on: true, angle: 0 };
        else {
          // Direction from the centre (behind the viewer: no reliable direction, so point up).
          const angle = p ? Math.atan2(p[1] - h / 2, p[0] - w / 2) : -Math.PI / 2;
          const m = 22;
          const k = Math.min(
            Math.abs((w / 2 - m) / (Math.cos(angle) || 1e-9)),
            Math.abs((h / 2 - m) / (Math.sin(angle) || 1e-9)),
          );
          pos = {
            x: w / 2 + Math.cos(angle) * k,
            y: h / 2 + Math.sin(angle) * k,
            on: false,
            angle,
          };
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if pos && w > 0}
  <svg class="scope" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
    {#if pos.on}
      <g transform={`translate(${pos.x} ${pos.y})`} class:slewing>
        <circle r="18" />
        <path d="M-28,0H-10M10,0H28M0,-28V-10M0,10V28" />
        <text y="-24" text-anchor="middle">{label}</text>
      </g>
    {:else}
      <g transform={`translate(${pos.x} ${pos.y}) rotate(${(pos.angle * 180) / Math.PI})`}>
        <path class="arrow" d="M10,0L-6,-8L-6,8Z" />
      </g>
      <text
        x={Math.min(w - 80, Math.max(80, pos.x))}
        y={pos.y + (pos.y > h / 2 ? -16 : 22)}
        text-anchor="middle">{label}</text
      >
    {/if}
  </svg>
{/if}

<style>
  .scope {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    filter: var(--sky-filter);
  }
  circle,
  path {
    fill: none;
    stroke: var(--good);
    stroke-width: 2;
  }
  .arrow {
    fill: var(--good);
  }
  .slewing circle {
    stroke-dasharray: 6 5;
  }
  text {
    fill: var(--good);
    font-size: 12px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--sky);
    stroke-width: 3px;
  }
</style>
