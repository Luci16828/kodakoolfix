import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadAllViews, PROGRESS_PATH } from '../src/lib/server/coding/store.ts';

const views = loadAllViews();
const summary = {
	sources: views.length,
	verified: views.filter((v) => v.status === 'verified').length,
	failed: views.filter((v) => v.status === 'failed').length,
	uncoded: views.filter((v) => v.status === 'uncoded').length,
	codes: views.reduce((n, v) => n + v.codes, 0)
};

const progress = {
	updated: new Date().toISOString(),
	summary,
	sources: Object.fromEntries(
		views.map((v) => [
			v.source,
			{ status: v.status, codes: v.codes, ...(v.errors.length ? { errors: v.errors } : {}) }
		])
	)
};

mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n');

for (const v of views) {
	if (v.status === 'failed') {
		console.error(`FAIL ${v.source}`);
		for (const e of v.errors) console.error(`  ${e}`);
	}
}

console.log(
	`${summary.verified} verified, ${summary.failed} failed, ${summary.uncoded} uncoded, ${summary.codes} codes total`,
	`— progress written to ${PROGRESS_PATH.slice(process.cwd().length + 1)}`
);

if (summary.failed > 0) process.exitCode = 1;
