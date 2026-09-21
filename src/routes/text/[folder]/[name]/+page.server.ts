import { error } from '@sveltejs/kit';
import { listSources, loadView } from '$lib/server/coding/store';
import { buildTokens } from '$lib/coding/tokens';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const ref = listSources().find((s) => s.folder === params.folder && s.name === params.name);
	if (!ref) error(404, `unknown source "${params.folder}/${params.name}"`);
	const { text, ...view } = loadView(ref);
	return {
		...view,
		codes: view.coding?.codes ?? [],
		tokens: buildTokens(text, view.coding?.codes ?? [])
	};
};
