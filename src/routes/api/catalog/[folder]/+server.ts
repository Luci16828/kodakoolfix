import { json } from "@sveltejs/kit";
import { toCatalogView } from "$lib/server/coding/store";

export function GET({ params }: { params: { folder: string } }) {
  return json(toCatalogView(params.folder, []));
}
