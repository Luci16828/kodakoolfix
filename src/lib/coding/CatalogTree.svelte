<script lang="ts" module>
  import type { CatalogView } from "$lib/server/coding/store";
</script>

<script lang="ts">
  import { Tree } from "melt/builders";
  import "material-symbols/rounded.css";
  import type { Slug } from "./shortlabel";

  let {
    catalog,
    counts = null,
    selected = null,
    styleFor = () => "",
    onpick,
    onhover,
    editing = false,
    onrename,
    ontag,
    onmove,
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
    /** inline editing: name/tag inputs + drag reordering (picks disabled) */
    editing?: boolean;
    onrename?: (id: string, name: string) => void;
    /** empty tag string clears the override (auto slug returns) */
    ontag?: (id: string, tag: string) => void;
    /** drop `dragId` onto `targetId` (reorders within the target's sibling list) */
    onmove?: (dragId: string, targetId: string) => void;
  } = $props();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** row currently being dragged / currently a drop target (edit mode only) */
  let dragId = $state<string | null>(null);
  let dropId = $state<string | null>(null);

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
    if (editing) return;
    if (UUID_RE.test(n.item.id)) onpick?.(n.item.id);
  }
</script>

{#snippet nodes(children: TreeNode[])}
  {#each children as n (n.id)}
    {@const droppable = editing && dragId !== null && dragId !== n.item.id}
    <div
      {...n.attrs}
      class="tnode"
      class:group={n.canExpand}
      class:unused={countOf(n) === 0}
      class:sel={selected === n.item.id}
      class:drop={droppable && dropId === n.item.id}
      data-kind={n.item.kind}
      style={styleFor(n.item)}
      onmouseenter={() => onhover?.(n.item.id)}
      onmouseleave={() => onhover?.(null)}
      onclick={() => click(n)}
      ondragover={(e) => {
        if (droppable) {
          e.preventDefault();
          dropId = n.item.id;
        }
      }}
      ondragleave={() => {
        if (dropId === n.item.id) dropId = null;
      }}
      ondrop={(e) => {
        if (dragId !== null) {
          e.preventDefault();
          onmove?.(dragId, n.item.id);
        }
        dragId = null;
        dropId = null;
      }}
    >
      {#if editing}
        <span
          class="grip material-symbols-rounded"
          draggable="true"
          title="drag to reorder"
          aria-hidden="true"
          ondragstart={() => (dragId = n.item.id)}
          ondragend={() => {
            dragId = null;
            dropId = null;
          }}
        >
          drag_indicator</span
        >
      {/if}
      <span class="caret material-symbols-rounded" class:hidden={!n.canExpand} aria-hidden="true"
        >{n.canExpand ? (n.expanded ? "expand_more" : "chevron_right") : ""}</span
      >
      <span class="tnum" title={n.item.code}>{n.item.slug?.short ?? codeId(n.item.code)}</span>
      {#if editing}
        <input
          class="tedit"
          value={n.item.name}
          placeholder="name"
          spellcheck="false"
          aria-label={`name ${n.item.name || n.item.code}`}
          oninput={(e) => onrename?.(n.item.id, e.currentTarget.value)}
          onkeydown={(e) => e.stopPropagation()}
        />
        <input
          class="ttag"
          value={n.item.tag ?? ""}
          placeholder={n.item.slug?.short ?? "tag"}
          maxlength={12}
          spellcheck="false"
          title="override the auto tag (empty = auto)"
          aria-label={`tag ${n.item.name || n.item.code}`}
          oninput={(e) => ontag?.(n.item.id, e.currentTarget.value)}
          onkeydown={(e) => e.stopPropagation()}
        />
      {:else}
        <span class="tname"
          >{#each boldSegments(n.item.name, n.item.slug) as seg, si (si)}{#if seg.b}<b>{seg.t}</b
              >{:else}{seg.t}{/if}{/each}</span
        >
      {/if}
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
    font-size: 1.1rem;
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
  /* edit mode: grip handle + inline name/tag inputs, hover no longer paints the row */
  .grip {
    width: 1rem;
    flex: none;
    text-align: center;
    font-size: 1rem;
    cursor: grab;
    color: var(--on-surface-variant, #888);
  }
  .tnode.drop {
    outline: 2px dashed var(--primary, #6750a4);
    outline-offset: -2px;
  }
  .tedit {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.1rem 0.3rem;
    background: var(--surface, white);
    color: var(--on-surface);
    border: 1px solid var(--outline, #888);
    border-radius: 4px;
  }
  .ttag {
    width: 3.4rem;
    flex: none;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
    background: var(--surface, white);
    color: var(--on-surface);
    border: 1px solid var(--outline, #888);
    border-radius: 4px;
  }
  .tnode:hover .tedit,
  .tnode:hover .ttag {
    border-color: var(--outline, #888);
  }
</style>
