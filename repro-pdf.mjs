// live phase-2 PDF repro: upload a PDF on the coding page, verify the rendered
// canvas + text layer, then arm a device and smart-click a sentence.
// run: direnv exec . node --experimental-strip-types ./repro-pdf.mjs  (dev server on :5173)
import { firefox } from "playwright";
import { buildPdf } from "./src/lib/coding/pdf-sample.ts";

const bytes = buildPdf(["Hello coding world.", "Zweite Zeile."]);

const browser = await firefox.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page
  .getByRole("button", { name: /new document in test/ })
  .first()
  .click();
await page.waitForURL("**/text/test/**");
await page.waitForTimeout(1200);

// upload the PDF through the dropzone's hidden file input (first file input on the page)
await page
  .locator('input[type="file"]')
  .first()
  .setInputFiles({ name: "repro.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
await page.waitForTimeout(1500);

await page.getByRole("link", { name: "repro" }).click();
await page.waitForSelector(".pdfpage canvas", { timeout: 15000 });
await page.waitForTimeout(800);

const spans = await page.evaluate(() => [...document.querySelectorAll(".pdfspan")].map((s) => s.textContent));
console.log("pdf spans:", JSON.stringify(spans));
const canvas = await page.evaluate(() => {
  const c = document.querySelector(".pdfpage canvas");
  if (!c) return "no canvas";
  const d = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return `canvas ${c.width}x${c.height} center pixel rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
});
console.log("canvas:", canvas);

// arm a catalog device and smart-click the first sentence
await page.getByRole("treeitem", { name: /Hype/ }).click();
await page.locator(".pdfspan").first().click();
await page.waitForTimeout(1400);
const marks = await page.evaluate(() => document.querySelectorAll(".pdfmark").length);
const chips = await page.evaluate(() => [...document.querySelectorAll(".pdfchip")].map((c) => c.textContent));
console.log("marks:", marks, "chips:", JSON.stringify(chips));

await page.screenshot({ path: "/tmp/opencode/pdfview-ff.png" });
await browser.close();
