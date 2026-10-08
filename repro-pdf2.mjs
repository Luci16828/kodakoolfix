// real-PDF verification: upload a Stellungnahme PDF and check the four phase-2 fixes
// (chip anchoring, multiply blend, word-level rects, hard-break smart select) + the
// text ⇄ document toggle against a real 5-page document.
// run: direnv exec . node --experimental-strip-types ./repro-pdf2.mjs  (dev server on :5173)
import { firefox } from "playwright";
import { readFileSync } from "node:fs";

const PDF = "/home/theaninova/Projects/1. Sampling/Stellungnahmen/20-13-77aa.pdf";
const bytes = readFileSync(PDF);

const browser = await firefox.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page
  .getByRole("button", { name: /new document in test/ })
  .first()
  .click();
await page.waitForURL("**/text/test/**");
await page.waitForTimeout(1000);

await page
  .locator('input[type="file"]')
  .first()
  .setInputFiles({ name: "77aa.pdf", mimeType: "application/pdf", buffer: bytes });
await page.waitForTimeout(2500);
await page.getByRole("link", { name: "77aa" }).click();
await page.waitForSelector(".pdfpage canvas", { timeout: 20000 });
await page.waitForTimeout(1500);

const dump = () =>
  page.evaluate(() => {
    const pageEl = document.querySelector(".pdfpage");
    const pr = pageEl.getBoundingClientRect();
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left - pr.left),
        top: Math.round(pr.bottom - r.bottom),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const mark = document.querySelector(".pdfmark");
    const chip = document.querySelector(".pdfchip");
    return {
      page: { w: Math.round(pr.width), h: Math.round(pr.height) },
      spans: [...document.querySelectorAll(".pdfspan")]
        .slice(0, 20)
        .map((el) => ({ s: el.dataset.start, t: (el.textContent ?? "").slice(0, 26), ...rel(el) })),
      marks: [...document.querySelectorAll(".pdfmark")].map((el) => rel(el)),
      chips: [...document.querySelectorAll(".pdfchip")].map((el) => ({ label: el.textContent, ...rel(el) })),
      blend: mark ? getComputedStyle(mark).mixBlendMode : null,
      chipAligned:
        mark && chip
          ? Math.abs(chip.getBoundingClientRect().left - mark.getBoundingClientRect().left) < 4 &&
            Math.abs(chip.getBoundingClientRect().bottom - mark.getBoundingClientRect().bottom) < 4
          : null,
    };
  });

const hypeRow = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".treeitem, [role='treeitem']")]
      .map((e) => e.textContent)
      .find((t) => t?.includes("Hype")),
  );

console.log("BEFORE:", JSON.stringify(await dump(), null, 1));

// 1) smart click at the center of a mid-page span (data-start=262: "zu dem Gesetzentwurf …")
//    hard breaks: the entry must cover only this line, not a multi-line blob
await page.getByRole("treeitem", { name: /Hype/ }).click();
const span = page.locator('.pdfspan[data-start="262"]').first();
const spanBox = await span.boundingBox();
await span.click();
await page.waitForTimeout(1400);
const after1 = await dump();
console.log("AFTER span-center click:", JSON.stringify(after1, null, 1));
console.log("Hype row after click1:", JSON.stringify(await hypeRow()));
const clickedSpan = after1.spans.find((s) => s.s === "262");
console.log(
  "FIX3 hard-break (all marks on the clicked line only):",
  clickedSpan !== undefined &&
    after1.marks.length > 0 &&
    after1.marks.every((m) => Math.abs(m.top - clickedSpan.top) < 20 && m.h < 40),
);
console.log("FIX1 multiply blend:", after1.blend);
console.log("FIX4 chip anchored at mark:", after1.chipAligned);

// 2) click on the canvas away from any span (left margin, mid-page) — must NOT code anything
const box = await page.locator(".pdfpage").first().boundingBox();
await page.mouse.click(box.x + 30, box.y + box.height * 0.5);
await page.waitForTimeout(900);
console.log("Hype row after off-span click:", JSON.stringify(await hypeRow()));

// 3) delegated selection: smart off, drag across a few words inside the same line
//    (native selection is off — the drag maps to canonical offsets + snapWords)
await page.locator(".smart input").first().uncheck();
const y = spanBox.y + spanBox.height / 2;
await page.mouse.move(spanBox.x + spanBox.width * 0.25, y);
await page.mouse.down();
await page.mouse.move(spanBox.x + spanBox.width * 0.6, y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1400);
const after2 = await dump();
console.log("AFTER word drag:", JSON.stringify(after2, null, 1));
await page.screenshot({ path: "/tmp/opencode/pdfview-selection.png" });
console.log("Hype row after word drag:", JSON.stringify(await hypeRow()));
console.log(
  "native selection suppressed + selection as coverage marks:",
  JSON.stringify(
    await page.evaluate(() => ({
      nativeRanges: window.getSelection()?.rangeCount ?? -1,
      collapsed: window.getSelection()?.isCollapsed ?? null,
      nativeText: (window.getSelection()?.toString() ?? "").slice(0, 40),
      markRects: document.querySelectorAll(".pdfmark").length,
    })),
  ),
);
const spanW = spanBox.width;
console.log(
  "FIX2 word-level rect:",
  after2.marks.some((m) => m.w < spanW * 0.6 && m.left >= 0),
);

// 4) text ⇄ document toggle
await page.getByRole("radio", { name: "text" }).click();
await page.waitForSelector(".cm-content", { timeout: 8000 });
const inText = await page.evaluate(() => ({
  cm: document.querySelector(".cm-content") !== null,
  pdf: document.querySelector(".pdfpage") !== null,
  underlines: document.querySelectorAll(".cm-underline").length,
}));
console.log("TOGGLE text surface:", JSON.stringify(inText));
await page.screenshot({ path: "/tmp/opencode/pdfview-real-text.png" });
await page.getByRole("radio", { name: "pages" }).click();
await page.waitForSelector(".pdfpage canvas", { timeout: 20000 });
await page.waitForTimeout(2000);
const back = await dump();
console.log("TOGGLE back to pages:", JSON.stringify({ marks: back.marks.length, chips: back.chips.length }));

await page.screenshot({ path: "/tmp/opencode/pdfview-real.png" });
await browser.close();
