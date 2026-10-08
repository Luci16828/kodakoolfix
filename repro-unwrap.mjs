// A/B probe for JOIN_SOFT_BREAKS: line counts of the real test PDF with the
// flag on vs off. Run: direnv exec . node --experimental-strip-types ./repro-unwrap.mjs
import { readFileSync } from "node:fs";
import { extractPdfDoc } from "./src/lib/coding/pdf.ts";

const bytes = new Uint8Array(readFileSync(`${process.env.HOME}/Projects/1. Sampling/Stellungnahmen/20-13-77aa.pdf`));
const { text, spans } = await extractPdfDoc(bytes);
const lines = text.split("\n");
console.log("chars:", text.length, "spans:", spans.length, "lines:", lines.length);
console.log("blank lines:", lines.filter((l) => !l.trim()).length);
console.log("sample joined region:", JSON.stringify(text.slice(200, 340)));
// spans must still slice exactly onto the text (1:1 swap invariant)
let bad = 0;
for (const s of spans) if (!text.slice(s.start, s.end).trim()) bad++;
console.log("empty span slices:", bad);
