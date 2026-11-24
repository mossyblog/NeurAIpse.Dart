import type { SpacingRegion } from "./spacing.ts";
import type { Rect } from "./types.ts";

/**
 * Gap bands for flex and grid containers (inspector spec 3.3). Pure: the DOM layer passes
 * the container's content box and the margin boxes of its in-flow children, so a band is
 * the space between margin boxes and equals the computed gap unless justify/align
 * distribution adds space (then `measured` carries the real width).
 */

export type FlexInput = {
  /** Container content box, drawn px. */
  content: Rect;
  flexDirection: string;
  /** Computed px. */
  rowGap: number;
  columnGap: number;
  /** In-flow children's margin boxes (display:none, contents, absolute and fixed already skipped). */
  children: readonly Rect[];
  /** Drawing scale (rendered px per CSS px) for comparing measured space with the gap. */
  scale?: { x: number; y: number };
};

type Axis = { start: "x" | "y"; size: "width" | "height" };
const X: Axis = { start: "x", size: "width" };
const Y: Axis = { start: "y", size: "height" };

const end = (r: Rect, a: Axis) => r[a.start] + r[a.size];
const round = (n: number) => Math.round(n * 100) / 100;

/** Groups rects into lines along the cross axis: a rect joins a line it overlaps on that axis. */
export function groupLines(rects: readonly Rect[], cross: "x" | "y"): Rect[][] {
  const a = cross === "x" ? X : Y;
  const sorted = [...rects].sort((p, q) => p[a.start] - q[a.start] || end(p, a) - end(q, a));
  const lines: { start: number; end: number; items: Rect[] }[] = [];
  for (const rect of sorted) {
    const line = lines[lines.length - 1];
    // Half a pixel of slack so baseline-aligned or sub-pixel rows stay together.
    if (line && rect[a.start] < line.end - 0.5) {
      line.items.push(rect);
      line.end = Math.max(line.end, end(rect, a));
    } else {
      lines.push({ start: rect[a.start], end: end(rect, a), items: [rect] });
    }
  }
  return lines.map((line) => line.items);
}

function span(rects: readonly Rect[], a: Axis): { start: number; end: number } {
  return { start: Math.min(...rects.map((r) => r[a.start])), end: Math.max(...rects.map((r) => end(r, a))) };
}

function band(main: Axis, mainStart: number, mainEnd: number, crossStart: number, crossEnd: number): Rect {
  return main === X
    ? { x: mainStart, y: crossStart, width: mainEnd - mainStart, height: crossEnd - crossStart }
    : { x: crossStart, y: mainStart, width: crossEnd - crossStart, height: mainEnd - mainStart };
}

/**
 * Flex gap bands. Sorting is by rect position, so `row-reverse`, `column-reverse`,
 * `wrap-reverse`, `order` and `direction: rtl` need no special handling: the visual
 * neighbours are the ones that get a band. Bands of zero or negative space are skipped.
 */
export function flexGapRegions<E>(input: FlexInput, element: E): SpacingRegion<E>[] {
  const column = input.flexDirection.startsWith("column");
  const main = column ? Y : X;
  const cross = column ? X : Y;
  const mainGap = column ? input.rowGap : input.columnGap;
  const crossGap = column ? input.columnGap : input.rowGap;
  const mainSide = column ? "row" : "column";
  const crossSide = column ? "column" : "row";
  const mainScale = column ? (input.scale?.y ?? 1) : (input.scale?.x ?? 1);
  const crossScale = column ? (input.scale?.x ?? 1) : (input.scale?.y ?? 1);
  const regions: SpacingRegion<E>[] = [];
  const children = input.children.filter((r) => r.width >= 0 && r.height >= 0);
  if (children.length < 2) return regions;
  const lines = groupLines(children, cross.start);
  let mainIndex = 0;
  for (const line of lines) {
    const ordered = [...line].sort((p, q) => p[main.start] - q[main.start]);
    const extent = span(line, cross);
    for (let i = 1; i < ordered.length; i++) {
      const from = end(ordered[i - 1], main);
      const to = ordered[i][main.start];
      if (to - from <= 0.01) continue;
      const measured = round((to - from) / mainScale);
      regions.push({
        kind: "gap",
        side: mainSide,
        rect: band(main, from, to, extent.start, extent.end),
        value: mainGap,
        element,
        index: mainIndex++,
        ...(Math.abs(measured - mainGap) > 0.5 ? { measured } : {}),
      });
    }
  }
  const mainExtent = { start: input.content[main.start], end: end(input.content, main) };
  for (let i = 1; i < lines.length; i++) {
    const from = span(lines[i - 1], cross).end;
    const to = span(lines[i], cross).start;
    if (to - from <= 0.01) continue;
    const measured = round((to - from) / crossScale);
    regions.push({
      kind: "gap",
      side: crossSide,
      rect: band(cross, from, to, mainExtent.start, mainExtent.end),
      value: crossGap,
      element,
      index: i - 1,
      ...(Math.abs(measured - crossGap) > 0.5 ? { measured } : {}),
    });
  }
  return regions;
}

export type GridTracks = { sizes: number[]; supported: boolean; reason?: string };

/**
 * Parses a computed `grid-template-columns/rows`. Chromium resolves it to px tracks,
 * including implicit tracks and expanded `repeat(auto-fill, ...)`. Line names are
 * dropped. `none`, `subgrid` or any non-px track is reported unsupported.
 */
export function parseGridTracks(value: string): GridTracks {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return { sizes: [], supported: false, reason: "no tracks" };
  if (trimmed.startsWith("subgrid")) return { sizes: [], supported: false, reason: "subgrid" };
  const tokens = trimmed.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean);
  const sizes: number[] = [];
  for (const token of tokens) {
    const match = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/.exec(token);
    if (!match) return { sizes: [], supported: false, reason: `unresolved track ${token}` };
    sizes.push(Number(match[1]));
  }
  return { sizes, supported: true };
}

export type GridInput = {
  content: Rect;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  rowGap: number;
  columnGap: number;
  /** Computed `justify-content` / `align-content` (start, end, center; others approximate). */
  justifyContent?: string;
  alignContent?: string;
  rtl?: boolean;
  scale?: { x: number; y: number };
};

/** Offset of the track block inside the content box for a content-distribution value. */
function alignOffset(free: number, value: string | undefined, reversed: boolean): { offset: number; exact: boolean } {
  const v = (value ?? "normal").replace(/^(safe|unsafe)\s+/, "");
  if (free <= 0) return { offset: 0, exact: true };
  if (v === "center") return { offset: free / 2, exact: true };
  if (v === "end" || v === "flex-end") return { offset: reversed ? 0 : free, exact: true };
  if (v === "start" || v === "flex-start" || v === "normal" || v === "stretch") return { offset: reversed ? free : 0, exact: true };
  if (v === "left") return { offset: 0, exact: true };
  if (v === "right") return { offset: free, exact: true };
  // space-between/around/evenly change the gaps themselves.
  return { offset: 0, exact: false };
}

/**
 * Grid gap bands from resolved tracks (spike, spec 3.3): one band per gutter spanning
 * the full track block, so spanning items do not split a band. Returns no regions with
 * a reason when the tracks cannot be modelled (subgrid, unresolved).
 */
export function gridGapRegions<E>(input: GridInput, element: E): { regions: SpacingRegion<E>[]; supported: boolean; reason?: string; approximate: boolean } {
  const cols = parseGridTracks(input.gridTemplateColumns);
  const rows = parseGridTracks(input.gridTemplateRows);
  if (!cols.supported || !rows.supported) {
    return { regions: [], supported: false, reason: cols.reason ?? rows.reason, approximate: false };
  }
  const sx = input.scale?.x ?? 1;
  const sy = input.scale?.y ?? 1;
  const colGap = input.columnGap * sx;
  const rowGap = input.rowGap * sy;
  const colSizes = cols.sizes.map((s) => s * sx);
  const rowSizes = rows.sizes.map((s) => s * sy);
  const total = (sizes: number[], gap: number) => sizes.reduce((sum, s) => sum + s, 0) + Math.max(0, sizes.length - 1) * gap;
  const width = total(colSizes, colGap);
  const height = total(rowSizes, rowGap);
  const jx = alignOffset(input.content.width - width, input.justifyContent, Boolean(input.rtl));
  const jy = alignOffset(input.content.height - height, input.alignContent, false);
  const left = input.content.x + jx.offset;
  const top = input.content.y + jy.offset;
  const regions: SpacingRegion<E>[] = [];
  const approximate = !jx.exact || !jy.exact;
  const flags = approximate ? { flags: ["approximate"] } : {};
  if (colGap > 0) {
    // In rtl, column 1 sits at the right edge; gutters are the same positions mirrored.
    let cursor = input.rtl ? left + width : left;
    for (let i = 0; i < colSizes.length - 1; i++) {
      cursor = input.rtl ? cursor - colSizes[i] : cursor + colSizes[i];
      const x = input.rtl ? cursor - colGap : cursor;
      regions.push({ kind: "gap", side: "column", rect: { x, y: top, width: colGap, height }, value: input.columnGap, element, index: i, ...flags });
      cursor = input.rtl ? cursor - colGap : cursor + colGap;
    }
  }
  if (rowGap > 0) {
    let cursor = top;
    for (let i = 0; i < rowSizes.length - 1; i++) {
      cursor += rowSizes[i];
      regions.push({ kind: "gap", side: "row", rect: { x: left, y: cursor, width, height: rowGap }, value: input.rowGap, element, index: i, ...flags });
      cursor += rowGap;
    }
  }
  return { regions, supported: true, approximate };
}
