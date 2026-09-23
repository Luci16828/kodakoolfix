import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

/** One coding entry projected onto editor character offsets. */
export interface CodingMarkSpec {
  /** deterministic entry id (entryId()), used for lookup/removal */
  id: string;
  from: number;
  to: number;
  /** display code label, shown as tooltip */
  code: string;
  /** css custom properties for the mark (--fill, --fill-d, --hl, --hl-d) */
  style: string;
  /** brighten with the hover color (related entry hovered) */
  hot?: boolean;
}

const setCodingMarks = StateEffect.define<CodingMarkSpec[]>({
  map: (specs, change) => specs.map((s) => ({ ...s, from: change.mapPos(s.from), to: change.mapPos(s.to) })),
});

const specsField = StateField.define<CodingMarkSpec[]>({
  create: () => [],
  update(specs, tr) {
    for (const e of tr.effects) if (e.is(setCodingMarks)) specs = e.value.map((s) => ({ ...s }));
    return specs;
  },
});

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setCodingMarks)) {
        const sorted = [...e.value].sort((a, b) => a.from - b.from || b.to - a.to);
        marks = Decoration.set(
          sorted.map((s) =>
            Decoration.mark({
              class: s.hot ? "cm-underline cm-hot" : "cm-underline",
              attributes: { style: s.style, "data-entry": s.id, title: s.code },
            }).range(s.from, s.to),
          ),
          true,
        );
      }
    return marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const marksTheme = EditorView.baseTheme({
  "& .cm-underline": { cursor: "pointer" },
});

/** Replace the full mark set (called whenever the entry list changes). */
export function syncCodingMarks(view: EditorView, specs: CodingMarkSpec[]): void {
  view.dispatch({ effects: setCodingMarks.of(specs) });
}

/** Innermost mark containing `pos`, or null. */
export function markAtPos(view: EditorView, pos: number): CodingMarkSpec | null {
  const specs = view.state.field(specsField);
  let best: CodingMarkSpec | null = null;
  for (const s of specs) {
    if (s.from <= pos && pos < s.to && (!best || s.to - s.from < best.to - best.from)) best = s;
  }
  return best;
}

/** Extension: fields + click/hover detection for marks. */
export function codingMarks(onMarkClick: (id: string | null) => void, onMarkHover?: (id: string | null) => void) {
  return [
    specsField,
    marksField,
    marksTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        onMarkClick(pos === null ? null : (markAtPos(view, pos)?.id ?? null));
        return false;
      },
      mouseover(event, view) {
        if (!onMarkHover) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        onMarkHover(pos === null ? null : (markAtPos(view, pos)?.id ?? null));
        return false;
      },
      mouseleave() {
        onMarkHover?.(null);
        return false;
      },
    }),
  ];
}
