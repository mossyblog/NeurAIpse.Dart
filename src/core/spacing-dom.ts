import { boxHitTest, grabSides, marginZone, paddingZone, ringExists, type BoxCandidate, type BoxCell, type BoxGroup } from "./box-select.ts";
import { flexGapRegions, gridGapRegions } from "./gaps.ts";
import {
  boxRects,
  boxRegions,
  distanceToRect,
  hitTestRegions,
  inlineRegions,
  mayCollapse,
  parsePx,
  rectArea,
  SNAP_DISTANCE,
  transformFlags,
  type BoxMetrics,
  type BoxSide,
  type Scale,
  type SpacingRegion,
} from "./spacing.ts";
import type { Point, Rect } from "./types.ts";

/**
 * DOM readers for the spacing inspector: computed style + getBoundingClientRect in,
 * pure geometry out. Only the hovered and pinned elements are read.
 */

const toRect = (r: DOMRect | DOMRectReadOnly): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

function styleOf(el: Element): CSSStyleDeclaration | null {
  return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
}

export function readMetrics(style: CSSStyleDeclaration): BoxMetrics {
  return {
    margin: { top: parsePx(style.marginTop), right: parsePx(style.marginRight), bottom: parsePx(style.marginBottom), left: parsePx(style.marginLeft) },
    padding: { top: parsePx(style.paddingTop), right: parsePx(style.paddingRight), bottom: parsePx(style.paddingBottom), left: parsePx(style.paddingLeft) },
    border: { top: parsePx(style.borderTopWidth), right: parsePx(style.borderRightWidth), bottom: parsePx(style.borderBottomWidth), left: parsePx(style.borderLeftWidth) },
  };
}

/** Rendered px per CSS px, from the border box against the layout size (covers ancestor transforms). */
export function elementScale(el: Element, rect: Rect): Scale {
  const html = el as HTMLElement;
  const w = typeof html.offsetWidth === "number" ? html.offsetWidth : 0;
  const h = typeof html.offsetHeight === "number" ? html.offsetHeight : 0;
  const x = w > 0 && rect.width > 0 ? rect.width / w : 1;
  const y = h > 0 && rect.height > 0 ? rect.height / h : 1;
  return { x: Math.abs(x - 1) < 0.005 ? 1 : x, y: Math.abs(y - 1) < 0.005 ? 1 : y };
}

/** True when the element or an ancestor is rotated or skewed (drawn bounds are approximate). */
export function isRotatedOrSkewed(el: Element): boolean {
  let current: Element | null = el;
  for (let depth = 0; current && depth < 32; depth++) {
    const t = styleOf(current)?.transform;
    if (t && t !== "none") {
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) return true; // matrix3d and the like
      const [, b, c] = m[1].split(",").map(Number);
      if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isOutOfFlow(style: CSSStyleDeclaration): boolean {
  return style.position === "absolute" || style.position === "fixed";
}

/** Has a box: not display none or contents. */
export function hasBox(style: CSSStyleDeclaration | null): boolean {
  return Boolean(style && style.display !== "none" && style.display !== "contents");
}

/** In-flow children with boxes, and their margin boxes (negative margins clamp). */
export function inFlowChildren(el: Element): { element: Element; marginBox: Rect }[] {
  const out: { element: Element; marginBox: Rect }[] = [];
  for (const child of Array.from(el.children)) {
    const style = styleOf(child);
    if (!style || !hasBox(style) || isOutOfFlow(style)) continue;
    const rect = toRect(child.getBoundingClientRect());
    const scale = elementScale(child, rect);
    out.push({ element: child, marginBox: boxRects(rect, readMetrics(style), scale).marginBox });
  }
  return out;
}

function isBfcRoot(style: CSSStyleDeclaration): boolean {
  return (
    style.display === "flow-root" ||
    style.display.includes("flex") ||
    style.display.includes("grid") ||
    style.display.includes("table") ||
    style.display.startsWith("inline-") ||
    (style.overflowY !== "visible" && style.overflowY !== "clip") ||
    style.contain.includes("layout") ||
    style.contain.includes("paint")
  );
}

function inBlockFlow(style: CSSStyleDeclaration): boolean {
  return (
    (style.display === "block" || style.display === "list-item" || style.display === "table") &&
    style.float === "none" &&
    !isOutOfFlow(style)
  );
}

/** `may collapse` flags for vertical margins (spec 3.5). */
function collapseFlags(el: Element, style: CSSStyleDeclaration, metrics: BoxMetrics): Partial<Record<BoxSide, string[]>> {
  const parent = el.parentElement;
  const parentStyle = parent ? styleOf(parent) : null;
  if (!parent || !parentStyle) return {};
  const siblings = Array.from(parent.children).filter((child) => {
    const s = styleOf(child);
    return s && hasBox(s) && !isOutOfFlow(s);
  });
  const index = siblings.indexOf(el);
  const flags: Partial<Record<BoxSide, string[]>> = {};
  for (const side of ["top", "bottom"] as const) {
    const sibling = side === "top" ? siblings[index - 1] : siblings[index + 1];
    const siblingStyle = sibling ? styleOf(sibling) : null;
    const siblingMargin = siblingStyle && inBlockFlow(siblingStyle)
      ? parsePx(side === "top" ? siblingStyle.marginBottom : siblingStyle.marginTop)
      : null;
    const separator = side === "top"
      ? parsePx(parentStyle.paddingTop) + parsePx(parentStyle.borderTopWidth)
      : parsePx(parentStyle.paddingBottom) + parsePx(parentStyle.borderBottomWidth);
    const hint = mayCollapse({
      side,
      value: metrics.margin[side],
      inBlockFlow: inBlockFlow(style),
      parentIsPlainBlock: parentStyle.display === "block" && !isBfcRoot(parentStyle),
      isEdgeChild: side === "top" ? index === 0 : index === siblings.length - 1,
      parentSeparator: separator,
      siblingMargin,
    });
    if (hint) flags[side] = ["may collapse"];
  }
  return flags;
}

export type ElementSpacing = {
  element: Element;
  border: Rect;
  /** Line-box fragments for inline elements; the border box otherwise. */
  fragments: Rect[];
  regions: SpacingRegion[];
  scale: Scale;
  flags: string[];
  /** Block boxes: border box inside the borders, drawn px (Box hit-test frame). */
  paddingBox?: Rect;
  /** Grid spike: set when the container is a grid that could not be modelled. */
  gridNote?: string;
};

/**
 * Margin, padding and gap regions of one element, or null when it has no box. `light`
 * skips gap bands and collapse hints (used for hit-test candidates, which only need
 * margins, so large child lists stay linear).
 */
export function elementSpacing(el: Element, options: { light?: boolean } = {}): ElementSpacing | null {
  const style = styleOf(el);
  if (!hasBox(style) || !style) return null;
  const border = toRect(el.getBoundingClientRect());
  const metrics = readMetrics(style);
  const scale = elementScale(el, border);
  const flags = transformFlags(scale, isRotatedOrSkewed(el));
  if (style.display === "inline") {
    const fragments = Array.from(el.getClientRects(), toRect);
    // Inline boxes have no offset size; scale comes from ancestors only (assume none here).
    return {
      element: el,
      border,
      fragments,
      regions: inlineRegions(fragments, metrics, el, { flags, rtl: style.direction === "rtl" }),
      scale: { x: 1, y: 1 },
      flags,
    };
  }
  const regions = boxRegions(border, metrics, el, { scale, flags, marginFlags: options.light ? undefined : collapseFlags(el, style, metrics) });
  const rects = boxRects(border, metrics, scale);
  const paddingBox = rects.paddingBox;
  if (options.light) return { element: el, border, fragments: [border], regions, scale, flags, paddingBox };
  let gridNote: string | undefined;
  const display = style.display;
  const content = rects.contentBox;
  if (display === "flex" || display === "inline-flex") {
    const children = inFlowChildren(el).map((c) => c.marginBox);
    regions.push(...flexGapRegions({ content, flexDirection: style.flexDirection, rowGap: parsePx(style.rowGap), columnGap: parsePx(style.columnGap), children, scale }, el).map((r) => (flags.length ? { ...r, flags: [...(r.flags ?? []), ...flags] } : r)));
  } else if (display === "grid" || display === "inline-grid") {
    const grid = gridGapRegions({
      content,
      gridTemplateColumns: style.gridTemplateColumns,
      gridTemplateRows: style.gridTemplateRows,
      rowGap: parsePx(style.rowGap),
      columnGap: parsePx(style.columnGap),
      justifyContent: style.justifyContent,
      alignContent: style.alignContent,
      rtl: style.direction === "rtl",
      scale,
    }, el);
    regions.push(...grid.regions);
    if (!grid.supported) gridNote = `grid gaps unsupported: ${grid.reason}`;
  }
  return { element: el, border, fragments: [border], regions, scale, flags, paddingBox, gridNote };
}

export type BoxSpacingHit = { spacing: ElementSpacing; group: BoxGroup | "content"; cell: BoxCell | null };

type GhostHit = { element: Element; group: BoxGroup; cell: BoxCell; area: number };

/** Zones of a candidate's all-zero padding / margin rings (block boxes only): the 8px grab strip per side. */
function ghostHits(c: BoxCandidate<Element>, point: Point): GhostHit[] {
  if (!c.frame) return [];
  const out: GhostHit[] = [];
  for (const group of ["padding", "margin"] as const) {
    if ((c.groups && !c.groups.includes(group)) || ringExists(c.regions, group) || !c.regions.some((r) => r.kind === group)) continue;
    const zone = (group === "padding" ? paddingZone : marginZone)(c.frame, grabSides(c.regions, group), point);
    if (zone) out.push({ element: c.element, group, cell: zone.cell, area: zone.area });
  }
  return out;
}

const candidateOf = (s: ElementSpacing, groups?: BoxGroup[]): BoxCandidate<Element> => ({
  element: s.element,
  regions: s.regions,
  ...(s.paddingBox ? { frame: { border: s.border, paddingBox: s.paddingBox } } : {}),
  ...(groups ? { groups } : {}),
});

/**
 * Box hit-test in the page (spec 14.2): the element under the point, its in-flow
 * children's margins, the hovered (`sticky`) element and the selected (`selected`)
 * element, which answers first while the point is in one of its zones. Groups come from
 * `boxHitTest`; a zero-size child within 8px answers as `content`.
 */
export function hitTestBox(target: Element, point: Point, sticky?: Element | null, selected?: Element | null): BoxSpacingHit | null {
  const own = elementSpacing(target);
  if (!own) return null;
  const spacings = new Map<Element, ElementSpacing>([[target, own]]);
  const candidates: BoxCandidate<Element>[] = [candidateOf(own)];
  const childSpacings: ElementSpacing[] = [];
  for (const child of Array.from(target.children).slice(0, 200)) {
    const s = elementSpacing(child, { light: true });
    if (!s) continue;
    childSpacings.push(s);
    candidates.push(candidateOf(s, ["margin"]));
  }
  for (const extra of [selected, sticky]) {
    if (!extra || spacings.has(extra) || !extra.isConnected) continue;
    const s = elementSpacing(extra);
    if (!s) continue;
    spacings.set(extra, s);
    candidates.push(candidateOf(s));
  }
  const hit = boxHitTest(candidates, point, { priority: selected ?? null });
  const answer = (h: { element: Element; group: BoxGroup; cell: BoxCell }): BoxSpacingHit => {
    // Re-read a light child in full so its overlay carries gaps and collapse hints.
    const spacing = spacings.get(h.element) ?? elementSpacing(h.element) ?? own;
    return { spacing, group: h.group, cell: h.cell };
  };
  if (hit && hit.group !== "content" && (!selected || hit.element === selected)) return answer(hit);
  // A ring whose four sides are all 0 (no zone in `boxHitTest`) keeps a ghost ring with
  // an 8px grab zone per side, so it can be hovered, selected and set from 0. It answers
  // only where no real zone does, except for the selected element (so it can narrow).
  const selectedCandidate = selected ? candidates.find((c) => c.element === selected) : undefined;
  const selectedGhost = selectedCandidate ? ghostHits(selectedCandidate, point)[0] : undefined;
  if (selectedGhost) return answer(selectedGhost);
  if (hit && hit.group !== "content") return answer(hit);
  const ghost = candidates.flatMap((c) => ghostHits(c, point)).reduce<GhostHit | null>((best, h) => (!best || h.area < best.area ? h : best), null);
  if (ghost) return answer(ghost);
  for (const s of childSpacings) {
    if (rectArea(s.border) > 0 || distanceToRect(point, s.border) > SNAP_DISTANCE) continue;
    return { spacing: elementSpacing(s.element) ?? s, group: "content", cell: null };
  }
  return { spacing: own, group: "content", cell: null };
}

export type SpacingHit = { spacing: ElementSpacing; region: SpacingRegion | null };

/**
 * Hit-test (spec 3.1): the element under the point, its own regions, its in-flow
 * children's margins (a point in a child's margin lands on the parent) and the sticky
 * element's regions (the one already hovered). Smallest area wins. A zero-size child
 * within 8px is picked as the element when nothing else matches.
 */
export function hitTestSpacing(target: Element, point: Point, sticky?: Element | null): SpacingHit | null {
  const own = elementSpacing(target);
  if (!own) return null;
  const pool: { spacing: ElementSpacing; region: SpacingRegion }[] = own.regions.map((region) => ({ spacing: own, region }));
  const childSpacings: ElementSpacing[] = [];
  for (const child of Array.from(target.children).slice(0, 200)) {
    const s = elementSpacing(child, { light: true });
    if (!s) continue;
    childSpacings.push(s);
    for (const region of s.regions) if (region.kind === "margin") pool.push({ spacing: s, region });
  }
  if (sticky && sticky !== target && sticky.isConnected) {
    const s = elementSpacing(sticky);
    if (s) for (const region of s.regions) pool.push({ spacing: s, region });
  }
  const region = hitTestRegions(pool.map((p) => p.region), point);
  if (region) {
    const match = pool.find((p) => p.region === region);
    // Re-read a light child in full so its overlay carries gaps and collapse hints.
    if (match) return { spacing: elementSpacing(match.spacing.element) ?? match.spacing, region };
  }
  let zero: ElementSpacing | null = null;
  let best = SNAP_DISTANCE;
  for (const s of childSpacings) {
    if (rectArea(s.border) > 0) continue;
    const d = distanceToRect(point, s.border);
    if (d <= best) {
      zero = s;
      best = d;
    }
  }
  return { spacing: zero ? (elementSpacing(zero.element) ?? zero) : own, region: null };
}

/** Topmost page element at a point, skipping overlay nodes and descending open shadow roots. */
export function deepElementFromPoint(doc: Document | ShadowRoot, x: number, y: number, skip: (el: Element) => boolean): Element | null {
  const found = doc.elementsFromPoint(x, y).find((el) => !skip(el)) ?? null;
  if (found?.shadowRoot && found.shadowRoot !== doc) {
    const inner = deepElementFromPoint(found.shadowRoot, x, y, skip);
    if (inner && inner !== found) return inner;
  }
  return found;
}
