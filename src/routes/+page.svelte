<script lang="ts">
  import { resolve } from "$app/paths";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { toQdc } from "$lib/coding/qdc";
  import { useColors } from "$lib/coding/prefs.svelte";
  import { createArticle, DEFAULT_PROJECT, watchArticles, type ArticleSummary } from "$lib/client/coding-db";
  import type { Instructions } from "$lib/coding/instructions";

  let {
    data,
  }: {
    data: { catalogs: { folder: string; instructions: Instructions }[] };
  } = $props();

  const prefs = useColors();

  let articles = $state<ArticleSummary[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let errMsg = $state("");

  onMount(() => {
    return watchArticles((list) => {
      articles = list;
      loading = false;
    });
  });

  let totals = $derived.by(() => {
    let codes = 0;
    let versions = 0;
    for (const a of articles) {
      codes += a.codes;
      versions += a.versions;
    }
    return { documents: articles.length, codes, versions };
  });

  let targetProject = $derived(
    data.catalogs[0]?.folder ?? articles.find((a) => a.project !== DEFAULT_PROJECT)?.project ?? DEFAULT_PROJECT,
  );

  let byProject = $derived.by(() => {
    const groups: [string, ArticleSummary[]][] = [];
    for (const a of articles) {
      const group = groups.find((entry) => entry[0] === a.project);
      if (group) group[1].push(a);
      else groups.push([a.project, [a]]);
    }
    return groups;
  });

  let catalogByProject = $derived(new SvelteMap(data.catalogs.map((c) => [c.folder, c.instructions])));

  function exportQdc(folder: string, instr: Instructions) {
    const url = URL.createObjectURL(new Blob([toQdc(instr, { options: prefs.options })], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder}.qdc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function newArticle() {
    busy = true;
    errMsg = "";
    try {
      const article = await createArticle(targetProject);
      await goto(resolve("/text/[folder]/[name]", { folder: article.project, name: article.name }));
    } catch (e) {
      errMsg = String(e);
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Coding dashboard</title>
</svelte:head>

<main>
  <h1>Text coding</h1>
  <p class="nav"><a href={resolve("/colors")}>colors</a></p>
  <p class="summary">
    <span class="chip">{totals.documents} documents</span>
    <span class="chip">{totals.codes} codes</span>
    <span class="chip versions">{totals.versions} versions</span>
  </p>

  <div class="actions">
    <button type="button" class="go" onclick={newArticle} disabled={busy}>
      {busy ? "creating…" : `new document in ${targetProject}`}
    </button>
    {#if errMsg}<span class="msg err">{errMsg}</span>{/if}
  </div>

  {#if loading}
    <p class="empty">Loading local articles…</p>
  {:else}
    {#each byProject as [project, items] (project)}
      {@const instr = catalogByProject.get(project)}
      <section>
        <h2>
          {project}/
          {#if instr}
            <button type="button" class="export" onclick={() => exportQdc(project, instr)}> export .qdc </button>
          {/if}
        </h2>
        <ul>
          {#each items as a (a.id)}
            <li>
              <a href={resolve("/text/[folder]/[name]", { folder: a.project, name: a.name })}>
                <span class="name">{a.name}</span>
              </a>
              <span class="codes">{a.codes}</span>
              {#if a.versions}
                <span class="chip versions">{a.versions} v</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="empty">No documents yet — create one to start coding.</p>
    {/each}
  {/if}
</main>

<style>
  main {
    max-width: 44rem;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  h1 {
    font-size: 1.4rem;
  }
  .summary {
    display: flex;
    gap: 0.5rem;
  }
  .actions {
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .go {
    font: inherit;
    padding: 0.35rem 0.9rem;
    border-radius: 99px;
    border: 1px solid var(--primary, #6750a4);
    background: var(--primary, #6750a4);
    color: white;
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .msg {
    color: #0a6b2d;
  }
  .msg.err {
    color: #b3261e;
  }
  ul {
    list-style: none;
    padding: 0;
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
  }
  li:hover {
    background: var(--surface-variant);
  }
  a {
    text-decoration: none;
    color: inherit;
    flex: 1;
  }
  .name {
    font-weight: 600;
  }
  h2 {
    font-size: 1rem;
    margin: 1.5rem 0 0.25rem;
    color: var(--on-surface-variant);
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .export {
    font: inherit;
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    background: var(--surface-variant);
    border: none;
    border-radius: 99px;
    padding: 0.1rem 0.6rem;
    cursor: pointer;
  }
  .export:hover {
    filter: brightness(1.1);
  }
  .codes {
    color: var(--on-surface-variant);
    font-variant-numeric: tabular-nums;
    min-width: 2rem;
    text-align: right;
  }
  .empty {
    margin-top: 1.5rem;
    color: var(--on-surface-variant);
  }
  .chip {
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    border-radius: 99px;
    background: var(--surface-variant);
    color: var(--on-surface-variant);
  }
  :root[data-theme="dark"] .chip.versions {
    background: #23304d;
    color: #b8c7ff;
  }
</style>
