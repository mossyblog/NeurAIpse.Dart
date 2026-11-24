/**
 * Pure selection geometry: gesture classification, area hit-testing, multi-select
 * grouping and marker tracking. No DOM access; callers pass rects and captures.
 */
import { collapseWhitespace, truncate } from "./dom.ts";
import type { Annotation, Point, Rect } from "./types.ts";

/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 8;
/** Fraction of an element's area that must lie inside a drawn region to select it. */
export const AREA_COVERAGE = 0.5;
/** Most elements one area drag can select. */
export const AREA_LIMIT = 50;
/** Longest selectedText kept on an annotation. */
export const SELECTED_TEXT_LIMIT = 500;

export type Gesture = "click" | "text" | "area" | "multi" | "none";

export type GestureInput = {
  start: Point;
  end: Point;
  /** Cmd or Ctrl was held when the press started. */
  modifier: boolean;
  /** The press started over rendered text, so the browser owns the drag (selection). */
  startedOnText: boolean;
  /** The document selection is non-empty after release. */
  hasSelection: boolean;
};

export function isDrag(start: Point, end: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold;
}

/**
 * What a press-and-release means. Cmd/Ctrl adds to a multi-select. A press over text
 * belongs to native selection (a text annotation when text ends up selected). A drag
 * from anywhere else draws an area. A short press is a click.
 */
export function classifyGesture(input: GestureInput): Gesture {
  if (input.modifier) return "multi";
  const dragged = isDrag(input.start, input.end);
  if (input.startedOnText) {
    if (input.hasSelection) return "text";
    return dragged ? "none" : "click";
  }
  return dragged ? "area" : "click";
}

/** The rectangle spanned by two corner points. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Share of `rect` covered by `region`, 0..1. Empty rects score 0. */
export function coverage(region: Rect, rect: Rect): number {
  const area = rect.width * rect.height;
  return area > 0 ? intersectionArea(region, rect) / area : 0;
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export type AreaPickOptions = {
  /** Where the drag started. Elements under it are the surface being drawn on, not targets. */
  start?: Point;
  /** Extra rejection, checked only for elements that pass coverage (e.g. occluded ones). */
  exclude?: (index: number) => boolean;
  limit?: number;
};

/**
 * Indices of the elements a drawn region selects: those at least `AREA_COVERAGE` inside
 * it, keeping only the outermost (a selected element's descendants are dropped).
 * Elements containing the drag start are skipped, so drawing inside a container selects
 * its children rather than the container. `rects` must be in document order;
 * `isInside(child, ancestor)` reports containment.
 */
export function pickAreaTargets(
  region: Rect,
  rects: readonly Rect[],
  isInside: (child: number, ancestor: number) => boolean,
  options: AreaPickOptions = {},
): number[] {
  const limit = options.limit ?? AREA_LIMIT;
  const picked: number[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    if (coverage(region, rects[i]) < AREA_COVERAGE) continue;
    if (options.start && containsPoint(rects[i], options.start)) continue;
    if (options.exclude?.(i)) continue;
    if (picked.some((ancestor) => isInside(i, ancestor))) continue;
    picked.push(i);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Smallest rect containing every input rect, or null for an empty list. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Adds the item, or removes it when already present (Cmd/Ctrl+click toggles). */
export function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

/** Popup header and element name for a group. */
export function groupLabel(count: number): string {
  return `${count} elements`;
}

/** Element name for a drawn region that contains no element. */
export function areaLabel(region: Rect): string {
  return `area ${Math.round(region.width)}×${Math.round(region.height)}`;
}

/** 1-based sequence number for the next area drawing on a route. */
export function nextDrawingIndex(annotations: readonly Pick<Annotation, "drawingIndex">[]): number {
  let max = 0;
  for (const a of annotations) if (typeof a.drawingIndex === "number") max = Math.max(max, a.drawingIndex);
  return max + 1;
}

/** Whitespace-collapsed selection text, capped at `SELECTED_TEXT_LIMIT`. */
export function normalizeSelectedText(text: string): string {
  return truncate(collapseWhitespace(text), SELECTED_TEXT_LIMIT);
}

type Capture = Omit<Annotation, "id" | "comment" | "timestamp">;

/**
 * Combines per-element captures into one multi-select annotation. Forensic fields come
 * from the first element; geometry is a snapshot of every element plus their union.
 * `marker` is the annotation point already converted with `markerPosition`.
 */
export function buildGroupCapture(
  captures: readonly Capture[],
  marker: Point,
  extra: Partial<Capture> = {},
): Capture {
  const [first] = captures;
  if (!first) throw new Error("buildGroupCapture needs at least one capture");
  const boxes = captures.map((c) => c.boundingBox).filter((box): box is Rect => Boolean(box));
  const attributes: Record<string, string> = {};
  for (const c of captures) {
    for (const [key, value] of Object.entries(c.attributes ?? {})) {
      if (!(key in attributes)) attributes[key] = value;
    }
  }
  const group: Capture = {
    ...first,
    x: marker.x,
    y: marker.y,
    element: captures.length > 1 ? groupLabel(captures.length) : first.element,
    elementPath: captures.map((c) => c.elementPath).join(", "),
    boundingBox: unionRect(boxes) ?? first.boundingBox,
    elementBoundingBoxes: boxes,
    ...extra,
  };
  if (captures.length > 1) group.isMultiSelect = true;
  else delete group.isMultiSelect;
  if (captures.every((c) => c.isFixed)) group.isFixed = true;
  else delete group.isFixed;
  if (Object.keys(attributes).length > 0) group.attributes = attributes;
  else delete group.attributes;
  return group;
}

/** Marker position inside its element, as fractions of the element box (0..1). */
export type MarkerAnchor = { fx: number; fy: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Where a saved marker sits relative to its element's saved bounding box. Returns null
 * for snapshots (groups, areas) and annotations without geometry, which never track.
 */
export function markerAnchor(
  annotation: Pick<Annotation, "x" | "y" | "boundingBox" | "isMultiSelect" | "drawingIndex">,
  viewportWidth: number,
): MarkerAnchor | null {
  const box = annotation.boundingBox;
  if (!box || annotation.isMultiSelect || annotation.drawingIndex != null) return null;
  const px = (annotation.x / 100) * viewportWidth;
  return {
    fx: box.width > 0 ? clamp01((px - box.x) / box.width) : 0.5,
    fy: box.height > 0 ? clamp01((annotation.y - box.y) / box.height) : 0.5,
  };
}

/** Marker point (page px, or viewport px for fixed elements) on an element's current box. */
export function placeOnRect(box: Rect, anchor: MarkerAnchor): Point {
  return { x: box.x + anchor.fx * box.width, y: box.y + anchor.fy * box.height };
}
