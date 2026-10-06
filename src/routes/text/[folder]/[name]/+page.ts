import type { CatalogView } from "$lib/server/coding/store";

export const ssr = false;

export async function load({
  fetch,
  params,
}: {
  fetch: typeof globalThis.fetch;
  params: { folder: string; name: string };
}): Promise<{ folder: string; name: string; catalog: CatalogView[] }> {
  let catalog: CatalogView[] = [];
  try {
    const res = await fetch(`/api/catalog/${encodeURIComponent(params.folder)}`);
    if (res.ok) catalog = await res.json();
  } catch {
    catalog = [];
  }
  return { folder: params.folder, name: params.name, catalog };
}
