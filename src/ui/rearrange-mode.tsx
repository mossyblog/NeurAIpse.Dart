"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getElementClasses, getElementPath, identifyElement } from "../core/identify.ts";
import type { MeasureLine } from "../core/measure.ts";
import {
  applyResizeSnap,
  constrainAxis,
  distanceLines,
  translateRect,
  nearestRelation,
  rearrangeNudge,
  pastThreshold,
  resizeFromHandle,
  resizeSnapLines,
  roundRect,
  sameRect,
  snapRect,
  type RearrangeHandle,
  type SnapGuide,
} from "../core/rearrange-geometry.ts";
import {
  REARRANGE_COMPUTED,
  REARRANGE_NOT_FOUND,
  rearrangeItems,
  type RearrangeDetail,
} from "../core/rearrange-output.ts";
import { createRearrangePreview, REARRANGE_ID_ATTRIBUTE, type RearrangeTarget } from "../core/rearrange-preview.ts";
import { pickAreaTargets, unionRect } from "../core/select.ts";
import { isEditableElement } from "../core/shortcuts.ts";
import { deepElementFromPoint } from "../core/spacing-dom.ts";
import type { Annotation, Point, Rect } from "../core/types.ts";
import { RearrangeOverlay, type OverlayBox } from "./rearrange-overlay.tsx";
import { RearrangePanel, type RearrangeRow } from "./rearrange-panel.tsx";
import { isFromSurface, realTarget, type Surface } from "./shadow-surface.ts";

/**
 * Rearrange mode (parity spec 10.2): select existing page elements, move them (drag the
 * selection or its grip, arrow keys), resize them (8 handles), hide them (Delete), with
 * snap guides and distance pills. Each touched element is one `kind: "rearrange"`
 * annotation kept with the feedback for the route; the preview lives only while the mode
 * is on and is fully reverted when it ends.
 */

export type RearrangeContext = {
  surface: Surface;
  attributeNames: readonly string[];
  annotations: Annotation[];
  commit: (list: Annotation[]) => void;
  /** Selection accent (marker colour). */
  color: string;
  sourceFor?: (el: Element) => string | undefined;
  onAdd?: (a: Annotation) => void;
  onUpdate?: (a: Annotation) => void;
  onDelete?: (a: Annotation) => void;
  notify: (text: string) => void;
  setEscape: (handler: (() => boolean) | null) => void;
  onCopy: () => void;
};

/** Page events swallowed while the mode is on: the page never sees a click. */
const BLOCKED = ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "dragstart", "selectstart"] as const;
const SKIPPED = new Set(["html", "body", "head", "script", "style", "link", "meta", "noscript", "template", "br"]);

type Logical = { rect: Rect; original: Rect };

type Gesture =
  | { kind: "press"; start: Point; target: Element | null; additive: boolean; onSelected: boolean }
  | { kind: "move"; start: Point; items: { el: Element; from: Logical; visual: Rect }[]; union: Rect; targets: Rect[] }
  | { kind: "resize"; start: Point; handle: RearrangeHandle; el: Element; from: Logical; visual: Rect; targets: Rect[] }
  | { kind: "marquee"; start: Point; additive: boolean };

type DragView = {
  draft: Map<Element, Logical>;
  guides: SnapGuide[];
  lines: MeasureLine[];
  marquee?: Rect;
};

let counter = 0;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `rearrange-${Date.now()}-${++counter}`;
const nowMs = () => Date.now();

const toDoc = (r: Rect): Rect => ({ x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height });
const toView = (r: Rect): Rect => ({ x: r.x - window.scrollX, y: r.y - window.scrollY, width: r.width, height: r.height });
const viewRect = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, width: b.width, height: b.height };
};

/** `.card-btn` from the first class, else `#id`, else the tag (sibling and parent labels). */
function shortLabel(el: Element): string {
  const cls = getElementClasses(el).split(" ").find((c) => c && !c.includes(":") && !c.includes("["));
  if (cls) return `.${cls}`;
  const id = el.getAttribute("id");
  if (id) return `#${id}`;
  return el.localName;
}

/** Selector that matches exactly this element: the short path, else deeper paths. */
function uniqueSelector(el: Element, attributeNames: readonly string[]): string {
  let path = identifyElement(el, attributeNames).path;
  for (const depth of [8, 16, 64]) {
    try {
      const matches = document.querySelectorAll(path);
      if (matches.length === 1 && matches[0] === el) return path;
    } catch {
      // Fall through to a deeper path.
    }
    path = getElementPath(el, depth, attributeNames);
  }
  return path;
}

/** Computed layout without the preview (its rule keys off the id attribute, lifted briefly). */
function computedLayout(el: Element): Record<string, string> {
  const id = el.getAttribute(REARRANGE_ID_ATTRIBUTE);
  if (id !== null) el.removeAttribute(REARRANGE_ID_ATTRIBUTE);
  const style = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of REARRANGE_COMPUTED) out[p] = style.getPropertyValue(p).trim();
  if (id !== null) el.setAttribute(REARRANGE_ID_ATTRIBUTE, id);
  return out;
}

/** Forensic after-values: the before values with the preview overrides applied. */
function afterLayout(before: Record<string, string>, original: Rect, rect: Rect, removed: boolean): Record<string, string> {
  const after = { ...before };
  const dx = Math.round(rect.x - original.x);
  const dy = Math.round(rect.y - original.y);
  if (dx || dy) after.translate = `${dx}px ${dy}px`;
  if (Math.round(rect.width) !== Math.round(original.width)) after.width = `${Math.round(rect.width)}px`;
  if (Math.round(rect.height) !== Math.round(original.height)) after.height = `${Math.round(rect.height)}px`;
  if (before.display === "inline" && (dx || dy || after.width !== before.width || after.height !== before.height)) after.display = "inline-block";
  if (removed) after.visibility = "hidden";
  return after;
}

const isRecord = (a: Annotation) => a.kind === "rearrange" && Boolean(a.rearrange);

export function RearrangeMode({ ctx }: { ctx: RearrangeContext }) {
  const { surface } = ctx;
  /** Live element per record id; held in state (not a ref) so render may read it. */
  const [live] = useState(() => new Map<string, Element>());
  const [preview] = useState(() => createRearrangePreview(document));
  /** Gesture in progress (pointer handlers only; never read in render). */
  const gesture = useRef<Gesture | null>(null);
  const [selection, setSelection] = useState<Element[]>([]);
  const [hover, setHover] = useState<Element | null>(null);
  const [view, setView] = useState<DragView | null>(null);
  const [, setTick] = useState(0);
  /** Latest record list written or received (handlers only), so one event's edits compose. */
  const working = useRef<Annotation[]>(ctx.annotations);

  const records = rearrangeItems(ctx.annotations);
  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;

  const elementFor = (a: Annotation): Element | null => {
    const el = live.get(a.id);
    return el && el.isConnected ? el : null;
  };
  const recordFor = (el: Element): Annotation | undefined => working.current.find((a) => isRecord(a) && live.get(a.id) === el);

  /** Re-attaches stored selectors (after a reload): exactly one match, else not found. */
  const attach = (list: readonly Annotation[]): string[] => {
    const missing: string[] = [];
    for (const a of rearrangeItems(list)) {
      if (elementFor(a)) continue;
      let found: Element | null = null;
      try {
        const matches = document.querySelectorAll(a.rearrange!.selector);
        if (matches.length === 1) found = matches[0];
      } catch {
        found = null;
      }
      if (found) live.set(a.id, found);
      else missing.push(a.id);
    }
    return missing;
  };

  const targetsFor = (list: readonly Annotation[], draft?: Map<Element, Logical>): RearrangeTarget[] => {
    const out = new Map<Element, RearrangeTarget>();
    const add = (element: Element, original: Rect, rect: Rect, removed: boolean) => {
      const resized = Math.round(rect.width) !== Math.round(original.width) || Math.round(rect.height) !== Math.round(original.height);
      out.set(element, { element, offset: { x: rect.x - original.x, y: rect.y - original.y }, ...(resized ? { size: { width: rect.width, height: rect.height } } : {}), ...(removed ? { removed: true } : {}) });
    };
    for (const a of rearrangeItems(list)) {
      const el = elementFor(a);
      if (el) add(el, a.rearrange!.originalRect, a.rearrange!.currentRect, Boolean(a.rearrangeDetail?.removed));
    }
    for (const [el, logical] of draft ?? []) add(el, logical.original, logical.rect, false);
    return [...out.values()];
  };

  const redraw = () => requestAnimationFrame(() => setTick((t) => t + 1));

  // The preview follows the records and the drag draft; unmount reverts it fully.
  const draft = view?.draft;
  const syncPreview = useEffectEvent((list: Annotation[], next: Map<Element, Logical> | undefined) => {
    working.current = list;
    attach(list);
    preview.apply(targetsFor(list, next));
  });
  useEffect(() => {
    syncPreview(ctx.annotations, draft);
    const frame = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => cancelAnimationFrame(frame);
  }, [ctx.annotations, draft]);
  useEffect(() => () => preview.revert(), [preview]);

  // Entering the mode: report stored rearrangements whose element is gone.
  const reportMissing = useEffectEvent(() => {
    const missing = attach(ctx.annotations);
    if (missing.length) ctx.notify(REARRANGE_NOT_FOUND);
  });
  useEffect(() => reportMissing(), []);

  /** Writes the list and keeps the working copy, so one event's edits compose. */
  const write = (list: Annotation[]) => {
    working.current = list;
    ctx.commit(list);
  };

  /** Siblings (and parent) of an element as document rects, for snapping and relations. */
  const neighbours = (el: Element, exclude: readonly Element[]) => {
    const parent = el.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((c) => !exclude.includes(c) && !SKIPPED.has(c.localName) && !isOverlay(c)) : [];
    return {
      siblings: siblings.map((s) => ({ label: shortLabel(s), rect: toDoc(viewRect(s)) })).filter((s) => s.rect.width > 0 || s.rect.height > 0),
      parent: parent && parent !== document.body && parent !== document.documentElement ? { label: shortLabel(parent), rect: toDoc(viewRect(parent)) } : undefined,
    };
  };

  /** Logical rects of an element: the record's, else measured now (no preview on it yet). */
  const logicalOf = (el: Element): Logical => {
    const rec = recordFor(el)?.rearrange;
    if (rec) return { rect: rec.currentRect, original: rec.originalRect };
    const measured = roundRect(toDoc(viewRect(el)));
    return { rect: measured, original: measured };
  };

  /**
   * Creates, updates or drops (back at its original rect) the record for each element.
   * `visual` is where the element appears now (document px), for the sibling relation.
   */
  const upsert = (changes: { el: Element; rect: Rect; original: Rect; visual: Rect; removed?: boolean }[]) => {
    let list = working.current;
    const added: Annotation[] = [];
    const updated: Annotation[] = [];
    const deleted: Annotation[] = [];
    const moving = changes.map((c) => c.el);
    for (const change of changes) {
      const existing = recordFor(change.el);
      const rect = roundRect(change.rect);
      const removed = Boolean(change.removed);
      if (!removed && sameRect(rect, change.original)) {
        if (existing) {
          list = list.filter((a) => a.id !== existing.id);
          live.delete(existing.id);
          deleted.push(existing);
        }
        continue;
      }
      const el = change.el;
      const { siblings, parent } = neighbours(el, moving);
      const before = existing?.rearrangeDetail?.computed?.before ?? computedLayout(el);
      const detail: RearrangeDetail = {
        ...(removed ? { removed: true } : {}),
        relation: nearestRelation(change.visual, siblings, parent),
        ...(parent ? { parent: parent.label } : {}),
        computed: { before, after: afterLayout(before, change.original, rect, removed) },
      };
      const now = nowMs();
      const selector = existing?.rearrange?.selector ?? uniqueSelector(el, ctx.attributeNames);
      const label = existing?.rearrange?.label ?? identifyElement(el, ctx.attributeNames).name;
      const sourceFile = existing?.sourceFile ?? ctx.sourceFor?.(el);
      const annotation: Annotation = {
        ...(existing ?? { id: newId(), timestamp: now }),
        x: ((rect.x - window.scrollX + rect.width / 2) / Math.max(1, window.innerWidth)) * 100,
        y: rect.y + rect.height / 2,
        kind: "rearrange",
        comment: "",
        element: label,
        elementPath: selector,
        rearrange: { selector, label, tagName: el.localName, originalRect: roundRect(change.original), currentRect: rect },
        rearrangeDetail: detail,
        ...(sourceFile ? { sourceFile } : {}),
        ...(existing ? { updatedAt: new Date(now).toISOString() } : {}),
      };
      if (!removed) delete annotation.rearrangeDetail?.removed;
      live.set(annotation.id, el);
      if (existing) {
        list = list.map((a) => (a.id === existing.id ? annotation : a));
        updated.push(annotation);
      } else {
        list = [...list, annotation];
        added.push(annotation);
      }
    }
    if (list === working.current) return;
    write(list);
    added.forEach((a) => ctx.onAdd?.(a));
    updated.forEach((a) => ctx.onUpdate?.(a));
    deleted.forEach((a) => ctx.onDelete?.(a));
  };

  const resetRecord = (id: string) => {
    const target = working.current.find((a) => a.id === id);
    if (!target) return;
    live.delete(id);
    write(working.current.filter((a) => a.id !== id));
    ctx.onDelete?.(target);
  };

  const toggleRemoved = (id: string) => {
    const a = working.current.find((item) => item.id === id);
    const el = a ? elementFor(a) : null;
    if (!a?.rearrange) return;
    if (!el) return ctx.notify(REARRANGE_NOT_FOUND);
    const removed = !a.rearrangeDetail?.removed;
    upsert([{ el, rect: a.rearrange.currentRect, original: a.rearrange.originalRect, visual: toDoc(viewRect(el)), removed }]);
  };

  const selectRecord = (id: string) => {
    const a = working.current.find((item) => item.id === id);
    const el = a ? elementFor(a) : null;
    if (!el) return ctx.notify(REARRANGE_NOT_FOUND);
    setSelection([el]);
  };

  const at = (x: number, y: number): Element | null => {
    const el = deepElementFromPoint(document, x, y, isOverlay);
    return el && !SKIPPED.has(el.localName) ? el : null;
  };

  /** True when the element (or a descendant) is what the user sees at its centre. */
  const visibleAt = (el: Element, rect: Rect) => {
    const top = at(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return Boolean(top && (top === el || el.contains(top)));
  };

  /** The selected element at or above `el` (a press inside a selected box moves it). */
  const selectedOwner = (el: Element | null): Element | null => {
    for (let node = el; node; node = node.parentElement) if (selection.includes(node)) return node;
    return null;
  };

  const startMove = (start: Point) => {
    const els = selection.filter((el) => el.isConnected);
    if (!els.length) return;
    const items = els.map((el) => ({ el, from: logicalOf(el), visual: toDoc(viewRect(el)) }));
    const union = unionRect(items.map((i) => i.visual))!;
    const targets = els.length ? neighbours(els[0], els).siblings.map((s) => s.rect) : [];
    const parent = els[0].parentElement;
    if (parent && parent !== document.body) targets.push(toDoc(viewRect(parent)));
    gesture.current = { kind: "move", start, items, union, targets };
  };

  const startResize = (el: Element, handle: RearrangeHandle, start: Point) => {
    const { siblings } = neighbours(el, [el]);
    const targets = siblings.map((s) => s.rect);
    const parent = el.parentElement;
    if (parent && parent !== document.body) targets.push(toDoc(viewRect(parent)));
    gesture.current = { kind: "resize", start, handle, el, from: logicalOf(el), visual: toDoc(viewRect(el)), targets };
  };

  const onPointerMove = (event: PointerEvent) => {
    const g = gesture.current;
    const p = { x: event.clientX, y: event.clientY };
    if (!g) {
      if (isFromSurface(event, surface)) return;
      const next = at(p.x, p.y);
      setHover((current) => (current === next ? current : next));
      return;
    }
    if (g.kind === "press") {
      if (!pastThreshold(g.start, p)) return;
      if (g.onSelected) startMove(g.start);
      else gesture.current = { kind: "marquee", start: g.start, additive: g.additive };
      return onPointerMove(event);
    }
    let dx = p.x - g.start.x;
    let dy = p.y - g.start.y;
    if (g.kind === "marquee") {
      const marquee = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(dx), height: Math.abs(dy) };
      setView({ draft: new Map(), guides: [], lines: [], marquee });
      return;
    }
    if (g.kind === "move") {
      if (event.shiftKey) ({ x: dx, y: dy } = constrainAxis(dx, dy));
      let moved = translateRect(g.union, dx, dy);
      let guides: SnapGuide[] = [];
      if (!event.altKey) {
        const snap = snapRect(moved, g.targets, { lines: { x: event.shiftKey && dx === 0 ? [] : ["start", "mid", "end"], y: event.shiftKey && dy === 0 ? [] : ["start", "mid", "end"] } });
        dx += snap.dx;
        dy += snap.dy;
        moved = translateRect(g.union, dx, dy);
        guides = snap.guides;
      }
      const next = new Map<Element, Logical>();
      for (const item of g.items) next.set(item.el, { rect: translateRect(item.from.rect, dx, dy), original: item.from.original });
      setView({ draft: next, guides: guides.map(guideToView), lines: distanceLines(toView(moved), g.targets.map(toView)) });
      return;
    }
    let visual = resizeFromHandle(g.visual, g.handle, dx, dy, { keepAspect: event.shiftKey });
    let guides: SnapGuide[] = [];
    if (!event.altKey && !event.shiftKey) {
      const snap = snapRect(visual, g.targets, { lines: resizeSnapLines(g.handle) });
      visual = applyResizeSnap(visual, g.handle, snap.dx, snap.dy);
      guides = snap.guides;
    }
    const shift = { x: g.from.rect.x - g.visual.x, y: g.from.rect.y - g.visual.y };
    const rect = { x: visual.x + shift.x, y: visual.y + shift.y, width: visual.width, height: visual.height };
    setView({ draft: new Map([[g.el, { rect, original: g.from.original }]]), guides: guides.map(guideToView), lines: distanceLines(toView(visual), g.targets.map(toView)) });
  };

  const guideToView = (g: SnapGuide): SnapGuide =>
    g.axis === "x" ? { axis: "x", pos: g.pos - window.scrollX, from: g.from - window.scrollY, to: g.to - window.scrollY } : { axis: "y", pos: g.pos - window.scrollY, from: g.from - window.scrollX, to: g.to - window.scrollX };

  const finish = (event: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (g.kind === "press") {
      if (!g.target) {
        if (!g.additive) setSelection([]);
        return;
      }
      const target = g.target;
      setSelection((current) => (g.additive ? (current.includes(target) ? current.filter((el) => el !== target) : [...current, target]) : [target]));
      return;
    }
    if (g.kind === "marquee") {
      const region = view?.marquee;
      setView(null);
      if (!region) return;
      const candidates = Array.from(document.body.querySelectorAll("*")).filter((el) => !SKIPPED.has(el.localName) && !isOverlay(el));
      const rects = candidates.map(viewRect);
      const picked = pickAreaTargets(region, rects, (child, ancestor) => candidates[ancestor].contains(candidates[child]), {
        exclude: (i) => rects[i].width === 0 || rects[i].height === 0 || !visibleAt(candidates[i], rects[i]),
      }).map((i) => candidates[i]);
      setSelection((current) => (g.additive || additive ? [...current, ...picked.filter((el) => !current.includes(el))] : picked));
      return;
    }
    const drafted = view?.draft;
    setView(null);
    if (!drafted?.size) return;
    if (g.kind === "move") {
      upsert(g.items.flatMap((item) => {
        const logical = drafted.get(item.el);
        if (!logical) return [];
        const delta = { x: logical.rect.x - item.from.rect.x, y: logical.rect.y - item.from.rect.y };
        return [{ el: item.el, rect: logical.rect, original: logical.original, visual: translateRect(item.visual, delta.x, delta.y) }];
      }));
    } else {
      const logical = drafted.get(g.el);
      if (!logical) return;
      const shift = { x: g.visual.x - g.from.rect.x, y: g.visual.y - g.from.rect.y };
      upsert([{ el: g.el, rect: logical.rect, original: logical.original, visual: translateRect(logical.rect, shift.x, shift.y) }]);
    }
  };

  const cancelGesture = () => {
    if (!gesture.current) return false;
    gesture.current = null;
    setView(null);
    return true;
  };

  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    if (isFromSurface(event, surface) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const p = { x: event.clientX, y: event.clientY };
    const target = at(p.x, p.y);
    const owner = selectedOwner(target);
    gesture.current = { kind: "press", start: p, target, additive: event.shiftKey || event.metaKey || event.ctrlKey, onSelected: Boolean(owner) };
  });
  const onMove = useEffectEvent((event: PointerEvent) => onPointerMove(event));
  const onUp = useEffectEvent((event: PointerEvent) => {
    if (!gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    finish(event);
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (gesture.current || !selection.length) return;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableElement(realTarget(event))) return;
    const els = selection.filter((el) => el.isConnected);
    if (!els.length) return;
    const delta = rearrangeNudge(event.key, event.shiftKey);
    if (delta) {
      event.preventDefault();
      event.stopPropagation();
      upsert(els.map((el) => {
        const logical = logicalOf(el);
        const visual = toDoc(viewRect(el));
        return { el, rect: translateRect(logical.rect, delta.x, delta.y), original: logical.original, visual: translateRect(visual, delta.x, delta.y) };
      }));
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      upsert(els.map((el) => {
        const logical = logicalOf(el);
        return { el, rect: logical.rect, original: logical.original, visual: toDoc(viewRect(el)), removed: true };
      }));
      setSelection([]);
    }
  });
  const onScroll = useEffectEvent(() => redraw());

  useEffect(() => {
    const block = (event: Event) => {
      if (isFromSurface(event, surface)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const down = (event: PointerEvent) => onPointerDown(event);
    const move = (event: PointerEvent) => onMove(event);
    const up = (event: PointerEvent) => onUp(event);
    const key = (event: KeyboardEvent) => onKey(event);
    const scroll = () => onScroll();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    for (const type of BLOCKED) window.addEventListener(type, block, true);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [surface]);

  // Esc steps back: cancel a drag, then clear the selection; then the toolbar leaves the mode.
  const onEscape = useEffectEvent(() => {
    if (cancelGesture()) return true;
    if (selection.length) {
      setSelection([]);
      return true;
    }
    return false;
  });
  const { setEscape } = ctx;
  useEffect(() => {
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [setEscape]);

  // ---- Render ----
  const recordOf = new Map<Element, Annotation>();
  for (const a of records) {
    const el = elementFor(a);
    if (el) recordOf.set(el, a);
  }
  const boxes: OverlayBox[] = [];
  const seen = new Set<Element>();
  const boxFor = (el: Element, selected: boolean): OverlayBox => {
    const logical = view?.draft.get(el);
    const record = recordOf.get(el);
    let rect = viewRect(el);
    if (logical) {
      // Drafted boxes follow the drag exactly (the preview lands a frame later).
      const base = record?.rearrange ?? null;
      const from = base ? base.currentRect : logical.original;
      rect = { x: rect.x + (logical.rect.x - from.x), y: rect.y + (logical.rect.y - from.y), width: logical.rect.width, height: logical.rect.height };
    }
    const original = record?.rearrange?.originalRect ?? logical?.original;
    const current = logical?.rect ?? record?.rearrange?.currentRect;
    const ghost = original && current && !sameRect(original, current)
      ? { x: rect.x - (current.x - original.x), y: rect.y - (current.y - original.y), width: original.width, height: original.height }
      : undefined;
    return { key: record?.id ?? `sel-${selection.indexOf(el)}`, rect, ghost, selected, removed: Boolean(record?.rearrangeDetail?.removed) && !logical, name: identifyElement(el, ctx.attributeNames).name, element: el };
  };
  for (const el of selection) {
    if (!el.isConnected) continue;
    seen.add(el);
    boxes.push(boxFor(el, true));
  }
  for (const [el] of recordOf) if (!seen.has(el)) boxes.push(boxFor(el, false));
  const hoverBox = hover && !view && !selection.includes(hover) ? { rect: viewRect(hover), name: identifyElement(hover, ctx.attributeNames).name } : null;

  const rows: RearrangeRow[] = records.map((a) => ({
    id: a.id,
    label: a.rearrange!.label,
    summary: a.rearrangeDetail?.removed ? "removed" : undefined,
    annotation: a,
    found: Boolean(elementFor(a)),
    removed: Boolean(a.rearrangeDetail?.removed),
  }));
  const selectedName = selection.length > 1 ? `${selection.length} elements` : selection[0] ? identifyElement(selection[0], ctx.attributeNames).name : "";

  return (
    <>
      <RearrangeOverlay
        color={ctx.color}
        boxes={boxes}
        selectedCount={selection.length}
        hover={hoverBox}
        guides={view?.guides ?? []}
        lines={view?.lines ?? []}
        marquee={view?.marquee}
        onHandleDown={(el, handle, event) => {
          event.preventDefault();
          event.stopPropagation();
          startResize(el, handle, { x: event.clientX, y: event.clientY });
        }}
        onGripDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startMove({ x: event.clientX, y: event.clientY });
        }}
      />
      <RearrangePanel
        selectedName={selectedName}
        selectedCount={selection.length}
        rows={rows}
        onReset={resetRecord}
        onToggleRemoved={toggleRemoved}
        onSelect={selectRecord}
        onCopy={ctx.onCopy}
      />
    </>
  );
}
