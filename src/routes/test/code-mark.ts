import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

/** One code label rendered as a chip above the segment. */
export interface CodingMarkTag {
  label: string;
  marker: string;
  markerD: string;
  on: string;
  onD: string;
}

/**
 * One rendered mark segment. Segments are disjoint: every overlapping entry
 * range is split at its boundaries so a segment always carries the full set of
 * entries covering it (hatch colors, click lookup).
 */
export interface CodingMarkSpec {
  /** stable segment key: the covering entry ids joined with "|" */
  id: string;
  /** deterministic entry ids (entryId()) covered by this segment */
  ids: string[];
  from: number;
  to: number;
  /** display code labels joined with " · ", shown as tooltip */
  code: string;
  /** css custom properties for the mark (--fill, --fill-d, --hl, --hl-d, --bars, --bars-d) */
  style: string;
  /** code label chips shown above the segment (one per distinct covering code) */
  tags: CodingMarkTag[];
  /** brighten (related entry hovered) */
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
              attributes: { style: s.style, "data-entry": s.ids.join(" "), title: s.code },
            }).range(s.from, s.to),
          ),
          true,
        );
      }
    return marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Zero-width inline widget: the code label chips floating above a segment. */
class LabelWidget extends WidgetType {
  constructor(readonly spec: CodingMarkSpec) {
    super();
  }

  eq(other: LabelWidget): boolean {
    const a = this.spec.tags;
    const b = other.spec.tags;
    return (
      this.spec.id === other.spec.id &&
      a.length === b.length &&
      a.every((t, i) => t.label === b[i].label && t.marker === b[i].marker)
    );
  }

  toDOM(): HTMLElement {
    const line = document.createElement("span");
    line.className = "cm-tagline";
    line.setAttribute("data-segment", this.spec.id);
    const row = document.createElement("span");
    row.className = "cm-tagrow";
    for (const t of this.spec.tags) {
      const chip = document.createElement("span");
      chip.className = "cm-tag";
      chip.style.cssText = `--tag:${t.marker}; --tag-d:${t.markerD}; --tag-on:${t.on}; --tag-on-d:${t.onD}`;
      chip.setAttribute("data-entry", this.spec.ids.join(" "));
      chip.textContent = t.label;
      row.appendChild(chip);
    }
    line.appendChild(row);
    return line;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const labelsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(labels, tr) {
    labels = labels.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setCodingMarks)) {
        const sorted = [...e.value]
          .filter((s) => s.tags.length > 0)
          .sort((a, b) => a.from - b.from || a.to - b.to || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        labels = Decoration.set(
          sorted.map((s) => Decoration.widget({ widget: new LabelWidget(s), side: 1 }).range(s.from)),
          true,
        );
      }
    return labels;
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
    labelsField,
    marksTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const tag = (event.target as HTMLElement).closest?.(".cm-tagline");
        if (tag) {
          onMarkClick(tag.getAttribute("data-segment"));
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        onMarkClick(pos === null ? null : (markAtPos(view, pos)?.id ?? null));
        return false;
      },
      mouseover(event, view) {
        if (!onMarkHover) return false;
        if ((event.target as HTMLElement).closest?.(".cm-tagline")) return false;
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
