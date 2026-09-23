import type { CodeEntry } from "./types";

/** Cumulative character offsets of each line's first character (line 0 = 0). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 0-based line containing the character position `pos` (must be < text.length). */
export function lineAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Deterministic document id for a coding entry, stable across re-imports. */
export function entryId(source: string, entry: CodeEntry): string {
  const key = entry.device ?? entry.code ?? "";
  const end = entry.endLine !== undefined ? `#${entry.endLine}` : "";
  return `${source}|${entry.line}${end}|${entry.range[0]}-${entry.range[1]}|${key}`;
}

/**
 * Convert exclusive global character offsets [from, to) into a coding entry
 * spanning the source lines between them; `excerpt` is the verbatim span.
 */
export function entryFromOffsets(
  source: string,
  starts: number[],
  text: string,
  from: number,
  to: number,
  device: string,
): CodeEntry {
  while (to > from + 1 && text[to - 1] === "\n") to--;
  const line = lineAt(starts, from);
  const endLine = lineAt(starts, to - 1);
  const entry: CodeEntry = {
    device,
    line: line + 1,
    range: [from - starts[line], to - starts[endLine]],
    excerpt: text.slice(from, to),
  };
  if (endLine !== line) entry.endLine = endLine + 1;
  return entry;
}
