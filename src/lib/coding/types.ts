export const ELLIPSIS = '[...]';

export interface CodeEntry {
	/** code label assigned to the passage */
	code: string;
	/** 1-based line number in the source text */
	line: number;
	/** 1-based line the span ends on; defaults to `line` (entry may cross line breaks) */
	endLine?: number;
	/** character range [start, end): start offsets within `line`, end offsets within `endLine` */
	range: [number, number];
	/** verbatim text of the range; collapsed middle parts replaced by "[...]" */
	excerpt: string;
	note?: string;
}

export interface CodingFile {
	/** path of the source text relative to coding_source/, e.g. "test/spd 1.txt" */
	source: string;
	codes: CodeEntry[];
}

export type SourceStatusKind = 'uncoded' | 'verified' | 'failed';

export interface SourceStatus {
	folder: string;
	/** base name without extension, e.g. "spd 1" */
	name: string;
	/** path relative to coding_source/, e.g. "test/spd 1.txt" */
	source: string;
	status: SourceStatusKind;
	codes: number;
	errors: string[];
}
