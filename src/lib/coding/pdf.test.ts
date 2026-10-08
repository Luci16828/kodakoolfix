import { describe, expect, it } from "vitest";
import { extractPdfDoc, extractPdfText } from "./pdf";
import { buildPdf } from "./pdf-sample";

describe("extractPdfText", () => {
  const pdf = buildPdf(["Hello coding world.", "Zweite Zeile."]);
  it("extracts the text lines of a PDF", async () => {
    const { text, pages } = await extractPdfText(pdf);
    expect(pages).toBe(1);
    expect(text).toContain("Hello coding world.");
    expect(text).toContain("Zweite Zeile.");
  });
  it("is deterministic across calls", async () => {
    const a = await extractPdfText(pdf);
    const b = await extractPdfText(pdf);
    expect(a.text).toBe(b.text);
  });
  it("accepts ArrayBuffer input", async () => {
    const { text } = await extractPdfText(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength));
    expect(text).toContain("Hello coding world.");
  });
  it("maps every span exactly onto the extracted text", async () => {
    const { text, spans } = await extractPdfDoc(pdf);
    expect(spans.length).toBe(2);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("Hello coding world.");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("Zweite Zeile.");
    expect(spans[0].page).toBe(1);
    expect(spans[1].page).toBe(1);
    expect(spans[1].y).toBeLessThan(spans[0].y); // second line sits lower on the page
  });
});
