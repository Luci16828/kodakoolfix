<script lang="ts">
  import { resolve } from "$app/paths";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import "material-symbols/rounded.css";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { toQdc } from "$lib/coding/qdc";
  import { useColors } from "$lib/coding/prefs.svelte";
  import {
    createArticle,
    DEFAULT_PROJECT,
    listLocalCatalogs,
    watchArticles,
    type ArticleSummary,
  } from "$lib/client/coding-db";
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
  /** locally edited catalogs override the server copies (for display + .qdc export) */
  const localCats = new SvelteMap<string, Instructions>();
  /** file-tree panel (default) vs. flat list, persisted per browser */
  let treeView = $state(true);
  const collapsed = new SvelteSet<string>();

  onMount(() => {
    treeView = localStorage.getItem("coding-dash-view") !== "list";
    const unwatch = watchArticles((list) => {
      articles = list;
      loading = false;
    });
    void listLocalCatalogs().then((m) => {
      for (const [folder, instr] of m) localCats.set(folder, instr);
    });
    return unwatch;
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
    for (const a of [...articles].sort((x, y) => x.name.localeCompare(y.name))) {
      const group = groups.find((entry) => entry[0] === a.project);
      if (group) group[1].push(a);
      else groups.push([a.project, [a]]);
    }
    return groups.sort((x, y) => x[0].localeCompare(y[0]));
  });

  let catalogByProject = $derived(
    new SvelteMap(data.catalogs.map((c) => [c.folder, localCats.get(c.folder) ?? c.instructions])),
  );

  function exportQdc(folder: string, instr: Instructions) {
    const url = URL.createObjectURL(new Blob([toQdc(instr, { options: prefs.options })], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder}.qdc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleView(): void {
    treeView = !treeView;
    localStorage.setItem("coding-dash-view", treeView ? "tree" : "list");
  }

  function toggleFolder(project: string): void {
    if (collapsed.has(project)) collapsed.delete(project);
    else collapsed.add(project);
  }

  async function newArticle() {
    busy = true;
    errMsg = "";
    try {
      const article = await createArticle(targetProject);
      await goto(resolve("/text/[folder]/[name]", { folder: article.project, name: article.name }));
    } catch (e) {
      errMsg = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Coding dashboard</title>
</svelte:head>

<main>
  <h1>Text coding</h1>
  <p class="nav">
    <a href={resolve("/colors")}><span class="material-symbols-rounded" aria-hidden="true">palette</span>colors</a>
    <button
      type="button"
      class="viewtoggle"
      aria-pressed={treeView}
      aria-label={treeView ? "show flat list" : "show file tree"}
      onclick={toggleView}
    >
      <span class="material-symbols-rounded" aria-hidden="true">{treeView ? "list" : "account_tree"}</span>
    </button>
  </p>
  <p class="summary">
    <span class="chip">{totals.documents} documents</span>
    <span class="chip">{totals.codes} codes</span>
    <span class="chip versions">{totals.versions} versions</span>
  </p>

  <div class="actions">
    <button type="button" class="go" onclick={newArticle} disabled={busy}>
      <span class="material-symbols-rounded" aria-hidden="true">note_add</span>{busy
        ? "creating…"
        : `new document in ${targetProject}`}
    </button>
    {#if errMsg}<span class="msg err">{errMsg}</span>{/if}
  </div>

  {#if loading}
    <p class="empty">Loading local articles…</p>
  {:else}
    {#each byProject as [project, items] (project)}
      {@const instr = catalogByProject.get(project)}
      {@const open = !collapsed.has(project)}
      <section class="group" class:tree={treeView}>
        <h2>
          {#if treeView}
            <button
              type="button"
              class="fcaret"
              aria-expanded={open}
              aria-label={open ? `collapse ${project}` : `expand ${project}`}
              onclick={() => toggleFolder(project)}
            >
              <span class="material-symbols-rounded" aria-hidden="true">{open ? "expand_more" : "chevron_right"}</span>
            </button>
          {/if}
          <span class="gname">{project}/</span>
          {#if treeView}<span class="chip fcount">{items.length}</span>{/if}
          {#if instr}
            <button type="button" class="export" onclick={() => exportQdc(project, instr)}>
              <span class="material-symbols-rounded" aria-hidden="true">file_download</span>export .qdc
            </button>
          {/if}
        </h2>
        {#if !treeView || open}
          <ul>
            {#each items as a (a.id)}
              <li>
                <a href={resolve("/text/[folder]/[name]", { folder: a.project, name: a.name })}>
                  {#if treeView}
                    <span class="material-symbols-rounded" aria-hidden="true">description</span>
                  {/if}
                  <span class="name">{a.name}</span>
                </a>
                <span class="codes">{a.codes}</span>
                {#if a.versions}
                  <span class="chip versions">{a.versions} v</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
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
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.9rem;
    border-radius: 99px;
    border: 1px solid var(--primary, #6750a4);
    background: var(--primary, #6750a4);
    color: white;
    cursor: pointer;
  }
  .go .material-symbols-rounded {
    font-size: 1.1rem;
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
  li a {
    text-decoration: none;
    color: inherit;
    flex: 1;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .nav a,
  .viewtoggle {
    font-size: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--on-surface-variant);
    text-decoration: none;
    padding: 0.15rem 0.7rem;
    border: 1px solid var(--outline);
    border-radius: 999px;
  }
  .viewtoggle {
    font: inherit;
    font-size: 0.8rem;
    background: var(--surface);
    cursor: pointer;
  }
  .nav a:hover,
  .viewtoggle:hover {
    color: var(--primary);
    border-color: var(--primary);
  }
  .nav a .material-symbols-rounded,
  .viewtoggle .material-symbols-rounded {
    font-size: 1rem;
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
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--on-surface-variant);
    background: var(--surface-variant);
    border: none;
    border-radius: 99px;
    padding: 0.1rem 0.6rem;
    cursor: pointer;
  }
  .export .material-symbols-rounded {
    font-size: 1rem;
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
  .chip.versions {
    background: var(--primary-container);
    color: var(--on-primary-container);
  }
  /* file-tree panel: right-aligned, collapsible folders */
  .group.tree {
    margin-left: auto;
    width: min(100%, 26rem);
  }
  .tree h2 {
    margin: 0.9rem 0 0;
    align-items: center;
  }
  .fcaret {
    font: inherit;
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--on-surface-variant);
  }
  .fcaret .material-symbols-rounded {
    font-size: 1.2rem;
  }
  .fcaret:hover {
    color: var(--primary);
  }
  .fcount {
    font-variant-numeric: tabular-nums;
  }
  .tree ul {
    margin: 0.3rem 0 0 0.55rem;
    padding-left: 1.1rem;
    border-left: 1px solid var(--outline);
  }
  .tree li a {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .tree li a .material-symbols-rounded {
    font-size: 1.05rem;
    color: var(--on-surface-variant);
  }
</style>
