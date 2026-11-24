import type { Point, Rect } from "./types.ts";

/**
 * Spacing inspector geometry (inspector spec section 3). Pure functions over rects and
 * numbers; the DOM readers in `spacing-dom.ts` feed them. All rects are viewport px.
 */

export type SpacingKind = "margin" | "padding" | "gap";
export type SpacingSide = "top" | "right" | "bottom" | "left" | "row" | "column";
export type BoxSide = "top" | "right" | "bottom" | "left";

export type SpacingRegion<E = Element> = {
  kind: SpacingKind;
  side: SpacingSide;
  /** Drawn rect, viewport coordinates. Zero thickness when the value is <= 0. */
  rect: Rect;
  /** Real computed value in px (negative margins stay negative). */
  value: number;
  element: E;
  /** Gap only: space actually measured between the neighbouring boxes, when it differs. */
  measured?: number;
  /** Gap only: position of the band among its siblings, for stable identity across redraws. */
  index?: number;
  /** Notes shown in the label: `scaled ×0.5`, `approximate`, `may collapse`, `clamped`. */
  flags?: string[];
};

export type Sides = { top: number; right: number; bottom: number; left: number };

export type BoxMetrics = {
  margin: Sides;
  padding: Sides;
  border: Sides;
};

/** Drawing scale per axis: rendered px per CSS px (from transforms or zoom). */
export type Scale = { x: number; y: number };

export const BOX_SIDES: readonly BoxSide[] = ["top", "right", "bottom", "left"];
export const ZERO_SIDES: Sides = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/** Zero-area regions and boxes are picked when the pointer is this close (spec 3.5). */
export const SNAP_DISTANCE = 8;

/** Parses a computed px length; anything unparsable is 0. */
export function parsePx(value: string | null | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** CSS property name for a region, e.g. `padding-top`, `row-gap`. */
export function regionProperty(region: Pick<SpacingRegion<unknown>, "kind" | "side">): string {
  if (region.kind === "gap") return region.side === "row" ? "row-gap" : "column-gap";
  return `${region.kind}-${region.side}`;
}

/** Same element, kind, side and gap index: the identity kept across redraws. */
export function sameRegion<E>(a: SpacingRegion<E> | null | undefined, b: SpacingRegion<E> | null | undefined): boolean {
  if (!a || !b) return false;
  return a.element === b.element && a.kind === b.kind && a.side === b.side && (a.index ?? 0) === (b.index ?? 0);
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function insetRect(r: Rect, s: Sides): Rect {
  return {
    x: r.x + s.left,
    y: r.y + s.top,
    width: Math.max(0, r.width - s.left - s.right),
    height: Math.max(0, r.height - s.top - s.bottom),
  };
}

function scaled(s: Sides, scale: Scale): Sides {
  return { top: s.top * scale.y, right: s.right * scale.x, bottom: s.bottom * scale.y, left: s.left * scale.x };
}

function clamp0(s: Sides): Sides {
  return { top: Math.max(0, s.top), right: Math.max(0, s.right), bottom: Math.max(0, s.bottom), left: Math.max(0, s.left) };
}

/** Four strips between an outer and an inner rect (the inner is `outer` inset by `t`). */
function strips(outer: Rect, t: Sides): Record<BoxSide, Rect> {
  const right = outer.x + outer.width;
  const bottom = outer.y + outer.height;
  return {
    top: { x: outer.x, y: outer.y, width: outer.width, height: t.top },
    bottom: { x: outer.x, y: bottom - t.bottom, width: outer.width, height: t.bottom },
    left: { x: outer.x, y: outer.y + t.top, width: t.left, height: Math.max(0, outer.height - t.top - t.bottom) },
    right: { x: right - t.right, y: outer.y + t.top, width: t.right, height: Math.max(0, outer.height - t.top - t.bottom) },
  };
}

/** Padding box (border box inset by borders) and content box, in drawn px. */
export function boxRects(border: Rect, metrics: BoxMetrics, scale: Scale = { x: 1, y: 1 }) {
  const paddingBox = insetRect(border, scaled(metrics.border, scale));
  const contentBox = insetRect(paddingBox, clamp0(scaled(metrics.padding, scale)));
  const t = clamp0(scaled(metrics.margin, scale));
  const marginBox = { x: border.x - t.left, y: border.y - t.top, width: border.width + t.left + t.right, height: border.height + t.top + t.bottom };
  return { border, paddingBox, contentBox, marginBox };
}

/** Label notes for a transform: `scaled ×0.5` and `approximate` for rotation or skew. */
export function transformFlags(scale: Scale, rotatedOrSkewed = false): string[] {
  const flags: string[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  if (Math.abs(scale.x - 1) > 0.01 || Math.abs(scale.y - 1) > 0.01) {
    flags.push(round(scale.x) === round(scale.y) ? `scaled ×${round(scale.x)}` : `scaled ×${round(scale.x)}/${round(scale.y)}`);
  }
  if (rotatedOrSkewed) flags.push("approximate");
  return flags;
}

/**
 * Margin and padding regions for one block-level box. Thickness is the computed value
 * times the drawing scale; negative margins draw at zero thickness but keep `value`.
 */
export function boxRegions<E>(
  border: Rect,
  metrics: BoxMetrics,
  element: E,
  options: { scale?: Scale; flags?: string[]; marginFlags?: Partial<Record<BoxSide, string[]>> } = {},
): SpacingRegion<E>[] {
  const scale = options.scale ?? { x: 1, y: 1 };
  const flags = options.flags ?? [];
  const { paddingBox } = boxRects(border, metrics, scale);
  const pad = strips(paddingBox, clamp0(scaled(metrics.padding, scale)));
  const t = clamp0(scaled(metrics.margin, scale));
  const right = border.x + border.width;
  const bottom = border.y + border.height;
  const margin: Record<BoxSide, Rect> = {
    top: { x: border.x - t.left, y: border.y - t.top, width: border.width + t.left + t.right, height: t.top },
    bottom: { x: border.x - t.left, y: bottom, width: border.width + t.left + t.right, height: t.bottom },
    left: { x: border.x - t.left, y: border.y, width: t.left, height: border.height },
    right: { x: right, y: border.y, width: t.right, height: border.height },
  };
  const regions: SpacingRegion<E>[] = [];
  for (const side of BOX_SIDES) {
    const value = metrics.margin[side];
    const extra = [...flags, ...(options.marginFlags?.[side] ?? [])];
    if (value < 0) extra.push("clamped");
    regions.push(withFlags({ kind: "margin", side, rect: margin[side], value, element }, extra));
  }
  for (const side of BOX_SIDES) {
    regions.push(withFlags({ kind: "padding", side, rect: pad[side], value: metrics.padding[side], element }, flags));
  }
  return regions;
}

function withFlags<E>(region: SpacingRegion<E>, flags: string[]): SpacingRegion<E> {
  return flags.length > 0 ? { ...region, flags: [...flags] } : region;
}

/**
 * Inline boxes (spec 3.5): one fragment rect per line box from `getClientRects()`.
 * Horizontal margin and padding belong to the first (left) and last (right) fragment;
 * vertical padding paints on every fragment; vertical margins do not apply and are skipped.
 */
export function inlineRegions<E>(
  fragments: readonly Rect[],
  metrics: BoxMetrics,
  element: E,
  options: { scale?: Scale; flags?: string[]; rtl?: boolean } = {},
): SpacingRegion<E>[] {
  if (fragments.length === 0) return [];
  const scale = options.scale ?? { x: 1, y: 1 };
  const flags = options.flags ?? [];
  const regions: SpacingRegion<E>[] = [];
  const first = fragments[0];
  const last = fragments[fragments.length - 1];
  // margin/padding-left and -right are physical: in rtl the first fragment is the rightmost.
  const leftBox = options.rtl ? last : first;
  const rightBox = options.rtl ? first : last;
  const p = clamp0(scaled(metrics.padding, scale));
  const b = scaled(metrics.border, scale);
  const m = clamp0(scaled(metrics.margin, scale));
  regions.push(withFlags({ kind: "margin", side: "left", rect: { x: leftBox.x - m.left, y: leftBox.y, width: m.left, height: leftBox.height }, value: metrics.margin.left, element }, metrics.margin.left < 0 ? [...flags, "clamped"] : flags));
  regions.push(withFlags({ kind: "margin", side: "right", rect: { x: rightBox.x + rightBox.width, y: rightBox.y, width: m.right, height: rightBox.height }, value: metrics.margin.right, element }, metrics.margin.right < 0 ? [...flags, "clamped"] : flags));
  regions.push(withFlags({ kind: "padding", side: "left", rect: { x: leftBox.x + b.left, y: leftBox.y + b.top + p.top, width: p.left, height: Math.max(0, leftBox.height - b.top - b.bottom - p.top - p.bottom) }, value: metrics.padding.left, element }, flags));
  regions.push(withFlags({ kind: "padding", side: "right", rect: { x: rightBox.x + rightBox.width - b.right - p.right, y: rightBox.y + b.top + p.top, width: p.right, height: Math.max(0, rightBox.height - b.top - b.bottom - p.top - p.bottom) }, value: metrics.padding.right, element }, flags));
  fragments.forEach((frag) => {
    const inner = { x: frag.x + b.left, width: Math.max(0, frag.width - b.left - b.right) };
    regions.push(withFlags({ kind: "padding", side: "top", rect: { ...inner, y: frag.y + b.top, height: p.top }, value: metrics.padding.top, element }, flags));
    regions.push(withFlags({ kind: "padding", side: "bottom", rect: { ...inner, y: frag.y + frag.height - b.bottom - p.bottom, height: p.bottom }, value: metrics.padding.bottom, element }, flags));
  });
  return regions;
}

export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

function contains(r: Rect, p: Point): boolean {
  return r.width > 0 && r.height > 0 && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

/**
 * Region under the point: the smallest-area region whose rect contains it. When none
 * does, the nearest zero-area region with a non-zero value within `snap` px (a clamped
 * negative margin or a collapsed band). Ties keep the earlier region.
 */
export function hitTestRegions<E>(regions: readonly SpacingRegion<E>[], point: Point, snap = SNAP_DISTANCE): SpacingRegion<E> | null {
  let best: SpacingRegion<E> | null = null;
  let bestArea = Infinity;
  for (const region of regions) {
    if (!contains(region.rect, point)) continue;
    const area = rectArea(region.rect);
    if (area < bestArea) {
      best = region;
      bestArea = area;
    }
  }
  if (best) return best;
  let nearest: SpacingRegion<E> | null = null;
  let nearestDistance = snap;
  for (const region of regions) {
    if (rectArea(region.rect) > 0 || region.value === 0) continue;
    const d = distanceToRect(point, region.rect);
    if (d <= nearestDistance) {
      nearest = region;
      nearestDistance = d;
    }
  }
  return nearest;
}

/** Token resolver hook (token resolution is phase I5). Returns a token name or undefined. */
export type TokenResolver<E = Element> = (element: E, property: string, value: number) => string | undefined;
export const noTokenResolver: TokenResolver<unknown> = () => undefined;

function formatPx(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Overlay label (spec 14.6): `p-4 · 16` with a token; without one the px value and a `?`
 * hint (`13 ?`); `24 (gap 16)` when measured differs; then flags.
 */
export function regionLabel<E>(region: SpacingRegion<E>, token?: string): string {
  let text = formatPx(region.value);
  if (region.measured != null && Math.abs(region.measured - region.value) > 0.5) {
    text = `${formatPx(region.measured)} (gap ${formatPx(region.value)})`;
  }
  text = token ? `${token} · ${text}` : `${text} ?`;
  if (region.flags?.length) text = `${text} · ${region.flags.join(" · ")}`;
  return text;
}

/** Inputs for the margin-collapse hint, read from computed styles by the DOM layer. */
export type CollapseInput = {
  side: "top" | "bottom";
  value: number;
  /** Element participates in block flow: display block/list-item/table, not floated, static or relative. */
  inBlockFlow: boolean;
  /** Parent is a plain block container (not flex/grid, not a BFC root like flow-root or overflow != visible). */
  parentIsPlainBlock: boolean;
  /** The element is the first (side top) or last (side bottom) in-flow child of its parent. */
  isEdgeChild: boolean;
  /** Parent padding + border on the same side. */
  parentSeparator: number;
  /** Adjacent in-flow sibling's opposing margin (previous sibling's bottom for top, next's top for bottom), or null. */
  siblingMargin: number | null;
};

/**
 * Spec 3.5: flag `may collapse` when an adjacent vertical margin shares the edge and
 * nothing separates them. The collapsed value itself is not computed.
 */
export function mayCollapse(input: CollapseInput): boolean {
  if (input.value === 0 || !input.inBlockFlow || !input.parentIsPlainBlock) return false;
  if (input.siblingMargin != null && input.siblingMargin !== 0) return true;
  // The child margin escapes a parent with no padding or border on that side.
  return input.isEdgeChild && input.parentSeparator === 0;
}
