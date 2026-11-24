import type { Annotation, Rect } from "./types.ts";

/**
 * Layout placements (parity spec 7 and 10): `kind: "placement"` annotations. Geometry is
 * in document px; `x` is the left edge as % of viewport width and `y` the top edge in px
 * from the document top. `element` / `elementPath` name the page element under the
 * placement's centre (identifyElement), refreshed after every move or resize.
 */

export type PlacementAnnotation = Annotation & {
  kind: "placement";
  placement: NonNullable<Annotation["placement"]>;
};

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Smallest placement side in px. */
export const MIN_PLACEMENT_SIZE = 16;
/** Arrow-key nudge: 8px (one grid step), 1px with Shift. */
export const NUDGE_STEP = 8;
export const FINE_NUDGE_STEP = 1;
/** Cmd/Ctrl+D copies land this far right and down (two grid steps). */
export const DUPLICATE_OFFSET = 16;

export type NearElement = { name: string; path: string };

export function isPlacement(a: Annotation): a is PlacementAnnotation {
  return a.kind === "placement" && a.placement != null;
}

/** Everything except placements (feedback numbering, markers, metadata formats). */
export function withoutPlacements<T extends Annotation>(list: readonly T[]): T[] {
  return list.filter((a) => a.kind !== "placement");
}

export function placementsOf(list: readonly Annotation[]): PlacementAnnotation[] {
  return list.filter(isPlacement);
}

/** Document-px rect of a placement for the given viewport width. */
export function placementRect(a: PlacementAnnotation, viewportWidth: number): Rect {
  return {
    x: (a.x / 100) * viewportWidth,
    y: a.y,
    width: a.placement.width,
    height: a.placement.height,
  };
}

function round(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** The placement moved or resized to `rect` (document px, rounded to whole px). */
export function withPlacementRect<T extends PlacementAnnotation>(a: T, rect: Rect, viewportWidth: number): T {
  const r = round(rect);
  return {
    ...a,
    x: viewportWidth > 0 ? (r.x / viewportWidth) * 100 : 0,
    y: r.y,
    boundingBox: r,
    placement: { ...a.placement, width: r.width, height: r.height },
  };
}

export type CreatePlacementInput = {
  id: string;
  componentType: string;
  /** Document px. */
  rect: Rect;
  viewportWidth: number;
  scrollY: number;
  timestamp: number;
  near: NearElement;
  text?: string;
  comment?: string;
};

export function createPlacement(input: CreatePlacementInput): PlacementAnnotation {
  const base: PlacementAnnotation = {
    id: input.id,
    kind: "placement",
    x: 0,
    y: 0,
    comment: input.comment ?? "",
    element: input.near.name,
    elementPath: input.near.path,
    timestamp: input.timestamp,
    placement: {
      componentType: input.componentType,
      width: 0,
      height: 0,
      scrollY: Math.round(input.scrollY),
      ...(input.text ? { text: input.text } : {}),
    },
  };
  return withPlacementRect(base, input.rect, input.viewportWidth);
}

/** A rect of the given size centred on a document point, clamped to the document's left/top. */
export function rectAround(point: { x: number; y: number }, size: { width: number; height: number }): Rect {
  return {
    x: Math.max(0, Math.round(point.x - size.width / 2)),
    y: Math.max(0, Math.round(point.y - size.height / 2)),
    width: size.width,
    height: size.height,
  };
}

export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: Math.max(0, rect.x + dx), y: Math.max(0, rect.y + dy) };
}

/**
 * Resizes from one of 8 handles by a pointer delta. The opposite edge stays put; each
 * side is at least `min` px.
 */
export function resizeRect(rect: Rect, handle: ResizeHandle, dx: number, dy: number, min = MIN_PLACEMENT_SIZE): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - min);
  if (handle.includes("e")) right = Math.max(right + dx, left + min);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - min);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + min);
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Delta for an arrow key: 8px, or 1px with Shift. Null for any other key. */
export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const dir = ARROWS[key];
  if (!dir) return null;
  const step = shift ? FINE_NUDGE_STEP : NUDGE_STEP;
  return { dx: dir[0] * step, dy: dir[1] * step };
}

/** A copy with a new id, offset by DUPLICATE_OFFSET, comment kept. */
export function duplicatePlacement(
  a: PlacementAnnotation,
  id: string,
  timestamp: number,
  viewportWidth: number,
): PlacementAnnotation {
  const rect = moveRect(placementRect(a, viewportWidth), DUPLICATE_OFFSET, DUPLICATE_OFFSET);
  const copy: PlacementAnnotation = {
    ...a,
    id,
    timestamp,
    placement: { ...a.placement },
  };
  delete copy._syncedTo;
  delete copy.updatedAt;
  delete copy.createdAt;
  return withPlacementRect(copy, rect, viewportWidth);
}

/** Sets or clears the inline text (`placement.text`); blank text removes the key. */
export function withPlacementText<T extends PlacementAnnotation>(a: T, text: string): T {
  const trimmed = text.replace(/[\r\n\t]+/g, " ").trim();
  const placement = { ...a.placement };
  if (trimmed) placement.text = trimmed;
  else delete placement.text;
  return { ...a, placement };
}

export function withNear<T extends PlacementAnnotation>(a: T, near: NearElement): T {
  return a.element === near.name && a.elementPath === near.path ? a : { ...a, element: near.name, elementPath: near.path };
}
