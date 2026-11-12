<script lang="ts">
  import { ageLabel, type LiveSource } from '../lib/data/live.svelte';

  interface Props {
    sources: { label: string; source: LiveSource<unknown> }[];
    now: number;
  }
  let { sources, now }: Props = $props();
</script>

<ul class="status" aria-label="Data freshness">
  {#each sources as { label, source } (label)}
    <li class="s-{source.status}" title={source.error ?? ''}>
      <span class="dot" aria-hidden="true"></span>
      {label}:
      {#if source.status === 'loading'}loading…{:else if source.status === 'error'}unavailable{:else}{ageLabel(
          source.fetchedAt,
          now,
        )}{#if source.status === 'stale'}
          (offline, showing last data){/if}{/if}
    </li>
  {/each}
</ul>

<style>
  .status {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    font-size: 12px;
    color: var(--muted);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 3px;
    background: var(--line);
  }
  .s-ok .dot {
    background: var(--good);
  }
  .s-stale .dot,
  .s-loading .dot {
    background: var(--warn);
  }
  .s-error .dot {
    background: var(--bad);
  }
</style>
