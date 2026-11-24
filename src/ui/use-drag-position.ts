import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { loadPosition, savePosition } from "../core/storage.ts";
import type { Point } from "../core/types.ts";

export const LAUNCHER_SIZE = 40;
const EDGE = 16;
const DEFAULT_OFFSET = 24;
const DRAG_THRESHOLD = 4;

type Size = { width: number; height: number };

function clampBox(point: Point, box: Size, viewport: Size): Point {
  return {
    x: Math.min(Math.max(EDGE, point.x), Math.max(EDGE, viewport.width - box.width - EDGE)),
    y: Math.min(Math.max(EDGE, point.y), Math.max(EDGE, viewport.height - box.height - EDGE)),
  };
}

function clamp(point: Point, width: number, height: number): Point {
  return clampBox(point, { width: LAUNCHER_SIZE, height: LAUNCHER_SIZE }, { width, height });
}

function defaultPosition(): Point {
  return {
    x: window.innerWidth - LAUNCHER_SIZE - DEFAULT_OFFSET,
    y: window.innerHeight - LAUNCHER_SIZE - DEFAULT_OFFSET,
  };
}

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

/**
 * Launcher and expanded-toolbar dock position, persisted at `feedback-toolbar-position`.
 * `handlers` attaches to the collapsed launcher (drag + click); `dragHandlers` attaches
 * to the expanded toolbar's grip (pointer-only drag with smooth clamping and no edge flip).
 */
export function useDragPosition(onClick: () => void, expanded = false) {
  const viewport = useViewport();
  const [stored, setStored] = useState<Point>(() => loadPosition() ?? defaultPosition());
  const [dockSize, setDockSize] = useState<Size>({ width: LAUNCHER_SIZE, height: LAUNCHER_SIZE });
  const [liveDock, setLiveDock] = useState<{ x: number; y: number; right: boolean; bottom: boolean } | null>(null);
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null);
  const dockDrag = useRef<{ start: Point; origin: Point; size: Size; right: boolean; bottom: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const position = clamp(stored, viewport.width, viewport.height);

  useEffect(() => {
    if (!dockEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect ?? dockEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDockSize((prev) =>
          Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    });
    observer.observe(dockEl);
    return () => observer.disconnect();
  }, [dockEl, expanded]);

  const right = liveDock ? liveDock.right : position.x + LAUNCHER_SIZE / 2 > viewport.width / 2;
  const bottom = liveDock ? liveDock.bottom : position.y + LAUNCHER_SIZE / 2 > viewport.height / 2;

  const boxWidth = expanded ? Math.max(LAUNCHER_SIZE, dockSize.width) : LAUNCHER_SIZE;
  const boxHeight = expanded ? Math.max(LAUNCHER_SIZE, dockSize.height) : LAUNCHER_SIZE;

  const anchor: CSSProperties = liveDock
    ? { left: liveDock.x, top: liveDock.y }
    : {
        ...(right
          ? { right: Math.min(Math.max(EDGE, viewport.width - position.x - LAUNCHER_SIZE), Math.max(EDGE, viewport.width - boxWidth - EDGE)) }
          : { left: Math.min(Math.max(EDGE, position.x), Math.max(EDGE, viewport.width - boxWidth - EDGE)) }),
        ...(bottom
          ? { bottom: Math.min(Math.max(EDGE, viewport.height - position.y - LAUNCHER_SIZE), Math.max(EDGE, viewport.height - boxHeight - EDGE)) }
          : { top: Math.min(Math.max(EDGE, position.y), Math.max(EDGE, viewport.height - boxHeight - EDGE)) }),
      };

  const handlers: DragPointerHandlers & { onClick: () => void } = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      suppressClick.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { start: { x: event.clientX, y: event.clientY }, origin: position, moved: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const state = drag.current;
      if (!state) return;
      const dx = event.clientX - state.start.x;
      const dy = event.clientY - state.start.y;
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.moved = true;
      setStored(clamp({ x: state.origin.x + dx, y: state.origin.y + dy }, viewport.width, viewport.height));
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const state = drag.current;
      drag.current = null;
      if (!state) return;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (state.moved) {
        suppressClick.current = true;
        savePosition(clamp(
          { x: state.origin.x + event.clientX - state.start.x, y: state.origin.y + event.clientY - state.start.y },
          viewport.width,
          viewport.height,
        ));
      }
    },
    onClick() {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onClick();
    },
    onPointerCancel() {
      drag.current = null;
    },
  };

  const dragHandlers: DragPointerHandlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = dockEl?.getBoundingClientRect();
      const size = rect && rect.width > 0 ? { width: rect.width, height: rect.height } : dockSize;
      const origin = rect ? { x: rect.left, y: rect.top } : position;
      dockDrag.current = {
        start: { x: event.clientX, y: event.clientY },
        origin,
        size,
        right,
        bottom,
        moved: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const state = dockDrag.current;
      if (!state) return;
      const dx = event.clientX - state.start.x;
      const dy = event.clientY - state.start.y;
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.moved = true;
      const next = clampBox({ x: state.origin.x + dx, y: state.origin.y + dy }, state.size, viewport);
      setLiveDock({ x: next.x, y: next.y, right: state.right, bottom: state.bottom });
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const state = dockDrag.current;
      dockDrag.current = null;
      if (!state) return;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (state.moved) {
        const next = clampBox(
          { x: state.origin.x + event.clientX - state.start.x, y: state.origin.y + event.clientY - state.start.y },
          state.size,
          viewport,
        );
        const nextRight = next.x + state.size.width / 2 > viewport.width / 2;
        const nextBottom = next.y + state.size.height / 2 > viewport.height / 2;
        const persisted = clamp(
          {
            x: nextRight ? next.x + state.size.width - LAUNCHER_SIZE : next.x,
            y: nextBottom ? next.y + state.size.height - LAUNCHER_SIZE : next.y,
          },
          viewport.width,
          viewport.height,
        );
        setStored(persisted);
        savePosition(persisted);
      }
      setLiveDock(null);
    },
    onPointerCancel() {
      dockDrag.current = null;
      setLiveDock(null);
    },
  };

  return { position, viewport, anchor, right, bottom, dockRef: setDockEl, handlers, dragHandlers };
}
