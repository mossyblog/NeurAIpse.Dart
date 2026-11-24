import { measureBetween, type MeasureLine } from "./measure.ts";
import type { Point, Rect } from "./types.ts";

/**
 * Rearrange mode geometry (parity spec 10.2): pure rect maths for move, resize, nudge,
 * axis constraint, snapping to sibling edges and centres, and the nearest-sibling
 * relationship written to the output. No DOM access.
 */

export type RearrangeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const REARRANGE_HANDLES: readonly RearrangeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Smallest previewed size, per side, in px. */
export const REARRANGE_MIN_SIZE = 8;
/** Pointer travel (px) before a press becomes a drag, so Shift-click still toggles. */
export const REARRANGE_DRAG_THRESHOLD = 4;
/** Snap distance (px) to a sibling edge or centre. */
export const REARRANGE_SNAP = 4;
/** Arrow-key nudge: 8px, Shift 1px. */
export const REARRANGE_NUDGE = 8;
export const REARRANGE_NUDGE_FINE = 1;

export const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

export function sameRect(a: Rect, b: Rect): boolean {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

/** Shift while moving: keep the dominant axis only. */
export function constrainAxis(dx: number, dy: number): Point {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };
}

/** True once the pointer left the press point by more than the drag threshold. */
export function pastThreshold(start: Point, p: Point, threshold = REARRANGE_DRAG_THRESHOLD): boolean {
  return Math.abs(p.x - start.x) > threshold || Math.abs(p.y - start.y) > threshold;
}

/**
 * Resizes from one handle by a pointer delta. The opposite edge stays put; a size never
 * drops below `min`. `keepAspect` (Shift on a corner) scales both sides together.
 */
export function resizeFromHandle(r: Rect, handle: RearrangeHandle, dx: number, dy: number, options: { min?: number; keepAspect?: boolean } = {}): Rect {
  const min = options.min ?? REARRANGE_MIN_SIZE;
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - min);
  if (handle.includes("e")) right = Math.max(right + dx, left + min);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - min);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + min);
  let width = right - left;
  let height = bottom - top;
  if (options.keepAspect && handle.length === 2 && r.width > 0 && r.height > 0) {
    const scale = Math.max(width / r.width, height / r.height);
    width = Math.max(min, r.width * scale);
    height = Math.max(min, r.height * scale);
    if (handle.includes("w")) left = r.x + r.width - width;
    if (handle.includes("n")) top = r.y + r.height - height;
  }
  return { x: left, y: top, width, height };
}

/** Arrow key to a nudge delta, or null for other keys. */
export function rearrangeNudge(key: string, fine: boolean): Point | null {
  const step = fine ? REARRANGE_NUDGE_FINE : REARRANGE_NUDGE;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}

/** A snap guide: an aligned line across the moving box and the sibling it snapped to. */
export type SnapGuide = { axis: "x" | "y"; pos: number; from: number; to: number };

type Edges = { start: number; mid: number; end: number };
const edges = (r: Rect, axis: "x" | "y"): Edges =>
  axis === "x" ? { start: r.x, mid: r.x + r.width / 2, end: r.x + r.width } : { start: r.y, mid: r.y + r.height / 2, end: r.y + r.height };

/**
 * Snaps a moving (or resizing) box to sibling edges and centres. `moving` lists which of
 * the box's lines may snap per axis (all three for a move, the dragged edge for a resize).
 * Returns the offset to add on each axis and the guides for every line that aligned.
 */
export function snapRect(
  rect: Rect,
  targets: readonly Rect[],
  options: { distance?: number; lines?: { x: (keyof Edges)[]; y: (keyof Edges)[] } } = {},
): { dx: number; dy: number; guides: SnapGuide[] } {
  const distance = options.distance ?? REARRANGE_SNAP;
  const lines = options.lines ?? { x: ["start", "mid", "end"], y: ["start", "mid", "end"] };
  const offset = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const own = edges(rect, axis);
    let best: number | null = null;
    for (const target of targets) {
      const t = edges(target, axis);
      for (const line of lines[axis]) {
        for (const value of [t.start, t.mid, t.end]) {
          const d = value - own[line];
          if (Math.abs(d) <= distance && (best == null || Math.abs(d) < Math.abs(best))) best = d;
        }
      }
    }
    if (best != null) offset[axis] = best;
  }
  const snapped = { x: rect.x + offset.x, y: rect.y + offset.y, width: rect.width, height: rect.height };
  const guides: SnapGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    if (!lines[axis].length) continue;
    const own = edges(snapped, axis);
    const cross = axis === "x" ? "y" : "x";
    for (const target of targets) {
      const t = edges(target, axis);
      for (const line of lines[axis]) {
        const pos = own[line];
        if (![t.start, t.mid, t.end].some((v) => Math.abs(v - pos) < 0.5)) continue;
        const a = edges(snapped, cross);
        const b = edges(target, cross);
        const guide = { axis, pos, from: Math.min(a.start, b.start), to: Math.max(a.end, b.end) };
        if (!guides.some((g) => g.axis === guide.axis && Math.abs(g.pos - guide.pos) < 0.5 && g.from === guide.from && g.to === guide.to)) guides.push(guide);
      }
    }
  }
  return { dx: offset.x, dy: offset.y, guides };
}

/** Which lines of a box move with a resize handle (the dragged edges snap, nothing else). */
export function resizeSnapLines(handle: RearrangeHandle): { x: ("start" | "end")[]; y: ("start" | "end")[] } {
  return {
    x: handle.includes("w") ? ["start"] : handle.includes("e") ? ["end"] : [],
    y: handle.includes("n") ? ["start"] : handle.includes("s") ? ["end"] : [],
  };
}

/**
 * Applies a snap result to a resize: the dragged edge takes the offset, the opposite edge
 * stays. Width / height never drop below `min`.
 */
export function applyResizeSnap(r: Rect, handle: RearrangeHandle, dx: number, dy: number, min = REARRANGE_MIN_SIZE): Rect {
  let { x, y, width, height } = r;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  } else if (handle.includes("e")) width += dx;
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  } else if (handle.includes("s")) height += dy;
  if (width < min || height < min) return r;
  return { x, y, width, height };
}

/** Relationship of a moved box to its nearest sibling (or its parent), stored on the record. */
export type RearrangeRelation = {
  label: string;
  /** `below`, `above`, `left of`, `right of`, `overlapping`, or `inside` (the parent). */
  relation: "below" | "above" | "left of" | "right of" | "overlapping" | "inside";
  /** Gap in px for the four directions; for `inside`, the left and top offsets. */
  distance: number;
  offset?: { left: number; top: number };
};

/**
 * Nearest sibling by edge distance (measure spec 3.4 geometry), else the position inside
 * the parent. Null when there is neither.
 */
export function nearestRelation(rect: Rect, siblings: readonly { label: string; rect: Rect }[], parent?: { label: string; rect: Rect }): RearrangeRelation | null {
  let best: { label: string; rect: Rect; d: number } | null = null;
  for (const s of siblings) {
    if (s.rect.width === 0 && s.rect.height === 0) continue;
    const [gx, gy] = axisGaps(rect, s.rect);
    const gap = Math.hypot(Math.max(0, gx), Math.max(0, gy));
    if (!best || gap < best.d) best = { label: s.label, rect: s.rect, d: gap };
  }
  if (best) {
    const [gx, gy] = axisGaps(rect, best.rect);
    if (gx <= 0 && gy <= 0) return { label: best.label, relation: "overlapping", distance: 0 };
    if (gy >= gx) {
      const below = rect.y >= best.rect.y + best.rect.height - 0.5;
      return { label: best.label, relation: below ? "below" : "above", distance: Math.round(gy) };
    }
    const right = rect.x >= best.rect.x + best.rect.width - 0.5;
    return { label: best.label, relation: right ? "right of" : "left of", distance: Math.round(gx) };
  }
  if (parent) {
    return { label: parent.label, relation: "inside", distance: 0, offset: { left: Math.round(rect.x - parent.rect.x), top: Math.round(rect.y - parent.rect.y) } };
  }
  return null;
}

/** Edge gaps on x and y (negative when the ranges overlap). */
function axisGaps(a: Rect, b: Rect): [number, number] {
  const gx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return [gx, gy];
}

/**
 * Distance pills while dragging: the measure lines (measure spec 3.4) from the moving box
 * to the closest sibling above/below and left/right of it. At most one line per axis.
 */
export function distanceLines(rect: Rect, siblings: readonly Rect[]): MeasureLine[] {
  const best: Partial<Record<"x" | "y", MeasureLine>> = {};
  for (const s of siblings) {
    for (const line of measureBetween(rect, s).lines) {
      if (line.case !== "disjoint" && line.case !== "offset") continue;
      const current = best[line.axis];
      if (!current || line.distance < current.distance) best[line.axis] = line;
    }
  }
  return [best.x, best.y].filter((l): l is MeasureLine => Boolean(l));
}
