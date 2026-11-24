import { BOX_SIDES, type BoxSide, type SpacingKind, type SpacingRegion } from "./spacing.ts";
import type { Point, Rect } from "./types.ts";

/**
 * Box sub-mode selection (inspector spec 14.2): the area under the cursor picks a whole
 * group (the padding ring, the margin ring or all gap bands of a container); a click
 * selects that ring, a click on one of its sides narrows to it, Shift toggles sides and
 * Esc steps back. Pure functions; the DOM layer feeds them rects and values.
 */

export type BoxGroup = SpacingKind;

/** Minimum grab thickness for a side, so a side at 0 stays selectable (spec 14.2). */
export const MIN_GRAB = 8;

/** A hit cell: a side, a corner (two sides at once) or a gap band index. */
export type BoxCell = BoxSide | "corner" | number;

export type BoxHit<E> =
  | { element: E; group: BoxGroup; cell: BoxCell; area: number }
  | { element: E; group: "content"; cell: null; area: number };

/** Block-box frame in drawn px: the border box and the padding box (border box inside the borders). */
export type BoxFrame = { border: Rect; paddingBox: Rect };

export type BoxCandidate<E> = {
  element: E;
  regions: readonly SpacingRegion<E>[];
  /** Block boxes; inline boxes (several fragments) hit-test their region strips instead. */
  frame?: BoxFrame;
  /** Groups this candidate may answer for (children of the target answer for margin only). */
  groups?: readonly BoxGroup[];
};

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const inside = (r: Rect, p: Point) => p.x >= r.x && p.x < right(r) && p.y >= r.y && p.y < bottom(r);
const sideOf = (region: SpacingRegion<unknown>) => region.side as BoxSide;

/** Drawn thickness of a side strip (height for top/bottom, width for left/right). */
function thickness(region: SpacingRegion<unknown>): number {
  return region.side === "top" || region.side === "bottom" ? region.rect.height : region.rect.width;
}

/** A ring exists when at least one of its sides is not 0 (a ring with every side at 0 has no zone). */
export function ringExists(regions: readonly SpacingRegion<unknown>[], group: BoxGroup): boolean {
  return regions.some((r) => r.kind === group && r.value !== 0);
}

/** Grab thickness per side: max(drawn thickness, MIN_GRAB). */
export function grabSides(regions: readonly SpacingRegion<unknown>[], group: "padding" | "margin", grab = MIN_GRAB): Record<BoxSide, number> {
  const out = { top: grab, right: grab, bottom: grab, left: grab };
  for (const r of regions) if (r.kind === group && r.side !== "row" && r.side !== "column") out[sideOf(r)] = Math.max(out[sideOf(r)], thickness(r));
  return out;
}

/** Result of one ring test: the cell and the ranking area (the smaller band for a corner). */
type RingResult = { cell: BoxSide | "corner"; area: number };

function pickCell(flags: Record<BoxSide, boolean>, areas: Record<BoxSide, number>): RingResult | null {
  const on = BOX_SIDES.filter((s) => flags[s]);
  if (on.length === 0) return null;
  const area = Math.min(...on.map((s) => areas[s]));
  return { cell: on.length >= 2 ? "corner" : on[0], area };
}

/** Padding zone: inside the padding box, within max(value, grab) of an edge. */
export function paddingZone(frame: BoxFrame, e: Record<BoxSide, number>, p: Point): RingResult | null {
  const b = frame.paddingBox;
  if (!inside(frame.border, p)) return null;
  const flags = {
    top: p.y < b.y + e.top,
    bottom: p.y >= bottom(b) - e.bottom,
    left: p.x < b.x + e.left,
    right: p.x >= right(b) - e.right,
  };
  const areas = { top: b.width * e.top, bottom: b.width * e.bottom, left: b.height * e.left, right: b.height * e.right };
  return pickCell(flags, areas);
}

/** Margin zone: outside the border box, inside the border box grown by max(value, grab) per side. */
export function marginZone(frame: BoxFrame, e: Record<BoxSide, number>, p: Point): RingResult | null {
  const b = frame.border;
  const outer = { x: b.x - e.left, y: b.y - e.top, width: b.width + e.left + e.right, height: b.height + e.top + e.bottom };
  if (!inside(outer, p) || inside(b, p)) return null;
  const flags = { top: p.y < b.y, bottom: p.y >= bottom(b), left: p.x < b.x, right: p.x >= right(b) };
  const areas = { top: outer.width * e.top, bottom: outer.width * e.bottom, left: b.height * e.left, right: b.height * e.right };
  return pickCell(flags, areas);
}

/** Strip grown to `grab` toward the content (padding) or away from the box (margin). */
export function grownStrip(region: SpacingRegion<unknown>, grab = MIN_GRAB): Rect {
  const r = region.rect;
  const t = thickness(region);
  if (t >= grab) return r;
  const d = grab - t;
  const outward = region.kind === "margin";
  switch (region.side) {
    case "top":
      return outward ? { ...r, y: r.y - d, height: grab } : { ...r, height: grab };
    case "bottom":
      return outward ? { ...r, height: grab } : { ...r, y: r.y - d, height: grab };
    case "left":
      return outward ? { ...r, x: r.x - d, width: grab } : { ...r, width: grab };
    default:
      return outward ? { ...r, width: grab } : { ...r, x: r.x - d, width: grab };
  }
}

/** Gap bands of one element, in region order: the cell index of a gap hit. */
export function gapBands<E>(regions: readonly SpacingRegion<E>[]): SpacingRegion<E>[] {
  return regions.filter((r) => r.kind === "gap");
}

function candidateHits<E>(c: BoxCandidate<E>, p: Point, grab: number): BoxHit<E>[] {
  const allow = (g: BoxGroup) => !c.groups || c.groups.includes(g);
  const hits: BoxHit<E>[] = [];
  if (allow("gap")) {
    gapBands(c.regions).forEach((band, i) => {
      if (band.rect.width > 0 && band.rect.height > 0 && inside(band.rect, p)) hits.push({ element: c.element, group: "gap", cell: i, area: band.rect.width * band.rect.height });
    });
  }
  for (const group of ["padding", "margin"] as const) {
    if (!allow(group) || !ringExists(c.regions, group)) continue;
    if (c.frame) {
      const e = grabSides(c.regions, group, grab);
      const hit = group === "padding" ? paddingZone(c.frame, e, p) : marginZone(c.frame, e, p);
      if (hit) hits.push({ element: c.element, group, cell: hit.cell, area: hit.area });
      continue;
    }
    // Inline boxes: the strips themselves, grown to the grab size; no corners.
    for (const region of c.regions) {
      if (region.kind !== group) continue;
      const r = grownStrip(region, grab);
      if (inside(r, p)) hits.push({ element: c.element, group, cell: sideOf(region), area: r.width * r.height });
    }
  }
  return hits;
}

/**
 * Box hit-test (spec 14.2). `candidates[0]` is the element under the pointer; others are
 * its children (margins) and the hovered element. A `priority` candidate (the selection)
 * answers first whenever the point is in one of its zones, so its margin over the parent
 * or a 0 side's grab area over a child narrows instead of switching element. Otherwise
 * the smallest band wins (ties keep the earlier candidate). No zone: the first candidate
 * whose border box holds the point answers `content`, else null.
 */
export function boxHitTest<E>(candidates: readonly BoxCandidate<E>[], p: Point, options: { priority?: E | null; grab?: number } = {}): BoxHit<E> | null {
  const grab = options.grab ?? MIN_GRAB;
  const smallest = (hits: BoxHit<E>[]) => hits.reduce<BoxHit<E> | null>((best, h) => (!best || h.area < best.area ? h : best), null);
  if (options.priority != null) {
    const own = candidates.filter((c) => c.element === options.priority).flatMap((c) => candidateHits(c, p, grab));
    const best = smallest(own);
    if (best) return best;
  }
  const best = smallest(candidates.flatMap((c) => candidateHits(c, p, grab)));
  if (best) return best;
  for (const c of candidates) {
    const box = c.frame?.border;
    if (box && inside(box, p)) return { element: c.element, group: "content", cell: null, area: box.width * box.height };
  }
  return null;
}

/* ---------------- Selection state ---------------- */

/** Selected group of one element: the sides of a ring (gap: all bands, `sides` empty). */
export type BoxSelection = { group: BoxGroup; sides: BoxSide[] };

const ordered = (sides: Iterable<BoxSide>) => BOX_SIDES.filter((s) => new Set(sides).has(s));
const whole = (group: BoxGroup): BoxSelection => ({ group, sides: group === "gap" ? [] : [...BOX_SIDES] });

export const SIDE_PRESETS = { all: [...BOX_SIDES], vertical: ["top", "bottom"], horizontal: ["left", "right"] } as const satisfies Record<string, readonly BoxSide[]>;

/** Narrow, widen or toggle one side of a ring selection (canvas side click or panel cell). */
export function toggleSide(selection: BoxSelection, side: BoxSide, additive: boolean): BoxSelection {
  if (selection.group === "gap") return selection;
  const has = selection.sides.includes(side);
  if (additive) {
    if (has) return selection.sides.length > 1 ? { ...selection, sides: selection.sides.filter((s) => s !== side) } : selection;
    return { ...selection, sides: ordered([...selection.sides, side]) };
  }
  // Clicking the lone selected side again widens back to the whole ring.
  if (has && selection.sides.length === 1) return whole(selection.group);
  return { ...selection, sides: [side] };
}

/**
 * Canvas click on a hit (spec 14.2). A new element or group selects the whole ring
 * (Shift on a side selects just that side); inside the selected ring a corner selects
 * every side and a side narrows (Shift toggles). Gap selections always keep every band.
 */
export function clickSelect(current: BoxSelection | null, sameElement: boolean, hit: { group: BoxGroup; cell: BoxCell }, shift: boolean): BoxSelection {
  const side = typeof hit.cell === "string" && hit.cell !== "corner" ? hit.cell : null;
  if (!current || !sameElement || current.group !== hit.group) {
    if (hit.group !== "gap" && side && shift) return { group: hit.group, sides: [side] };
    return whole(hit.group);
  }
  if (hit.group === "gap") return current;
  if (!side) return whole(hit.group);
  return toggleSide(current, side, shift);
}

/** Esc steps back one level: narrowed sides -> whole ring -> nothing. */
export function escapeSelection(current: BoxSelection | null): BoxSelection | null {
  if (!current) return null;
  if (current.group !== "gap" && current.sides.length < 4) return whole(current.group);
  return null;
}

export function presetSelection(group: BoxGroup, preset: keyof typeof SIDE_PRESETS): BoxSelection {
  return group === "gap" ? whole("gap") : { group, sides: [...SIDE_PRESETS[preset]] };
}

/* ---------------- Properties ---------------- */

/**
 * CSS properties a selection edits (spec 14.2): all four sides -> `padding`; top+bottom ->
 * `padding-block`; left+right -> `padding-inline`; one side -> `padding-top`; any other
 * combination -> one property per side. Gap: `gap` when both axes have bands or the two
 * gaps are equal (one shared value), else the longhand of the axis that has bands.
 */
export function selectionProperties(selection: BoxSelection, gap?: { axes: readonly ("row" | "column")[]; rowGap: number; columnGap: number }): string[] {
  const g = selection.group;
  if (g === "gap") {
    const axes = gap?.axes ?? [];
    if (axes.length !== 1 || gap?.rowGap === gap?.columnGap) return ["gap"];
    return [axes[0] === "row" ? "row-gap" : "column-gap"];
  }
  const sides = ordered(selection.sides);
  const has = (...s: BoxSide[]) => sides.length === s.length && s.every((x) => sides.includes(x));
  if (has("top", "right", "bottom", "left")) return [g];
  if (has("top", "bottom")) return [`${g}-block`];
  if (has("left", "right")) return [`${g}-inline`];
  return sides.map((s) => `${g}-${s}`);
}

/** Inverse of `selectionProperties`: the group and physical sides a property covers. */
export function propertySides(property: string): BoxSelection | null {
  if (property === "gap" || property === "row-gap" || property === "column-gap") return { group: "gap", sides: [] };
  const m = /^(padding|margin)(?:-(top|right|bottom|left|block|inline))?$/.exec(property);
  if (!m) return null;
  const group = m[1] as BoxGroup;
  const part = m[2];
  if (!part) return { group, sides: [...BOX_SIDES] };
  if (part === "block") return { group, sides: ["top", "bottom"] };
  if (part === "inline") return { group, sides: ["left", "right"] };
  return { group, sides: [part as BoxSide] };
}

/** Longhands a property sets (for reading values and resolving tokens). */
export function longhandsOf(property: string, gapAxes: readonly ("row" | "column")[] = ["row", "column"]): string[] {
  const s = propertySides(property);
  if (!s) return [property];
  if (s.group === "gap") return property === "gap" ? gapAxes.map((a) => `${a}-gap`) : [property];
  return s.sides.map((side) => `${s.group}-${side}`);
}

/* ---------------- Readout and stepping ---------------- */

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Value readout for the selected sides: `–` (nothing), `mixed` when they differ, else `16px`. */
export function valueReadout(values: readonly number[]): string {
  if (values.length === 0) return "–";
  return values.some((v) => Math.abs(v - values[0]) > 0.01) ? "mixed" : `${fmt(values[0])}px`;
}

/** Sorted unique px steps of a token scale (on-grid tokens when the scale has any). */
export function tokenSteps(tokens: readonly { px: number; onGrid: boolean }[]): number[] {
  const grid = tokens.filter((t) => t.onGrid);
  const use = grid.length ? grid : tokens;
  return [...new Set(use.map((t) => Math.round(t.px * 100) / 100))].sort((a, b) => a - b);
}

/**
 * Keyboard step (spec 14.2): one token up or down from the largest selected value (every
 * selected side gets the result); `fine` moves 1px. Never below `min`; at either end of
 * the scale the value stays.
 */
export function stepSelectionValue(values: readonly number[], steps: readonly number[], direction: 1 | -1, fine = false, min = -Infinity): number {
  const base = values.length ? Math.max(...values) : 0;
  if (fine || steps.length === 0) return Math.max(min, Math.round((base + direction) * 100) / 100);
  const next = direction > 0 ? steps.find((s) => s > base + 0.01) : [...steps].reverse().find((s) => s < base - 0.01);
  return Math.max(min, next ?? (direction > 0 ? Math.max(base, steps[steps.length - 1]) : Math.min(base, steps[0])));
}

/* ---------------- Copy notes ---------------- */

/**
 * Sides a Tailwind spacing utility sets: `p-4` all, `px-6` left+right, `pt-1` top. Logical
 * `ps`/`pe` (inline start/end) map by direction: start is left in LTR, right in RTL. Null
 * for anything else.
 */
export function utilitySides(utility: string | undefined, rtl = false): BoxSide[] | null {
  if (!utility) return null;
  const m = /^(?:[\w-]+:)*-?([pm])([xytrblse]?)-/.exec(utility);
  if (!m) return null;
  switch (m[2]) {
    case "":
      return [...BOX_SIDES];
    case "x":
      return ["left", "right"];
    case "y":
      return ["top", "bottom"];
    case "t":
      return ["top"];
    case "r":
      return ["right"];
    case "e":
      return [rtl ? "left" : "right"];
    case "s":
      return [rtl ? "right" : "left"];
    case "b":
      return ["bottom"];
    default:
      return ["left"];
  }
}

export type NoteInput = {
  group: BoxGroup;
  /** Selected sides (padding and margin). */
  sides: readonly BoxSide[];
  /** Winning utility per side before the edit (`p-4`), when known. */
  utilities?: Partial<Record<BoxSide, string>>;
  /** Value per side before the edit, px. */
  values?: Partial<Record<BoxSide, number>>;
  /** Gap: number of bands the one value is shared by. */
  bands?: number;
  /** Viewport width at edit time, px. */
  viewport?: number;
  /** The element's direction is RTL (logical `ps`/`pe` utilities cover right/left). */
  rtl?: boolean;
};

/**
 * Copy notes for a Box edit (spec 14.2): a partial selection of an authored shorthand
 * (`authored as \`p-4\`; split it, keep the other sides unchanged`), a side that was 0
 * with no utility, the shared gap value, and the viewport width.
 */
export function selectionNotes(input: NoteInput): string[] {
  const notes: string[] = [];
  if (input.group !== "gap") {
    const selected = new Set(input.sides);
    const seen = new Set<string>();
    for (const side of ordered(input.sides)) {
      const utility = input.utilities?.[side];
      const covers = utilitySides(utility, input.rtl);
      if (!utility || !covers || seen.has(utility)) continue;
      seen.add(utility);
      if (covers.some((s) => !selected.has(s))) notes.push(`authored as \`${utility}\`; split it, keep the other sides unchanged`);
    }
    for (const side of ordered(input.sides)) {
      if (input.values?.[side] === 0 && !input.utilities?.[side]) notes.push(`${input.group}-${side} was 0, so no existing utility to edit`);
    }
  } else if (input.bands != null) {
    notes.push(`one value shared by ${input.bands} band${input.bands === 1 ? "" : "s"}`);
  }
  if (input.viewport != null) notes.push(`At viewport ${Math.round(input.viewport)}px`);
  return notes;
}

/** Utility prefix for chips and labels: `p`, `px`, `pt`, `m`, `gap`. */
export function selectionUtilityPrefix(selection: BoxSelection): string {
  if (selection.group === "gap") return "gap";
  const k = selection.group === "padding" ? "p" : "m";
  const [prop] = selectionProperties(selection);
  if (selectionProperties(selection).length > 1 || prop === selection.group) return k;
  if (prop.endsWith("-block")) return `${k}y`;
  if (prop.endsWith("-inline")) return `${k}x`;
  return `${k}${prop.split("-")[1][0]}`;
}
