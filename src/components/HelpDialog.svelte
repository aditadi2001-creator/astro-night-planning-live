<script lang="ts">
  /** Help: start the guided tour, the keyboard keys, and the plain-language glossary. */
  import { GLOSSARY } from '../lib/glossary';

  interface Props {
    onclose: () => void;
    ontour: () => void;
  }
  let { onclose, ontour }: Props = $props();

  let q = $state('');
  const list = $derived(
    GLOSSARY.filter((t) => `${t.term} ${t.text}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  let box = $state<HTMLDivElement>();
  $effect(() => {
    box?.querySelector<HTMLElement>('button')?.focus();
  });
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div
  class="help"
  role="dialog"
  aria-modal="true"
  aria-labelledby="help-title"
  tabindex="-1"
  bind:this={box}
  onkeydown={key}
>
  <header>
    <h2 id="help-title">Help</h2>
    <button class="x" onclick={onclose} aria-label="Close help">×</button>
  </header>
  <div class="body">
    <section>
      <h3>New here?</h3>
      <p>A one-minute tour of the main controls.</p>
      <button class="primary" onclick={ontour}>Take the tour</button>
    </section>
    <section>
      <h3>Keys</h3>
      <dl class="keys">
        <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt>
        <dd>Search every catalog</dd>
        <dt><kbd>Esc</kbd></dt>
        <dd>Close a panel or dialog</dd>
        <dt><kbd>[</kbd> <kbd>]</kbd></dt>
        <dd>Turn the camera frame (Sky page)</dd>
        <dt><kbd>Alt</kbd> <kbd>F</kbd></dt>
        <dd>Keep the highlighted search result as a favorite</dd>
      </dl>
      <p class="note">The Sky page's More tab lists all of its keys.</p>
    </section>
    <section>
      <h3 id="gl-title">Glossary</h3>
      <label class="find"
        ><span class="visually-hidden">Find a term</span>
        <input type="search" bind:value={q} placeholder="Find a term" autocomplete="off" /></label
      >
      <dl class="gl" aria-labelledby="gl-title">
        {#each list as t (t.term)}
          <dt>{t.term}</dt>
          <dd>{t.text}</dd>
        {:else}
          <dd class="note">No term matches "{q}".</dd>
        {/each}
      </dl>
    </section>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(0 0 0 / 0.5);
  }
  .help {
    position: fixed;
    z-index: 61;
    inset: max(4vh, 16px) 0 auto;
    margin: 0 auto;
    width: min(640px, calc(100% - 24px));
    max-height: min(88vh, 900px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--ink-1);
    color: var(--text);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-card, 12px);
    box-shadow: var(--shadow-float);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s3) var(--s4);
    border-bottom: 1px solid var(--rule);
  }
  h2 {
    margin: 0;
    font-family: var(--font-name);
    font-style: italic;
    font-size: var(--fs-21);
  }
  .x {
    min-width: 40px;
    min-height: 40px;
  }
  .body {
    overflow: auto;
    padding: var(--s3) var(--s4) var(--s5);
    display: grid;
    gap: var(--s5);
  }
  section {
    display: grid;
    gap: var(--s2);
    justify-items: start;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-14);
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: var(--fs-14);
  }
  .note {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .primary {
    border-color: var(--brass);
    color: var(--brass);
  }
  .keys,
  .gl {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: var(--s1) var(--s3);
    margin: 0;
    width: 100%;
    font-size: var(--fs-14);
  }
  .gl {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .gl dt {
    font-weight: 700;
    margin-top: var(--s2);
  }
  dd {
    margin: 0;
  }
  .gl dd {
    color: var(--text-2);
  }
  kbd {
    font: inherit;
    font-size: var(--fs-12);
    padding: 1px 6px;
    border: 1px solid var(--ui-line);
    border-radius: 4px;
  }
  .find,
  .find input {
    width: 100%;
  }
  .find input {
    font: inherit;
    padding: 8px 10px;
    color: var(--text);
    background: var(--ink-0);
    border: 1px solid var(--ui-line);
    border-radius: var(--r-input);
  }
</style>
