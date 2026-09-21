import type { CodeEntry } from './types.ts';

export interface TextToken {
	text: string;
	/** index into the codes array passed to buildTokens, empty for uncoded text */
	codes: number[];
}

/**
 * Split the source text into consecutive tokens, marking which codes cover them.
 * Entries should be validated first (verifyEntry); entries that would exceed the
 * text or overlap an earlier span are skipped.
 */
export function buildTokens(sourceText: string, codes: CodeEntry[]): TextToken[] {
	const lines = sourceText.split('\n');
	const lineStarts: number[] = [];
	let pos = 0;
	for (const line of lines) {
		lineStarts.push(pos);
		pos += line.length + 1;
	}

	const spans = codes
		.map((entry, index) => ({
			start: (lineStarts[entry.line - 1] ?? -1) + entry.range[0],
			end: (lineStarts[entry.line - 1] ?? -1) + entry.range[1],
			index
		}))
		.filter(({ start, end }) => start >= 0 && start < end && end <= sourceText.length)
		.sort((a, b) => a.start - b.start || b.end - a.end);

	const tokens: TextToken[] = [];
	const push = (text: string, code: number[]) => {
		if (text.length > 0) tokens.push({ text, codes: code });
	};
	let cursor = 0;
	for (const span of spans) {
		if (span.start < cursor) continue;
		push(sourceText.slice(cursor, span.start), []);
		push(sourceText.slice(span.start, span.end), [span.index]);
		cursor = span.end;
	}
	push(sourceText.slice(cursor), []);
	return tokens;
}

/** Deterministic hue per code label for highlighting. */
export function codeHue(code: string): number {
	let h = 0;
	for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
	return h;
}
