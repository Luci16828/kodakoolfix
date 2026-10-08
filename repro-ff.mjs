import { firefox } from "playwright";

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

const L1 =
  "> „Besonders problematisch ist die voraussetzungslose Änderung von Geschlecht und Namen bei Kindern und Jugendlichen.";
const L2 = "Wenn sich das Kind, der Jugendliche später mit seinem biologischen Geschlecht ausgesöhnt hätte?“";
await page.locator(".cm-content").click();
await page.keyboard.type(L1);
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.keyboard.type(L2);
await page.waitForTimeout(600);

const lines = await page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent));
console.log("doc lines:", JSON.stringify(lines));

await page.getByRole("treeitem", { name: /Hype/ }).click();
const l1 = await page.locator(".cm-line").first().boundingBox();
await page.mouse.click(l1.x + 30, l1.y + l1.height / 2);
await page.waitForTimeout(700);
const l2 = await page.locator(".cm-line").last().boundingBox();
await page.mouse.click(l2.x + 30, l2.y + l2.height / 2);
await page.waitForTimeout(700);
await page.keyboard.press("Escape");

const coded = await page.evaluate(() =>
  [...document.querySelectorAll(".cm-underline")].map((el) => (el.textContent ?? "").trim()),
);
console.log("coded spans:", JSON.stringify(coded, null, 1));
await browser.close();
