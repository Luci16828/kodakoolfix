<script lang="ts">
  import { EditorView, drawSelection } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { onMount } from "svelte";
  import { buildPalette } from "$lib/coding/palette";
  import CatalogTree from "$lib/coding/CatalogTree.svelte";
  import { entryFromOffsets, entryId, lineStarts } from "$lib/coding/edit";
  import type { CodeEntry } from "$lib/coding/types";
  import { addEntry, importSource, pushSource, removeLocalEntry, watchSource } from "$lib/client/coding-db";
  import { codingMarks, syncCodingMarks, type CodingMarkSpec } from "./code-mark";

  const { data } = $props();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const starts = $derived(lineStarts(data.text));

  let parent = $state<HTMLDivElement | undefined>(undefined);
  let view = $state.raw<EditorView | undefined>(undefined);
  let unsubscribe: (() => void) | undefined;

  let dbEntries: CodeEntry[] | null = $state(null);
  let dirty = $state(0);
  let armed = $state<string | null>(null);
  let active: string | null = $state(null);
  let saving = $state(false);
  let saveMsg = $state("");
  let editMsg = $state("");
  /** catalog id under the sidebar cursor (fades unrelated marks) */
  let hoverDevice = $state<string | null>(null);
  /** entry id under the editor cursor (brightens its mark) */
  let hoverId = $state<string | null>(null);

  function toEntry(c: (typeof data.codes)[number]): CodeEntry {
    const { code, device, line, endLine, range, excerpt, note } = c;
    const entry: CodeEntry = device ? { device, line, range, excerpt } : { code, line, range, excerpt };
    if (endLine !== undefined) entry.endLine = endLine;
    if (note !== undefined) entry.note = note;
    return entry;
  }

  const entries = $derived(dbEntries ?? data.codes.map(toEntry));

  function flatten(nodes: typeof data.catalog, out: (typeof data.catalog)[number][] = []) {
    for (const n of nodes) {
      out.push(n);
      flatten(n.children, out);
    }
    return out;
  }
  const nodes = $derived(flatten(data.catalog));
  const displayByDevice = $derived(new Map(nodes.map((n) => [n.id, n.code])));

  const palette = $derived(
    buildPalette([
      ...new Set([
        ...nodes.map((n) => n.code),
        ...entries.map((e) => displayByDevice.get(e.device ?? e.code ?? "") ?? e.code ?? e.device ?? ""),
      ]),
    ]),
  );
  const colorOf = (code: string) => palette.get(code)?.light.marker ?? "#888888";

  // article parity: repeating stripes separated by surface gaps (hatch())
  function hatch(stops: string[]): string {
    const w = 4;
    const p = w + 2;
    const total = stops.length * p;
    const stopsStr = stops
      .flatMap((col, k) => [
        `${col} ${k * p}px ${k * p + w}px`,
        `var(--surface, white) ${k * p + w}px ${(k + 1) * p}px`,
      ])
      .concat(`${stops[0]} ${total}px ${total}px`)
      .join(", ");
    return `repeating-linear-gradient(45deg, ${stopsStr})`;
  }

  const fillOf = (code: string, dark: boolean, hover: boolean): string => {
    const c = palette.get(code);
    if (!c) return "#888888";
    return hover ? (dark ? c.dark.fillHover : c.light.fillHover) : dark ? c.dark.fill : c.light.fill;
  };

  function colorVars(code: string): string {
    const c = palette.get(code);
    if (!c) return "";
    return [
      `--fill: ${c.light.fill}`,
      `--fill-d: ${c.dark.fill}`,
      `--marker: ${c.light.marker}`,
      `--marker-d: ${c.dark.marker}`,
      `--on-marker: ${c.light.on}`,
      `--on-marker-d: ${c.dark.on}`,
    ].join("; ");
  }

  // catalog id for an entry's device/code/alias key
  const keyToId = $derived.by(() => {
    const map = new Map<string, string>();
    const walk = (ns: typeof data.catalog): void => {
      for (const n of ns) {
        map.set(n.id, n.id);
        map.set(n.code, n.id);
        for (const a of n.alias ?? []) map.set(a, n.id);
        walk(n.children);
      }
    };
    walk(data.catalog);
    return map;
  });

  // ids of the hovered catalog node and its whole subtree (null = no filter)
  const hoverKeys = $derived.by(() => {
    if (hoverDevice === null) return null;
    const find = (ns: typeof data.catalog): (typeof data.catalog)[number] | null => {
      for (const n of ns) {
        if (n.id === hoverDevice) return n;
        const f = find(n.children);
        if (f) return f;
      }
      return null;
    };
    const node = find(data.catalog);
    if (!node) return null;
    const ids = new Set<string>();
    const collect = (n: (typeof data.catalog)[number]): void => {
      ids.add(n.id);
      for (const c of n.children) collect(c);
    };
    collect(node);
    return ids;
  });

  interface Placed {
    entry: CodeEntry;
    id: string;
    code: string;
    from: number;
    to: number;
    faded: boolean;
  }

  const placed = $derived.by<Placed[]>(() => {
    const out: Placed[] = [];
    for (const e of entries) {
      const key = e.device ?? e.code ?? "";
      const from = starts[e.line - 1] + e.range[0];
      const to = starts[(e.endLine ?? e.line) - 1] + e.range[1];
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) continue;
      out.push({
        entry: e,
        id: entryId(data.source, e),
        code: displayByDevice.get(key) ?? key,
        from,
        to,
        faded: hoverKeys !== null && !hoverKeys.has(keyToId.get(key) ?? key),
      });
    }
    return out;
  });

  // split overlapping entries into disjoint segments (article token parity):
  // one mark per maximal interval with identical coverage; multi coverage gets
  // the hatch of all covering colors, single coverage the plain fill bar
  const specs = $derived.by<CodingMarkSpec[]>(() => {
    const points = [...new Set(placed.flatMap((p) => [p.from, p.to]))].sort((a, b) => a - b);
    const out: CodingMarkSpec[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i];
      const to = points[i + 1];
      const cov = placed.filter((p) => p.from <= from && to <= p.to);
      if (cov.length === 0) continue;
      const ids = cov.map((p) => p.id);
      const id = [...ids].sort().join("|");
      const hot = hoverId === id;
      const mix = (col: string, faded: boolean) => (faded ? `color-mix(in srgb, ${col} 32%, transparent)` : col);
      const style =
        cov.length === 1
          ? [
              `--fill:${mix(fillOf(cov[0].code, false, false), cov[0].faded)}`,
              `--fill-d:${mix(fillOf(cov[0].code, true, false), cov[0].faded)}`,
              `--hl:${fillOf(cov[0].code, false, true)}`,
              `--hl-d:${fillOf(cov[0].code, true, true)}`,
            ].join("; ")
          : [
              `--bars:${hatch(cov.map((p) => (hot ? fillOf(p.code, false, true) : mix(fillOf(p.code, false, false), p.faded))))}`,
              `--bars-d:${hatch(cov.map((p) => (hot ? fillOf(p.code, true, true) : mix(fillOf(p.code, true, false), p.faded))))}`,
            ].join("; ");
      out.push({
        id,
        ids,
        from,
        to,
        code: [...cov.map((p) => p.code)].sort().join(" · "),
        style,
        hot,
      });
    }
    return out;
  });

  const entryCountsById = $derived.by(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const key = e.device ?? e.code;
      if (key === undefined) continue;
      const id = keyToId.get(key) ?? key;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  });

  const activeEntries = $derived.by(() => {
    const key = active;
    if (key === null) return [];
    const ids = new Set(key.split("|"));
    return entries.filter((e) => ids.has(entryId(data.source, e)));
  });
  const armedLabel = $derived(armed === null ? "" : (displayByDevice.get(armed) ?? armed));

  $effect(() => {
    if (!view) return;
    try {
      syncCodingMarks(view, specs);
    } catch (e) {
      editMsg = `marks: ${String(e)}`;
    }
  });

  function pick(id: string) {
    if (!UUID_RE.test(id)) return;
    armed = armed === id ? null : id;
    active = null;
    saveMsg = "";
    editMsg = "";
  }

  async function save() {
    saving = true;
    const errors = await pushSource({ folder: data.folder, name: data.name, source: data.source }, entries);
    saveMsg = errors.length === 0 ? "saved" : errors.join("; ");
    saving = false;
  }

  function removeEntry(e: CodeEntry) {
    void removeLocalEntry(data.source, e);
    active = null;
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: data.text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          drawSelection(),
          codingMarks(
            (id) => (active = id),
            (id) => {
              if (id !== hoverId) hoverId = id;
            },
          ),
          // add on mouse release only: during a drag CM dispatches a selection
          // transaction per mousemove, so updateListener would fire per-pixel
          EditorView.domEventHandlers({
            mouseup: (_event, v) => {
              if (armed === null) return;
              const r = v.state.selection.main;
              if (r.empty) return;
              const entry = entryFromOffsets(data.source, starts, data.text, r.from, r.to, armed);
              void addEntry(data.source, entry).catch((e) => (editMsg = String(e)));
              v.dispatch({ selection: { anchor: r.to } });
            },
          }),
        ],
      }),
      parent: parent ?? document.body,
    });

    try {
      syncCodingMarks(view, specs);
    } catch (e) {
      editMsg = `marks: ${String(e)}`;
    }

    importSource(data.source, data.codes.map(toEntry)).catch((e) => (editMsg = `import: ${String(e)}`));
    unsubscribe = watchSource(data.source, (es, d) => {
      dbEntries = es;
      dirty = d;
    });

    return () => {
      unsubscribe?.();
      view?.destroy();
    };
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      armed = null;
      active = null;
    }
  }}
/>

<main>
  <header>
    <h1>{data.name}</h1>
    <p class="source">{data.source}</p>
    <div class="bar">
      {#if armed !== null}
        <span class="hint"
          >armed <span class="tag" style={`--marker:${colorOf(armedLabel)}`}>{armedLabel}</span> — select text to code it,
          Esc to stop</span
        >
      {/if}
      {#if dirty > 0}
        <button type="button" class="save" onclick={save} disabled={saving}>
          {saving ? "saving…" : `save ${dirty} edit${dirty === 1 ? "" : "s"}`}
        </button>
      {/if}
      {#if saveMsg}<span class="msg" class:err={saveMsg !== "saved"}>{saveMsg}</span>{/if}
      {#if editMsg}<span class="msg err">{editMsg}</span>{/if}
    </div>
  </header>

  <div class="workspace">
    <div class="editor" bind:this={parent}></div>
    <aside>
      <h2>Frame devices</h2>
      <CatalogTree
        catalog={data.catalog}
        counts={dbEntries === null ? null : entryCountsById}
        selected={armed}
        styleFor={(n) => colorVars(n.code)}
        onpick={pick}
        onhover={(id) => (hoverDevice = id)}
      />
    </aside>
  </div>

  {#if activeEntries.length > 0}
    <aside class="detail">
      {#each activeEntries as e (entryId(data.source, e))}
        {@const code = displayByDevice.get(e.device ?? e.code ?? "") ?? e.code ?? e.device ?? ""}
        <div class="row">
          <span class="tag" style={`--marker:${colorOf(code)}`}>{code}</span>
          <blockquote>{e.excerpt}</blockquote>
          {#if e.note}<p class="note">{e.note}</p>{/if}
          <button type="button" class="del" onclick={() => removeEntry(e)}>remove</button>
        </div>
      {/each}
    </aside>
  {/if}
</main>

<style lang="scss">
  main {
    max-width: 90cm;
    margin: 0 auto;
    padding: 1rem 2rem;
    font-family: var(--font-sans, system-ui, sans-serif);
  }

  h1 {
    margin: 0;
    font-size: 1.3rem;
  }

  .source {
    color: var(--on-surface-variant, #666);
    font-size: 0.8rem;
    margin: 0.2rem 0 0.6rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: 1.5rem;
    align-items: start;
  }

  aside {
    position: sticky;
    top: 1rem;

    h2 {
      margin: 0 0 0.4rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--on-surface-variant, #666);
    }
  }

  @media (max-width: 50rem) {
    .workspace {
      grid-template-columns: 1fr;
    }

    aside {
      position: static;
    }
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 1.6rem;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;

    .hint {
      font-style: italic;
    }

    .save {
      font: inherit;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      border: 1px solid var(--outline, #888);
      background: var(--surface, white);
      cursor: pointer;
    }

    .msg {
      color: #0a6b2d;

      &.err {
        color: #b3261e;
      }
    }
  }

  .tag {
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--marker, #666);
    color: white;
  }

  .editor {
    height: 70vh;
    border: 1px solid var(--outline, #ddd);
    border-radius: 4px;
  }

  :global(.cm-content) {
    font-family: var(--font-serif, Georgia, serif);
    line-height: 2.55;
    padding: 0.5rem 0;
  }

  /* highlight bar hugging the text instead of the full leading (article .coded parity);
     segments with several entries get the precomputed hatch (--bars), singles the plain fill */
  :global(.cm-underline) {
    position: relative;
    isolation: isolate;
    border-radius: 2px;
    background-image: var(--bars, linear-gradient(var(--fill, transparent), var(--fill, transparent)));
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 1.2em;
  }

  :global(:root[data-theme="dark"] .cm-underline) {
    background-image: var(--bars-d, linear-gradient(var(--fill-d, transparent), var(--fill-d, transparent)));
  }

  /* fillHover overlay, revealed on hover (article .coded.focused::after parity) */
  :global(.cm-underline::after) {
    content: "";
    position: absolute;
    inset: calc(50% - 0.6em) 0;
    z-index: -1;
    background: var(--hl, transparent);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }

  :global(:root[data-theme="dark"] .cm-underline::after) {
    background: var(--hl-d, transparent);
  }

  :global(.cm-underline:hover::after),
  :global(.cm-underline.hot::after) {
    opacity: 1;
  }

  .detail {
    margin-top: 0.8rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--outline, #ddd);
    border-radius: 6px;
    width: fit-content;
    max-width: 60cm;

    blockquote {
      margin: 0.4rem 0;
      font-family: var(--font-serif, Georgia, serif);
    }

    .row + .row {
      margin-top: 0.6rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--outline, #ddd);
    }

    .note {
      font-size: 0.8rem;
      color: var(--on-surface-variant, #666);
    }

    .del {
      font: inherit;
      font-size: 0.8rem;
      color: #b3261e;
      border: 1px solid #b3261e55;
      border-radius: 999px;
      background: transparent;
      padding: 0.1rem 0.6rem;
      cursor: pointer;
    }
  }
</style>
