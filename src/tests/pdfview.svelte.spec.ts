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
    on: "#000000",
    onD: "#ffffff",
  };
}

async function mount(marks: ReturnType<typeof mk>[]) {
  const bytes = buildPdf(["Hello coding world.", "Zweite Zeile."]);
  const doc = await extractPdfDoc(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  render(PdfView, {
    data: btoa(bin),
    text: doc.text,
    marks,
    armed: false,
    smart: true,
    preview: null,
    onadd: () => {},
    onselect: () => {},
    onpreview: () => {},
    onhovermark: () => {},
  });
  await expect.element(page.getByRole("textbox")).toBeInTheDocument();
  return doc;
}

describe("PdfView", () => {
  it("renders pages, a text layer and mark rectangles", async () => {
    await mount([mk("e1", 0, 19, "1.1")]);
    expect(document.querySelectorAll(".pdfspan").length).toBeGreaterThan(0);
    await expect.poll(() => document.querySelectorAll(".pdfmark").length).toBeGreaterThan(0);
    await expect.poll(() => document.querySelectorAll(".pdfchip").length).toBeGreaterThan(0);
  });

  it("anchors the label chip at its mark rectangle, not at the page corner", async () => {
    await mount([mk("e1", 0, 19, "1.1")]);
    await expect
      .poll(() => {
        const chip = document.querySelector(".pdfchip");
        const mark = document.querySelector(".pdfmark");
        if (!chip || !mark) return false;
        const c = chip.getBoundingClientRect();
        const m = mark.getBoundingClientRect();
        return Math.abs(c.left - m.left) < 4 && Math.abs(c.bottom - m.bottom) < 4;
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
});
