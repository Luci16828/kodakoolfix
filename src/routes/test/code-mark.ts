import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

/** One code label rendered as a chip above the segment. */
export interface CodingMarkTag {
  label: string;
  /** entry id the chip belongs to (hover lookup) */
  id: string;
  /** brighten (entry hot under the mouse or as narrowest of its segment) */
  hot?: boolean;
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
  /** css custom properties for the mark (--bars, --bars-d, --bars-hot, --bars-hot-d) */
  style: string;
  /** code label chips shown above the segment (one per distinct covering code) */
  tags: CodingMarkTag[];
  /** brighten (related entry hovered) */
  hot?: boolean;
}

const setCodingMarks = StateEffect.define<CodingMarkSpec[]>({
  map: (specs, change) => specs.map((s) => ({ ...s, from: change.mapPos(s.from), to: change.mapPos(s.to) })),
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
              attributes: { style: s.style, "data-entry": s.ids.join(" "), "data-seg": s.id, title: s.code },
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
      a.every((t, i) => t.label === b[i].label && t.marker === b[i].marker && t.hot === b[i].hot)
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
      chip.className = t.hot ? "cm-tag cm-tag-hot" : "cm-tag";
      chip.style.cssText = `--tag:${t.marker}; --tag-d:${t.markerD}; --tag-on:${t.on}; --tag-on-d:${t.onD}`;
      chip.setAttribute("data-entry", this.spec.ids.join(" "));
      chip.setAttribute("data-tag-entry", t.id);
      chip.appendChild(document.createTextNode(t.label));
      const x = document.createElement("span");
      x.className = "cm-tag-x material-symbols-rounded";
      x.setAttribute("data-del-entry", t.id);
      x.textContent = "close";
      chip.appendChild(x);
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

/** Replace the full mark set (called whenever the entry list changes). */
export function syncCodingMarks(view: EditorView, specs: CodingMarkSpec[]): void {
  view.dispatch({ effects: setCodingMarks.of(specs) });
}

// resolve hover/click from the element under the pointer, not posAtCoords:
// with the wide 2.55 leading posAtCoords snaps to the nearest char, so leaving
// a mark into the gap between lines would keep it hot
interface Hit {
  seg: string | null;
  tag: string | null;
  /** entry id whose remove button is under the pointer */
  del: string | null;
}

function hit(event: MouseEvent): Hit | null {
  const el = event.target instanceof Element ? event.target : null;
  if (!el) return null;
  const x = el.closest(".cm-tag-x");
  if (x) {
    return {
      seg: x.closest(".cm-tagline")?.getAttribute("data-segment") ?? null,
      tag: x.closest(".cm-tag")?.getAttribute("data-tag-entry") ?? null,
      del: x.getAttribute("data-del-entry"),
    };
  }
  const chip = el.closest(".cm-tag");
  if (chip) {
    return {
      seg: chip.closest(".cm-tagline")?.getAttribute("data-segment") ?? null,
      tag: chip.getAttribute("data-tag-entry"),
      del: null,
    };
  }
  if (el.closest(".cm-tagline")) return { seg: null, tag: null, del: null };
  const mark = el.closest(".cm-underline");
  return { seg: mark?.getAttribute("data-seg") ?? null, tag: null, del: null };
}

/** Extension: fields + click/hover detection for marks and label chips. */
export function codingMarks(
  onMarkClick: (id: string | null) => void,
  onMarkHover?: (id: string | null) => void,
  onTagHover?: (id: string | null) => void,
  onTagRemove?: (id: string) => void,
  onAdd?: (from: number, to: number) => void,
) {
  // mouseup-add and del must share one extension: a mousedown swallowed by the
  // remove button may never pair with the mouseup that adds an entry, even when
  // posAtDOM fails to collapse a stale selection
  let downDel = false;
  return [
    marksField,
    labelsField,
    EditorView.domEventHandlers({
      mousedown(event) {
        const h = hit(event);
        if (h?.del) {
          downDel = true;
          onTagRemove?.(h.del);
          // collapse the selection so no stale range lingers after the removal
          if (event.target instanceof Element) {
            try {
              const pos = arguments[1].posAtDOM(event.target, 0);
              if (pos >= 0) arguments[1].dispatch({ selection: { anchor: pos } });
            } catch {
              /* widget DOM unresolvable; selection is cleared on the next click */
            }
          }
          return true; // swallow: never arm a drag from the remove button
        }
        onMarkClick(h?.seg ?? null);
        return false;
      },
      mouseup(_event, view) {
        if (downDel) {
          downDel = false;
          return false;
        }
        const r = view.state.selection.main;
        if (!r.empty) onAdd?.(r.from, r.to);
        return false;
      },
      // hover must be resolved on mousemove, not mouseover: every hot-state change
      // rebuilds the mark DOM under the pointer, and after such a swap no mouseover
      // fires until a new element boundary is crossed, leaving stale hot segments
      mousemove(event) {
        const h = hit(event);
        onTagHover?.(h?.tag ?? null);
        onMarkHover?.(h?.seg ?? null);
        return false;
      },
      mouseleave() {
        onMarkHover?.(null);
        onTagHover?.(null);
        return false;
      },
    }),
  ];
}
