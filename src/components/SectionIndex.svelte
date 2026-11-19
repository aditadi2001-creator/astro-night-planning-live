<script lang="ts">
  /**
   * Plan page section index: a sticky rail on wide screens, a row of chips on
   * phones (wrapping, never a sideways-scrolling strip). Highlights the section
   * in view and keeps `s=` in the URL current so a shared link opens there.
   */
  import { onMount } from 'svelte';
  import { PLAN_SECTIONS, type SectionId } from '../lib/state/route';

  interface Props {
    active: SectionId;
    onactive: (id: SectionId) => void;
    onjump: (id: SectionId) => void;
  }
  let { active, onactive, onjump }: Props = $props();

  onMount(() => {
    const els = PLAN_SECTIONS.map((s) => document.getElementById(`sec-${s.id}`)).filter(
      (e): e is HTMLElement => !!e,
    );
    const seen: Record<string, number> = {};
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0;
        // The topmost section that is meaningfully visible.
        const first = els.find((el) => (seen[el.id] ?? 0) > 0.05);
        if (first) onactive(first.id.slice(4) as SectionId);
      },
      { rootMargin: '-120px 0px -45% 0px', threshold: [0, 0.05, 0.25, 0.5] },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  });
</script>

<nav class="index" aria-label="Plan sections">
  <ol>
    {#each PLAN_SECTIONS as s (s.id)}
      <li>
        <a
          href={`#/plan?s=${s.id}`}
          aria-current={active === s.id ? 'location' : undefined}
          onclick={(e) => {
            e.preventDefault();
            onjump(s.id);
          }}>{s.label}</a
        >
      </li>
    {/each}
  </ol>
</nav>

<style>
  .index ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1) var(--s2);
  }
  .index a {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 var(--s3);
    border-radius: var(--r-input);
    color: var(--text-2);
    text-decoration: none;
    font-size: var(--fs-14);
  }
  .index a:hover {
    color: var(--text);
    background: var(--ink-2);
  }
  .index a[aria-current='location'] {
    color: var(--text);
    background: var(--ink-2);
    box-shadow: inset 2px 0 0 var(--brass);
  }
  @media (min-width: 1100px) {
    .index ol {
      flex-direction: column;
      flex-wrap: nowrap;
    }
    .index a {
      width: 100%;
      font-size: var(--fs-16);
    }
  }
</style>
