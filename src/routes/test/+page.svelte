<script lang="ts">
  import { EditorView } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { onMount } from "svelte";
  import "material-symbols/rounded.css";
  import { buildPalette } from "$lib/coding/palette";
  import CatalogTree from "$lib/coding/CatalogTree.svelte";
  import { entryFromOffsets, entryId, lineStarts } from "$lib/coding/edit";
  import type { CodeEntry } from "$lib/coding/types";
  import { addEntry, importSource, pushSource, removeLocalEntry, watchSource } from "$lib/client/coding-db";
  import { codingMarks, smartSelect, syncCodingMarks, type CodingMarkSpec } from "./code-mark";

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
  let smart = $state(false);
  /** current editor selection (rendered as just another mark) */
  let selRange: { from: number; to: number } | null = $state(null);
  /** span a smart click would select right now (hover preview mark) */
  let previewRange: { from: number; to: number } | null = $state(null);
  let saveMsg = $state("");
  let editMsg = $state("");
  /** catalog id under the sidebar cursor (fades unrelated marks) */
  let hoverDevice = $state<string | null>(null);
  /** segment id under the editor cursor (heats its narrowest entry) */
  let hoverId = $state<string | null>(null);
  /** entry id under a hovered label chip (heats the entry everywhere) */
  let hoverChip = $state<string | null>(null);

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

  // short slugs (LTE etc.) from the catalog, keyed by display code
  const shortByCode = $derived.by(() => {
    const map = new Map<string, string>();
    const walk = (ns: typeof data.catalog): void => {
      for (const n of ns) {
        if (n.slug) map.set(n.code, n.slug.short);
        walk(n.children);
      }
    };
    walk(data.catalog);
    return map;
  });

  // selection & smart-preview are coverage pseudo-codes (rendered through the
  // same segments/hatch pipeline as real entries, so overlaps hatch)
  const SEL_CODE = "__selection";
  const PREVIEW_CODE = "__preview";

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
    if (code === SEL_CODE) return dark ? "#7f97e6" : "#4a7ad4";
    if (code === PREVIEW_CODE) return dark ? "#93a4d6" : "#829fcf";
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
    entry?: CodeEntry;
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
        faded:
          selRange !== null || previewRange !== null || (hoverKeys !== null && !hoverKeys.has(keyToId.get(key) ?? key)),
      });
    }
    // selection & preview are coverage pseudo-entries: they split segments and
    // hatch against real marks instead of sitting as a separate overlay
    if (selRange !== null && selRange.to > selRange.from)
      out.push({ id: SEL_CODE, code: SEL_CODE, from: selRange.from, to: selRange.to, faded: false });
    if (previewRange !== null && previewRange.to > previewRange.from)
      out.push({ id: PREVIEW_CODE, code: PREVIEW_CODE, from: previewRange.from, to: previewRange.to, faded: false });
    return out;
  });

  const tagFor = (code: string) => {
    const c = palette.get(code);
    return {
      label: shortByCode.get(code) ?? code,
      marker: c?.light.marker ?? "#888888",
      markerD: c?.dark.marker ?? "#888888",
      on: c?.light.on ?? "#ffffff",
      onD: c?.dark.on ?? "#ffffff",
    };
  };

  // article parity: entry size metric (lines dominate chars) for the narrowest
  // entry of a hovered segment; pseudo coverage (selection/preview) is ignored
  const spanOf = (p: Placed): number => {
    if (!p.entry) return Number.POSITIVE_INFINITY;
    return ((p.entry.endLine ?? p.entry.line) - p.entry.line) * 1_000_000 + (p.to - p.from);
  };
  const narrowest = (cov: Placed[]): Placed | undefined =>
    cov.filter((p) => p.entry !== undefined).reduce<Placed | undefined>((a, b) => (a === undefined || spanOf(b) < spanOf(a) ? b : a), undefined);
  // split overlapping entries into disjoint segments (article token parity):
  // maximal intervals with identical coverage, independent of any hover state
  const segments = $derived.by(() => {
    const points = [...new Set(placed.flatMap((p) => [p.from, p.to]))].sort((a, b) => a - b);
    const out: { id: string; ids: string[]; from: number; to: number; cov: Placed[] }[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i];
      const to = points[i + 1];
      const cov = placed.filter((p) => p.from <= from && to <= p.to);
      if (cov.length === 0) continue;
      const ids = cov.map((p) => p.id);
      out.push({ id: [...ids].sort().join("|"), ids, from, to, cov });
    }
    return out;
  });

  // single hover model (article hotSetFor parity): hovering a segment marks its
  // narrowest entry hot, hovering a chip marks that entry hot, and the entry is
  // then hot in EVERY segment and chip it covers — bars and chips both render
  // off this one set, so all hover sources go through the same code path
  const hotEntries = $derived.by(() => {
    const s = new Set<string>();
    const seg = hoverId === null ? undefined : segments.find((x) => x.id === hoverId);
    if (seg !== undefined) s.add(narrowest(seg.cov).id);
    if (hoverChip !== null) s.add(hoverChip);
    return s;
  });

  const specs = $derived.by<CodingMarkSpec[]>(() => {
    const out: CodingMarkSpec[] = [];
    for (const { id, ids, from, to, cov } of segments) {
      const hotIds = new Set(ids.filter((x) => hotEntries.has(x)));
      const hot = hotIds.size > 0;
      const mix = (col: string, faded: boolean) => (faded ? `color-mix(in srgb, ${col} 32%, transparent)` : col);
      const grad = (dark: boolean, hotVariant: boolean): string =>
        cov.length === 1
          ? `linear-gradient(${hotVariant ? fillOf(cov[0].code, dark, true) : mix(fillOf(cov[0].code, dark, false), cov[0].faded)}, ${hotVariant ? fillOf(cov[0].code, dark, true) : mix(fillOf(cov[0].code, dark, false), cov[0].faded)})`
          : hatch(
              cov.map((p) =>
                hotVariant && hotIds.has(p.id) ? fillOf(p.code, dark, true) : mix(fillOf(p.code, dark, false), p.faded),
              ),
            );
      const style = [
        `--bars:${grad(false, false)}`,
        `--bars-d:${grad(true, false)}`,
        `--bars-hot:${grad(false, true)}`,
        `--bars-hot-d:${grad(true, true)}`,
      ].join("; ");
      out.push({
        id,
        ids,
        from,
        to,
        code: [...cov.map((p) => p.code)].sort().join(" · "),
        style,
        // one label per entry, only above the segment where it starts
        tags: cov.filter((p) => p.from === from).map((p) => ({ ...tagFor(p.code), id: p.id, hot: hotIds.has(p.id) })),
        hot,
      });
    }
    // selection and click-preview ride the same mark pipeline: a single-color
    // band in the marker hue, so they line up with the coding bars and hatch
    const band = (l: string, d: string) =>
      `--bars:linear-gradient(${l},${l}); --bars-d:linear-gradient(${d},${d}); ` +
      `--bars-hot:linear-gradient(${l},${l}); --bars-hot-d:linear-gradient(${d},${d})`;
    if (previewRange !== null && previewRange.to > previewRange.from)
      out.push({
        id: "preview",
        ids: [],
        from: previewRange.from,
        to: previewRange.to,
        code: "",
        style: band(
          "color-mix(in srgb, var(--marker, #93b5e5) 16%, transparent)",
          "color-mix(in srgb, var(--marker-d, #8899bb) 16%, transparent)",
        ),
        tags: [],
        cls: "cm-preview",
      });
    if (selRange !== null && selRange.to > selRange.from)
      out.push({
        id: "sel",
        ids: [],
        from: selRange.from,
        to: selRange.to,
        code: "",
        style: band(
          "color-mix(in srgb, var(--marker, #93b5e5) 34%, transparent)",
          "color-mix(in srgb, var(--marker-d, #8899bb) 34%, transparent)",
        ),
        tags: [],
        cls: "cm-sel",
      });
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

  // cursor-following ctag while armed (article parity)
  let cursor = $state({ x: 0, y: 0 });
  let dragging = $state(false);

  function markerVars(code: string): string {
    const c = palette.get(code);
    if (!c) return "";
    return [
      `--marker:${c.light.marker}`,
      `--marker-d:${c.dark.marker}`,
      `--on-marker:${c.light.on}`,
      `--on-marker-d:${c.dark.on}`,
    ].join("; ");
  }

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
          // selection is folded into specs as a mark; mirror CM's main range
          EditorView.updateListener.of((u) => {
            if (!u.selectionSet) return;
            const r = u.state.selection.main;
            selRange = r.empty ? null : { from: r.from, to: r.to };
          }),
          // listed before codingMarks: its click-selection dispatch updates the
          // selection before the mouseup-add handler reads it
          smartSelect({
            enabled: () => smart,
            onPreview: (s) => {
              previewRange = s;
            },
          }),
          codingMarks(
            (id) => (active = id),
            (id) => {
              if (id !== hoverId) hoverId = id;
            },
            (id) => {
              if (id !== hoverChip) hoverChip = id;
            },
            (id) => {
              const e = entries.find((x) => entryId(data.source, x) === id);
              if (e !== undefined) removeEntry(e);
            },
            // add on mouse release only: during a drag CM dispatches a selection
            // transaction per mousemove, so updateListener would fire per-pixel
            (selFrom, selTo) => {
              if (armed === null) return;
              // trim whitespace at both ends: a multi-line drag otherwise codes
              // the trailing spaces / leading indents of each line, rendering as
              // floating bars over whitespace
              let from = selFrom;
              let to = selTo;
              while (from < to && /\s/.test(data.text[from])) from++;
              while (to > from && /\s/.test(data.text[to - 1])) to--;
              if (from >= to) return;
              const entry = entryFromOffsets(data.source, starts, data.text, from, to, armed);
              void addEntry(data.source, entry).catch((e) => (editMsg = String(e)));
              view?.dispatch({ selection: { anchor: to } });
            },
          ),
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
  onmousemove={(e) => {
    if (armed !== null) cursor = { x: e.clientX, y: e.clientY };
  }}
  onmousedown={() => (dragging = true)}
  onmouseup={() => (dragging = false)}
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
      <label class="smart" title="select by word/quote/sentence instead of raw characters">
        <input type="checkbox" bind:checked={smart} />
        smart select
      </label>
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
    <div
      class="editor"
      class:arm={armed !== null}
      class:smart
      style={armed !== null ? markerVars(armedLabel) : ""}
      bind:this={parent}
    ></div>
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
  {#if armed !== null && !dragging}
    <div class="ctag" style={`left: ${cursor.x + 14}px; top: ${cursor.y + 14}px; ${markerVars(armedLabel)}`}>
      {armedLabel}
    </div>
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
  }

  :global(.cm-editor.cm-focused) {
    outline: none;
  }

  /* armed keeps the normal text cursor (the floating ctag already signals arming);
     only smart select changes the cursor, to a cell, where it would be text */
  .editor.smart :global(.cm-content) {
    cursor: cell;
  }

  /* selection is drawn by our own .cm-underline mark (see specs) instead of the
     drawSelection layer: hide the native highlight */
  :global(.cm-editor ::selection) {
    background: transparent;
  }

  /* selection & smart-preview are just extra .cm-underline marks (same band
     pipeline, their own --bars in the marker hue); the coding bars dim to a
     faded color (specs.faded) so text stays legible, never opacity-faded */
  :global(.cm-underline.cm-sel),
  :global(.cm-underline.cm-preview) {
    border-radius: 2px;
  }

  .smart {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85rem;
    color: var(--on-surface-variant, #666);
    cursor: pointer;
    user-select: none;
  }

  /* cursor-following tag while armed (article .ctag parity) */
  .ctag {
    position: fixed;
    z-index: 10;
    pointer-events: none;
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 3px;
    background: var(--marker, #666);
    color: var(--on-marker, white);
    white-space: nowrap;
  }

  :root[data-theme="dark"] .ctag {
    background: var(--marker-d, #aaa);
    color: var(--on-marker-d, black);
  }

  :global(.cm-content) {
    font-family: var(--font-serif, Georgia, serif);
    line-height: 2.55;
    padding: 1.35rem 0 0.5rem;
  }

  /* highlight bar hugging the text (article .coded parity); base and hover
     gradients are both precomputed, the hot class swaps in --bars-hot. No abs
     ::after: it misplaces itself on fragmented (wrapped, multi-line) marks */
  :global(.cm-underline) {
    border-radius: 2px;
    background-image: var(--bars, none);
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 1.2em;
  }

  :global(.cm-underline.cm-hot) {
    background-image: var(--bars-hot, var(--bars, none));
  }

  :global(:root[data-theme="dark"] .cm-underline) {
    background-image: var(--bars-d, none);
  }

  :global(:root[data-theme="dark"] .cm-underline.cm-hot) {
    background-image: var(--bars-hot-d, var(--bars-d, none));
  }

  /* code label chips floating above the segment start (article .cid parity),
     rendered by the zero-width inline widget */
  :global(.cm-tagline) {
    position: relative;
    display: inline-block;
    width: 0;
    height: 0;
  }

  /* line-height 2.55 with the 1.2em bar centered puts the bar top ~0.9em above
     the baseline, where the chip row anchors */
  :global(.cm-tagrow) {
    position: absolute;
    bottom: 0.9em;
    left: 0;
    z-index: 2;
    display: inline-flex;
    gap: 3px;
    white-space: nowrap;
  }

  :global(.cm-tag) {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.5;
    padding: 1px 3px;
    border-radius: 3px 3px 0 0;
    background: var(--tag, #888);
    color: var(--tag-on, #fff);
    cursor: pointer;
  }

  :global(:root[data-theme="dark"] .cm-tag) {
    background: var(--tag-d, #888);
    color: var(--tag-on-d, #fff);
  }

  /* material-symbols remove button inside the chip, revealed on chip hover
     (span prefix beats the .material-symbols-rounded utility on specificity);
     collapses to zero width so it takes no space until the chip is hovered */
  :global(span.cm-tag-x) {
    display: inline-block;
    width: 0;
    overflow: hidden;
    margin-left: 0;
    font-size: 0.9em;
    line-height: 1;
    vertical-align: -0.15em;
    cursor: pointer;
    transition:
      width 0.12s ease,
      margin-left 0.12s ease;
  }

  :global(.cm-tag:hover span.cm-tag-x) {
    width: 0.95em;
    margin-left: 2px;
  }

  /* article .id:hover/.hot parity */
  :global(.cm-tag:hover),
  :global(.cm-tag-hot) {
    filter: brightness(1.2);
  }

  :global(:root[data-theme="dark"] .cm-tag:hover),
  :global(:root[data-theme="dark"] .cm-tag-hot) {
    filter: brightness(1.35);
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
