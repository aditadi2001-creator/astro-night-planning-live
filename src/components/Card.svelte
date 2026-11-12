<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    credit?: string;
    /** Short status shown next to the title, e.g. "forecast" or "estimate". */
    tag?: string;
    children: Snippet;
  }
  let { title, credit, tag, children }: Props = $props();
</script>

<article class="card">
  <h2>
    {title}{#if tag}<span class="tag">{tag}</span>{/if}
  </h2>
  {@render children()}
  {#if credit}<p class="credit-line">{credit}</p>{/if}
</article>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    min-width: 0;
  }
  h2 {
    font-size: 13px;
    margin: 0 0 8px;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tag {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 6px;
    color: var(--muted);
    text-transform: none;
  }
  .card :global(dl) {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 8px;
  }
  .card :global(dt) {
    color: var(--muted);
  }
  .card :global(dd) {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .credit-line {
    margin: 6px 0 0;
  }
</style>
