import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import PdfView from "$lib/coding/PdfView.svelte";
import { buildPdf } from "$lib/coding/pdf-sample";
import { extractPdfDoc } from "$lib/coding/pdf";

function mk(id: string, from: number, to: number, label: string) {
  return {
    id,
    from,
    to,
    faded: false,
    hot: false,
    color: "#ff0000",
    colorD: "#ff0000",
    colorHot: "#ff0000",
    colorHotD: "#ff0000",
    label,
    tagless: false,
    on: "#000000",
    onD: "#ffffff",
  };
}

async function mount(
  marks: ReturnType<typeof mk>[],
  opts: {
    armed?: boolean;
    smart?: boolean;
    onselect?: (r: { from: number; to: number } | null) => void;
    onadd?: (from: number, to: number) => void;
  } = {},
) {
  const bytes = buildPdf(["Hello coding world.", "Zweite Zeile."]);
  const doc = await extractPdfDoc(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  render(PdfView, {
    data: btoa(bin),
    text: doc.text,
    marks,
    armed: opts.armed ?? false,
    smart: opts.smart ?? true,
    preview: null,
    onadd: opts.onadd ?? (() => {}),
    onselect: opts.onselect ?? (() => {}),
    onpreview: () => {},
    onhovermark: () => {},
  });
  await expect.element(page.getByRole("textbox")).toBeInTheDocument();
  return doc;
}

/** wait until the text layer has been stretched+measured (the span's transparent
    text occupies exactly its PDF box width) — drag tests need this for stable
    caret→offset mapping */
async function settled(span: HTMLElement): Promise<void> {
  const tn = span.firstChild as Text;
  const target = parseFloat(span.style.width);
  const r = document.createRange();
  await expect
    .poll(() => {
      r.selectNodeContents(tn);
      return Math.abs(r.getBoundingClientRect().width - target);
    })
    .toBeLessThan(1);
}

describe("PdfView", () => {
  it("renders pages, a text layer and mark rectangles", async () => {
    await mount([mk("e1", 0, 19, "1.1")]);
    expect(document.querySelectorAll(".pdfspan").length).toBeGreaterThan(0);
    await expect.poll(() => document.querySelectorAll(".pdfmark").length).toBeGreaterThan(0);
    await expect.poll(() => document.querySelectorAll(".pdfchip").length).toBeGreaterThan(0);
  });

  it("anchors the label chip row at its mark rectangle, not at the page corner", async () => {
    await mount([mk("e1", 0, 19, "1.1")]);
    await expect
      .poll(() => {
        const chip = document.querySelector(".pdfchip");
        const mark = document.querySelector(".pdfmark");
        if (!chip || !mark) return false;
        const c = chip.getBoundingClientRect();
        const m = mark.getBoundingClientRect();
        // chip row sits just above the mark's top edge, left-aligned with it
        return Math.abs(c.left - m.left) < 4 && Math.abs(c.bottom - m.top) < 4;
      })
      .toBe(true);
  });

  it("codes word-level coverage inside a line", async () => {
    // e1 covers the whole line, e2 only "coding" (offsets 6..12) → the line is
    // split at the mark boundaries into three rects, none covering the full span
    await mount([mk("e1", 0, 19, "1.1"), mk("e2", 6, 12, "2")]);
    await expect
      .poll(() => {
        const span = document.querySelector('.pdfspan[data-start="0"]');
        if (!span) return false;
        const sw = span.getBoundingClientRect().width;
        const rects = [...document.querySelectorAll(".pdfmark")].map((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width / sw, left: (r.left - span.getBoundingClientRect().left) / sw };
        });
        return rects.length === 3 && rects.every((r) => r.w < 0.9) && rects.some((r) => r.left > 0.2 && r.left < 0.45);
      })
      .toBe(true);
  });

  it("aligns mark rects with the stretched text layer (measured glyph positions)", async () => {
    await mount([mk("e1", 6, 12, "1.1")]); // "coding" inside "Hello coding world."
    const span = document.querySelector('.pdfspan[data-start="0"]') as HTMLElement;
    await settled(span);
    const tn = span.firstChild as Text;
    const r = document.createRange();
    await expect
      .poll(() => {
        const mark = document.querySelector(".pdfmark");
        if (!mark) return false;
        r.setStart(tn, 6);
        r.setEnd(tn, 12);
        const tr = r.getBoundingClientRect();
        const mr = mark.getBoundingClientRect();
        return (
          Math.abs(mr.left - tr.left) < 2 &&
          Math.abs(mr.right - tr.right) < 2 &&
          Math.abs(mr.top - tr.top) < 3 &&
          Math.abs(mr.bottom - tr.bottom) < 3
        );
      })
      .toBe(true);
  });

  it("delegates drag selection to the canonical text (word-snapped, editor parity)", async () => {
    const sels: { from: number; to: number }[] = [];
    const adds: [number, number][] = [];
    await mount([mk("e1", 0, 19, "1.1")], {
      armed: true,
      onselect: (r) => {
        if (r !== null) sels.push(r);
      },
      onadd: (f, t) => adds.push([f, t]),
    });
    const textEl = document.querySelector(".pdftext") as HTMLElement;
    const span = document.querySelector('.pdfspan[data-start="0"]') as HTMLElement;
    await settled(span);
    const sp = span.getBoundingClientRect();
    const w = parseFloat(span.style.width); // stretched text occupies exactly this
    const y = sp.top + sp.height / 2;
    const fire = (type: string, x: number, buttons: number) =>
      textEl.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons, bubbles: true }));
    // drag from inside "Hello" to mid-line: ends snap to whole words
    fire("mousedown", sp.left + 2, 1);
    fire("mousemove", sp.left + w * 0.6, 1);
    fire("mouseup", sp.left + w * 0.6, 0);
    expect(adds).toEqual([[0, 12]]); // "Hello coding" — snapped, not raw pixel offsets
    expect(sels.length).toBeGreaterThan(0);
    expect(sels[sels.length - 1]).toEqual({ from: 0, to: 12 }); // selection persists after coding
  });

  it("non-smart drag selects raw character offsets (plain CodeMirror parity)", async () => {
    const adds: [number, number][] = [];
    await mount([mk("e1", 0, 19, "1.1")], { armed: true, smart: false, onadd: (f, t) => adds.push([f, t]) });
    const textEl = document.querySelector(".pdftext") as HTMLElement;
    const span = document.querySelector('.pdfspan[data-start="0"]') as HTMLElement;
    await settled(span);
    const sp = span.getBoundingClientRect();
    const w = parseFloat(span.style.width);
    const y = sp.top + sp.height / 2;
    const fire = (type: string, x: number, buttons: number) =>
      textEl.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons, bubbles: true }));
    // mid-word start and end: must NOT expand to word boundaries
    fire("mousedown", sp.left + w * 0.25, 1);
    fire("mousemove", sp.left + w * 0.55, 1);
    fire("mouseup", sp.left + w * 0.55, 0);
    expect(adds.length).toBe(1);
    const [from, to] = adds[0];
    // the essential property: NOT expanded to word boundaries (snapWords would
    // give exactly [0, 12] = "Hello coding")
    expect(from).toBeGreaterThanOrEqual(1);
    expect(from).toBeLessThanOrEqual(5);
    expect(to).toBeGreaterThanOrEqual(8);
    expect(to).toBeLessThanOrEqual(11);
  });
});
