import { useEffect, useRef, useState } from "react";
import { longhandsOf } from "../core/box-select.ts";
import { identifyElement, getElementClasses } from "../core/identify.ts";
import { createPreview, type PreviewEntry } from "../core/preview.ts";
import { regionProperty, type SpacingRegion } from "../core/spacing.ts";
import { serializeRegion, type StyleChange, type StyleChangeDetail, type StyleValue } from "../core/style-change.ts";
import { isStyleAnnotation } from "../core/style-output.ts";
import { tokenCss } from "../core/token-values.ts";
import type { Annotation } from "../core/types.ts";

/**
 * Pending inspector edits as `kind: "style-change"` / `"measure"` annotations (spec 7.4):
 * stored per route with the feedback, so they persist, copy, send and clear with it.
 * Live elements (for the preview and Edit) are kept in memory only; after a reload they
 * are re-attached from the stored selectors when the counts still match.
 */

export type StyleEdit = {
  category: StyleChange["category"];
  property: string;
  /** Change group identity: one spacing element, one type group, one colour group. */
  groupId: string;
  elements: Element[];
  from: StyleValue;
  to: StyleValue;
  region?: SpacingRegion;
  signature?: string;
  measure?: StyleChange["measure"];
  detail?: StyleChangeDetail;
  /** Pre-preview computed value per element (Box reads it with the preview lifted). */
  before?: string[];
};

/** When a record was last written: preview declarations apply in this order (later wins). */
const editedAt = (a: Annotation) => (a.updatedAt ? Date.parse(a.updatedAt) : a.timestamp) || 0;

export type StyleChangesOptions = {
  annotations: Annotation[];
  commit: (list: Annotation[]) => void;
  attributeNames: readonly string[];
  /** Source file for a new change's first element (sync best effort), refined later by `enrich`. */
  sourceFor?: (el: Element) => string | undefined;
  enrich?: (el: Element, apply: (sourceFile: string) => void) => void;
  onAdd?: (a: Annotation) => void;
  onUpdate?: (a: Annotation) => void;
  onDelete?: (a: Annotation) => void;
  /** Preview is live only in inspector modes (spec 6 revert rules). */
  previewEnabled: boolean;
  /** Called after each preview write (overlays redraw). */
  onPreview?: () => void;
};

let counter = 0;
/** Wall clock, outside the hook so render purity checks stay meaningful. */
const nowMs = () => Date.now();
const newId = () => globalThis.crypto?.randomUUID?.() ?? `style-${Date.now()}-${++counter}`;

/** `.card-body` from the first class, else `#id`, else the tag. */
export function memberLabel(el: Element): string {
  const cls = getElementClasses(el).split(" ").find((c) => c && !c.includes(":") && !c.includes("["));
  if (cls) return `.${cls}`;
  const id = el.getAttribute("id");
  if (id) return `#${id}`;
  return el.localName;
}

/** CSS written to the preview for a change's new value (shared token -> CSS mapping). */
export function previewValue(to: StyleValue): string {
  return to.token ? tokenCss(to.token) : to.value;
}

/** One transient preview declaration (an I9 handle drag): longhands only; `key` groups several elements under one rule. */
export type DraftEntry = { elements: Element[]; property: string; value: string; key?: string };

/**
 * The one preview's entries: pending records in edit order (a later `padding-top` beats
 * an earlier `padding` in the same rule), then the drag draft. A record that sets a
 * drafted longhand (directly or through a shorthand such as `padding`) is written as its
 * other longhands, so the draft value always wins and nothing else changes.
 */
function previewEntries(annotations: readonly Annotation[], live: ReadonlyMap<string, Element[]>, draft: readonly DraftEntry[] | null): PreviewEntry<Element>[] {
  const entries: PreviewEntry<Element>[] = [];
  const drafted = (el: Element, longhand: string) => Boolean(draft?.some((d) => d.property === longhand && d.elements.includes(el)));
  const ordered = annotations.map((a, i) => ({ a, i })).sort((x, y) => editedAt(x.a) - editedAt(y.a) || x.i - y.i).map(({ a }) => a);
  for (const a of ordered) {
    if (a.kind !== "style-change" || !a.styleChange) continue;
    const els = live.get(a.id)?.filter((el) => el.isConnected) ?? [];
    const key = els.length > 1 ? a.styleDetail?.groupId : undefined;
    const { property } = a.styleChange;
    const value = previewValue(a.styleChange.to);
    for (const element of els) {
      const longhands = draft ? longhandsOf(property) : [property];
      if (!longhands.some((l) => drafted(element, l))) {
        entries.push({ element, property, value, ...(key ? { key } : {}) });
        continue;
      }
      for (const l of longhands) if (!drafted(element, l)) entries.push({ element, property: l, value, ...(key ? { key } : {}) });
    }
  }
  for (const d of draft ?? []) {
    const key = d.elements.length > 1 ? d.key : undefined;
    for (const element of d.elements) if (element.isConnected) entries.push({ element, property: d.property, value: d.value, ...(key ? { key } : {}) });
  }
  return entries;
}

function sameGroup(a: Annotation, groupId: string, property: string): boolean {
  return a.kind === "style-change" && a.styleDetail?.groupId === groupId && a.styleChange?.property === property;
}

export function useStyleChanges(options: StyleChangesOptions) {
  /** Live elements per annotation id. Held in state (not a ref) so render may read it. */
  const [live] = useState(() => new Map<string, Element[]>());
  /** Bumped when elements are (re)attached without a list change, to re-apply the preview. */
  const [attached, setAttached] = useState(0);
  const [preview] = useState(() => (typeof document === "undefined" ? null : createPreview<Element>(document)));
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  /**
   * Commits and updates the working list at once, so several edits in one event (a font
   * size and its companion line-height, a membership re-sync) compose instead of each
   * overwriting the list from the last render.
   */
  const write = (list: Annotation[]) => {
    latest.current = { ...latest.current, annotations: list };
    latest.current.commit(list);
  };
  const items = options.annotations.filter(isStyleAnnotation);

  const elementsFor = (a: Annotation): Element[] => live.get(a.id)?.filter((el) => el.isConnected) ?? [];

  /** Re-attaches stored selectors to live elements (after a reload); true when all match. */
  const reattach = (a: Annotation): Element[] => {
    const existing = elementsFor(a);
    if (existing.length) return existing;
    const selectors = a.styleChange?.group.selectors ?? (a.elementPath ? [a.elementPath] : []);
    const found: Element[] = [];
    for (const selector of selectors) {
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) return [];
        found.push(matches[0]);
      } catch {
        return [];
      }
    }
    if (a.styleChange && found.length !== a.styleChange.group.count) return [];
    // Share the list across the whole group so every property edit previews again.
    for (const item of latest.current.annotations) {
      if (item.styleDetail?.groupId && item.styleDetail.groupId === a.styleDetail?.groupId) live.set(item.id, found);
    }
    live.set(a.id, found);
    setAttached((n) => n + 1);
    return found;
  };

  const upsert = (edit: StyleEdit) => {
    const { annotations, attributeNames } = latest.current;
    const existing = annotations.find((a) => sameGroup(a, edit.groupId, edit.property));
    const from = existing?.styleChange?.from ?? edit.from;
    if (edit.to.value === from.value && (edit.to.token ?? "") === (from.token ?? "")) {
      if (existing) remove(existing.id);
      return;
    }
    const selectors = edit.elements.map((el) => identifyElement(el, attributeNames).path);
    const labels = edit.elements.map(memberLabel);
    // Before-values per member: kept from the first capture (pre-preview) by selector,
    // read now for members added later (Shift-click).
    const previous = new Map<string, string>();
    existing?.styleChange?.group.selectors.forEach((sel, i) => {
      const value = existing.styleDetail?.computed?.[i]?.before;
      if (value != null) previous.set(sel, value);
    });
    const before = edit.elements.map((el, i) => ({ before: previous.get(selectors[i]) ?? edit.before?.[i] ?? getComputedStyle(el).getPropertyValue(edit.property).trim(), after: "" }));
    const region = existing?.styleChange?.region ?? (edit.region ? serializeRegion(edit.region, selectors[0] ?? "") : undefined);
    const change: StyleChange = {
      category: edit.category,
      property: edit.property,
      from: { ...from },
      to: { ...edit.to },
      ...(region ? { region } : {}),
      group: { count: edit.elements.length, selectors, ...(edit.signature ? { signature: edit.signature } : {}) },
      ...(edit.measure ? { measure: edit.measure } : existing?.styleChange?.measure ? { measure: existing.styleChange.measure } : {}),
    };
    const detail: StyleChangeDetail = {
      ...existing?.styleDetail,
      ...edit.detail,
      groupId: edit.groupId,
      labels,
      computed: before.map((c) => ({ before: c.before, after: "" })),
      // From-side facts stay as first captured (before any preview).
      ...(existing?.styleDetail?.flags ? { flags: existing.styleDetail.flags } : {}),
      ...(existing?.styleDetail?.memberFlags ? { memberFlags: existing.styleDetail.memberFlags } : {}),
      ...(existing?.styleDetail?.origin ? { origin: existing.styleDetail.origin } : {}),
      ...(existing?.styleDetail?.fromUtility ? { fromUtility: existing.styleDetail.fromUtility } : {}),
    };
    if (!detail.toUtility) delete detail.toUtility;
    if (edit.detail && "toUtility" in edit.detail && !edit.detail.toUtility) delete detail.toUtility;
    const name = detail.name ?? labels[0] ?? edit.property;
    const now = nowMs();
    const sourceFile = existing?.sourceFile ?? (edit.elements[0] ? latest.current.sourceFor?.(edit.elements[0]) : undefined);
    const annotation: Annotation = {
      ...(existing ?? { id: newId(), x: 0, y: 0, timestamp: now }),
      kind: "style-change",
      comment: "",
      element: name,
      elementPath: selectors[0] ?? "",
      styleChange: change,
      styleDetail: detail,
      ...(sourceFile ? { sourceFile } : {}),
      ...(existing ? { updatedAt: new Date(now).toISOString() } : {}),
    };
    live.set(annotation.id, edit.elements);
    for (const a of annotations) if (a.id !== annotation.id && a.styleDetail?.groupId === edit.groupId) live.set(a.id, edit.elements);
    write(existing ? annotations.map((a) => (a.id === existing.id ? annotation : a)) : [...annotations, annotation]);
    if (existing) latest.current.onUpdate?.(annotation);
    else latest.current.onAdd?.(annotation);
    if (!existing && !sourceFile && edit.elements[0]) {
      latest.current.enrich?.(edit.elements[0], (file) => {
        const list = latest.current.annotations;
        if (!list.some((a) => a.id === annotation.id)) return;
        write(list.map((a) => (a.styleDetail?.groupId === edit.groupId && !a.sourceFile ? { ...a, sourceFile: file } : a)));
      });
    }
  };

  /** A pure measurement (spec 7.4 kind "measure"). */
  const addMeasure = (measure: NonNullable<StyleChange["measure"]>, labels: [string, string]) => {
    const { annotations } = latest.current;
    const annotation: Annotation = {
      id: newId(),
      x: 0,
      y: 0,
      timestamp: nowMs(),
      kind: "measure",
      comment: "",
      element: `${labels[0]} → ${labels[1]}`,
      elementPath: measure.fromRegion.element,
      measure,
      styleDetail: { measureLabels: labels },
    };
    write([...annotations, annotation]);
    latest.current.onAdd?.(annotation);
  };

  const remove = (id: string) => {
    const { annotations } = latest.current;
    const target = annotations.find((a) => a.id === id);
    if (!target) return;
    live.delete(id);
    write(annotations.filter((a) => a.id !== id));
    latest.current.onDelete?.(target);
  };

  /** Pending change for an element and property (spacing rows, overlay labels). */
  const findFor = (el: Element, property: string): Annotation | undefined =>
    latest.current.annotations.find((a) => a.kind === "style-change" && a.styleChange?.property === property && elementsFor(a).includes(el));

  // One preview for every category, live only in inspector modes (spec 6 revert rules).
  const { annotations, previewEnabled } = options;
  /** Live I9 handle-drag values (see `setDraft`). A ref: it changes on every pointer move. */
  const draftRef = useRef<DraftEntry[] | null>(null);
  useEffect(() => {
    if (!preview) return;
    preview.apply(previewEnabled ? previewEntries(annotations, live, draftRef.current) : []);
    if (previewEnabled) latest.current.onPreview?.();
  }, [preview, annotations, previewEnabled, attached, live]);
  useEffect(() => () => preview?.revert(), [preview]);

  /**
   * Transient preview values (an I9 handle drag), merged into the one preview `<style>`
   * and written synchronously; never stored, synced or listed. `null` drops them, so the
   * page computes the pending-list values again: a release then commits with `upsert`
   * (exactly like a panel edit) and Esc restores the pre-drag preview.
   */
  const setDraft = (entries: DraftEntry[] | null) => {
    draftRef.current = entries;
    if (!preview || !latest.current.previewEnabled) return;
    preview.apply(previewEntries(latest.current.annotations, live, entries));
    latest.current.onPreview?.();
  };

  /** Forensic after-values: live computed while previewed, else the new value. */
  const withComputed = (list: Annotation[]): Annotation[] =>
    list.map((a) => {
      if (a.kind !== "style-change" || !a.styleChange) return a;
      const els = elementsFor(a);
      const computed = (a.styleDetail?.computed ?? a.styleChange.group.selectors.map(() => ({ before: a.styleChange?.from.value ?? "", after: "" }))).map((c, i) => {
        const el = els[i];
        const previewed = el?.hasAttribute("data-annotate-group");
        const after = previewed ? getComputedStyle(el).getPropertyValue(a.styleChange?.property ?? "").trim() : (a.styleChange?.to.value ?? "");
        return { before: c.before, after };
      });
      return { ...a, styleDetail: { ...a.styleDetail, computed } };
    });

  return { items, elementsFor, reattach, upsert, addMeasure, remove, findFor, withComputed, setDraft };
}

export type StyleChangesApi = ReturnType<typeof useStyleChanges>;

/** Spacing measure record between two pinned regions. */
export function measureRecord(a: SpacingRegion, b: SpacingRegion, selectors: [string, string], distance: number): NonNullable<StyleChange["measure"]> {
  return { fromRegion: serializeRegion(a, selectors[0]), toRegion: serializeRegion(b, selectors[1]), distance };
}

export { regionProperty };
