<script lang="ts" module>
  export interface TourStep {
    /** CSS selector of the control to point at (skipped when it is not on the page). */
    sel: string;
    title: string;
    text: string;
  }
  export const TOUR_KEY = 'anp.tour.v1';
  export function tourSeen(): boolean {
    try {
      return localStorage.getItem(TOUR_KEY) != null;
    } catch {
      return true;
    }
  }
  export function markTourSeen(): void {
    try {
      localStorage.setItem(TOUR_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  }
</script>

<script lang="ts">
  /**
   * A short guided tour: a ring around one control at a time and a card that explains it.
   * Next / Back / Esc; the card takes the focus so screen readers read it.
   */
  import { tick } from 'svelte';

  interface Props {
    steps: TourStep[];
    onclose: () => void;
  }
  let { steps, onclose }: Props = $props();

  const shown = $derived(steps.filter((s) => document.querySelector(s.sel)));
  let i = $state(0);
  let rect = $state<DOMRect | null>(null);
  let card = $state<HTMLDivElement>();
  const step = $derived(shown[i]);

  function measure() {
    const el = step ? document.querySelector(step.sel) : null;
    if (!el) {
      rect = null;
      return;
    }
    el.scrollIntoView({ block: 'nearest' });
    rect = el.getBoundingClientRect();
  }
  $effect(() => {
    void i;
    measure();
    void tick().then(() => card?.focus());
    const on = () => measure();
    addEventListener('resize', on);
    addEventListener('scroll', on, true);
    return () => {
      removeEventListener('resize', on);
      removeEventListener('scroll', on, true);
    };
  });
  function finish() {
    markTourSeen();
    onclose();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (i < shown.length - 1) i++;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (i > 0) i--;
    }
  }
  /** The card goes below the control, or above it when there is no room. */
  const pos = $derived.by(() => {
    if (!rect) return { top: 80, left: 16 };
    const w = Math.min(340, innerWidth - 24);
    const left = Math.max(12, Math.min(innerWidth - w - 12, rect.left + rect.width / 2 - w / 2));
    const below = rect.bottom + 12;
    const top = below + 180 < innerHeight ? below : Math.max(12, rect.top - 192);
    return { top, left };
  });
</script>

{#if step}
  {#if rect}
    <div
      class="ring"
      aria-hidden="true"
      style:top={`${rect.top - 6}px`}
      style:left={`${rect.left - 6}px`}
      style:width={`${rect.width + 12}px`}
      style:height={`${rect.height + 12}px`}
    ></div>
  {/if}
  <div
    class="card"
    role="dialog"
    aria-modal="false"
    aria-labelledby="tour-title"
    aria-describedby="tour-text"
    tabindex="-1"
    bind:this={card}
    onkeydown={key}
    style:top={`${pos.top}px`}
    style:left={`${pos.left}px`}
  >
    <p class="count">{i + 1} of {shown.length}</p>
    <h2 id="tour-title">{step.title}</h2>
    <p id="tour-text">{step.text}</p>
    <div class="row">
      <button onclick={finish}>Skip</button>
      <span class="grow"></span>
      {#if i > 0}<button onclick={() => i--}>Back</button>{/if}
      {#if i < shown.length - 1}
        <button class="primary" onclick={() => i++}>Next</button>
      {:else}
        <button class="primary" onclick={finish}>Done</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ring {
    position: fixed;
    z-index: 70;
    border: 2px solid var(--brass);
    border-radius: 10px;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.45);
    pointer-events: none;
  }
  .card {
    position: fixed;
    z-index: 71;
    width: min(340px, calc(100vw - 24px));
    display: grid;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
    background: var(--ink-1);
    color: var(--text);
    border: 1px solid var(--brass);
    border-radius: 12px;
    box-shadow: var(--shadow-float);
  }
  .card:focus {
    outline: none;
  }
  .card:focus-visible {
    outline: 2px solid var(--brass);
    outline-offset: 2px;
  }
  .count {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  h2 {
    margin: 0;
    font-family: var(--font-name);
    font-style: italic;
    font-size: var(--fs-18);
  }
  p {
    margin: 0;
    font-size: var(--fs-14);
  }
  .row {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  .primary {
    border-color: var(--brass);
    color: var(--brass);
  }
</style>
