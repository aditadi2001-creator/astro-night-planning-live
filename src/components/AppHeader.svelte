<script lang="ts">
  /**
   * Global header for both pages: location, equipment profile, search,
   * Beginner/Expert, night vision and the Plan ⇄ Sky switch. The night ribbon
   * (time scrubber) is rendered by the parent directly below.
   */
  import type { Place } from '../lib/astro/sky';
  import type { Page } from '../lib/state/route';
  import type { Profile } from '../lib/profiles';
  import LocationPicker from './LocationPicker.svelte';
  import { fmtTime, zoneLabel } from '../lib/time/format';

  interface Props {
    page: Page;
    place: Place;
    now: Date;
    tz: string | undefined;
    profiles: Profile[];
    profileId: string;
    expert: boolean;
    night: boolean;
    onplace: (p: Place) => void;
    onprofile: (id: string) => void;
    onexpert: (v: boolean) => void;
    onnight: (v: boolean) => void;
    onpage: (p: Page) => void;
    onsearch: () => void;
  }
  let {
    page,
    place,
    now,
    tz,
    profiles,
    profileId,
    expert,
    night,
    onplace,
    onprofile,
    onexpert,
    onnight,
    onpage,
    onsearch,
  }: Props = $props();

  let picking = $state(false);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
</script>

<header class="bar">
  <a class="brand" href="#/plan" aria-label="Astro Night Planning, Plan page">
    <img src="/favicon.svg" alt="" width="26" height="26" />
    <span class="name">Astro Night Planning</span>
  </a>

  <div class="loc-wrap">
    <button
      class="loc"
      onclick={() => (picking = !picking)}
      aria-expanded={picking}
      aria-haspopup="dialog"
      title="Change location"
    >
      <span class="place">{place.name}</span>
      <span class="clock">
        {fmtTime(now, tz)} <span class="zone">{zoneLabel(now, tz)}</span>
      </span>
    </button>
    {#if picking}
      <LocationPicker {place} {onplace} onclose={() => (picking = false)} />
    {/if}
  </div>

  <label class="profile">
    <span class="visually-hidden">Equipment profile</span>
    <select
      value={profileId}
      onchange={(e) => onprofile((e.currentTarget as HTMLSelectElement).value)}
    >
      {#each profiles as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </label>

  <button class="search" onclick={onsearch} title={`Search the sky (${mac ? '⌘' : 'Ctrl'} K)`}>
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg
    >
    <span class="label">Search</span>
    <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
  </button>

  <div class="seg" role="group" aria-label="Detail level">
    <button aria-pressed={!expert} onclick={() => onexpert(false)}>Beginner</button>
    <button aria-pressed={expert} onclick={() => onexpert(true)}>Expert</button>
  </div>

  <button
    class="night"
    aria-pressed={night}
    aria-label="Red night mode"
    onclick={() => onnight(!night)}
    title="Red night-vision mode (keeps your eyes dark-adapted)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg
    >
    <span class="label">Night</span>
  </button>

  <nav class="pages" aria-label="Pages">
    <a
      href="#/plan"
      aria-current={page === 'plan' ? 'page' : undefined}
      onclick={(e) => {
        e.preventDefault();
        onpage('plan');
      }}>Plan</a
    >
    <a
      href="#/sky"
      aria-current={page === 'sky' ? 'page' : undefined}
      onclick={(e) => {
        e.preventDefault();
        onpage('sky');
      }}>Sky</a
    >
  </nav>
</header>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    padding: var(--s2) var(--s4);
    background: var(--ink-1);
    border-bottom: 1px solid var(--rule);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--s2);
    color: var(--text);
    text-decoration: none;
    font-family: var(--font-name);
    font-style: italic;
    font-weight: 600;
    font-size: var(--fs-18);
    white-space: nowrap;
  }
  .loc-wrap {
    position: relative;
  }
  .loc {
    display: grid;
    text-align: left;
    line-height: 1.2;
    background: transparent;
    border-color: transparent;
    padding: 4px 8px;
    min-height: var(--touch);
  }
  .loc:hover {
    border-color: var(--rule);
  }
  .place {
    font-weight: 600;
  }
  .place::after {
    content: ' ▾';
    color: var(--text-2);
    font-size: var(--fs-12);
  }
  .clock {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .profile select {
    min-height: 36px;
    max-width: 230px;
    font: inherit;
    font-size: var(--fs-14);
    color: var(--text);
    background: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 4px 8px;
  }
  .search {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    margin-left: auto;
    color: var(--text-2);
    min-width: 150px;
  }
  .search svg,
  .night svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  kbd {
    margin-left: auto;
    font: inherit;
    font-size: var(--fs-12);
    color: var(--text-2);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0 4px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--rule);
    border-radius: var(--r-pill);
    overflow: hidden;
  }
  .seg button {
    border: 0;
    border-radius: 0;
    background: transparent;
    font-size: var(--fs-14);
    padding: 4px 12px;
  }
  .seg button[aria-pressed='true'] {
    background: var(--brass);
    color: var(--brass-ink);
  }
  .night {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .night[aria-pressed='true'] {
    border-color: var(--brass);
    color: var(--brass);
  }
  .pages {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--ink-0);
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
  }
  .pages a {
    display: inline-flex;
    align-items: center;
    min-height: 34px;
    padding: 0 14px;
    color: var(--text-2);
    text-decoration: none;
    border-radius: 4px;
  }
  .pages a[aria-current='page'] {
    color: var(--text);
    background: var(--ink-2);
    box-shadow: inset 0 -2px 0 var(--brass);
  }
  @media (max-width: 899px) {
    .name,
    .search .label,
    kbd,
    .night .label {
      display: none;
    }
    .search {
      min-width: 0;
    }
  }
  @media (max-width: 599px) {
    .bar {
      padding: var(--s2) var(--s3);
      gap: var(--s2);
    }
    .profile {
      order: 10;
      flex: 1 1 100%;
    }
    .profile select {
      width: 100%;
      max-width: none;
    }
    .seg {
      order: 11;
    }
    .pages {
      order: 12;
      margin-left: auto;
    }
  }
</style>
