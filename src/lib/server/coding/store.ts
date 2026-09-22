import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCodingJson, verifyCoding } from './verify.ts';
import { deviceIndex, instructionsSchema } from '../../coding/instructions.ts';
import type { CodeEntry, CodingFile, SourceStatus, SourceStatusKind } from '../../coding/types.ts';

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

export interface CodeView extends Omit<CodeEntry, 'code'> {
	/** display code: the stored label, or derived from the entry's device UUID via the folder catalog */
	code: string;
}

export interface CodingViewFile {
	source: string;
	codes: CodeView[];
}

export interface SourceView extends SourceStatus {
	coding: CodingViewFile | null;
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

/** Folder's frame-device catalog (coding/<folder>/.INSTRUCTIONS.json), or null when absent/invalid. */
export function loadCatalog(folder: string): Map<string, { code: string; name: string }> | null {
	const file = path.join(CODING_ROOT, folder, '.INSTRUCTIONS.json');
	if (!existsSync(file)) return null;
	try {
		return deviceIndex(instructionsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
	} catch {
		return null;
	}
}

/** Resolve display codes: device UUIDs become "N.M Name" via the catalog; plain labels pass through. */
export function toCodingView(
	coding: CodingFile,
	catalog: Map<string, { code: string; name: string }> | null
): CodingViewFile {
	return {
		source: coding.source,
		codes: coding.codes.map((entry) => {
			const device = entry.device !== undefined ? catalog?.get(entry.device) : undefined;
			return {
				...entry,
				code: device ? `${device.code} ${device.name}` : (entry.code ?? entry.device ?? '(unknown)')
			};
		})
	};
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
		coding: toCodingView(coding, loadCatalog(ref.folder))
	};
}

export function loadAllViews(): SourceView[] {
	return listSources().map(loadView);
}
