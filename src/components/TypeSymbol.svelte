<script lang="ts">
  /**
   * Printed-atlas symbol for an object type (DESIGN.md): ellipse = galaxy, square = bright
   * nebula, dashed square = dark nebula, dotted circle = open cluster, circle + cross = globular,
   * circle + rays = planetary nebula, double ring = supernova remnant. Shape carries the meaning;
   * colour only helps.
   */
  import type { ScoreKind } from '../lib/plan/rank';
  let {
    kind,
    size = 18,
    label,
  }: { kind: ScoreKind | 'planet' | 'star'; size?: number; label?: string } = $props();
  const COLOR: Record<string, string> = {
    galaxy: 'var(--obj-galaxy)',
    nebula: 'var(--obj-emission)',
    reflection: 'var(--obj-reflection)',
    dark: 'var(--obj-dark)',
    planetary: 'var(--obj-planetary)',
    cluster: 'var(--obj-open)',
    globular: 'var(--obj-globular)',
    remnant: 'var(--obj-remnant)',
    planet: 'var(--obj-planet)',
    star: 'var(--obj-star)',
    other: 'var(--text-2)',
  };
</script>

<svg
  viewBox="0 0 20 20"
  width={size}
  height={size}
  style:color={COLOR[kind] ?? COLOR.other}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {#if kind === 'galaxy'}
    <ellipse cx="10" cy="10" rx="8" ry="4" transform="rotate(-30 10 10)" />
  {:else if kind === 'nebula' || kind === 'reflection'}
    <rect x="3" y="3" width="14" height="14" rx="1" />
  {:else if kind === 'dark'}
    <rect x="3" y="3" width="14" height="14" stroke-dasharray="3 2" />
  {:else if kind === 'cluster'}
    <circle cx="10" cy="10" r="7" stroke-dasharray="1.5 2" />
  {:else if kind === 'globular'}
    <circle cx="10" cy="10" r="7" /><path d="M10 3v14M3 10h14" />
  {:else if kind === 'planetary'}
    <circle cx="10" cy="10" r="4.5" /><path d="M10 1v4M10 15v4M1 10h4M15 10h4" />
  {:else if kind === 'remnant'}
    <circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="4" />
  {:else if kind === 'planet'}
    <circle cx="10" cy="10" r="5" /><path d="M2 13c5 1 11-3 16-7" />
  {:else}
    <circle cx="10" cy="10" r="3" fill="currentColor" />
  {/if}
</svg>

<style>
  svg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    vertical-align: middle;
  }
</style>
