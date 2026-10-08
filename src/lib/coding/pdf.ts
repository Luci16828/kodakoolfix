/**
 * PDF → text extraction shared by the client (upload flow + PDF view, via dynamic
 * import so unpdf stays out of the main bundle) and the server verify pipeline.
 * Deterministic: the same PDF bytes always produce the same text AND the same
 * span offsets, so coding offsets and page-rectangle mapping stay stable.
 */

export interface PdfText {
  /** extracted text; one entry per PDF page, pages separated by a blank line */
  text: string;
  pages: number;
}

/** one pdf.js text item mapped onto the extracted text */
export interface PdfSpan {
  /** [start, end) offsets into the extracted text */
  start: number;
  end: number;
  /** 1-based PDF page */
  page: number;
  /** PDF user space, origin bottom-left */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfDoc extends PdfText {
  spans: PdfSpan[];
}

export async function extractPdfDoc(data: Uint8Array | ArrayBuffer): Promise<PdfDoc> {
  const { extractTextItems } = await import("unpdf");
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  // pdf.js transfers (detaches) the buffer it is handed — always give it a private copy
  const bytes = new Uint8Array(src.byteLength);
  bytes.set(src);
  const { totalPages, items } = await extractTextItems(bytes);
  const spans: PdfSpan[] = [];
  let base = 0; // absolute offset of the current page's text in the joined document
  const pages = items.map((pageItems, pageIndex) => {
    let out = "";
    let prev: { x: number; width: number; eol: boolean } | null = null;
    for (const it of pageItems) {
      // pdf.js splits a visual line into items; insert a space where the PDF
      // left a horizontal gap instead of encoding one (gap spaces get no span)
      if (prev !== null && !prev.eol && it.x > prev.x + prev.width + 1 && !out.endsWith(" ") && !it.str.startsWith(" "))
        out += " ";
      const start = base + out.length;
      out += it.str;
      spans.push({
        start,
        end: base + out.length,
        page: pageIndex + 1,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
      });
      if (it.hasEOL) out += "\n";
      prev = { x: it.x, width: it.width, eol: it.hasEOL };
    }
    const pageText = out.replace(/\s+$/, "");
    base += pageText.length + 2; // + the "\n\n" page separator
    return pageText;
  });
  const joined = pages.join("\n\n");
  // global leading trim shifts every span (trailing trim cannot touch span ends)
  const lead = joined.length - joined.trimStart().length;
  if (lead > 0)
    for (const s of spans) {
      s.start = Math.max(0, s.start - lead);
      s.end = Math.max(0, s.end - lead);
    }
  return { text: joined.trim(), pages: totalPages, spans: spans.filter((s) => s.start < s.end) };
}

export async function extractPdfText(data: Uint8Array | ArrayBuffer): Promise<PdfText> {
  const { text, pages } = await extractPdfDoc(data);
  return { text, pages };
}
