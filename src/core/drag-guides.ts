import type { SpacingKind, SpacingSide } from "./spacing.ts";
import type { Rect } from "./types.ts";

/**
 * Drag handles and token guides (inspector spec 13, phase I9). Pure functions: the
 * spacing scale comes in as data (read from `:root` at runtime by the caller), geometry
 * as viewport rects. Handles and guides share `guideLines`, so a handle snaps exactly
 * onto the guide drawn for the same token.
 */

/** One step of the spacing scale. `token` is the record token (`--spacing × 6`, `--spacing-lg`). */
export type ScaleStep = { px: number; token: string };
export type SnapMode = "token" | "grid8" | "free";
export type Axis = "x" | "y";

const GRID8 = 8;
const EPS = 0.01;

/** Sorted ascending, non-negative, one step per px (the first listed wins a tie). */
export function normalizeScale(scale: readonly ScaleStep[]): ScaleStep[] {
  const sorted = scale.filter((s) => Number.isFinite(s.px) && s.px >= 0).map((s, i) => ({ s, i }));
  sorted.sort((a, b) => a.s.px - b.s.px || a.i - b.i);
  const out: ScaleStep[] = [];
  for (const { s } of sorted) if (!out.length || Math.abs(out[out.length - 1].px - s.px) > EPS) out.push({ px: s.px, token: s.token });
  return out;
}

const gridSnap = (value: number) => Math.max(0, Math.floor(value / GRID8 + 0.5) * GRID8);

/**
 * Snaps a raw drag value (spec 13.4). `token`: nearest scale step, midpoint ties round
 * up, below 0 clamps to 0, above the max returns the max. `grid8`: nearest multiple of 8
 * (never negative), no token. `free`: the value rounded to 1px, sign kept (margins may go
 * negative here only). An empty scale falls back to `grid8`.
 */
export function snapToToken(value: number, scale: readonly ScaleStep[], mode: SnapMode): { px: number; token?: string } {
  if (mode === "free") return { px: Math.round(value) };
  const steps = normalizeScale(scale);
  if (mode === "grid8" || steps.length === 0) return { px: gridSnap(value) };
  const v = Math.max(0, value);
  let best = steps[0];
  for (const step of steps) {
    const d = Math.abs(step.px - v);
    const bestD = Math.abs(best.px - v);
    // Later steps are larger: `<=` makes an exact midpoint round up.
    if (d < bestD - 1e-9 || Math.abs(d - bestD) <= 1e-9) best = step;
    if (step.px > v && d > bestD) break;
  }
  return { px: best.px, token: best.token };
}

/**
 * Guide steps around a value: up to `down` steps below, the current value (always, with
 * its token when it sits on one, else an empty token), then up to `up` steps above, in
 * ascending px. Value 0 has nothing below.
 */
export function guideOffsets(value: number, scale: readonly ScaleStep[], up: number, down: number): { px: number; token: string; current: boolean }[] {
  const steps = normalizeScale(scale);
  const on = steps.find((s) => Math.abs(s.px - value) <= EPS);
  const lower = steps.filter((s) => s.px < value - EPS);
  const below = down > 0 ? lower.slice(-down) : [];
  const above = steps.filter((s) => s.px > value + EPS).slice(0, Math.max(0, up));
  return [
    ...below.map((s) => ({ px: s.px, token: s.token, current: false })),
    { px: value, token: on?.token ?? "", current: true },
    ...above.map((s) => ({ px: s.px, token: s.token, current: false })),
  ];
}

/** Drag axis of a region side: top/bottom/row on Y, left/right/column on X (spec 13.1). */
export function sideAxis(side: SpacingSide): Axis {
  return side === "left" || side === "right" || side === "column" ? "x" : "y";
}

/**
 * Viewport direction (+1 right/down, -1 left/up) in which the handle edge moves when the
 * value grows. Padding: the inner edge moves inward. Margin: the outer edge moves outward.
 * Gap: the far edge moves along the visual order; `reversed` (RTL or reverse flex on the
 * gap's axis) flips it. Physical left/right sides never flip: they are physical properties.
 */
export function growDirection(kind: SpacingKind, side: SpacingSide, reversed = false): 1 | -1 {
  if (kind === "gap") return reversed ? -1 : 1;
  const inward = side === "top" || side === "left" ? 1 : -1;
  return (kind === "padding" ? inward : -inward) as 1 | -1;
}

/**
 * Raw px value for a drag (spec 13.4), before snapping. `delta` is viewport px along the
 * region axis from the pointerdown position; it is divided by the element's rendered
 * scale. `rtl` flips the column gap (the visual order runs right to left); physical
 * left/right sides keep their sign. `options.start` is the value at pointerdown (zero
 * delta returns it unchanged) and `options.kind` picks padding vs margin direction. With a
 * scale, the result stays within twice its largest step so a runaway drag is bounded.
 */
export function dragDeltaToValue(
  delta: number,
  scale: readonly ScaleStep[],
  side: SpacingSide,
  elementScale: number,
  rtl: boolean,
  options: { kind?: SpacingKind; start?: number } = {},
): number {
  const start = options.start ?? 0;
  if (delta === 0) return start;
  const kind = options.kind ?? (side === "row" || side === "column" ? "gap" : "padding");
  const reversed = kind === "gap" && side === "column" && rtl;
  const s = Number.isFinite(elementScale) && elementScale > 0 ? elementScale : 1;
  const raw = start + (growDirection(kind, side, reversed) * delta) / s;
  const steps = normalizeScale(scale);
  if (!steps.length) return raw;
  const bound = Math.max(steps[steps.length - 1].px * 2, Math.abs(start));
  return Math.min(bound, Math.max(-bound, raw));
}

/** One drawn guide: `pos` is the viewport coordinate on the region axis. */
export type GuideLine = { px: number; token: string; current: boolean; pos: number };

/**
 * Where the region's handle edge sits for a value `px`: the zero-value anchor (the band
 * edge that does not move) plus `px` scaled. Derived from a rect drawn at the current
 * value, so the current value maps back onto the drawn edge. The handle sits there (gaps: centred on the band).
 */
export function edgePosition(rect: Rect, kind: SpacingKind, side: SpacingSide, px: number, elementScale: number, reversed = false): number {
  const axis = sideAxis(side);
  const dir = growDirection(kind, side, reversed);
  const start = axis === "x" ? rect.x : rect.y;
  const length = axis === "x" ? rect.width : rect.height;
  // The fixed edge: start for growth in +, end for growth in -. Negative margins draw at 0
  // thickness on the border edge, which is the fixed edge too.
  const anchor = dir > 0 ? start : start + length;
  return anchor + dir * px * elementScale;
}

/**
 * Guide lines for a region (spec 13.3): `guideOffsets` placed with `edgePosition`, minus
 * lines more than `threshold` px outside the viewport extent on that axis.
 */
export function guideLines(input: {
  rect: Rect;
  kind: SpacingKind;
  side: SpacingSide;
  value: number;
  scale: readonly ScaleStep[];
  elementScale: number;
  reversed?: boolean;
  up?: number;
  down?: number;
  viewport: { width: number; height: number };
  threshold?: number;
}): GuideLine[] {
  const { rect, kind, side, value, scale, elementScale, reversed = false, up = 4, down = 2, viewport, threshold = 24 } = input;
  const extent = sideAxis(side) === "x" ? viewport.width : viewport.height;
  return guideOffsets(value, scale, up, down)
    .map((g) => ({ ...g, pos: edgePosition(rect, kind, side, g.px, elementScale, reversed) }))
    .filter((g) => g.pos >= -threshold && g.pos <= extent + threshold);
}

/** Tailwind utility prefix for a spacing property: `pt`, `ml`, `gap-y`, `gap-x`. */
export function utilityPrefix(property: string): string {
  if (property === "row-gap") return "gap-y";
  if (property === "column-gap") return "gap-x";
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(property);
  return m ? `${m[1][0]}${m[2][0]}` : property;
}

/** Human label of a scale token for a property: `--spacing × 6` on padding-top -> `pt-6`. */
export function stepLabel(property: string, token: string | undefined): string | undefined {
  if (!token) return undefined;
  const m = /^--spacing × (-?\d*\.?\d+)$/.exec(token);
  if (m) return `${utilityPrefix(property)}-${m[1]}`;
  if (token === "--spacing") return `${utilityPrefix(property)}-1`;
  return token;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Mode segment of the drag label: how the value was snapped. */
export const SNAP_MODE_LABEL: Readonly<Record<SnapMode, string>> = Object.freeze({ token: "token", grid8: "8px grid", free: "free px" });

/**
 * Floating drag label (spec 13.1): `old → new · token · mode`, e.g. `16 → 24 · pt-6 · token`,
 * `16 → 21 · no token · free px`, `16 → 24 · no token · 8px grid`. A symmetric (Cmd/Ctrl)
 * drag names both sides and says so: `8/16 → 24 · pt-6 + pb-6 · token + both sides`.
 */
export function dragLabel(input: { from: number; to: number; mode: SnapMode; labels: (string | undefined)[]; otherFrom?: number; symmetric?: boolean }): string {
  const from = input.otherFrom != null && Math.abs(input.otherFrom - input.from) > EPS ? `${fmt(input.from)}/${fmt(input.otherFrom)}` : fmt(input.from);
  const names = input.labels.filter((l): l is string => Boolean(l));
  const token = input.mode === "token" && names.length ? names.join(" + ") : "no token";
  const mode = `${SNAP_MODE_LABEL[input.mode]}${input.symmetric ? " + both sides" : ""}`;
  return `${from} → ${fmt(input.to)} · ${token} · ${mode}`;
}

/**
 * Opposite side for a symmetric (Cmd/Ctrl) drag: top/bottom, left/right. A gap is one
 * shared value (spec 14.2), so it has no opposite and maps to itself.
 */
export function oppositeProperty(property: string): string {
  const pairs: Record<string, string> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(property);
  return m ? `${m[1]}-${pairs[m[2]]}` : property;
}
