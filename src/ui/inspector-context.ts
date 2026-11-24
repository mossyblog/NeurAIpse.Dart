import type { InspectorSubMode } from "../core/spacing-modes.ts";
import type { TokenResolverApi } from "../core/tokens-dom.ts";
import type { Annotation } from "../core/types.ts";
import type { PendingItem } from "./inspector-panel.tsx";
import type { Surface } from "./shadow-surface.ts";
import type { StyleChangesApi } from "./use-style-changes.ts";

/** What every inspector mode (spacing, type, colour) gets from the toolbar. */
export type InspectorContext = {
  surface: Surface;
  attributeNames: readonly string[];
  resolver: TokenResolverApi;
  styles: StyleChangesApi;
  /** Pending list for the panel (every category). */
  pending: PendingItem[];
  onEdit: (id: string) => void;
  onCopy: () => void;
  /** Edit request from the pending list: re-target this change (bumped `n` repeats it). */
  focus: { id: string; n: number } | null;
  /** Toolbar status line, e.g. when an Edit target is no longer on the page. */
  notify: (text: string) => void;
  /** Spacing sub-mode (spec 14): Box or Lines. */
  subMode: InspectorSubMode;
  /** I9 drag handles on the selected Box sides (spec 13.1). Optional: off when absent. */
  handles?: boolean;
  /** I9 token guides: Box sides (spec 13.3) and the type ladder (I9b). Optional: off when absent. */
  guides?: boolean;
  /** Registers the active inspector's Esc hook (returns true when it consumed the key); null unregisters. */
  setEscape: (handler: (() => boolean) | null) => void;
};

export const EDIT_NOT_FOUND = "Element not found for this change";

const serials = new WeakMap<Element, number>();
let serial = 0;

/** Stable per-session id for an element, used as its spacing change group. */
export function elementSerial(el: Element): number {
  let id = serials.get(el);
  if (id == null) serials.set(el, (id = ++serial));
  return id;
}

/** Pending-list rows for style changes and measurements. */
export function pendingItems(items: readonly Annotation[]): PendingItem[] {
  return items.flatMap((a): PendingItem[] => {
    if (a.kind === "measure" && a.measure) {
      const [from, to] = a.styleDetail?.measureLabels ?? [a.measure.fromRegion.element, a.measure.toRegion.element];
      return [{ id: a.id, label: "Measure", property: "distance", from, to: `${to}: ${Math.round(a.measure.distance * 100) / 100}px` }];
    }
    const c = a.styleChange;
    if (!c) return [];
    const count = c.group.count > 1 ? ` ×${c.group.count}` : "";
    return [{ id: a.id, label: `${a.styleDetail?.name ?? a.element}${count}`, property: c.property, from: c.from.token ?? c.from.value, to: c.to.token ?? c.to.value }];
  });
}
