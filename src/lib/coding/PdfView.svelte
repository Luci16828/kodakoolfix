<script lang="ts">
  /**
   * PDF coding surface (phase 2): renders every PDF page to a canvas and overlays
   * a transparent text layer built from the canonical extracted-text spans
   * (src/lib/coding/pdf.ts), so entry offsets map 1:1 onto page rectangles.
   * Selection is delegated to the canonical text (nearest-offset anchoring +
   * snapWords), not to the browser. Coding marks render as hatched rectangles
   * below the text layer; label chips carry `data-tag-entry` so the CodingDoc
   * popup anchors to them like editor chips.
   */
  import { base64ToBytes } from "$lib/client/coding-db";
  import type { PdfSpan } from "$lib/coding/pdf";
  import { elementSpan, sentenceSpan, snapWords } from "$lib/coding/segment";

  interface PdfMark {
    id: string;
    from: number;
    to: number;
    faded: boolean;
    hot: boolean;
    color: string;
    colorD: string;
    colorHot: string;
    colorHotD: string;
    label: string;
    /** pseudo coverage (selection/preview): rendered like a mark but without a chip */
    tagless: boolean;
    on: string;
    onD: string;
  }

  interface Range {
    from: number;
    to: number;
  }

  let props = $props<{
    /** base64 PDF bytes (RxDB pdfs collection) */
    data: string;
    /** canonical extracted text (entry offsets reference it) */
    text: string;
    marks: PdfMark[];
    armed: boolean;
    smart: boolean;
    /** smart-click preview span (rendered by the parent as pseudo coverage) */
    preview: Range | null;
    onadd: (from: number, to: number) => void;
    onselect: (r: Range | null) => void;
    onpreview: (r: Range | null) => void;
    onhovermark: (id: string | null) => void;
  }>();

  interface PageState {
    page: number;
    w: number;
    h: number;
    spans: PdfSpan[];
  }

  let host = $state<HTMLDivElement | null>(null);
  let pages = $state<PageState[]>([]);
  let scale = $state(1);
  let pdfDoc: {
    numPages: number;
    getPage(n: number): Promise<{
      getViewport(o: { scale: number }): { width: number; height: number };
      render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
        promise: Promise<unknown>;
        cancel(): void;
      };
    }>;
    destroy(): void;
  } | null = null;

  // ----- load + render pipeline -----

  $effect(() => {
    const data = props.data;
    let alive = true;
    void (async () => {
      const unpdf = await import("unpdf");
      const { extractPdfDoc } = await import("$lib/coding/pdf");
      const bytes = base64ToBytes(data);
      // every consumer transfers (detaches) the buffer it is handed → private copies
      const copy = () => {
        const c = new Uint8Array(bytes.length);
        c.set(bytes);
        return c;
      };
      const doc = await unpdf.getDocumentProxy(copy());
      const { spans } = await extractPdfDoc(copy());
      if (!alive) {
        (doc as unknown as { destroy?: () => void }).destroy?.();
        return;
      }
      pdfDoc = doc as unknown as typeof pdfDoc;
      const byPage = new Map<number, PdfSpan[]>();
      for (const s of spans) {
        const arr = byPage.get(s.page) ?? [];
        arr.push(s);
        byPage.set(s.page, arr);
      }
      const out: PageState[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        out.push({ page: i, w: vp.width, h: vp.height, spans: byPage.get(i) ?? [] });
      }
      pages = out;
    })();
    return () => {
      alive = false;
    };
  });

  function fit(): void {
    if (!host || pages.length === 0) return;
    const maxW = Math.max(...pages.map((p) => p.w));
    scale = Math.max(0.4, Math.min(1.6, (host.clientWidth - 32) / maxW));
  }

  $effect(() => {
    const el = host;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  });

  // render bookkeeping (canvas nodes, render tasks, tokens) lives OUTSIDE reactive
  // state: writing it into the `pages` $state this effect reads would re-trigger
  // it endlessly (effect_update_depth_exceeded)
  const canvasEls = new Map<number, HTMLCanvasElement>();
  const renderTasks = new Map<number, { cancel(): void }>();
  const renderTokens = new Map<number, number>();

  function renderPage(page: number): void {
    const doc = pdfDoc;
    const canvas = canvasEls.get(page);
    if (!doc || !canvas) return;
    const sc = scale;
    const dpr = window.devicePixelRatio || 1;
    const token = (renderTokens.get(page) ?? 0) + 1;
    renderTokens.set(page, token);
    void (async () => {
      const pg = pages.find((p) => p.page === page);
      const pdfPage = await doc.getPage(page);
      if (!pg || token !== renderTokens.get(page)) return;
      const viewport = pdfPage.getViewport({ scale: sc * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTasks.get(page)?.cancel();
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTasks.set(page, task);
      try {
        await task.promise;
      } catch {
        // cancelled by a newer render — fine
      }
    })();
  }

  /** attach the page canvas and render it as soon as it is mounted */
  function canvasFor(node: HTMLCanvasElement, page: number): { destroy(): void } {
    canvasEls.set(page, node);
    renderPage(page);
    return {
      destroy: () => {
        canvasEls.delete(page);
        renderTasks.get(page)?.cancel();
        renderTasks.delete(page);
      },
    };
  }

  // re-render every page when the fit scale or the loaded pages change
  $effect(() => {
    for (const pg of pages) renderPage(pg.page);
  });

  // fit the pages into the container once they are loaded
  $effect(() => {
    if (pages.length > 0) fit();
  });

  // ----- coverage rectangles (span runs with identical covering marks) -----

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

  interface Run {
    cov: PdfMark[];
    x0: number;
    x1: number;
    y: number;
    h: number;
    from: number;
    to: number;
  }

  interface Rect {
    key: string;
    page: number;
    style: string;
    chipBase: string;
    chips: { id: string; label: string; hot: boolean; on: string; onD: string }[];
  }

  /** approximate x of a text offset inside a span (linear char-width interpolation) */
  function spanX(s: PdfSpan, off: number): number {
    if (s.end <= s.start || s.width <= 0) return s.x;
    return s.x + (s.width * (off - s.start)) / (s.end - s.start);
  }

  function rectParts(run: Run): { geo: string; vars: string } {
    const cov = run.cov;
    // the editor paints its hatch *behind* the glyphs; the PDF overlay sits above the
    // canvas text, so the same hatch is painted translucent (with multiply) to keep
    // the page text readable underneath it
    const mix = (col: string, pct: number) => `color-mix(in srgb, ${col} ${String(pct)}%, transparent)`;
    const fill = (m: PdfMark, dark: boolean) =>
      m.hot ? mix(dark ? m.colorHotD : m.colorHot, 70) : mix(dark ? m.colorD : m.color, m.faded ? 22 : 55);
    const grad = (dark: boolean): string => {
      if (cov.length === 0) return "none";
      // focus mode parity with the editor: hot marks fully cover faded ones
      const focus = cov.some((m) => m.faded) && cov.some((m) => !m.faded || m.hot);
      const vis = focus ? cov.filter((m) => !m.faded || m.hot) : cov;
      const stops = vis.map((m) => fill(m, dark));
      const uniq = focus ? [...new Set(stops)] : stops;
      return uniq.length === 1 ? `linear-gradient(${uniq[0]}, ${uniq[0]})` : hatch(uniq);
    };
    const geo = [
      `left:${run.x0 * scale}px`,
      `bottom:${run.y * scale}px`,
      `width:${(run.x1 - run.x0) * scale}px`,
      `height:${Math.max(run.h, 6) * scale}px`,
    ].join("; ");
    const vars = `--m:${grad(false)}; --m-d:${grad(true)}`;
    return { geo, vars };
  }

  const rects = $derived.by<Rect[]>(() => {
    const out: Rect[] = [];
    for (const pg of pages) {
      let run: (Run & { key: string }) | null = null;
      const flush = () => {
        const r = run;
        if (!r) return;
        const { geo, vars } = rectParts(r);
        const chips = r.cov
          .filter((m: PdfMark) => !m.tagless && m.from >= r.from && m.from < r.to)
          .map((m) => ({ id: m.id, label: m.label, hot: m.hot, on: m.on, onD: m.onD }));
        out.push({
          key: `${pg.page}:${r.from}:${r.to}`,
          page: pg.page,
          style: `${geo}; ${vars}`,
          chipBase: `left:${r.x0 * scale}px; bottom:${r.y * scale}px; ${vars}`,
          chips,
        });
        run = null;
      };
      for (const s of pg.spans) {
        const cov = props.marks.filter((m: PdfMark) => m.from < s.end && s.start < m.to);
        if (cov.length === 0) {
          flush();
          continue;
        }
        // split the span at every covering mark boundary: coverage is constant
        // inside each sub-segment, so a mark codes only its own words — a PDF
        // text item is usually a whole line, and the old whole-span rect made
        // every mark cover the entire line
        const inner = new Set<number>();
        for (const m of cov) {
          const a = Math.max(m.from, s.start);
          const b = Math.min(m.to, s.end);
          if (a > s.start && a < s.end) inner.add(a);
          if (b > s.start && b < s.end) inner.add(b);
        }
        const cuts = [s.start, ...[...inner].sort((a, b) => a - b), s.end];
        for (let i = 0; i < cuts.length - 1; i++) {
          const a = cuts[i];
          const b = cuts[i + 1];
          const segCov = cov.filter((m: PdfMark) => m.from <= a && m.to >= b);
          if (segCov.length === 0) continue;
          const key = segCov
            .map((m: PdfMark) => m.id)
            .sort()
            .join("|");
          const x0 = spanX(s, a);
          const x1 = spanX(s, b);
          if (run && run.key === key && Math.abs(s.y - run.y) < 2 && a === run.to && x0 <= run.x1 + 3) {
            run.x1 = Math.max(run.x1, x1);
            run.h = Math.max(run.h, s.height);
            run.to = b;
          } else {
            flush();
            run = { key, cov: segCov, x0, x1, y: s.y, h: s.height, from: a, to: b };
          }
        }
      }
      flush();
    }
    return out;
  });

  // ----- selection / caret → canonical text offsets -----

  function offsetOf(node: Node | null, off: number): number | null {
    // only hits inside a text span count; a hit on the container itself must NOT
    // fall through to its first child (that mapped margin clicks to offset 0)
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const start = node.parentElement ? Number(node.parentElement.getAttribute("data-start")) : NaN;
    return Number.isFinite(start) ? start + off : null;
  }

  /** coordinate fallback: map a point to the offset of the NEAREST span box —
      a containing span wins; otherwise the closest one within half a line, so
      drags that start between lines still anchor on real text (margins stay null) */
  function offsetAtPoint(x: number, y: number): number | null {
    const pageEls = host ? host.querySelectorAll<HTMLElement>(".pdfpage") : [];
    for (let i = 0; i < pages.length && i < pageEls.length; i++) {
      const rect = pageEls[i].getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const px = (x - rect.left) / scale;
      const py = (rect.bottom - y) / scale;
      let best: { d: number; off: number } | null = null;
      for (const s of spansOf(i)) {
        const dx = px < s.x ? s.x - px : px > s.x + s.width ? px - (s.x + s.width) : 0;
        const dy = py < s.y ? s.y - py : py > s.y + s.height ? py - (s.y + s.height) : 0;
        const d = dx + dy;
        if (d > 14) continue; // further than half a line: margin, not text
        const t = s.width > 0 ? Math.min(1, Math.max(0, (px - s.x) / s.width)) : 0;
        const off = s.start + Math.round(t * (s.end - s.start));
        if (best === null || d < best.d) best = { d, off };
      }
      return best ? best.off : null;
    }
    return null;
  }

  function spansOf(pageIndex: number): PdfSpan[] {
    return pages[pageIndex]?.spans ?? [];
  }

  function caretOffset(x: number, y: number): number | null {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (typeof doc.caretPositionFromPoint === "function") {
      const p = doc.caretPositionFromPoint(x, y);
      const viaCaret = p ? offsetOf(p.offsetNode, p.offset) : null;
      if (viaCaret !== null) return viaCaret;
    }
    if (typeof doc.caretRangeFromPoint === "function") {
      const r = doc.caretRangeFromPoint(x, y);
      const viaCaret = r ? offsetOf(r.startContainer, r.startOffset) : null;
      if (viaCaret !== null) return viaCaret;
    }
    return offsetAtPoint(x, y);
  }

  // cleanup: clear shared selection/preview/hover state when the surface unmounts
  $effect(() => () => {
    props.onselect(null);
    props.onpreview(null);
    props.onhovermark(null);
  });

  $effect(() => {
    if (!props.armed) props.onpreview(null);
  });

  // ----- coding interactions (editor parity) -----
  // Selection is DELEGATED to the canonical text: native browser selection over
  // the absolutely-positioned span layer is unreliable, so a drag anchors on the
  // text nearest the cursor (caretOffset → offsetAtPoint) and snaps both ends
  // with snapWords — the same word-snapping CodeMirror applies to pointer
  // selections. The selection flows back through onselect and renders as its own
  // rect layer (selectionRects), exactly like the editor keeps a live selection.

  let downX = 0;
  let downY = 0;
  let moved = false;
  let anchorOff: number | null = null;
  let liveSel: Range | null = null;

  function smartAt(x: number, y: number): Range | null {
    const pos = caretOffset(x, y);
    if (pos === null) return null;
    // `hard`: extracted PDF lines are discrete layout lines, so every newline is
    // a paragraph boundary — a click codes its own line, not a blob
    return elementSpan(props.text, pos, true) ?? sentenceSpan(props.text, pos, true);
  }

  function onDown(e: MouseEvent): void {
    downX = e.clientX;
    downY = e.clientY;
    moved = false;
    anchorOff = caretOffset(e.clientX, e.clientY);
    liveSel = null;
    // a fresh press clears the previous selection (editor parity: a click places a caret)
    props.onselect(null);
    // armed smart click: preview the smart span immediately (editor smartSelect parity)
    if (props.armed && props.smart && anchorOff !== null) {
      props.onpreview(elementSpan(props.text, anchorOff, true) ?? sentenceSpan(props.text, anchorOff, true));
    }
  }

  function onMove(e: MouseEvent): void {
    if (e.buttons === 0) return;
    if (!moved && (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3)) moved = true;
    if (!moved) return;
    props.onpreview(null); // drag selection replaces the smart-click preview
    if (anchorOff === null) return;
    const head = caretOffset(e.clientX, e.clientY);
    if (head === null || head === anchorOff) return;
    const lo = Math.min(anchorOff, head);
    const hi = Math.max(anchorOff, head);
    // smart on: snap both ends to whole words (CodeMirror smartSelect parity);
    // smart off: raw character offsets, exactly like a plain CodeMirror drag
    liveSel = props.smart ? snapWords(props.text, lo, hi) : { from: lo, to: hi };
    props.onselect(liveSel); // live: focus-mode fade + coverage mark feedback
  }

  function onUp(): void {
    let r: Range | null = liveSel;
    if (!moved) r = props.preview ?? (props.smart ? smartAt(downX, downY) : null);
    if (r !== null && r.to > r.from) {
      if (props.armed) props.onadd(r.from, r.to);
      props.onselect(r); // the selection persists after coding, like in the editor
    } else {
      props.onselect(null);
    }
    liveSel = null;
    props.onpreview(null);
  }
</script>

<div class="pdfview" bind:this={host}>
  {#each pages as pg (pg.page)}
    <div class="pdfpage" style="width:{pg.w * scale}px; height:{pg.h * scale}px">
      <div class="pdfmarks" aria-hidden="true">
        {#each rects.filter((r) => r.page === pg.page) as r (r.key)}
          <div class="pdfmark" style={r.style}></div>
        {/each}
      </div>
      <div
        class="pdftext"
        role="textbox"
        aria-readonly="true"
        tabindex="0"
        class:armed={props.armed}
        onmousedown={onDown}
        onmousemove={onMove}
        onmouseup={onUp}
      >
        {#each pg.spans as s (s.start)}
          <span
            class="pdfspan"
            data-start={s.start}
            style="left:{s.x * scale}px; bottom:{s.y * scale}px; width:{Math.max(
              s.width * scale,
              1,
            )}px; height:{Math.max(s.height * scale, 4)}px; font-size:{Math.max(s.height * scale, 4)}px;"
            >{props.text.slice(s.start, s.end)}</span
          >
        {/each}
      </div>
      <div class="pdfchips">
        {#each rects.filter((r) => r.page === pg.page) as r (r.key)}
          {#each r.chips as c (c.id)}
            <span
              class="pdfchip"
              class:hot={c.hot}
              role="presentation"
              data-tag-entry={c.id}
              style="{r.chipBase}; --chip-on:{c.on}; --chip-on-d:{c.onD};"
              onmouseenter={() => props.onhovermark(c.id)}
              onmouseleave={() => props.onhovermark(null)}>{c.label}</span
            >
          {/each}
        {/each}
      </div>
      <canvas use:canvasFor={pg.page}></canvas>
    </div>
  {/each}
</div>

<style>
  .pdfview {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }

  .pdfpage {
    position: relative;
    background: white;
    box-shadow: 0 1px 8px rgb(0 0 0 / 22%);
    flex: none;
  }

  .pdfpage canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .pdfmarks {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }

  .pdfmark {
    position: absolute;
    border-radius: 2px;
    background-image: var(--m, none);
    /* translucent hatch (set in rectParts) painted over the rendered page text
       like a highlighter pen: multiply keeps the glyphs readable underneath */
    mix-blend-mode: multiply;
    --surface: white;
  }

  :root[data-theme="dark"] .pdfmark {
    background-image: var(--m-d, none);
  }

  .pdftext {
    position: absolute;
    inset: 0;
    z-index: 2;
    cursor: text;
    /* selection is delegated to the canonical text (snapWords drag) — native
       selection over the positioned span layer is unreliable and ugly */
    user-select: none;
  }

  .pdftext.armed {
    cursor: crosshair;
  }

  .pdfspan {
    position: absolute;
    color: transparent;
    white-space: pre;
    line-height: 1;
    overflow: hidden;
  }

  .pdfspan::selection {
    background: rgb(59 130 246 / 35%);
  }

  .pdfchips {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  .pdfchip {
    position: absolute;
    pointer-events: auto;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.5;
    padding: 0 5px;
    border-radius: 3px;
    background-image: var(--m, none);
    --surface: white;
    color: var(--chip-on, #111);
    opacity: 0.92;
  }

  :root[data-theme="dark"] .pdfchip {
    background-image: var(--m-d, none);
    color: var(--chip-on-d, #eee);
  }

  .pdfchip.hot {
    outline: 1px solid var(--outline, #888);
  }
</style>
