<script lang="ts">
  import { CREDITS } from '../lib/credits';

  const groups = [
    { kind: 'data', title: 'Data sources' },
    { kind: 'library', title: 'Software libraries' },
    { kind: 'survey', title: 'Optional sky surveys' },
  ] as const;
</script>

<article class="page">
  <h1>Credits</h1>
  <p>
    This site is free, non-commercial and open source under the
    <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</a>. It is only possible
    because of the open data and software below. Each entry shows the attribution the provider asks
    for.
  </p>

  {#each groups as g (g.kind)}
    {@const items = CREDITS.filter((c) => c.kind === g.kind)}
    {#if items.length}
      <h2>{g.title}</h2>
      <ul>
        {#each items as c (c.id)}
          <li>
            <h3>
              <a href={c.url} rel="noopener">{c.name}</a>
              {#if c.status === 'planned'}<span class="badge">coming soon</span>{/if}
            </h3>
            <p class="lic">License: {c.license}</p>
            <p>{c.usage}</p>
            <blockquote>{c.attribution}</blockquote>
            {#if c.notes}<p class="note">{c.notes}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</article>

<style>
  .page {
    max-width: 820px;
    margin: 0 auto;
  }
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  li {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 16px;
  }
  p {
    margin: 4px 0;
  }
  .lic,
  .note {
    font-size: 13px;
    color: var(--muted);
  }
  blockquote {
    margin: 8px 0 0;
    padding-left: 10px;
    border-left: 3px solid var(--line);
    font-size: 13px;
  }
  .badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--warn);
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 1px 6px;
    margin-left: 6px;
    vertical-align: middle;
  }
</style>
