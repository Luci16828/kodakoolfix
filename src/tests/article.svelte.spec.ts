import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ColorProvider from "./ColorProvider.svelte";
import ArticlePage from "../routes/text/[folder]/[name]/+page.svelte";
import { getArticle, readCodes } from "$lib/client/coding-db";
import type { CodeEntry } from "$lib/coding/types";
import { DEVICE_COMMENT, DEVICE_QUOTE, resetArticles, seedArticle, testCatalog } from "./fixtures";

const FOLDER = "test";
const NAME = "spd 1";
const TEXT = "Ein Zitat im Text.";

/** entry for the word `Zitat` (offsets 4..9 of the single-line body) */
const quoteEntry: CodeEntry = { device: DEVICE_QUOTE, line: 1, range: [4, 9], excerpt: "Zitat" };

function renderArticle(name = NAME, catalog = testCatalog()) {
  return render(ArticlePage, { data: { folder: FOLDER, name, catalog } }, { wrapper: ColorProvider });
}

/** waits until the local article has been handed to CodeMirror */
async function ready(): Promise<void> {
  await expect.element(page.getByRole("textbox")).toBeInTheDocument();
}

const editor = () => page.getByRole("textbox");
const marks = () => document.querySelectorAll(".cm-underline").length;
const chips = () => [...document.querySelectorAll(".cm-tag")].map((el) => el.textContent ?? "");

/** editor body without the floating code-label widgets */
function editorText(): string {
  const clone = (document.querySelector(".cm-content") as HTMLElement).cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-tagline").forEach((el) => el.remove());
  return (clone.textContent ?? "").trim();
}

/** count shown on the catalog row of `name` (own entries + children) */
function treeCount(name: string): string | null {
  const row = [...document.querySelectorAll(".tnode")].find((r) => r.textContent?.includes(name));
  return row?.querySelector(".tcount")?.textContent ?? null;
}

beforeEach(async () => {
  await resetArticles();
});

describe("article coding page", () => {
  it("reports an article that is not in local storage", async () => {
    renderArticle("missing");

    await expect.element(page.getByText("This article does not exist in local storage.")).toBeInTheDocument();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders the body with a mark and a label chip for each code", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await expect.element(editor()).toHaveTextContent("Zitat");
    expect(editorText()).toBe(TEXT);
    await expect.poll(marks).toBe(1);
    await expect.poll(chips).toEqual(["Z"]);

    const mark = document.querySelector(".cm-underline") as HTMLElement;
    expect(mark.getAttribute("title")).toBe("1.1");
    expect(mark.textContent).toBe("Zitat");
  });

  it("counts the entries per frame device in the catalog sidebar", async () => {
    await seedArticle({
      project: FOLDER,
      name: NAME,
      text: TEXT,
      entries: [quoteEntry, { device: DEVICE_COMMENT, line: 1, range: [13, 17], excerpt: "Text" }],
    });

    renderArticle();
    await ready();

    await expect.poll(() => treeCount("Zitat")).toBe("1");
    await expect.poll(() => treeCount("Kommentar")).toBe("1");
    await expect.poll(() => treeCount("Rahmen")).toBe("1");
  });

  it("arms a frame device on click and disarms it with Escape", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await page.getByRole("treeitem", { name: "Zitat" }).click();
    await expect.element(page.getByText("armed").first()).toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll(".ctag").length).toBe(1);

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("armed").first()).not.toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll(".ctag").length).toBe(0);
  });

  it("codes the released selection with the armed device", async () => {
    const id = await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await page.getByRole("treeitem", { name: "Kommentar" }).click();
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");
    document.querySelector(".cm-content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await expect.poll(() => treeCount("Kommentar")).toBe("1");
    await expect.poll(chips).toEqual(expect.arrayContaining(["Z", "K"]));

    await expect.poll(async () => (await readCodes(id)).length).toBe(2);
    const codes = await readCodes(id);
    expect(codes.find((c) => c.device === DEVICE_COMMENT)?.excerpt).toBeTruthy();
  });

  it("toggles smart select on the editor", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    const smart = page.getByRole("checkbox", { name: /smart select/ });
    await expect.element(smart).not.toBeChecked();
    await smart.click();

    await expect.element(smart).toBeChecked();
    await expect.poll(() => document.querySelector(".editor")?.classList.contains("smart")).toBe(true);
  });

  it("re-tints the markers through the shared color store", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    const { wrapper } = renderArticle();
    await ready();

    await page.getByRole("slider").first().element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(wrapper.prefs.chromaAdj).toBe(1);
    await expect.element(page.getByRole("button", { name: "reset" })).toBeInTheDocument();
  });

  it("saves an edited body into the local article", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("{End}!");

    await expect.element(page.getByRole("button", { name: "save" })).toBeInTheDocument();
    await expect.poll(editorText).toMatch(/Text\.!$/);
    await expect.poll(async () => (await getArticle(FOLDER, NAME))?.text).toMatch(/Text\.!$/);
  });

  it("snapshots the current state as a new version", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await expect.element(page.getByRole("button", { name: "version (0)" })).toBeInTheDocument();
    await page.getByRole("button", { name: "version (0)" }).click();

    await expect.element(page.getByRole("button", { name: "version (1)" })).toBeInTheDocument();
    await expect.element(page.getByText("version saved")).toBeInTheDocument();
    await expect.poll(async () => (await getArticle(FOLDER, NAME))?.versions.length).toBe(1);
  });
});
