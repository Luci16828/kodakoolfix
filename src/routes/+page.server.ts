import { loadAllViews, loadInstructions } from "$lib/server/coding/store";

export function load() {
  const statuses = loadAllViews().map(({ coding, text, ...status }) => status);
  const folders = [...new Set(statuses.map((s) => s.folder))];
  const catalogs = folders.flatMap((folder) => {
    const instructions = loadInstructions(folder);
    return instructions ? [{ folder, instructions }] : [];
  });
  return { statuses, catalogs };
}
