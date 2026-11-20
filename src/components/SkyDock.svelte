<script lang="ts">
  /**
   * The sky's dock: one place for everything around the sky (DESIGN.md). A right-hand drawer on
   * wide screens, a bottom sheet with thumb-reachable tabs on phones. Lives inside the sky's
   * frame so it stays available in full screen. No horizontally scrolling toolbars.
   */
  import type { Snippet } from 'svelte';
  import type { DockPanel } from './SkyView.svelte';

  interface Props {
    active: DockPanel | null;
    /** Panel contents, supplied by the page. */
    content: Snippet<[DockPanel]>;
    onsearch: () => void;
    infoAvailable: boolean;
    /** How much of the sky the open sheet covers (px from the right / bottom edge). */
    oninset?: (i: { right: number; bottom: number }) => void;
    /** Quick toggles kept on the sky (supplied by the page). */
    quick?: Snippet;
  }
  let { active = $bindable(), content, onsearch, infoAvailable, oninset, quick }: Props = $props();

  // The sky shrinks beside (wide screens) or above (phones) the open sheet, so the camera frame,
  // the telescope marker and the object stay in view instead of under the panel.
  let dockEl = $state<HTMLDivElement>();
  let sheetEl = $state<HTMLElement>();
  let tabsEl = $state<HTMLElement>();
  let lastInset = '';
  $effect(() => {
    const d = dockEl;
    const sh = sheetEl;
    const tb = tabsEl;
    if (!d) return;
    const measure = () => {
      const a = d.getBoundingClientRect();
      // Wide screens: the tab column (and the drawer beside it) on the right. Phones: the tab
      // bar is left over the sky's foot; only an open sheet shrinks the sky from below.
      const col = tb && tb.getBoundingClientRect().height > tb.getBoundingClientRect().width;
      const edge = sh ?? (col ? tb : null);
      let i = { right: 0, bottom: 0 };
      if (edge) {
        const b = edge.getBoundingClientRect();
        i = col
          ? { right: Math.max(0, Math.round(a.right - b.left + 4)), bottom: 0 }
          : { right: 0, bottom: Math.max(0, Math.round(a.bottom - b.top)) };
      }
      const k = `${i.right},${i.bottom}`;
      if (k !== lastInset) {
        lastInset = k;
        oninset?.(i);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(d);
    if (sh) ro.observe(sh);
    if (tb) ro.observe(tb);
    return () => ro.disconnect();
  });

  const TABS: { id: DockPanel; label: string; icon: string }[] = [
    {
      id: 'targets',
      label: 'Targets',
      icon: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
    },
    {
      id: 'info',
      label: 'Info',
      icon: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.5',
    },
    { id: 'layers', label: 'Layers', icon: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5' },
    {
      id: 'telescope',
      label: 'Telescope',
      icon: 'M3 14l13-6 2 4-13 6zM16 8l3-1.5 2 4-3 1.5M9 17l-2 4M9 17l3 4',
    },
    { id: 'horizon', label: 'Horizon', icon: 'M3 17l5-6 4 3 4-5 5 8M3 20h18' },
    { id: 'time', label: 'Time', icon: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 7v5l3 3' },
    { id: 'more', label: 'More', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
  ];
  const TITLES: Record<DockPanel, string> = {
    targets: 'Best targets tonight',
    info: 'Object information',
    layers: 'Layers',
    telescope: 'Telescope and field of view',
    horizon: 'Horizon and foreground',
    time: 'Date and time',
    more: 'Place, settings and help',
  };
  function toggle(id: DockPanel) {
    active = active === id ? null : id;
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' && active) {
      e.stopPropagation();
      active = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dock" class:open={!!active} onkeydown={key} bind:this={dockEl}>
  <div class="quick">
    <button class="qbtn" onclick={onsearch} aria-label="Search the sky (Ctrl K)">
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg
      >
    </button>
    <button class="qbtn wide" onclick={() => (active = 'targets')}>Tonight's best</button>
  </div>
  {#if quick}
    <div class="strip">{@render quick()}</div>
  {/if}

  {#if active}
    <section class="sheet" aria-labelledby="dock-title" bind:this={sheetEl}>
      <header>
        <h2 id="dock-title">{TITLES[active]}</h2>
        <button class="close" onclick={() => (active = null)} aria-label="Close panel">×</button>
      </header>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="body" tabindex="0">
        {@render content(active)}
      </div>
    </section>
  {/if}

  <nav class="tabs" aria-label="Sky panels" bind:this={tabsEl}>
    {#each TABS as t (t.id)}
      <button
        aria-pressed={active === t.id}
        onclick={() => toggle(t.id)}
        class:dot={t.id === 'info' && infoAvailable && active !== 'info'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>
</div>

<style>
  .dock {
    position: absolute;
    inset: 0;
    z-index: 8;
    pointer-events: none;
    display: grid;
  }
  .dock > * {
    pointer-events: auto;
  }
  .quick {
    position: absolute;
    top: var(--s3);
    left: var(--s3);
    display: flex;
    gap: var(--s2);
  }
  .qbtn {
    min-height: var(--touch);
    min-width: var(--touch);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: color-mix(in srgb, var(--ink-1) 85%, transparent);
    border-color: var(--rule);
    backdrop-filter: blur(6px);
  }
  /* Quick toggles: a column down the left edge, always on the sky. */
  .strip {
    position: absolute;
    top: calc(var(--s3) + var(--touch) + var(--s2));
    left: var(--s3);
    display: grid;
    gap: 4px;
  }
  /* Phones: the open sheet needs the room; the strip comes back when it closes. */
  @media (max-width: 899px) {
    .dock.open .strip {
      display: none;
    }
  }
  .qbtn.wide {
    padding: 0 var(--s3);
    font-size: var(--fs-14);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tabs {
    position: absolute;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: color-mix(in srgb, var(--ink-1) 92%, transparent);
    border: 1px solid var(--rule);
    backdrop-filter: blur(6px);
  }
  .tabs button {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 50px;
    min-height: var(--touch);
    padding: 4px 6px;
    background: transparent;
    border-color: transparent;
    font-size: 11px;
    color: var(--text-2);
  }
  .tabs button[aria-pressed='true'] {
    color: var(--text);
    background: var(--ink-2);
    box-shadow: inset 0 -2px 0 var(--brass);
  }
  .tabs button.dot::after {
    content: '';
    position: absolute;
    top: 6px;
    right: 12px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brass);
  }
  .sheet {
    position: absolute;
    display: flex;
    flex-direction: column;
    background: var(--ink-1);
    border: 1px solid var(--rule);
    box-shadow: var(--shadow-float);
  }
  .sheet header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
    border-bottom: 1px solid var(--rule);
  }
  .sheet h2 {
    margin: 0;
    font-family: var(--font-name);
    font-style: italic;
    font-weight: 600;
    font-size: var(--fs-21);
  }
  .close {
    min-height: 36px;
    min-width: 36px;
    font-size: 20px;
    line-height: 1;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--s4);
    outline: none;
  }
  /* Phones and tablets: tabs along the bottom, the sheet above them. */
  @media (max-width: 899px) {
    .tabs {
      left: 0;
      right: 0;
      bottom: 0;
      justify-content: space-between;
      border-width: 1px 0 0;
      padding-bottom: max(4px, env(safe-area-inset-bottom));
    }
    .tabs button {
      flex: 1 1 0;
      min-width: 0;
    }
    .sheet {
      left: 0;
      right: 0;
      bottom: calc(var(--touch) + 18px);
      /* Leaves the sky (and the camera frame) a usable strip above the sheet. */
      max-height: 55%;
      border-radius: var(--r-sheet) var(--r-sheet) 0 0;
      border-bottom: 0;
    }
  }
  /* Wide screens: a drawer on the right with the tabs as a column beside it. */
  @media (min-width: 900px) {
    .tabs {
      top: var(--s3);
      right: var(--s3);
      flex-direction: column;
      border-radius: var(--r-section);
    }
    .sheet {
      top: var(--s3);
      bottom: 34px;
      right: calc(var(--s3) + 66px);
      width: min(400px, 40%);
      border-radius: var(--r-sheet);
    }
  }
</style>
