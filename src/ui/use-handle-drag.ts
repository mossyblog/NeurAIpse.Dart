import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  dragDeltaToValue,
  edgePosition,
  oppositeProperty,
  sideAxis,
  snapToToken,
  type Axis,
  type ScaleStep,
  type SnapMode,
} from "../core/drag-guides.ts";
import { parsePx, regionProperty, type SpacingRegion } from "../core/spacing.ts";
import type { ElementSpacing } from "../core/spacing-dom.ts";
import { minFor } from "../core/style-change.ts";
import { elementSerial } from "./inspector-context.ts";

/** A region with live geometry, as the overlay draws it. */
export type HandleTarget = { spacing: ElementSpacing; region: SpacingRegion };

/** An active handle drag (spec 13.1). Geometry is frozen at pointerdown, in page px. */
export type HandleDrag = {
  key: string;
  element: Element;
  /** Region snapshot at pointerdown. */
  region: SpacingRegion;
  property: string;
  /** Cmd/Ctrl partner: the opposite side (a gap pairs row with column). */
  opposite: string;
  axis: Axis;
  /** Rendered px per CSS px on the drag axis. */
  elementScale: number;
  /** Gap only: the visual order on the gap's axis is reversed (RTL, reverse flex). */
  reversed: boolean;
  start: number;
  otherStart: number;
  startPage: number;
  /** Zero-value edge on the drag axis, page px: guides and the handle are placed from it. */
  anchorPage: number;
  mode: SnapMode;
  symmetric: boolean;
  moved: boolean;
  value: { px: number; token?: string };
};

type Modifiers = { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

/** Identity of a handle across redraws: element, property and gap index. */
export function handleKey(region: SpacingRegion): string {
  return `${elementSerial(region.element)}|${regionProperty(region)}|${region.index ?? 0}`;
}

/** Whether a gap grows against the axis: RTL / row-reverse for column gaps, column-reverse for row gaps. */
export function gapReversed(region: SpacingRegion): boolean {
  if (region.kind !== "gap") return false;
  const style = getComputedStyle(region.element);
  const flex = style.display.includes("flex");
  if (region.side === "column") return flex ? (style.direction === "rtl") !== (style.flexDirection === "row-reverse") : style.direction === "rtl";
  return flex && style.flexDirection === "column-reverse";
}

export const pageScroll = (axis: Axis) => (axis === "x" ? window.scrollX : window.scrollY);

/** Alt = free px, Shift = 8px grid, otherwise the token scale (spec 13.1). */
const modeOf = (m: Modifiers): SnapMode => (m.altKey ? "free" : m.shiftKey ? "grid8" : "token");

/**
 * After a cancel the capture is gone, so the click that ends the gesture lands on the page
 * (or the overlay host). Swallow that one click; the next press starts a fresh gesture.
 */
function swallowTrailingClick() {
  const done = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", done, true);
  };
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", done, true);
}

export type HandleDragOptions = {
  steps: ScaleStep[];
  /** Writes the live value (the transient preview draft). */
  onPreview: (drag: HandleDrag) => void;
  /** Release: the drag ended normally. */
  onFinish: (drag: HandleDrag) => void;
  /** Esc or a lost capture: the drag was cancelled. */
  onCancel: (drag: HandleDrag) => void;
  /** Pointerdown on a handle (the inspector selects that region). */
  onStart?: (target: HandleTarget) => void;
};

/**
 * Handle drag state machine (spec 13.1 drag flow): pointerdown captures the pointer on the
 * handle, each move turns the page-px delta from pointerdown into a value
 * (`dragDeltaToValue`, then `snapToToken`), release finishes, Esc cancels.
 */
export function useHandleDrag(options: HandleDragOptions) {
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const ref = useRef<HandleDrag | null>(null);
  const handle = useRef<{ el: Element; pointerId: number } | null>(null);
  const last = useRef<{ client: number } | null>(null);

  const compute = (d: HandleDrag, client: number, mods: Modifiers): HandleDrag => {
    let delta = client + pageScroll(d.axis) - d.startPage;
    // `dragDeltaToValue` flips the column gap for RTL; a reversed row gap is flipped here.
    if (d.region.side === "row" && d.reversed) delta = -delta;
    const mode = modeOf(mods);
    const raw = dragDeltaToValue(delta, options.steps, d.region.side, d.elementScale, d.region.side === "column" && d.reversed, { kind: d.region.kind, start: d.start });
    let value = snapToToken(raw, options.steps, mode);
    // Min 0; margins may go negative in free px only (spec 13.1 limits).
    const min = mode === "free" ? minFor(d.property) : 0;
    if (value.px < min) value = { px: min };
    return { ...d, mode, symmetric: d.region.kind !== "gap" && (mods.metaKey || mods.ctrlKey), moved: d.moved || delta !== 0, value };
  };

  const update = (next: HandleDrag) => {
    ref.current = next;
    setDrag(next);
    options.onPreview(next);
  };

  const release = () => {
    const h = handle.current;
    handle.current = null;
    if (h) {
      try {
        if (h.el.hasPointerCapture?.(h.pointerId)) h.el.releasePointerCapture(h.pointerId);
      } catch {
        // Already released.
      }
    }
  };

  const start = (event: PointerEvent, target: HandleTarget, el: Element) => {
    if (event.button !== 0 || ref.current) return;
    const { region, spacing } = target;
    const axis = sideAxis(region.side);
    const elementScale = (axis === "x" ? spacing.scale.x : spacing.scale.y) || 1;
    const reversed = gapReversed(region);
    const property = regionProperty(region);
    const opposite = oppositeProperty(property);
    const client = axis === "x" ? event.clientX : event.clientY;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Capture unsupported: the handle still gets the moves it is under.
    }
    handle.current = { el, pointerId: event.pointerId };
    last.current = { client };
    const d: HandleDrag = {
      key: handleKey(region),
      element: region.element,
      region,
      property,
      opposite,
      axis,
      elementScale,
      reversed,
      start: region.value,
      otherStart: parsePx(getComputedStyle(region.element).getPropertyValue(opposite)),
      startPage: client + pageScroll(axis),
      anchorPage: edgePosition(region.rect, region.kind, region.side, 0, elementScale, reversed) + pageScroll(axis),
      mode: modeOf(event),
      symmetric: region.kind !== "gap" && (event.metaKey || event.ctrlKey),
      moved: false,
      value: { px: region.value },
    };
    ref.current = d;
    setDrag(d);
    options.onStart?.(target);
  };

  const move = (event: PointerEvent) => {
    const d = ref.current;
    if (!d || handle.current?.pointerId !== event.pointerId) return;
    const client = d.axis === "x" ? event.clientX : event.clientY;
    last.current = { client };
    update(compute(d, client, event));
  };

  const finish = (event: PointerEvent) => {
    const d = ref.current;
    if (!d || handle.current?.pointerId !== event.pointerId) return;
    const client = d.axis === "x" ? event.clientX : event.clientY;
    const final = compute(d, client, event);
    ref.current = null;
    release();
    setDrag(null);
    options.onFinish(final);
  };

  /** Esc during a drag: restore and end. True when a drag was cancelled. */
  const cancel = (): boolean => {
    const d = ref.current;
    if (!d) return false;
    ref.current = null;
    release();
    swallowTrailingClick();
    setDrag(null);
    options.onCancel(d);
    return true;
  };

  // Modifier presses mid-drag re-snap at the last pointer position.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const d = ref.current;
    if (!d || !last.current || !["Alt", "Shift", "Meta", "Control"].includes(event.key)) return;
    update(compute(d, last.current.client, event));
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const key = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    };
  }, [dragging]);

  return { drag, start, move, finish, cancel };
}
