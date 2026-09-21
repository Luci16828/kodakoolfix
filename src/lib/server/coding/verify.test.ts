import { describe, expect, it } from 'vitest';
import { parseCodingJson, verifyCoding, verifyEntry } from '$lib/server/coding/verify';
import { loadAllViews } from '$lib/server/coding/store';
import type { CodeEntry } from '$lib/coding/types';

const LINE = 'Er ging mit dem Hund nach Hause';
const SOURCE = `first line\n${LINE}\nthird line`;

function entry(partial: Partial<CodeEntry>): CodeEntry {
	return {
		code: 'test',
		line: 2,
		range: [0, LINE.length],
		excerpt: LINE,
		...partial
	};
}

describe('verifyEntry', () => {
	it('accepts a verbatim excerpt', () => {
		expect(verifyEntry(SOURCE, entry({}))).toBeNull();
		expect(verifyEntry(SOURCE, entry({ range: [3, 7], excerpt: 'ging' }))).toBeNull();
	});

	it('rejects an excerpt that does not match the range', () => {
		expect(typeof verifyEntry(SOURCE, entry({ excerpt: 'Er ging' }))).toBe('string');
	});

	it('rejects out-of-bounds ranges and lines', () => {
		expect(verifyEntry(SOURCE, entry({ range: [0, LINE.length + 5] }))).toMatch(/invalid/);
		expect(verifyEntry(SOURCE, entry({ line: 99 }))).toMatch(/out of range/);
	});

	it('accepts an excerpt with [...] collapsing the middle', () => {
		expect(verifyEntry(SOURCE, entry({ excerpt: 'Er ging [...] nach Hause' }))).toBeNull();
		expect(verifyEntry(SOURCE, entry({ excerpt: 'Er ging [...] dem [...] Hause' }))).toBeNull();
	});

	it('rejects [...] when segments are not anchored to the range', () => {
		const msg = verifyEntry(
			SOURCE,
			entry({ range: [3, LINE.length], excerpt: 'Er ging [...] Hause' })
		);
		expect(msg).toMatch(/does not appear in order|start exactly|anchored/);
	});

	it('rejects [...] when the last segment ends before the range end', () => {
		expect(verifyEntry(SOURCE, entry({ excerpt: 'Er ging [...] Hund' }))).toMatch(
			/last segment must end exactly at range end/
		);
	});

	it('rejects [...] with nothing actually collapsed', () => {
		expect(
			verifyEntry(
				'Er ging nach Hause',
				entry({ line: 1, range: [0, 18], excerpt: 'Er ging [...] nach Hause' })
			)
		).toMatch(/does not appear in order/);
	});

	it('rejects empty segments around [...]', () => {
		expect(verifyEntry(SOURCE, entry({ excerpt: '[...] Hund nach Hause' }))).toMatch(/\[\.\.\.\]/);
	});
});

describe('verifyCoding', () => {
	it('flags overlapping ranges on the same line', () => {
		const codes = [
			entry({ range: [0, 10], excerpt: LINE.slice(0, 10) }),
			entry({ range: [5, 12], excerpt: LINE.slice(5, 12) })
		];
		const errors = verifyCoding(SOURCE, { source: 'x.txt', codes });
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/overlaps/);
	});
});

describe('parseCodingJson', () => {
	it('round-trips a valid coding file', () => {
		const coding = parseCodingJson(JSON.stringify({ source: 'a.txt', codes: [entry({})] }));
		expect(coding.source).toBe('a.txt');
		expect(coding.codes).toHaveLength(1);
	});

	it('throws on malformed entries', () => {
		expect(() =>
			parseCodingJson(JSON.stringify({ source: 'a.txt', codes: [{ code: '' }] }))
		).toThrow();
	});
});

describe('coding files', () => {
	const views = loadAllViews();

	it('has at least one coded source', () => {
		expect(views.some((v) => v.codes > 0)).toBe(true);
	});

	it('verifies every coding file against its source text', () => {
		const failures = views.flatMap((v) =>
			v.status === 'failed' ? v.errors.map((e) => `${v.source}: ${e}`) : []
		);
		expect(failures).toEqual([]);
	});
});
