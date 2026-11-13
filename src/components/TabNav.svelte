<script lang="ts" module>
  export const TABS = [
    { id: 'sky', label: 'Sky', hint: '3D sky, layers and time' },
    { id: 'tonight', label: 'Tonight', hint: 'Hour by hour and current conditions' },
    { id: 'week', label: 'Week', hint: 'Seven-night cloud outlook' },
    { id: 'targets', label: 'Targets', hint: 'Best deep-sky targets tonight' },
    { id: 'equipment', label: 'Equipment', hint: 'Telescopes, cameras and fields of view' },
    { id: 'maps', label: 'Maps', hint: 'Light-pollution and satellite cloud maps' },
    { id: 'space', label: 'Space', hint: 'Aurora and satellite passes' },
    { id: 'about', label: 'About', hint: 'Methods, data sources and credits' },
  ] as const;
  export type TabId = (typeof TABS)[number]['id'];

  /** Tab for a location hash ('#/credits' opens About; anything else unknown opens Sky). */
  export function tabFromHash(hash: string): TabId {
    const id = hash.replace(/^#\//, '').split(/[/?]/)[0] ?? '';
    if (id === 'credits') return 'about';
    return (TABS.find((t) => t.id === id)?.id ?? 'sky') as TabId;
  }
</script>

<script lang="ts">
  let { tab }: { tab: TabId } = $props();

  let strip: HTMLElement;
  // Keep the active tab visible in the scrolling strip on phones.
  $effect(() => {
    const el = strip?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<nav class="tabs" aria-label="Sections">
  <ul bind:this={strip}>
    {#each TABS as t (t.id)}
      <li>
        <a
          href={`#/${t.id}`}
          data-tab={t.id}
          aria-current={tab === t.id ? 'page' : undefined}
          title={t.hint}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {#if t.id === 'sky'}
              <path d="M12 3l2.2 5.6L20 9.3l-4.4 3.9 1.3 5.8L12 16l-4.9 3 1.3-5.8L4 9.3l5.8-.7z" />
            {:else if t.id === 'tonight'}
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            {:else if t.id === 'week'}
              <rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" />
            {:else if t.id === 'targets'}
              <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path
                d="M12 2v4M12 18v4M2 12h4M18 12h4"
              />
            {:else if t.id === 'equipment'}
              <path d="M3 14l13-6 2 4-13 6zM16 8l3-1.5 2 4-3 1.5M9 17l-2 4M9 17l3 4" />
            {:else if t.id === 'maps'}
              <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />
            {:else if t.id === 'space'}
              <circle cx="12" cy="12" r="3" /><ellipse
                cx="12"
                cy="12"
                rx="10"
                ry="4"
                transform="rotate(-25 12 12)"
              />
            {:else}
              <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" />
            {/if}
          </svg>
          <span>{t.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .tabs {
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  ul {
    display: flex;
    gap: 2px;
    margin: 0 auto;
    padding: 0 var(--gap);
    list-style: none;
    max-width: 1600px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  ul::-webkit-scrollbar {
    display: none;
  }
  li {
    flex: none;
  }
  a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    padding: 0 14px;
    color: var(--muted);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
    border-radius: 8px 8px 0 0;
    transition:
      color 0.15s,
      background-color 0.15s;
  }
  a:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--panel-2) 70%, transparent);
  }
  a[aria-current='page'] {
    color: var(--text);
  }
  a[aria-current='page']::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  a:focus-visible {
    outline-offset: -2px;
  }
  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  a[aria-current='page'] svg {
    stroke: var(--accent);
  }
  @media (max-width: 520px) {
    a {
      padding: 0 10px;
      gap: 5px;
      font-size: 13px;
    }
  }
</style>
