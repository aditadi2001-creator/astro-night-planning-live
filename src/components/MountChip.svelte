<script lang="ts">
  /**
   * The mount, always on the sky: not connected → one tap opens the Telescope panel; connected →
   * what it is doing, how far it is from the selected object, and Stop (only with control on,
   * CLAUDE.md rule 8). GoTo itself stays in the panel, where the safety checks and the
   * confirmation live.
   */
  import { separation } from '../lib/telescope/coords';
  import { telescope } from '../lib/telescope/session.svelte';

  interface Props {
    selected: { name: string; ra2000: number; dec2000: number } | null;
    onopen: () => void;
  }
  let { selected, onopen }: Props = $props();

  const st = $derived(telescope.state);
  const live = $derived(telescope.status === 'live' && st != null);
  const off = $derived(
    live && st && selected
      ? separation(st.ra2000, st.dec2000, selected.ra2000, selected.dec2000).sepDeg
      : null,
  );
  const fmt = (d: number) =>
    d >= 1
      ? `${d.toFixed(1)}°`
      : d * 60 >= 1
        ? `${(d * 60).toFixed(1)}′`
        : `${Math.round(d * 3600)}″`;
  const doing = $derived(
    !st
      ? ''
      : st.slewing
        ? 'Slewing'
        : st.atPark
          ? 'Parked'
          : st.tracking === true
            ? 'Tracking'
            : st.tracking === false
              ? 'Not tracking'
              : 'Connected',
  );
  let err = $state('');
  async function stop() {
    err = '';
    try {
      await telescope.act('stop');
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="mc" role="group" aria-label="Mount">
  {#if telescope.status === 'off'}
    <button onclick={onopen} title="Connect a mount (NINA, ASCOM, INDI, USB or Wi-Fi)">
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M3 14l13-6 2 4-13 6zM16 8l3-1.5 2 4-3 1.5M9 17l-2 4M9 17l3 4" /></svg
      >Connect mount</button
    >
  {:else}
    <button class="state" onclick={onopen} title="Open the Telescope panel (GoTo, sync, park)">
      <span class="dot" class:ok={live} class:busy={st?.slewing} aria-hidden="true"></span>
      {#if live}
        {doing}{off != null && selected ? ` · ${fmt(off)} off ${selected.name}` : ''}
      {:else if telescope.status === 'connecting'}
        Connecting…
      {:else}
        No reading
      {/if}
    </button>
    {#if live}
      <button
        class="stop"
        onclick={stop}
        disabled={!telescope.control}
        title={telescope.control
          ? 'Stop the mount now'
          : 'Switch on "Enable control" in the Telescope panel first'}>Stop</button
      >
    {/if}
  {/if}
  {#if err}<span class="err" role="alert">{err}</span>{/if}
</div>

<style>
  .mc {
    position: absolute;
    right: 8px;
    bottom: calc(var(--tl-bottom, 30px) + 86px);
    z-index: 6;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: min(360px, calc(100% - 80px));
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    font-size: var(--fs-12);
    background: color-mix(in srgb, var(--ink-1) 86%, transparent);
    border-color: var(--rule);
    backdrop-filter: blur(6px);
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--nogo);
  }
  .dot.ok {
    background: var(--go);
  }
  .dot.busy {
    background: var(--maybe);
  }
  .stop {
    border-color: var(--nogo);
    color: var(--nogo);
    font-weight: 700;
  }
  .err {
    flex-basis: 100%;
    text-align: right;
    font-size: var(--fs-12);
    color: var(--nogo);
  }
  /* Phones: the timeline is taller (the date has its own line). */
  @media (max-width: 599px) {
    .mc {
      bottom: calc(var(--tl-bottom, 30px) + 122px);
    }
  }
</style>
