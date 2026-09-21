import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCodingJson, verifyCoding } from './verify.ts';
import type { CodingFile, SourceStatus, SourceStatusKind } from '../../coding/types.ts';

export const ROOT = process.cwd();
export const SOURCES_ROOT = path.join(ROOT, 'coding_source');
export const CODING_ROOT = path.join(ROOT, 'coding');
export const PROGRESS_PATH = path.join(CODING_ROOT, 'progress.json');

export interface SourceRef {
	folder: string;
	/** base name without extension, e.g. "spd 1" */
	name: string;
	/** path relative to coding_source/, e.g. "test/spd 1.txt" */
	source: string;
}

export interface SourceView extends SourceStatus {
	coding: CodingFile | null;
	text: string;
}

export function listSources(): SourceRef[] {
	if (!existsSync(SOURCES_ROOT)) return [];
	const refs: SourceRef[] = [];
	for (const folder of readdirSync(SOURCES_ROOT, { withFileTypes: true })) {
		if (!folder.isDirectory()) continue;
		for (const file of readdirSync(path.join(SOURCES_ROOT, folder.name))) {
			if (!file.endsWith('.txt')) continue;
			const name = file.slice(0, -4);
			refs.push({ folder: folder.name, name, source: `${folder.name}/${file}` });
		}
	}
	refs.sort(
		(a, b) =>
			a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true })
	);
	return refs;
}

export function loadSourceText(ref: SourceRef): string {
	return readFileSync(path.join(SOURCES_ROOT, ref.source), 'utf8');
}

/** Folder's .INSTRUCTIONS.md contents, or null when absent/empty. */
export function readInstructions(folder: string): string | null {
	const file = path.join(SOURCES_ROOT, folder, '.INSTRUCTIONS.md');
	if (!existsSync(file)) return null;
	const text = readFileSync(file, 'utf8').trim();
	return text === '' ? null : text;
}

export function loadView(ref: SourceRef): SourceView {
	const text = loadSourceText(ref);
	const base: SourceView = {
		...ref,
		status: 'uncoded' as SourceStatusKind,
		codes: 0,
		errors: [],
		coding: null,
		text
	};
	const file = path.join(CODING_ROOT, ref.folder, `${ref.name}.json`);
	if (!existsSync(file)) return base;
	let coding: CodingFile;
	try {
		coding = parseCodingJson(readFileSync(file, 'utf8'));
	} catch (e) {
		return { ...base, status: 'failed', errors: [e instanceof Error ? e.message : String(e)] };
	}
	const errors = (
		coding.source === ref.source
			? []
			: [`"source" is "${coding.source}" but expected "${ref.source}"`]
	).concat(verifyCoding(text, coding).map((e) => `entry #${e.index + 1}: ${e.message}`));
	return {
		...base,
		status: errors.length ? 'failed' : 'verified',
		codes: coding.codes.length,
		errors,
		coding
	};
}

export function loadAllViews(): SourceView[] {
	return listSources().map(loadView);
}
