import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import ColorProvider from "./ColorProvider.svelte";
import ArticlePage from "../routes/text/[folder]/[name]/+page.svelte";
import { getArticle, getLocalCatalog, readCodes } from "$lib/client/coding-db";
import type { CodeEntry } from "$lib/coding/types";
import { DEVICE_COMMENT, DEVICE_QUOTE, resetArticles, seedArticle, testInstructions } from "./fixtures";

const navigated = vi.hoisted(() => [] as string[]);
vi.mock("$app/navigation", () => ({
  goto: (url: string) => {
    navigated.push(url);
    return Promise.resolve();
  },
}));

const FOLDER = "test";
const NAME = "spd 1";
const TEXT = "Ein Zitat im Text.";

/** entry for the word `Zitat` (offsets 4..9 of the single-line body) */
const quoteEntry: CodeEntry = { device: DEVICE_QUOTE, line: 1, range: [4, 9], excerpt: "Zitat" };

function renderArticle(name = NAME, instructions = testInstructions) {
  return render(ArticlePage, { data: { folder: FOLDER, name, instructions } }, { wrapper: ColorProvider });
}

/** waits until the local article has been handed to CodeMirror */
async function ready(): Promise<void> {
  await expect.element(page.getByRole("textbox")).toBeInTheDocument();
}

const editor = () => page.getByRole("textbox").first();
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

/** edit-mode row addressed by the value of one of its inputs */
function editRow(value: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".tnode")].find((r) =>
    [...r.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value === value),
  );
}

beforeEach(async () => {
  navigated.length = 0;
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

  it("keeps the body read-only until edit mode, and arming returns to coding", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    // coding mode (default for a non-empty body): typing does not change the doc
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("X");
    await expect.poll(editorText).toBe(TEXT);

    await page.getByRole("button", { name: "edit text" }).click();
    await expect.element(page.getByText("editing — arming a frame device returns to coding")).toBeInTheDocument();
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("X");
    await expect.poll(editorText).toMatch(/X/);

    // arming a device auto-exits edit mode
    await page.getByRole("treeitem", { name: "Zitat" }).click();
    await expect.element(page.getByText("armed").first()).toBeInTheDocument();
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("Y");
    await expect.poll(editorText).not.toMatch(/Y/);
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

  it("links to the colors screen instead of carrying sliders", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT });

    renderArticle();
    await ready();

    await expect.element(page.getByRole("link", { name: "colors" })).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it("saves an edited body into the local article", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await page.getByRole("button", { name: "edit text" }).click();
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("{End}!");

    await expect.element(page.getByRole("button", { name: "save" })).toBeInTheDocument();
    await expect.poll(editorText).toMatch(/Text\.!$/);
    await expect.poll(async () => (await getArticle(FOLDER, NAME))?.text).toMatch(/Text\.!$/);
  });

  it("snapshots versions and reverts to one", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await expect.element(page.getByRole("button", { name: "versions (0)" })).toBeInTheDocument();
    await page.getByRole("button", { name: "versions (0)" }).click();
    await expect.element(page.getByText("No versions yet")).toBeInTheDocument();
    await page.getByRole("button", { name: "snapshot now" }).click();
    await expect.element(page.getByRole("button", { name: "versions (1)" })).toBeInTheDocument();
    await expect.element(page.getByText("version saved")).toBeInTheDocument();

    // change the body, then revert to the snapshot
    await page.getByRole("button", { name: "edit text" }).click();
    await editor().click({ position: { x: 5, y: 30 } });
    await userEvent.keyboard("{End} CHANGED");
    await expect.poll(editorText).toMatch(/CHANGED$/);

    await page.getByRole("button", { name: "versions (1)" }).click();
    await page.getByRole("button", { name: "revert" }).click();

    await expect.poll(editorText).toBe(TEXT);
    // the pre-revert state was kept as a new version
    await expect.element(page.getByRole("button", { name: "versions (2)" })).toBeInTheDocument();
    await expect.poll(async () => (await getArticle(FOLDER, NAME))?.text).toBe(TEXT);
  });

  it("renames the document and follows to the new url", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT });

    renderArticle();
    await ready();

    await page.getByRole("button", { name: NAME }).click();
    const input = page.getByRole("textbox", { name: "document name" });
    await input.fill("spd 2");
    await userEvent.keyboard("{Enter}");

    await expect.poll(async () => (await getArticle(FOLDER, "spd 2"))?.name).toBe("spd 2");
    expect(navigated).toEqual(["/text/test/spd 2"]);
  });

  it("edits the frame-device catalog locally: rename, tag override, drag reorder", async () => {
    await seedArticle({ project: FOLDER, name: NAME, text: TEXT, entries: [quoteEntry] });

    renderArticle();
    await ready();

    await page.getByRole("button", { name: "edit devices" }).click();
    await page.getByRole("textbox", { name: "name Zitat" }).fill("Markierung");
    await page.getByRole("textbox", { name: "tag Kommentar" }).fill("KOM");

    // drag Kommentar onto Rahmen (top-level reorder)
    editRow("Kommentar")?.querySelector(".grip")?.dispatchEvent(new Event("dragstart"));
    editRow("Rahmen")?.dispatchEvent(new Event("dragover", { cancelable: true }));
    editRow("Rahmen")?.dispatchEvent(new Event("drop", { cancelable: true }));

    await page.getByRole("button", { name: "save catalog" }).click();

    await expect
      .poll(async () => (await getLocalCatalog(FOLDER))?.devices.map((d) => d.name))
      .toEqual(["Kommentar", "Rahmen"]);
    const local = await getLocalCatalog(FOLDER);
    expect(local?.devices[0].tag).toBe("KOM");
    expect(local?.devices[1].children[0]?.name).toBe("Markierung");
    // the override shows as the row tag after the tree reloads
    await expect.element(page.getByText("KOM").first()).toBeInTheDocument();
  });
});
