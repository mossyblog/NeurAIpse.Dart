/**
 * Same-origin iframe geometry. A transform maps a point in a frame's viewport to its
 * parent's viewport: `parent = origin + child * scale`. Borders, padding and
 * axis-aligned CSS scaling are included; rotation and skew are not supported.
 * Child scroll needs no term, since child rects are already in child viewport px.
 */
import type { Annotation, Point, Rect } from "./types.ts";

export type FrameTransform = { x: number; y: number; scaleX: number; scaleY: number };

export const IDENTITY: FrameTransform = Object.freeze({ x: 0, y: 0, scaleX: 1, scaleY: 1 });

export type FrameMetrics = {
  /** `getBoundingClientRect()` of the frame element in its parent viewport (scaled). */
  rect: Rect;
  /** Unscaled layout size, border box (`offsetWidth` / `offsetHeight`). */
  offsetWidth: number;
  offsetHeight: number;
  /** Unscaled computed border and padding widths, px. */
  borderLeft: number;
  borderTop: number;
  paddingLeft: number;
  paddingTop: number;
};

export function frameContentTransform(metrics: FrameMetrics): FrameTransform {
  const scaleX = metrics.offsetWidth > 0 ? metrics.rect.width / metrics.offsetWidth : 1;
  const scaleY = metrics.offsetHeight > 0 ? metrics.rect.height / metrics.offsetHeight : 1;
  return {
    x: metrics.rect.x + (metrics.borderLeft + metrics.paddingLeft) * scaleX,
    y: metrics.rect.y + (metrics.borderTop + metrics.paddingTop) * scaleY,
    scaleX,
    scaleY,
  };
}

/** `outer ∘ inner`: maps the inner frame's viewport straight to the outer frame's parent. */
export function composeTransforms(outer: FrameTransform, inner: FrameTransform): FrameTransform {
  return {
    x: outer.x + inner.x * outer.scaleX,
    y: outer.y + inner.y * outer.scaleY,
    scaleX: outer.scaleX * inner.scaleX,
    scaleY: outer.scaleY * inner.scaleY,
  };
}

export function applyToPoint(t: FrameTransform, p: Point): Point {
  return { x: t.x + p.x * t.scaleX, y: t.y + p.y * t.scaleY };
}

export function applyToRect(t: FrameTransform, r: Rect): Rect {
  return { x: t.x + r.x * t.scaleX, y: t.y + r.y * t.scaleY, width: r.width * t.scaleX, height: r.height * t.scaleY };
}

export function invertPoint(t: FrameTransform, p: Point): Point {
  return { x: (p.x - t.x) / (t.scaleX || 1), y: (p.y - t.y) / (t.scaleY || 1) };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export type FramePathEntry = NonNullable<Annotation["frame"]>["path"][number];

/* ---------------- DOM helpers (any window, including jsdom) ---------------- */

const FRAME_SELECTOR = "iframe, frame";

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function readFrameMetrics(frame: HTMLElement): FrameMetrics {
  const r = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  return {
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    offsetWidth: frame.offsetWidth,
    offsetHeight: frame.offsetHeight,
    borderLeft: px(style?.borderLeftWidth ?? "0"),
    borderTop: px(style?.borderTopWidth ?? "0"),
    paddingLeft: px(style?.paddingLeft ?? "0"),
    paddingTop: px(style?.paddingTop ?? "0"),
  };
}

/** Frame elements from the node's own frame up to the top document (innermost first). */
export function frameElementsOf(node: Node): HTMLElement[] {
  const frames: HTMLElement[] = [];
  let win: Window | null = (node.ownerDocument ?? (node as Document)).defaultView;
  while (win) {
    let frame: Element | null = null;
    try {
      frame = win.frameElement;
    } catch {
      frame = null;
    }
    if (!frame) break;
    frames.push(frame as HTMLElement);
    win = frame.ownerDocument.defaultView;
  }
  return frames;
}

/** Same-origin content document of a frame element, or null (cross-origin, not loaded). */
export function frameDocument(frame: Element): Document | null {
  try {
    return (frame as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    return null;
  }
}

export type FrameGeometry = {
  /** Node's viewport -> top viewport. */
  transform: FrameTransform;
  /** Part of the top viewport where the node's frame content is visible, or null. */
  clip: Rect | null;
  /** Innermost first. */
  frames: HTMLElement[];
};

/** Transform and visible clip from a node's document to the top viewport. */
export function frameGeometry(node: Node): FrameGeometry {
  const frames = frameElementsOf(node);
  let transform: FrameTransform = IDENTITY;
  let clip: Rect | null = null;
  // Walk outward: each step maps the accumulated (inner) geometry into the next parent.
  for (const frame of frames) {
    const local = frameContentTransform(readFrameMetrics(frame));
    const doc = frameDocument(frame);
    const view = doc?.defaultView;
    const viewport: Rect = {
      x: local.x,
      y: local.y,
      width: (view?.innerWidth ?? frame.clientWidth) * local.scaleX,
      height: (view?.innerHeight ?? frame.clientHeight) * local.scaleY,
    };
    clip = clip ? intersectRects(viewport, applyToRect(local, clip)) : viewport;
    transform = composeTransforms(local, transform);
    if (!clip) break;
  }
  if (frames.length > 0) {
    const top = frames[frames.length - 1].ownerDocument.defaultView;
    const topViewport: Rect = { x: 0, y: 0, width: top?.innerWidth ?? 0, height: top?.innerHeight ?? 0 };
    clip = clip ? intersectRects(clip, topViewport) : null;
  }
  return { transform, clip, frames };
}

/** Viewport rect of an element in top-viewport px, through any same-origin frames. */
export function topRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  return frameElementsOf(el).length ? applyToRect(frameGeometry(el).transform, rect) : rect;
}

/** `frame.path`: outermost first, `index` among the parent document's frames. */
export function framePathFor(node: Node): FramePathEntry[] {
  return frameElementsOf(node)
    .reverse()
    .map((frame) => {
      const siblings = Array.from(frame.ownerDocument.querySelectorAll(FRAME_SELECTOR));
      const doc = frameDocument(frame);
      const entry: FramePathEntry = { index: siblings.indexOf(frame), url: doc?.location.href ?? frame.getAttribute("src") ?? "" };
      const id = frame.getAttribute("id");
      if (id) entry.id = id;
      return entry;
    });
}

/**
 * Re-finds the document a frame path points at. Matches by id when recorded, else by
 * index, and requires the same URL, so a navigated frame resolves to null.
 */
export function resolveFramePath(top: Document, path: readonly FramePathEntry[]): Document | null {
  let doc: Document | null = top;
  for (const entry of path) {
    if (!doc) return null;
    const frames = Array.from(doc.querySelectorAll(FRAME_SELECTOR));
    const frame = (entry.id ? frames.find((f) => f.getAttribute("id") === entry.id) : undefined) ?? frames[entry.index];
    if (!frame) return null;
    const next = frameDocument(frame);
    if (!next || next.location.href !== entry.url) return null;
    doc = next;
  }
  return doc;
}

/** Every same-origin frame window under a document, depth first. */
export function collectFrameWindows(doc: Document, limit = 32): Window[] {
  const result: Window[] = [];
  const visit = (current: Document) => {
    for (const frame of Array.from(current.querySelectorAll(FRAME_SELECTOR))) {
      if (result.length >= limit) return;
      const child = frameDocument(frame);
      const view = child?.defaultView;
      if (!child || !view) continue;
      result.push(view);
      visit(child);
    }
  };
  visit(doc);
  return result;
}
