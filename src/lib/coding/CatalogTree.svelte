<script lang="ts" module>
  import type { CatalogView } from "$lib/server/coding/store";
</script>

<script lang="ts">
  import { Tree } from "melt/builders";
  import type { Slug } from "./shortlabel";

  let {
    catalog,
    counts = null,
    selected = null,
    styleFor = () => "",
    onpick,
    onhover,
  }: {
    catalog: CatalogView[];
    /** per-node counts keyed by catalog id; null falls back to the server count on each node */
    counts?: Map<string, number> | null;
    /** catalog id of the currently selected (armed) device */
    selected?: string | null;
    /** css custom properties applied to each node row (e.g. --marker, --fill) */
    styleFor?: (node: CatalogView) => string;
    /** called with the device id when a pickable leaf row is clicked */
    onpick?: (id: string) => void;
    onhover?: (id: string | null) => void;
  } = $props();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function expandableIds(ns: CatalogView[], acc: string[] = []): string[] {
    for (const n of ns) {
      if (n.children.length) {
        acc.push(n.id);
        expandableIds(n.children, acc);
      }
    }
    return acc;
  }

  const tree = $derived(
    new Tree({
      items: catalog,
      multiple: true,
      expanded: new Set(expandableIds(catalog)),
    }),
  );
  type TreeNode = (typeof tree.children)[number];

  function countOf(n: TreeNode): number {
    const own = counts === null ? n.item.count : (counts.get(n.item.id) ?? 0);
    return own + (n.children?.reduce((s, c) => s + countOf(c), 0) ?? 0);
  }

  function codeId(code: string): string {
    return /^[0-9]+(?:\.[0-9]+)*/.exec(code)?.[0] ?? code;
  }

  function boldSegments(name: string, slug: Slug | null): { t: string; b: boolean }[] {
    if (!slug || slug.bold.length === 0) return name ? [{ t: name, b: false }] : [];
    const out: { t: string; b: boolean }[] = [];
    let i = 0;
    for (const p of [...slug.bold].sort((a, b) => a.start - b.start)) {
      if (p.start > i) out.push({ t: name.slice(i, p.start), b: false });
      out.push({ t: name.slice(p.start, p.start + p.len), b: true });
      i = p.start + p.len;
    }
    if (i < name.length) out.push({ t: name.slice(i, name.length), b: false });
    return out;
  }

  function click(n: TreeNode): void {
    if (n.canExpand) {
      n.toggleExpand();
      return;
    }
    if (UUID_RE.test(n.item.id)) onpick?.(n.item.id);
  }
</script>

{#snippet nodes(children: TreeNode[])}
  {#each children as n (n.id)}
    <div
      {...n.attrs}
      class="tnode"
      class:group={n.canExpand}
      class:unused={countOf(n) === 0}
      class:sel={selected === n.item.id}
      data-kind={n.item.kind}
      style={styleFor(n.item)}
      onmouseenter={() => onhover?.(n.item.id)}
      onmouseleave={() => onhover?.(null)}
      onclick={() => click(n)}
    >
      <span class="caret" class:hidden={!n.canExpand} aria-hidden="true"
        >{n.canExpand ? (n.expanded ? "▾" : "▸") : ""}</span
      >
      <span class="tnum" title={n.item.code}>{n.item.slug?.short ?? codeId(n.item.code)}</span>
      <span class="tname"
        >{#each boldSegments(n.item.name, n.item.slug) as seg, si (si)}{#if seg.b}<b>{seg.t}</b
            >{:else}{seg.t}{/if}{/each}</span
      >
      <span class="tcount">{countOf(n) || ""}</span>
    </div>
    {#if n.canExpand && n.expanded}
      <div {...tree.group}>{@render nodes(n.children ?? [])}</div>
    {/if}
  {/each}
{/snippet}

<div {...tree.root} class="tree">
  {@render nodes(tree.children)}
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .tnode {
    display: flex;
    align-items: baseline;

    border: 1px solid var(--surface);
    gap: 0.4rem;
    text-align: left;
    background: var(--fill, transparent);
    color: var(--on-surface);
    outline: none;
    cursor: pointer;
  }
  .tnode.group {
    cursor: pointer;
  }
  :root[data-theme="dark"] .tnode {
    background: var(--fill-d, transparent);
  }
  .tnode:hover {
    background: var(--marker);
    color: var(--on-marker);
  }
  :root[data-theme="dark"] .tnode:hover {
    background: var(--marker-d);
    color: var(--on-marker-d);
  }
  .tnode.unused {
    opacity: 0.55;
  }
  .tnode.sel {
    background: var(--marker);
    color: var(--on-marker);
  }
  .tnode.sel .tnum {
    color: inherit;
  }
  :root[data-theme="dark"] .tnode.sel {
    background: var(--marker-d);
    color: var(--on-marker-d);
  }
  .caret {
    width: 0.9rem;
    flex: none;
    text-align: center;
    color: var(--on-surface-variant, #888);
  }
  .caret.hidden {
    visibility: hidden;
  }
  .tnum {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--marker);
  }
  :root[data-theme="dark"] .tnum {
    color: var(--marker-d);
  }
  .tnode:hover .tnum {
    color: inherit;
  }
  .tname {
    flex: 1;
    font-size: 0.85rem;
  }
  .tcount {
    color: inherit;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  div[role="group"] {
    display: flex;
    flex-direction: column;
    padding-left: 1rem;
    border-left: 1px solid var(--outline, #ccc);
    margin-left: 0.4rem;
  }
</style>
