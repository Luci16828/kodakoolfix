import { error } from '@sveltejs/kit';
import { listSources, loadView, toCatalogView } from '$lib/server/coding/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const ref = listSources().find((s) => s.folder === params.folder && s.name === params.name);
	if (!ref) error(404, `unknown source "${params.folder}/${params.name}"`);
	const { text, ...view } = loadView(ref);
	return {
		...view,
		text,
		codes: view.coding?.codes ?? [],
		catalog: toCatalogView(ref.folder, view.coding?.codes ?? [])
	};
};
