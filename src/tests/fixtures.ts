import { addVersion, createArticle, getDb, renameArticle, saveArticle } from "$lib/client/coding-db";
import type { Instructions } from "$lib/coding/instructions";
import type { CodeEntry } from "$lib/coding/types";

/**
 * Shared fixtures for the UI (browser) tests: a small frame-device catalog and
 * helpers to seed/wipe the local-first RxDB article store.
 */

export const DEVICE_FRAME = "11111111-1111-4111-8111-111111111111";
export const DEVICE_QUOTE = "22222222-2222-4222-8222-222222222222";
export const DEVICE_COMMENT = "33333333-3333-4333-8333-333333333333";

/** `1 Rahmen > 1.1 Zitat` and `2 Kommentar` (codes are derived from tree position). */
export const testInstructions: Instructions = {
  version: 1,
  title: "Test catalog",
  devices: [
    {
      id: DEVICE_FRAME,
      name: "Rahmen",
      kind: "element",
      examples: [],
      children: [{ id: DEVICE_QUOTE, name: "Zitat", kind: "device", examples: [], children: [] }],
    },
    { id: DEVICE_COMMENT, name: "Kommentar", kind: "device", examples: [], children: [] },
  ],
};

/** Remove every article + entry + local catalog so a test file never depends on the previous one. */
export async function resetArticles(): Promise<void> {
  const { articles, codes, catalogs } = await getDb();
  await Promise.all((await codes.find().exec()).map((d) => d.remove()));
  await Promise.all((await articles.find().exec()).map((d) => d.remove()));
  await Promise.all((await catalogs.find().exec()).map((d) => d.remove()));
}

export interface SeedArticle {
  project: string;
  name: string;
  text: string;
  entries?: CodeEntry[];
  /** labels of versions to snapshot after seeding */
  versions?: string[];
}

/** Create an article with a fixed name/body/entries; returns its id. */
export async function seedArticle(seed: SeedArticle): Promise<string> {
  const created = await createArticle(seed.project);
  await saveArticle(created.id, seed.text, seed.entries ?? []);
  await renameArticle(created.id, seed.name);
  for (const label of seed.versions ?? []) await addVersion(created.id, label);
  return created.id;
}
