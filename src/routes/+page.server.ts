import { loadAllViews } from '$lib/server/coding/store';

export function load() {
	return {
		statuses: loadAllViews().map(({ coding, text, ...status }) => status)
	};
}
