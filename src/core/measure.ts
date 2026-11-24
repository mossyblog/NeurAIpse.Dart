import type { SpacingRegion } from "./spacing.ts";
import type { Rect } from "./types.ts";

/**
 * Two-click guides and measure lines (inspector spec 3.4). Pure: inputs are viewport
 * rects, outputs are segments the overlay draws as-is.
 */

export type Segment = { x1: number; y1: number; x2: number; y2: number };

export type GuideOrientation = "vertical" | "horizontal";

export type Guide = {
  orientation: GuideOrientation;
  /** Full-viewport lines at both edges of the region (they coincide for zero thickness). */
  lines: Segment[];
  /** Region thickness label, placed at `labelAt`. */
  label: string;
  labelAt: { x: number; y: number };
};

/** Vertical guides for left/right/column regions, horizontal for top/bottom/row. */
export function guideOrientation(side: SpacingRegion<unknown>["side"]): GuideOrientation {
  return side === "left" || side === "right" || side === "column" ? "vertical" : "horizontal";
}

export function guideFor(region: Pick<SpacingRegion<unknown>, "side" | "rect" | "value">, viewport: { width: number; height: number }): Guide {
  const orientation = guideOrientation(region.side);
  const r = region.rect;
  const label = String(Math.round(region.value * 100) / 100);
  if (orientation === "vertical") {
    const xs = r.width > 0 ? [r.x, r.x + r.width] : [r.x];
    return {
      orientation,
      lines: xs.map((x) => ({ x1: x, y1: 0, x2: x, y2: viewport.height })),
      label,
      labelAt: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    };
  }
  const ys = r.height > 0 ? [r.y, r.y + r.height] : [r.y];
  return {
    orientation,
    lines: ys.map((y) => ({ x1: 0, y1: y, x2: viewport.width, y2: y })),
    label,
    labelAt: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
  };
}

export type MeasureCase = "disjoint" | "offset" | "inside" | "overlap" | "same-edge";

export type MeasureLine = {
  axis: "x" | "y";
  /** Solid measure segment (zero length for `same-edge`). */
  line: Segment;
  /** Signed distance: gap or inset >= 0, overlap < 0. */
  distance: number;
  label: string;
  /** Dashed support lines from a box that does not line up with the measure line. */
  extensions: Segment[];
  case: MeasureCase;
};

export type Measurement = { case: MeasureCase; lines: MeasureLine[] };

type Interval = { start: number; end: number };
const iv = (r: Rect, axis: "x" | "y"): Interval =>
  axis === "x" ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height };
const EPS = 0.01;
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const mid = (i: Interval) => (i.start + i.end) / 2;
const within = (inner: Interval, outer: Interval) => inner.start >= outer.start - EPS && inner.end <= outer.end + EPS;

/** Places a segment on `axis` from `from` to `to` at cross position `at`. */
function seg(axis: "x" | "y", from: number, to: number, at: number): Segment {
  return axis === "x" ? { x1: from, y1: at, x2: to, y2: at } : { x1: at, y1: from, x2: at, y2: to };
}

/**
 * Cross position of a measure line and the dashed extensions it needs. When the cross
 * ranges overlap, the line runs through the middle of the overlap and needs none.
 * Otherwise it runs through the smaller box's centre and a dashed line joins the other
 * box's near edge (at `otherEdge` on the measure axis) to the line.
 */
function crossPlacement(axis: "x" | "y", a: Rect, b: Rect, aEdge: number, bEdge: number): { at: number; extensions: Segment[] } {
  const crossAxis = axis === "x" ? "y" : "x";
  const ca = iv(a, crossAxis);
  const cb = iv(b, crossAxis);
  const lo = Math.max(ca.start, cb.start);
  const hi = Math.min(ca.end, cb.end);
  if (hi - lo > EPS) return { at: (lo + hi) / 2, extensions: [] };
  const sizeA = ca.end - ca.start;
  const sizeB = cb.end - cb.start;
  const smallIsA = sizeA <= sizeB;
  const at = mid(smallIsA ? ca : cb);
  const other = smallIsA ? cb : ca;
  const edge = smallIsA ? bEdge : aEdge;
  const near = at < other.start ? other.start : other.end;
  // Dashed line along the cross axis, at the other box's edge on the measure axis.
  const extension = crossAxis === "y" ? { x1: edge, y1: near, x2: edge, y2: at } : { x1: near, y1: edge, x2: at, y2: edge };
  return { at, extensions: [extension] };
}

/**
 * Measure between two boxes (spec 3.4): disjoint axes give gap lines (with dashed
 * extensions when offset), containment gives inset lines per side, partial overlap
 * gives a negative overlap line, touching edges give a `0` label with no line.
 */
export function measureBetween(a: Rect, b: Rect): Measurement {
  const lines: MeasureLine[] = [];
  const contained = (within(iv(b, "x"), iv(a, "x")) && within(iv(b, "y"), iv(a, "y")))
    || (within(iv(a, "x"), iv(b, "x")) && within(iv(a, "y"), iv(b, "y")));
  if (contained) {
    const [outer, inner] = within(iv(b, "x"), iv(a, "x")) && within(iv(b, "y"), iv(a, "y")) ? [a, b] : [b, a];
    for (const axis of ["x", "y"] as const) {
      const o = iv(outer, axis);
      const n = iv(inner, axis);
      const at = mid(iv(inner, axis === "x" ? "y" : "x"));
      for (const [from, to] of [[o.start, n.start], [n.end, o.end]] as const) {
        const distance = to - from;
        if (distance <= EPS) continue;
        lines.push({ axis, line: seg(axis, from, to, at), distance, label: fmt(distance), extensions: [], case: "inside" });
      }
    }
    return { case: "inside", lines };
  }
  let disjoint = false;
  let offset = false;
  let sameEdge = false;
  for (const axis of ["x", "y"] as const) {
    const ia = iv(a, axis);
    const ib = iv(b, axis);
    const [first, second, firstRect, secondRect] = ia.start <= ib.start ? [ia, ib, a, b] : [ib, ia, b, a];
    const gap = second.start - first.end;
    if (Math.abs(gap) <= EPS) {
      sameEdge = true;
      const p = first.end;
      lines.push({ axis, line: seg(axis, p, p, p), distance: 0, label: "0", extensions: [], case: "same-edge" });
    } else if (gap > 0) {
      disjoint = true;
      const { at, extensions } = crossPlacement(axis, firstRect, secondRect, first.end, second.start);
      if (extensions.length) offset = true;
      lines.push({ axis, line: seg(axis, first.end, second.start, at), distance: gap, label: fmt(gap), extensions, case: extensions.length ? "offset" : "disjoint" });
    }
  }
  if (disjoint || sameEdge) {
    // A touching edge only matters when the boxes are not apart on the other axis.
    const kept = disjoint ? lines.filter((l) => l.case !== "same-edge") : lines;
    return { case: disjoint ? (offset ? "offset" : "disjoint") : "same-edge", lines: kept };
  }
  // Partial overlap on both axes.
  for (const axis of ["x", "y"] as const) {
    const ia = iv(a, axis);
    const ib = iv(b, axis);
    const lo = Math.max(ia.start, ib.start);
    const hi = Math.min(ia.end, ib.end);
    const size = hi - lo;
    if (size <= EPS) continue;
    // Skip the axis where one range contains the other: there is no overlap edge pair.
    if (within(ia, ib) || within(ib, ia)) continue;
    const cross = axis === "x" ? "y" : "x";
    const cl = Math.max(iv(a, cross).start, iv(b, cross).start);
    const ch = Math.min(iv(a, cross).end, iv(b, cross).end);
    lines.push({ axis, line: seg(axis, lo, hi, (cl + ch) / 2), distance: -size, label: `-${fmt(size)}`, extensions: [], case: "overlap" });
  }
  return { case: "overlap", lines };
}

/** The headline distance of a measurement (first line), for labels and records. */
export function primaryDistance(m: Measurement): number {
  return m.lines[0]?.distance ?? 0;
}
