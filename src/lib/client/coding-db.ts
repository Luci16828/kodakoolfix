import { entryId } from "$lib/coding/edit";
import type { CodeEntry } from "$lib/coding/types";

export interface CodeDocData extends Record<string, unknown> {
  id: string;
  source: string;
  device?: string;
  code?: string;
  line: number;
  endLine?: number;
  range: [number, number];
  excerpt: string;
  note?: string;
  dirty: boolean;
}

const CODE_SCHEMA = {
  title: "codes",
  description: "one document per coding entry",
  version: 0,
  type: "object",
  primaryKey: "id",
  properties: {
    id: { type: "string", maxLength: 500 },
    source: { type: "string", maxLength: 200 },
    device: { type: "string", maxLength: 100 },
    code: { type: "string", maxLength: 100 },
    line: { type: "number" },
    endLine: { type: "number" },
    range: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    excerpt: { type: "string" },
    note: { type: "string" },
    dirty: { type: "boolean" },
  },
  required: ["id", "source", "line", "range", "excerpt"],
  indexes: ["source"],
} as const;

interface RxDocLike extends CodeDocData {
  patch(patch: Record<string, unknown>): Promise<unknown>;
  toJSON(): CodeDocData;
}

interface CodesCollection {
  find(query: { selector: Record<string, unknown> }): {
    exec(): Promise<RxDocLike[]>;
    $: { subscribe(next: (docs: RxDocLike[]) => void): { unsubscribe(): void } };
  };
  insert(doc: CodeDocData): Promise<unknown>;
  bulkUpsert(docs: CodeDocData[]): Promise<unknown>;
  bulkRemove(docs: RxDocLike[]): Promise<unknown>;
  findOne(id: string): { exec(): Promise<RxDocLike | null> };
}

let codesPromise: Promise<CodesCollection> | null = null;

export function getCodes(): Promise<CodesCollection> {
  codesPromise ??= (async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const db = await createRxDatabase({ name: "luci-coding", storage: getRxStorageDexie() });
    await db.addCollections({ codes: { schema: structuredClone(CODE_SCHEMA) } });
    return db.collections["codes"] as unknown as CodesCollection;
  })();
  return codesPromise;
}

function toDoc(source: string, entry: CodeEntry, dirty: boolean): CodeDocData {
  const base: CodeDocData = {
    id: entryId(source, entry),
    source,
    line: entry.line,
    range: entry.range,
    excerpt: entry.excerpt,
    dirty,
  };
  if (entry.device !== undefined) base.device = entry.device;
  if (entry.code !== undefined) base.code = entry.code;
  if (entry.endLine !== undefined) base.endLine = entry.endLine;
  if (entry.note !== undefined) base.note = entry.note;
  return base;
}

function toEntry(doc: RxDocLike): CodeEntry {
  const entry: CodeEntry = { line: doc.line, range: doc.range, excerpt: doc.excerpt };
  if (doc.device !== undefined) entry.device = doc.device;
  if (doc.code !== undefined) entry.code = doc.code;
  if (doc.endLine !== undefined) entry.endLine = doc.endLine;
  if (doc.note !== undefined) entry.note = doc.note;
  return entry;
}

/** Server-wins import: replace non-dirty docs for this source, keep local pending edits. */
export async function importSource(source: string, entries: CodeEntry[]): Promise<void> {
  const coll = await getCodes();
  const existing = await coll.find({ selector: { source } }).exec();
  const stale = existing.filter((d) => d.dirty !== true);
  if (stale.length > 0) await coll.bulkRemove(stale);
  await coll.bulkUpsert(entries.map((e) => toDoc(source, e, false)));
}

export function watchSource(source: string, next: (entries: CodeEntry[], dirtyCount: number) => void): () => void {
  const sub = { unsub: null as null | { unsubscribe(): void }, disposed: false };
  void getCodes().then((coll) => {
    if (sub.disposed) return;
    sub.unsub = coll
      .find({ selector: { source } })
      .$.subscribe((docs) => next(docs.map(toEntry), docs.filter((d) => d.dirty === true).length));
  });
  return () => {
    sub.disposed = true;
    sub.unsub?.unsubscribe();
  };
}

export async function addEntry(source: string, entry: CodeEntry): Promise<void> {
  const coll = await getCodes();
  await coll.bulkUpsert([toDoc(source, entry, true)]);
}

export async function removeLocalEntry(source: string, entry: CodeEntry): Promise<void> {
  const coll = await getCodes();
  const doc = await coll.findOne(entryId(source, entry)).exec();
  if (doc) await doc.patch({ dirty: true, _deleted: true });
}

/** Push the full entry set for a source to the server; on success clears the dirty flags. */
export async function pushSource(
  ref: { folder: string; name: string; source: string },
  entries: CodeEntry[],
): Promise<string[]> {
  const coll = await getCodes();
  const res = await fetch(`/api/coding/${encodeURIComponent(ref.folder)}/${encodeURIComponent(ref.name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: ref.source, codes: entries }),
  });
  const data = (await res.json().catch(() => undefined)) as { ok?: boolean; errors?: string[] } | undefined;
  if (!res.ok || data?.ok !== true) {
    return data?.errors?.length ? data.errors : [`save failed (HTTP ${res.status})`];
  }
  const dirty = await coll.find({ selector: { source: ref.source, dirty: true } }).exec();
  for (const doc of dirty) await doc.patch({ dirty: false });
  return [];
}

export async function dirtyCount(source: string): Promise<number> {
  const coll = await getCodes();
  return (await coll.find({ selector: { source, dirty: true } }).exec()).length;
}
