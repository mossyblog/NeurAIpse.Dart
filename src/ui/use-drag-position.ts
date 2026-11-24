import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clampNotchCenterY, resolveDraggedSide } from "../core/dock.ts";
import { loadPosition, savePosition } from "../core/storage.ts";
import type { DockSide, Point } from "../core/types.ts";

export const LAUNCHER_HEIGHT = 76;
export const EXPANDED_NOTCH_ESTIMATE = 470;
const DRAG_THRESHOLD = 4;

type Size = { width: number; height: number };

function useViewport(): Size {
  const [viewport, setViewport] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

export type DragPointerHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

export type UseDragPositionOptions = {
  side: DockSide;
  onSideChange: (side: DockSide) => void;
  expanded?: boolean;
};

/**
 * Edge-docked side-notch positioning (left or right viewport edge), persisted at
 * `feedback-toolbar-position`. Drag vertically to slide along the edge, or drag
 * horizontally across the viewport midpoint to snap the notch to the opposite side.
 */
export function useDragPosition(onClick: () => void, options: UseDragPositionOptions) {
  const { side, onSideChange, expanded = false } = options;
  const viewport = useViewport();
  const [storedY, setStoredY] = useState<number>(() => {
    const saved = loadPosition();
    return saved ? saved.y : Math.round(window.innerHeight / 2);
  });
  const [notchHeight, setNotchHeight] = useState<number>(() =>
    expanded ? EXPANDED_NOTCH_ESTIMATE : LAUNCHER_HEIGHT,
  );
  const [liveDrag, setLiveDrag] = useState<{ centerY: number; side: DockSide } | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  const drag = useRef<{ start: Point; originY: number; side: DockSide; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!dockEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      // Never re-render Annotate during hover magnification frames.
      if (dockEl.getAttribute("data-dock-hovered") === "true") return;
      const rect = entries[0]?.contentRect ?? dockEl.getBoundingClientRect();
      if (rect.height > 0) {
        setNotchHeight((prev) => (Math.abs(prev - rect.height) < 1 ? prev : rect.height));
      }
    });
    observer.observe(dockEl);
    return () => observer.disconnect();
  }, [dockEl, expanded]);

  const effectiveHeight =
    notchHeight > 0 ? notchHeight : expanded ? EXPANDED_NOTCH_ESTIMATE : LAUNCHER_HEIGHT;
  const effectiveSide: DockSide = liveDrag ? liveDrag.side : side;
  const centerY = clampNotchCenterY(
    liveDrag ? liveDrag.centerY : storedY,
    effectiveHeight,
    viewport.height,
  );

  const beginDrag = (event: PointerEvent<HTMLElement>, preventDefault: boolean) => {
    if (event.button !== 0) return;
    if (preventDefault) event.preventDefault();
    suppressClick.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      start: { x: event.clientX, y: event.clientY },
      originY: centerY,
      side,
      moved: false,
    };
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.start.x;
    const dy = event.clientY - state.start.y;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    const nextSide = resolveDraggedSide(event.clientX, viewport.width, state.side);
    state.side = nextSide;
    const nextCenterY = clampNotchCenterY(state.originY + dy, effectiveHeight, viewport.height);
    setLiveDrag({ centerY: nextCenterY, side: nextSide });
  };

  const endDrag = (event: PointerEvent<HTMLElement>, suppressNextClick: boolean) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (state.moved) {
      if (suppressNextClick) suppressClick.current = true;
      const finalSide = resolveDraggedSide(event.clientX, viewport.width, state.side);
      const finalCenterY = clampNotchCenterY(
        state.originY + (event.clientY - state.start.y),
        effectiveHeight,
        viewport.height,
      );
      setStoredY(finalCenterY);
      savePosition({ x: finalSide === "left" ? 0 : viewport.width, y: finalCenterY });
      if (finalSide !== side) onSideChange(finalSide);
    }
    setLiveDrag(null);
  };

  const cancelDrag = () => {
    drag.current = null;
    setLiveDrag(null);
  };

  const handlers: DragPointerHandlers & { onClick: () => void } = {
    onPointerDown: (event) => beginDrag(event, false),
    onPointerMove: moveDrag,
    onPointerUp: (event) => endDrag(event, true),
    onPointerCancel: cancelDrag,
    onClick() {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onClick();
    },
  };

  const dragHandlers: DragPointerHandlers = {
    onPointerDown: (event) => beginDrag(event, true),
    onPointerMove: moveDrag,
    onPointerUp: (event) => endDrag(event, false),
    onPointerCancel: cancelDrag,
  };

  return {
    side: effectiveSide,
    centerY,
    dragging: liveDrag !== null,
    viewport,
    dockRef: setDockEl,
    handlers,
    dragHandlers,
  };
}
