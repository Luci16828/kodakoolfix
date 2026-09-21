import { ELLIPSIS } from '../../coding/types.ts';
import type { CodeEntry, CodingFile } from '../../coding/types.ts';

/** Split an excerpt into its verbatim segments around "[...]". */
export function excerptSegments(excerpt: string): string[] {
	return excerpt.split(ELLIPSIS);
}

export interface EntryError {
	index: number;
	entry: CodeEntry;
	message: string;
}

/**
 * Verify one code entry against the source text.
 * The excerpt must match the source exactly: without "[...]" the excerpt equals
 * the source range verbatim; with "[...]" each segment must appear in order
 * inside the range, anchored to its start and end, with at least one omitted
 * character between consecutive segments. Returns an error message or null.
 */
export function verifyEntry(sourceText: string, entry: CodeEntry): string | null {
	const lines = sourceText.split('\n');
	if (!Number.isInteger(entry.line) || entry.line < 1 || entry.line > lines.length) {
		return `line ${entry.line} is out of range (1-${lines.length})`;
	}
	const line = lines[entry.line - 1];
	const [start, end] = entry.range;
	if (!Number.isInteger(start) || !Number.isInteger(end)) {
		return `range [${start}, ${end}) must be integers`;
	}
	if (start < 0 || end <= start || end > line.length) {
		return `range [${start}, ${end}) is invalid for line ${entry.line} (length ${line.length})`;
	}
	const span = line.slice(start, end);
	const segments = excerptSegments(entry.excerpt);
	if (segments.some((s) => s.length === 0)) {
		return `excerpt must not start or end with ${ELLIPSIS} or contain adjacent ${ELLIPSIS}`;
	}
	if (segments.length === 1) {
		return entry.excerpt === span ? null : 'excerpt does not match the text at this range';
	}
	let pos = 0;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const idx = i === 0 ? (span.startsWith(seg) ? 0 : -1) : span.indexOf(seg, pos + 1);
		if (idx === -1) {
			return `segment ${i + 1} (${JSON.stringify(seg)}) does not appear in order within the range`;
		}
		if (i === segments.length - 1 && idx + seg.length !== span.length) {
			return `last segment must end exactly at range end (found it ending at offset ${idx + seg.length} of ${span.length})`;
		}
		pos = idx + seg.length;
	}
	return null;
}

/** Verify a whole coding file against its source text. */
export function verifyCoding(sourceText: string, coding: CodingFile): EntryError[] {
	const errors: EntryError[] = [];
	const valid: { entry: CodeEntry; index: number }[] = [];
	coding.codes.forEach((entry, index) => {
		const message = verifyEntry(sourceText, entry);
		if (message) {
			errors.push({ index, entry, message });
		} else {
			valid.push({ entry, index });
		}
	});
	const byLine = new Map<number, typeof valid>();
	for (const v of valid) {
		const group = byLine.get(v.entry.line) ?? [];
		group.push(v);
		byLine.set(v.entry.line, group);
	}
	for (const group of byLine.values()) {
		group.sort((a, b) => a.entry.range[0] - b.entry.range[0]);
		for (let i = 1; i < group.length; i++) {
			const prev = group[i - 1].entry;
			const cur = group[i].entry;
			if (cur.range[0] < prev.range[1]) {
				errors.push({
					index: group[i].index,
					entry: cur,
					message: `overlaps entry #${group[i - 1].index + 1} on line ${cur.line}`
				});
			}
		}
	}
	return errors;
}

/** Parse and lightly type-check a coding JSON payload. Throws on shape errors. */
export function parseCodingJson(raw: string): CodingFile {
	const data: unknown = JSON.parse(raw);
	if (typeof data !== 'object' || data === null) throw new Error('coding file must be an object');
	const obj = data as Record<string, unknown>;
	if (typeof obj.source !== 'string') throw new Error('coding file needs a "source" string');
	if (!Array.isArray(obj.codes)) throw new Error('coding file needs a "codes" array');
	const codes: CodeEntry[] = obj.codes.map((c: unknown, i: number) => {
		if (typeof c !== 'object' || c === null) throw new Error(`codes[${i}] must be an object`);
		const e = c as Record<string, unknown>;
		if (typeof e.code !== 'string' || e.code === '')
			throw new Error(`codes[${i}].code must be a non-empty string`);
		if (typeof e.line !== 'number' || !Number.isInteger(e.line)) {
			throw new Error(`codes[${i}].line must be an integer`);
		}
		if (
			!Array.isArray(e.range) ||
			e.range.length !== 2 ||
			!e.range.every((n) => typeof n === 'number' && Number.isInteger(n))
		) {
			throw new Error(`codes[${i}].range must be [start, end] integers`);
		}
		if (typeof e.excerpt !== 'string' || e.excerpt === '') {
			throw new Error(`codes[${i}].excerpt must be a non-empty string`);
		}
		const entry: CodeEntry = {
			code: e.code,
			line: e.line,
			range: e.range as [number, number],
			excerpt: e.excerpt
		};
		if (typeof e.note === 'string') entry.note = e.note;
		return entry;
	});
	return { source: obj.source, codes };
}
