import type { DockSide } from "./types.ts";

/** Native DOM button size (px) rasterized at full crisp resolution before GPU scaling. */
export const DOCK_RENDER_SIZE = 36;
/** Fixed layout slot pitch (px) between adjacent notch icons (never mutates during hover). */
export const DOCK_SLOT_PITCH = 28;
/** Resting visual icon button size (px) on the unhovered side notch. */
export const DOCK_BASE_SIZE = 24;
/** Peak enlarged visual icon button size (px) directly under the pointer. */
export const DOCK_MAX_SIZE = 44;
/** Resting visual SVG icon size (px) inside each notch button. */
export const DOCK_BASE_ICON = 13;
/** Peak visual SVG icon size (px) inside the magnified notch button. */
export const DOCK_MAX_ICON = 23;
/** Vertical influence radius (px) for the smooth macOS Dock cosine falloff. */
export const DOCK_INFLUENCE_RADIUS = 72;
/** Maximum subtle inward lateral lift (px) on the magnified icon. */
export const DOCK_MAX_PROTRUSION = 5;
/** Concave Apple-notch corner fillet radius (px). */
export const NOTCH_FILLET_RADIUS = 12;
/** Minimum vertical clearance from the top/bottom viewport edges (px). */
export const NOTCH_EDGE_MARGIN = 20;

export type DockMetricsOptions = {
  baseSize?: number;
  maxSize?: number;
  baseIcon?: number;
  maxIcon?: number;
  renderSize?: number;
  radius?: number;
  maxProtrusion?: number;
};

export type DockItemMetrics = {
  /** Normalized magnification weight in [0, 1]. */
  factor: number;
  /** Target visual button width/height in px. */
  buttonSize: number;
  /** Target visual icon width/height in px. */
  iconSize: number;
  /** GPU transform scale relative to `DOCK_RENDER_SIZE`. */
  scale: number;
  /** Subtle inward lateral offset in px. */
  protrusion: number;
};

/**
 * Raised-cosine macOS Dock magnification curve in [0, 1].
 * Peaks at 1 when distance is 0 and smoothly reaches 0 at `radius`.
 */
export function dockMagnification(distance: number, radius = DOCK_INFLUENCE_RADIUS): number {
  if (!Number.isFinite(distance) || radius <= 0) return 0;
  const abs = Math.abs(distance);
  if (abs >= radius) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * abs) / radius));
}

/** Computes smooth dock sizing, GPU scale, and inward protrusion from a normalized factor in [0, 1]. */
export function dockMetricsForFactor(factor: number, options: DockMetricsOptions = {}): DockItemMetrics {
  const baseSize = options.baseSize ?? DOCK_BASE_SIZE;
  const maxSize = options.maxSize ?? DOCK_MAX_SIZE;
  const baseIcon = options.baseIcon ?? DOCK_BASE_ICON;
  const maxIcon = options.maxIcon ?? DOCK_MAX_ICON;
  const renderSize = options.renderSize ?? DOCK_RENDER_SIZE;
  const maxProtrusion = options.maxProtrusion ?? DOCK_MAX_PROTRUSION;

  const clamped = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 0;
  const buttonSize = baseSize + (maxSize - baseSize) * clamped;
  return {
    factor: clamped,
    buttonSize: Number(buttonSize.toFixed(2)),
    iconSize: Number((baseIcon + (maxIcon - baseIcon) * clamped).toFixed(2)),
    scale: Number((buttonSize / renderSize).toFixed(4)),
    protrusion: Number((maxProtrusion * clamped).toFixed(2)),
  };
}

/** Computes smooth dock sizing and inward protrusion for a single notch item. */
export function dockItemMetrics(
  pointerY: number | null,
  itemCenterY: number,
  options: DockMetricsOptions = {},
): DockItemMetrics {
  const radius = options.radius ?? DOCK_INFLUENCE_RADIUS;
  const factor = pointerY === null ? 0 : dockMagnification(pointerY - itemCenterY, radius);
  return dockMetricsForFactor(factor, options);
}

/**
 * Computes zero-overlap GPU vertical translateY offsets (px) for every icon so
 * magnified neighbors glide smoothly apart without triggering DOM layout reflow.
 */
export function computeDockOffsets(
  factors: readonly number[],
  pivotIndex: number | null,
  options: { baseSize?: number; maxSize?: number; slotPitch?: number; minGap?: number } = {},
): number[] {
  const count = factors.length;
  if (count === 0) return [];
  const baseSize = options.baseSize ?? DOCK_BASE_SIZE;
  const maxSize = options.maxSize ?? DOCK_MAX_SIZE;
  const slotPitch = options.slotPitch ?? DOCK_SLOT_PITCH;
  const minGap = options.minGap ?? 2;

  const extras = new Array<number>(count);
  let hasExtra = false;
  for (let i = 0; i < count; i++) {
    const visual = baseSize + (maxSize - baseSize) * Math.min(1, Math.max(0, factors[i] ?? 0));
    const extra = Math.max(0, visual - (slotPitch - minGap));
    extras[i] = extra;
    if (extra > 0.001) hasExtra = true;
  }
  if (!hasExtra) return new Array<number>(count).fill(0);

  const cum = new Array<number>(count);
  cum[0] = extras[0] / 2;
  for (let i = 1; i < count; i++) {
    cum[i] = cum[i - 1] + extras[i - 1] / 2 + extras[i] / 2;
  }

  let pivotOffset: number;
  if (pivotIndex === null || !Number.isFinite(pivotIndex)) {
    pivotOffset = (cum[0] + cum[count - 1]) / 2;
  } else {
    const clamped = Math.min(count - 1, Math.max(0, pivotIndex));
    const lo = Math.floor(clamped);
    const hi = Math.min(count - 1, lo + 1);
    const t = clamped - lo;
    pivotOffset = cum[lo] + (cum[hi] - cum[lo]) * t;
  }

  const offsets = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    offsets[i] = Number((cum[i] - pivotOffset).toFixed(2));
  }
  return offsets;
}

/** Clamps the notch vertical center so the entire notch stays within the viewport. */
export function clampNotchCenterY(
  centerY: number,
  notchHeight: number,
  viewportHeight: number,
  margin = NOTCH_EDGE_MARGIN,
): number {
  const safeViewport = Math.max(0, viewportHeight);
  const half = Math.max(0, notchHeight) / 2;
  const minCenter = half + margin;
  const maxCenter = safeViewport - half - margin;
  if (minCenter >= maxCenter) return Math.round(safeViewport / 2);
  return Math.round(Math.min(Math.max(minCenter, centerY), maxCenter));
}

/**
 * Resolves the target dock side while dragging horizontally, using a 10%
 * hysteresis band around the viewport midpoint so the notch does not flicker.
 */
export function resolveDraggedSide(
  pointerX: number,
  viewportWidth: number,
  currentSide: DockSide,
): DockSide {
  if (!Number.isFinite(pointerX) || viewportWidth <= 0) return currentSide;
  const ratio = pointerX / viewportWidth;
  if (currentSide === "right" && ratio < 0.45) return "left";
  if (currentSide === "left" && ratio > 0.55) return "right";
  return currentSide;
}
