import { error } from "@sveltejs/kit";
import { listSources, loadSourceText, loadView, toCatalogView } from "$lib/server/coding/store";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  const folder = url.searchParams.get("folder") ?? "test";
  const name = url.searchParams.get("name") ?? "spd 1";
  const ref = listSources().find((s) => s.folder === folder && s.name === name);
  if (!ref) error(404, `unknown source "${folder}/${name}"`);
  const { text, ...view } = loadView(ref);
  return {
    folder: ref.folder,
    name: ref.name,
    source: ref.source,
    text: loadSourceText(ref),
    codes: view.coding?.codes ?? [],
    catalog: toCatalogView(ref.folder, view.coding?.codes ?? []),
  };
};
