<script lang="ts">
  import { onMount } from 'svelte';
  import type { Place } from '../lib/astro/sky';
  import {
    describe,
    setObserver,
    startEngine,
    type ObjectInfo,
    type Stel,
  } from '../lib/engine/stel';

  interface Props {
    place: Place;
    /** The time the sky should show. */
    time: Date;
    /** Following the real clock (sky runs) or a chosen moment (sky frozen). */
    live: boolean;
    constellations: boolean;
  }
  let { place, time, live, constellations }: Props = $props();

  let canvas: HTMLCanvasElement;
  let stel = $state<Stel | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMsg = $state('');
  let selected = $state<ObjectInfo | null>(null);

  onMount(() => {
    let disposed = false;
    const resize = () => {
      // Cap the backing store at 2× for mid-range phones.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    startEngine(canvas)
      .then((s) => {
        if (disposed) return;
        const c = s.core;
        c.time_speed = 1;
        c.fov = 120 * s.D2R;
        c.observer.yaw = 180 * s.D2R; // look south
        c.observer.pitch = 25 * s.D2R;
        c.atmosphere.visible = true;
        c.milkyway.visible = true;
        c.dsos.visible = true;
        c.cardinals.visible = true;
        s.change((_obj, attr) => {
          if (attr === 'selection') {
            selected = c.selection ? describe(s, c.selection) : null;
          }
        });
        stel = s;
        status = 'ready';
        if (import.meta.env.DEV) (window as unknown as { __stel: Stel }).__stel = s;
      })
      .catch((e: unknown) => {
        status = 'error';
        errorMsg = e instanceof Error ? e.message : String(e);
      });

    return () => {
      disposed = true;
      ro.disconnect();
    };
  });

  // Keep the engine's observer in step with the chosen place and time.
  $effect(() => {
    if (!stel) return;
    stel.core.time_speed = live ? 1 : 0;
    setObserver(stel, place, time);
  });

  $effect(() => {
    if (!stel) return;
    const cons = stel.core.constellations as typeof stel.core.constellations & {
      show_only_pointed: boolean;
    };
    // Engine default draws only the constellation at the view centre.
    cons.show_only_pointed = false;
    cons.lines_visible = constellations;
    cons.labels_visible = constellations;
  });

  // Refresh the info panel while an object is selected (it moves with time).
  $effect(() => {
    void time;
    if (stel?.core.selection) selected = describe(stel, stel.core.selection);
  });

  const fmt = (v: number, d = 1) => `${v.toFixed(d)}°`;
  function clearSelection() {
    if (stel) stel.core.selection = null;
    selected = null;
  }

  // Keyboard navigation: arrows look around, +/- zoom, Esc clears selection.
  function onKey(e: KeyboardEvent) {
    if (!stel) return;
    const o = stel.core.observer;
    const step = Math.max(1, (stel.core.fov * stel.R2D) / 12) * stel.D2R;
    const limit = (Math.PI / 2) * 0.999;
    switch (e.key) {
      case 'ArrowLeft':
        o.yaw -= step;
        break;
      case 'ArrowRight':
        o.yaw += step;
        break;
      case 'ArrowUp':
        o.pitch = Math.min(limit, o.pitch + step);
        break;
      case 'ArrowDown':
        o.pitch = Math.max(-limit, o.pitch - step);
        break;
      case '+':
      case '=':
        stel.zoomTo(Math.max(0.5 * stel.D2R, stel.core.fov / 1.4), 0.2);
        break;
      case '-':
        stel.zoomTo(Math.min(185 * stel.D2R, stel.core.fov * 1.4), 0.2);
        break;
      case 'Escape':
        clearSelection();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<div class="wrap">
  <canvas
    bind:this={canvas}
    class="sky"
    tabindex="0"
    onkeydown={onKey}
    aria-label="Interactive 3D sky. Drag or use arrow keys to look around; scroll, pinch or +/- to zoom; tap an object for details."
  ></canvas>

  {#if status === 'loading'}
    <p class="overlay" role="status">Loading the sky…</p>
  {:else if status === 'error'}
    <p class="overlay error" role="alert">
      The 3D sky could not start ({errorMsg}). Your browser needs WebGL 2. Conditions below still
      work.
    </p>
  {/if}

  {#if selected}
    <section class="info" aria-live="polite" aria-label="Selected object">
      <header>
        <h3>{selected.name}</h3>
        <button class="close" onclick={clearSelection} aria-label="Close details">×</button>
      </header>
      {#if selected.type}<p class="type">{selected.type}</p>{/if}
      <dl>
        {#if selected.vmag !== null}<dt>Magnitude</dt>
          <dd>{selected.vmag.toFixed(2)}</dd>{/if}
        <dt>Altitude</dt>
        <dd>{fmt(selected.alt)}{selected.alt < 0 ? ' (below horizon)' : ''}</dd>
        <dt>Azimuth</dt>
        <dd>{fmt(selected.az)}</dd>
        <dt>RA / Dec</dt>
        <dd>{(selected.ra / 15).toFixed(3)} h / {fmt(selected.dec, 2)}</dd>
      </dl>
      {#if selected.otherNames.length}<p class="aka">Also: {selected.otherNames.join(', ')}</p>{/if}
    </section>
  {/if}

  <p class="credit-line credit">
    Stellarium Web Engine (AGPL) · ESA/Hipparcos · ESA/Gaia/DPAC · OpenNGC ·
    <a href="#/credits">credits</a>
  </p>
</div>

<style>
  .wrap {
    position: relative;
    height: 100%;
    min-height: inherit;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--line);
    background: #000;
  }
  .sky {
    display: block;
    width: 100%;
    height: 100%;
    min-height: inherit;
    touch-action: none;
    filter: var(--sky-filter);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 24px;
    text-align: center;
    color: var(--muted);
  }
  .overlay.error {
    color: var(--bad);
  }
  .info {
    position: absolute;
    left: 8px;
    bottom: 48px;
    max-width: min(320px, calc(100% - 16px));
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 12px;
    backdrop-filter: blur(6px);
  }
  .info header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 16px;
  }
  .close {
    min-height: 28px;
    padding: 0 8px;
    line-height: 1;
  }
  .type {
    margin: 2px 0 6px;
    color: var(--accent);
    font-size: 13px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .aka {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .credit {
    position: absolute;
    right: 8px;
    bottom: 4px;
    margin: 0;
    font-size: 11px;
    opacity: 0.8;
    pointer-events: none;
    left: 8px;
    text-align: right;
  }
  .credit a {
    pointer-events: auto;
  }
</style>
