<script lang="ts">
  /**
   * "Save for offline": downloads the star maps, catalogs and horizons (static files on this
   * site, about 30 MB, no data-Worker requests) into the service worker's data cache, so the
   * planner works at a dark site without signal. The forecast is the app's own last good copy
   * (kept 3 days). The data cache is capped at 150 MB; least recently used files go first.
   */
  import { onMount } from 'svelte';

  interface Props {
    placeName: string;
  }
  let { placeName }: Props = $props();

  type Status = { bytes: number; entries: number; cap: number };
  let status = $state<Status | null>(null);
  let supported = $state(true);
  let running = $state(false);
  let done = $state(0);
  let total = $state(0);
  let msg = $state('');
  let persisted = $state<boolean | null>(null);

  const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

  function ask(type: 'data-status' | 'data-clear'): Promise<Status | null> {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return Promise.resolve(null);
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 3000);
      ch.port1.onmessage = (e: MessageEvent<Status>) => {
        clearTimeout(t);
        resolve(e.data);
      };
      sw.postMessage({ type }, [ch.port2]);
    });
  }

  onMount(() => {
    supported = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
    void ask('data-status').then((s) => (status = s));
    void navigator.storage?.persisted?.().then((p) => (persisted = p));
  });

  async function save() {
    if (running) return;
    running = true;
    msg = '';
    try {
      // Ask the browser not to clear this data under storage pressure (no prompt in Chrome).
      persisted = (await navigator.storage?.persist?.()) ?? null;
      const pack = (await (await fetch('/offline-pack.json', { cache: 'no-store' })).json()) as {
        files: string[];
      };
      total = pack.files.length;
      done = 0;
      let failed = 0;
      let next = 0;
      const worker = async () => {
        while (next < pack.files.length) {
          const url = pack.files[next++] as string;
          try {
            const r = await fetch(url);
            if (!r.ok) failed++;
            await r.arrayBuffer();
          } catch {
            failed++;
          }
          done++;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      status = await ask('data-status');
      msg = failed
        ? `Saved, but ${failed} of ${total} files failed. Try again with a better connection.`
        : `Ready: the star maps and catalogs work offline. ${placeName}'s forecast is the last one loaded (kept 3 days).`;
    } catch {
      msg = 'Could not download the list of files. Are you online?';
    } finally {
      running = false;
    }
  }
  async function clear() {
    status = await ask('data-clear');
    msg = 'Offline data removed.';
  }
</script>

<section class="off" aria-labelledby="off-h">
  <h3 id="off-h">Offline at a dark site</h3>
  {#if !supported}
    <p class="note">
      Available on the published site once it has loaded once (it needs the app's offline support,
      which development builds do not install).
    </p>
  {:else}
    <p class="note">
      Before you leave, pick the site here, let the forecast load, then save the star maps and
      catalogs (about 30 MB) to this device.
    </p>
    <div class="row">
      <button class="primary" onclick={save} disabled={running}
        >{running ? 'Saving…' : 'Save for offline'}</button
      >
      <button onclick={clear} disabled={running || !status?.entries}>Remove</button>
    </div>
    {#if running}
      <progress max={total} value={done} aria-label="Files saved">{done} / {total}</progress>
    {/if}
    {#if status}
      <p class="note">
        Offline data on this device: {mb(status.bytes)} in {status.entries} files (at most {mb(
          status.cap,
        )}; the least recently used go first){persisted
          ? ', protected from automatic clean-up'
          : ''}.
      </p>
    {/if}
    {#if msg}<p class="msg" role="status">{msg}</p>{/if}
  {/if}
</section>

<style>
  .off {
    display: grid;
    gap: var(--s2);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-14);
    font-weight: 700;
  }
  p {
    margin: 0;
  }
  .note {
    font-size: var(--fs-12);
    color: var(--text-2);
  }
  .msg {
    font-size: var(--fs-12);
    color: var(--brass);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .primary {
    border-color: var(--brass);
    color: var(--brass);
  }
  progress {
    width: 100%;
    accent-color: var(--brass);
  }
</style>
