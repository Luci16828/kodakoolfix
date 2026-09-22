import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format } from 'prettier';
import { tool } from '@opencode-ai/plugin';
import type { CodeEntry } from '../../src/lib/coding/types.ts';
import { verifyCoding, verifyEntry } from '../../src/lib/server/coding/verify.ts';

/**
 * Index of source files, keyed by absolute path, invalidated on mtime change.
 * Lines are 1-based; columns are character offsets within the line.
 */
const index = new Map<string, { mtimeMs: number; lines: string[] }>();

function sourceLines(abs: string): string[] {
	const mtimeMs = statSync(abs).mtimeMs;
	const cached = index.get(abs);
	if (cached && cached.mtimeMs === mtimeMs) return cached.lines;
	const lines = readFileSync(abs, 'utf8').split('\n');
	index.set(abs, { mtimeMs, lines });
	return lines;
}

function resolveSource(worktree: string, file: string): string {
	if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
		throw new Error('file must be a relative path inside coding_source/, e.g. "test/spd 1"');
	}
	const rel = file.endsWith('.txt') ? file.slice(0, -4) : file;
	const abs = path.resolve(worktree, 'coding_source', `${rel}.txt`);
	if (!abs.startsWith(path.resolve(worktree, 'coding_source') + path.sep)) {
		throw new Error('file must stay inside coding_source/');
	}
	if (!existsSync(abs)) throw new Error(`no such source: coding_source/${rel}.txt`);
	return abs;
}

function codingPathFor(worktree: string, sourceAbs: string): string {
	const rel = path.relative(path.resolve(worktree, 'coding_source'), sourceAbs).slice(0, -4);
	return path.resolve(worktree, 'coding', `${rel}.json`);
}

function spanText(lines: string[], entry: CodeEntry): string | null {
	const endLine = entry.endLine ?? entry.line;
	if (
		entry.line < 1 ||
		entry.line > lines.length ||
		endLine < entry.line ||
		endLine > lines.length
	) {
		return null;
	}
	const [start, end] = entry.range;
	const first = lines[entry.line - 1];
	const last = lines[endLine - 1];
	if (start < 0 || start >= first.length || end < 0 || end > last.length) return null;
	if (endLine === entry.line && end <= start) return null;
	return endLine === entry.line
		? first.slice(start, end)
		: [first.slice(start), ...lines.slice(entry.line, endLine - 1), last.slice(0, end)].join('\n');
}

function describeEntry(lines: string[], entry: CodeEntry): string {
	const head = `line ${entry.line}, range [${entry.range[0]}, ${entry.range[1]})${
		entry.endLine && entry.endLine !== entry.line ? `, endLine ${entry.endLine}` : ''
	}`;
	const span = spanText(lines, entry);
	const endLine = entry.endLine ?? entry.line;
	return [
		`${head} -> ${JSON.stringify(entry.code)}`,
		`line ${entry.line}: ${lines[entry.line - 1]}`,
		...(entry.endLine && entry.endLine !== entry.line
			? [`line ${endLine}: ${lines[endLine - 1]}`]
			: []),
		`span: ${JSON.stringify(span ?? '(invalid range)')}`
	].join('\n');
}

function collapse(span: string): string {
	if (span.length <= 120) return span;
	return `${span.slice(0, 60)}[...]${span.slice(span.length - 60)}`;
}

function readCodingOrInit(file: string, sourceRel: string): { source: string; codes: CodeEntry[] } {
	if (!existsSync(file)) return { source: sourceRel, codes: [] };
	return JSON.parse(readFileSync(file, 'utf8'));
}

async function writeCoding(
	file: string,
	coding: { source: string; codes: CodeEntry[] }
): Promise<void> {
	mkdirSync(path.dirname(file), { recursive: true });
	const config = (await import('prettier').then((p) => p.resolveConfig(file))) ?? {
		useTabs: true,
		printWidth: 100
	};
	const out = await format(JSON.stringify(coding, null, '\t'), {
		...config,
		parser: 'json'
	});
	writeFileSync(file, out);
}

export const find = tool({
	description:
		'Index and locate exact substrings in a coding_source text file. Returns every occurrence as 1-based line + [start, end) character offsets within the line (plus endLine/end offsets when the query crosses line breaks), the full line text, and a 1-based occurrence number. Use this to obtain exact offsets instead of counting characters yourself.',
	args: {
		file: tool.schema
			.string()
			.describe('source path relative to coding_source/ without extension, e.g. "test/spd 1"'),
		query: tool.schema.string().describe('exact substring to locate (may contain newlines)')
	},
	async execute(args, context) {
		const abs = resolveSource(context.worktree, args.file);
		const lines = sourceLines(abs);
		const text = lines.join('\n');
		if (args.query === '') return 'query must not be empty';
		const hits: string[] = [];
		for (let idx = text.indexOf(args.query); idx !== -1; idx = text.indexOf(args.query, idx + 1)) {
			if (hits.length >= 10) {
				hits.push('... more than 10 occurrences; refine the query');
				break;
			}
			const endIdx = idx + args.query.length - 1;
			let line = 0;
			let lineStart = 0;
			for (let l = 0, off = 0; l < lines.length; l++) {
				if (idx <= off + lines[l].length) {
					line = l + 1;
					lineStart = off;
					break;
				}
				off += lines[l].length + 1;
			}
			let endLine = 0;
			let endLineStart = 0;
			for (let l = 0, off = 0; l < lines.length; l++) {
				if (endIdx <= off + lines[l].length) {
					endLine = l + 1;
					endLineStart = off;
					break;
				}
				off += lines[l].length + 1;
			}
			const startCol = idx - lineStart;
			const endCol = endIdx + 1 - endLineStart;
			hits.push(
				`occurrence ${hits.length + 1}: line ${line} [${startCol}, ${
					endLine === line ? endCol : lines[line - 1].length
				})${endLine !== line ? ` endLine ${endLine} end ${endCol}` : ''} | ${lines[line - 1]}`
			);
		}
		if (hits.length === 0) return `no match for ${JSON.stringify(args.query)} in ${args.file}`;
		return hits.join('\n');
	}
});

export const add = tool({
	description:
		'Append one code entry to coding/<folder>/<name>.json for a coding_source text. Validates line/range (+ optional endLine) against the real source, computes the excerpt itself (verbatim, with "[...]" collapse for long spans), refuses entries that do not verify, and prints back the resulting line(s) and span so you can double-check it is what you intended.',
	args: {
		file: tool.schema
			.string()
			.describe('source path relative to coding_source/ without extension, e.g. "test/spd 1"'),
		code: tool.schema.string().describe('code label for this passage'),
		line: tool.schema.number().int().describe('1-based line of the span start'),
		range: tool.schema
			.tuple([tool.schema.number().int(), tool.schema.number().int()])
			.describe('[start, end): start offset on `line`, end offset on `endLine` (or `line`)'),
		endLine: tool.schema
			.number()
			.int()
			.optional()
			.describe('1-based line the span ends on; only for entries crossing line breaks'),
		note: tool.schema.string().optional().describe('optional note')
	},
	async execute(args, context) {
		const abs = resolveSource(context.worktree, args.file);
		const lines = sourceLines(abs);
		const rel = path.relative(path.resolve(context.worktree, 'coding_source'), abs);
		const entry: CodeEntry = {
			code: args.code,
			line: args.line,
			range: [args.range[0], args.range[1]],
			excerpt: ''
		};
		if (args.endLine !== undefined) entry.endLine = args.endLine;
		if (args.note !== undefined) entry.note = args.note;
		const span = spanText(lines, entry);
		if (span === null) {
			return `REFUSED: invalid line/range for this source.\n${describeEntry(lines, entry)}`;
		}
		const candidate = collapse(span);
		entry.excerpt = candidate;
		if (verifyEntry(lines.join('\n'), entry) !== null) entry.excerpt = span;
		const msg = verifyEntry(lines.join('\n'), entry);
		if (msg !== null) {
			return `REFUSED: ${msg}\n${describeEntry(lines, entry)}`;
		}
		const codingFile = codingPathFor(context.worktree, abs);
		const coding = readCodingOrInit(codingFile, rel);
		coding.codes.push(entry);
		const errors = verifyCoding(lines.join('\n'), coding);
		if (errors.length > 0) {
			coding.codes.pop();
			return `REFUSED: file no longer verifies: ${errors.map((e) => `entry #${e.index + 1}: ${e.message}`).join('; ')}`;
		}
		await writeCoding(codingFile, coding);
		return [
			`ADDED entry #${coding.codes.length} (${coding.codes.length - 1} 0-based) to coding/${path.relative(path.resolve(context.worktree, 'coding'), codingFile)}`,
			describeEntry(lines, entry),
			`excerpt: ${JSON.stringify(entry.excerpt)}`
		].join('\n');
	}
});

export const remove = tool({
	description:
		'Remove one code entry (0-based index into the codes array of coding/<folder>/<name>.json). Prints back the removed entry.',
	args: {
		file: tool.schema
			.string()
			.describe('source path relative to coding_source/ without extension, e.g. "test/spd 1"'),
		index: tool.schema.number().int().describe('0-based index in the codes array')
	},
	async execute(args, context) {
		const abs = resolveSource(context.worktree, args.file);
		const lines = sourceLines(abs);
		const codingFile = codingPathFor(context.worktree, abs);
		const rel = path.relative(path.resolve(context.worktree, 'coding_source'), abs);
		const coding = readCodingOrInit(codingFile, rel);
		if (args.index < 0 || args.index >= coding.codes.length) {
			return `REFUSED: index ${args.index} out of range (file has ${coding.codes.length} codes)`;
		}
		const [removed] = coding.codes.splice(args.index, 1);
		await writeCoding(codingFile, coding);
		return `REMOVED entry #${args.index} (0-based):\n${describeEntry(lines, removed)}`;
	}
});
