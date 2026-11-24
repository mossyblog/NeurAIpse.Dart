import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "./primitives.tsx";
import { cn } from "cn";
import { CopyPlus, MessageSquare, Trash2, Type } from "lucide-react";
import { identifyElement } from "../core/identify.ts";
import { componentLabel, type PaletteItem } from "../core/layout-palette.ts";
import {
  createPlacement,
  duplicatePlacement,
  isPlacement,
  moveRect,
  nudgeDelta,
  placementRect,
  rectAround,
  resizeRect,
  RESIZE_HANDLES,
  withNear,
  withPlacementRect,
  withPlacementText,
  type NearElement,
  type PlacementAnnotation,
  type ResizeHandle,
} from "../core/layout-placement.ts";
import { applyResizeSnap, resizeSnapLines, snapRect } from "../core/rearrange-geometry.ts";
import { unionRect } from "../core/select.ts";
import { isEditableElement } from "../core/shortcuts.ts";
import { spacingTokens } from "../core/style-change.ts";
import { readRootVars } from "../core/tokens-dom.ts";
import type { Annotation, Point, Rect } from "../core/types.ts";
import { FIELD_CLASS, PILL_CLASS, SURFACE_CLASS, ToolbarDivider } from "./chrome.tsx";
import { LayoutPalette } from "./layout-palette.tsx";
import { Wireframe } from "./layout-wireframes.tsx";
import { Popup } from "./popup.tsx";
import { realTarget, type Surface } from "./shadow-surface.ts";

export type LayoutModeProps = {
  placements: readonly PlacementAnnotation[];
  /** Layout mode is on: palette, drop, select, move, resize and keys. Off: outlines only. */
  interactive: boolean;
  /** Show numbered marker and comment badges (hidden when overlay is collapsed for a clean preview). */
  showChrome?: boolean;
  accent: string;
  surface: Surface;
  attributeNames: readonly string[];
  /** Esc hook: returns true when the layout UI consumed Esc (edit, ghost, selection). */
  setEscape: (handler: (() => boolean) | null) => void;
  /** Applies an update to the route's annotation list. */
  apply: (update: (list: Annotation[]) => Annotation[]) => void;
  onAdd: (annotation: Annotation) => void;
  onUpdate: (annotation: Annotation) => void;
  onDelete: (annotation: Annotation) => void;
};

type Gesture =
  | { kind: "move"; start: Point; origin: Record<string, Rect>; moved: boolean }
  | { kind: "resize"; start: Point; id: string; handle: ResizeHandle; origin: Rect; moved: boolean }
  | { kind: "palette"; start: Point; item: PaletteItem; moved: boolean };

/** Pointer travel (px) before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

const HANDLE_POSITION: Record<ResizeHandle, CSSProperties> = {
  nw: { left: 0, top: 0, cursor: "nwse-resize" },
  n: { left: "50%", top: 0, cursor: "ns-resize" },
  ne: { left: "100%", top: 0, cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: 0, top: "100%", cursor: "nesw-resize" },
  w: { left: 0, top: "50%", cursor: "ew-resize" },
};

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function contains(rect: DOMRect | undefined, point: Point): boolean {
  return Boolean(rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

function TextEditor({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  return (
    <input
      ref={field}
      defaultValue={initial}
      aria-label="Placement text"
      data-annotate-placement-text-input=""
      placeholder="Text"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onDone(event.currentTarget.value);
        }
      }}
      onBlur={(event) => onDone(event.currentTarget.value)}
      className={cn(FIELD_CLASS, "pointer-events-auto absolute top-1/2 left-1/2 w-[min(100%,240px)] min-w-24 -translate-x-1/2 -translate-y-1/2 shadow-sm")}
    />
  );
}

/**
 * Layout mode (parity spec 10): a palette of wireframe components dropped on the page as
 * `kind: "placement"` annotations. Placements live in document px (a page layer shifted
 * by the scroll, like markers) and stay visible as numbered outlines outside the mode.
 */
const readGridSnapping = (): { gridStep: number; gapSteps: number[] } => {
  const rootFontPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const tokens = spacingTokens(readRootVars(document), rootFontPx);
  const gapSteps = Array.from(new Set(tokens.map((t) => Math.round(t.px)).filter((px) => px > 0))).sort((a, b) => a - b);
  const base = gapSteps.find((px) => px >= 4 && px <= 16);
  return { gridStep: base ?? 8, gapSteps };
};

export function LayoutMode(props: LayoutModeProps) {
  const { placements, interactive, showChrome = true, surface, attributeNames, apply } = props;
  const [armed, setArmed] = useState<PaletteItem | null>(null);
  const [ghost, setGhost] = useState<Point | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, Rect> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const gesture = useRef<Gesture | null>(null);
  const palette = useRef<HTMLDivElement>(null);
  const pageLayer = useRef<HTMLDivElement>(null);

  const byId = new Map(placements.map((p) => [p.id, p]));
  const live = selected.filter((id) => byId.has(id));

  useEffect(() => {
    const sync = () => {
      if (pageLayer.current) pageLayer.current.style.transform = `translate(${-window.scrollX}px, ${-window.scrollY}px)`;
    };
    const resize = () => {
      sync();
      setViewportWidth(window.innerWidth);
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", resize);
    };
  }, []);

  /** identifyElement of the page element under a document rect's centre; null when off screen. */
  const nearAt = (rect: Rect): NearElement | null => {
    const x = rect.x + rect.width / 2 - window.scrollX;
    const y = rect.y + rect.height / 2 - window.scrollY;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
    const el = document
      .elementsFromPoint(x, y)
      .find((node) => node !== surface.host && node.getRootNode() !== surface.shadow && node !== document.documentElement);
    return identifyElement(el ?? document.body, attributeNames);
  };

  const otherPlacementRects = (excludeIds: readonly string[]): Rect[] =>
    placements.filter((p) => !excludeIds.includes(p.id)).map((p) => placementRect(p, window.innerWidth));

  const drop = (item: PaletteItem, client: Point, bypassSnap = false) => {
    let rect = rectAround({ x: client.x + window.scrollX, y: client.y + window.scrollY }, item);
    if (!bypassSnap) {
      const { gridStep, gapSteps } = readGridSnapping();
      const snap = snapRect(rect, otherPlacementRects([]), { gridStep, gapSteps });
      rect = moveRect(rect, snap.dx, snap.dy);
    }
    const placement = createPlacement({
      id: createId(),
      componentType: item.type,
      rect,
      viewportWidth: window.innerWidth,
      scrollY: window.scrollY,
      timestamp: Date.now(),
      near: nearAt(rect) ?? identifyElement(document.body, attributeNames),
    });
    apply((list) => [...list, placement]);
    props.onAdd(placement);
    setSelected([placement.id]);
    setArmed(null);
    setGhost(null);
  };

  const commitRects = (rects: Record<string, Rect>) => {
    const changed: Annotation[] = [];
    const stamp = new Date().toISOString();
    apply((list) =>
      list.map((a) => {
        const rect = rects[a.id];
        if (!rect || !isPlacement(a)) return a;
        let next = withPlacementRect(a, rect, window.innerWidth);
        const near = nearAt(rect);
        if (near) next = withNear(next, near);
        next = { ...next, updatedAt: stamp };
        changed.push(next);
        return next;
      }),
    );
    changed.forEach(props.onUpdate);
  };

  const patch = (id: string, update: (p: PlacementAnnotation) => PlacementAnnotation) => {
    const changed: Annotation[] = [];
    apply((list) =>
      list.map((a) => {
        if (a.id !== id || !isPlacement(a)) return a;
        const next = update(a);
        if (next === a) return a;
        const stamped = { ...next, updatedAt: new Date().toISOString() };
        changed.push(stamped);
        return stamped;
      }),
    );
    changed.forEach(props.onUpdate);
  };

  const remove = (ids: readonly string[]) => {
    const removed = placements.filter((p) => ids.includes(p.id));
    if (removed.length === 0) return;
    apply((list) => list.filter((a) => !ids.includes(a.id)));
    removed.forEach(props.onDelete);
    setSelected([]);
    setEditing(null);
    setCommentId(null);
  };

  const duplicate = (ids: readonly string[]) => {
    const copies = ids.flatMap((id) => {
      const source = byId.get(id);
      if (!source) return [];
      const copy = duplicatePlacement(source, createId(), Date.now(), window.innerWidth);
      const near = nearAt(placementRect(copy, window.innerWidth));
      return [near ? withNear(copy, near) : copy];
    });
    if (copies.length === 0) return;
    apply((list) => [...list, ...copies]);
    copies.forEach(props.onAdd);
    setSelected(copies.map((c) => c.id));
  };

  const rectFor = (p: PlacementAnnotation) => draft?.[p.id] ?? placementRect(p, viewportWidth);

  const draftFrom = (g: Gesture, point: Point, bypassSnap = false): Record<string, Rect> | null => {
    let dx = point.x - g.start.x;
    let dy = point.y - g.start.y;
    if (g.kind === "move") {
      const ids = Object.keys(g.origin);
      const movedRects = Object.values(g.origin).map((r) => moveRect(r, dx, dy));
      if (!bypassSnap && movedRects.length > 0) {
        const union = unionRect(movedRects);
        if (union) {
          const { gridStep, gapSteps } = readGridSnapping();
          const snap = snapRect(union, otherPlacementRects(ids), { gridStep, gapSteps });
          dx += snap.dx;
          dy += snap.dy;
        }
      }
      return Object.fromEntries(Object.entries(g.origin).map(([id, r]) => [id, moveRect(r, dx, dy)]));
    }
    if (g.kind === "resize") {
      let next = resizeRect(g.origin, g.handle, dx, dy);
      if (!bypassSnap) {
        const { gridStep, gapSteps } = readGridSnapping();
        const snap = snapRect(next, otherPlacementRects([g.id]), { lines: resizeSnapLines(g.handle), gridStep, gapSteps });
        next = applyResizeSnap(next, g.handle, snap.dx, snap.dy);
      }
      return { [g.id]: next };
    }
    return null;
  };

  const onWindowMove = useEffectEvent((event: PointerEvent) => {
    const point = { x: event.clientX, y: event.clientY };
    const g = gesture.current;
    // No ghost over the palette: dropping there cancels.
    const ghostAt = contains(palette.current?.getBoundingClientRect(), point) ? null : point;
    if (!g) {
      if (armed) setGhost(ghostAt);
      return;
    }
    if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) < DRAG_THRESHOLD) return;
    g.moved = true;
    if (g.kind === "palette") {
      if (armed?.type !== g.item.type) setArmed(g.item);
      setGhost(ghostAt);
      return;
    }
    setDraft(draftFrom(g, point, event.altKey));
  });

  const onWindowUp = useEffectEvent((event: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const point = { x: event.clientX, y: event.clientY };
    if (g.kind === "palette") {
      if (!g.moved) {
        // A click arms the item (or disarms it); the ghost appears once the pointer moves.
        setArmed(armed?.type === g.item.type ? null : g.item);
        setGhost(null);
      } else if (contains(palette.current?.getBoundingClientRect(), point)) {
        setArmed(null);
        setGhost(null);
      } else {
        drop(g.item, point, event.altKey);
      }
      return;
    }
    setDraft(null);
    if (!g.moved) return;
    const rects = draftFrom(g, point, event.altKey);
    if (rects) commitRects(rects);
  });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isEditableElement(realTarget(event)) || live.length === 0 || editing || commentId) return;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Delete" || event.key === "Backspace") {
      consume();
      remove(live);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "d") {
      consume();
      if (!event.repeat) duplicate(live);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const delta = nudgeDelta(event.key, event.shiftKey);
    if (!delta) return;
    consume();
    commitRects(
      Object.fromEntries(
        live.flatMap((id) => {
          const p = byId.get(id);
          return p ? [[id, moveRect(placementRect(p, window.innerWidth), delta.dx, delta.dy)]] : [];
        }),
      ),
    );
  });

  const onEscape = useEffectEvent((): boolean => {
    if (editing) {
      setEditing(null);
      return true;
    }
    if (commentId) {
      setCommentId(null);
      return true;
    }
    if (armed || gesture.current?.kind === "palette") {
      gesture.current = null;
      setArmed(null);
      setGhost(null);
      return true;
    }
    if (live.length > 0) {
      setSelected([]);
      return true;
    }
    return false;
  });

  const { setEscape } = props;
  useEffect(() => {
    if (!interactive) return;
    const move = (event: PointerEvent) => onWindowMove(event);
    const up = (event: PointerEvent) => onWindowUp(event);
    const key = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    setEscape(() => onEscape());
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      setEscape(null);
    };
  }, [interactive, setEscape]);

  const begin = (g: Gesture, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    gesture.current = g;
  };

  const onCanvasDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (armed) {
      drop(armed, { x: event.clientX, y: event.clientY });
      return;
    }
    setSelected([]);
    setEditing(null);
    setCommentId(null);
  };

  const onBoxDown = (p: PlacementAnnotation, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    if (armed) {
      event.preventDefault();
      event.stopPropagation();
      drop(armed, { x: event.clientX, y: event.clientY });
      return;
    }
    if (editing === p.id) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let next = live;
    if (additive) next = live.includes(p.id) ? live.filter((id) => id !== p.id) : [...live, p.id];
    else if (!live.includes(p.id)) next = [p.id];
    setSelected(next);
    setCommentId(null);
    if (!next.includes(p.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const origin = Object.fromEntries(
      next.flatMap((id) => {
        const item = byId.get(id);
        return item ? [[id, placementRect(item, window.innerWidth)]] : [];
      }),
    );
    begin({ kind: "move", start: { x: event.clientX, y: event.clientY }, origin, moved: false }, event);
  };

  const single = live.length === 1 && !draft ? byId.get(live[0]) : undefined;
  const commentTarget = commentId ? byId.get(commentId) : undefined;
  const commentRect = commentTarget ? placementRect(commentTarget, viewportWidth) : null;

  return (
    <>
      {interactive && (
        <div
          data-annotate-layout-canvas=""
          className="pointer-events-auto fixed inset-0"
          style={{ cursor: armed ? "crosshair" : "default" }}
          onPointerDown={onCanvasDown}
        />
      )}
      <div ref={pageLayer} data-annotate-layout-layer="" className="pointer-events-none absolute top-0 left-0">
        {placements.map((p, index) => {
          const rect = rectFor(p);
          const isSelected = interactive && live.includes(p.id);
          const label = componentLabel(p.placement.componentType);
          const markerInset = rect.x - window.scrollX < 32;
          const actionsBelow = rect.y - window.scrollY < 44;
          const actionsLeft = rect.x + rect.width - window.scrollX < 140;
          return (
            <div
              key={p.id}
              role="group"
              aria-label={`Placement ${index + 1}: ${label}`}
              title={p.comment || label}
              data-annotate-placement={p.id}
              data-placement-type={p.placement.componentType}
              data-placement-index={index + 1}
              data-selected={isSelected || undefined}
              onPointerDown={(event) => onBoxDown(p, event)}
              onDoubleClick={() => {
                if (!interactive) return;
                setSelected([p.id]);
                setEditing(p.id);
              }}
              className={interactive ? "pointer-events-auto absolute cursor-move touch-none rounded-md bg-background/90 select-none" : "absolute rounded-md bg-background/90"}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                outline: isSelected ? `2px solid ${props.accent}` : "1.5px dashed color-mix(in oklch, var(--muted-foreground) 65%, transparent)",
                outlineOffset: isSelected ? 2 : 0,
                boxShadow: isSelected ? `0 0 0 4px color-mix(in oklch, ${props.accent} 16%, transparent)` : undefined,
              }}
            >
              <Wireframe type={p.placement.componentType} width={rect.width} height={rect.height} className="absolute inset-0" />
              {p.placement.text && editing !== p.id && (
                <span
                  data-annotate-placement-text=""
                  className={cn(PILL_CLASS, "absolute top-1/2 left-1/2 max-w-[calc(100%-12px)] -translate-x-1/2 -translate-y-1/2 truncate px-1.5 py-0.5 text-xs font-medium")}
                >
                  {p.placement.text}
                </span>
              )}
              {editing === p.id && (
                <TextEditor
                  initial={p.placement.text ?? ""}
                  onDone={(value) => {
                    setEditing(null);
                    if (value != null)
                      patch(p.id, (current) => {
                        const next = withPlacementText(current, value);
                        return next.placement.text === current.placement.text ? current : next;
                      });
                  }}
                />
              )}
              {showChrome && (
                <span
                  aria-hidden
                  data-annotate-placement-marker={index + 1}
                  className={cn(
                    "absolute flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-semibold text-white tabular-nums shadow-sm ring-2 ring-background",
                    markerInset ? "top-1.5 left-1.5" : "top-0 right-full mr-2",
                  )}
                  style={{ backgroundColor: props.accent, textShadow: "0 1px 1px rgba(0, 0, 0, 0.3)" }}
                >
                  {index + 1}
                </span>
              )}
              {showChrome && p.comment && (
                <span
                  aria-hidden
                  data-annotate-placement-has-comment=""
                  className={cn(PILL_CLASS, "absolute flex size-6 items-center justify-center", markerInset ? "top-1.5 left-9" : "top-7 right-full mr-2")}
                >
                  <MessageSquare className="size-3" />
                </span>
              )}
              {single?.id === p.id && editing !== p.id && (
                <>
                  {RESIZE_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      data-annotate-resize-handle={handle}
                      aria-label={`Resize ${handle}`}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        begin({ kind: "resize", start: { x: event.clientX, y: event.clientY }, id: p.id, handle, origin: placementRect(p, window.innerWidth), moved: false }, event);
                      }}
                      className="group pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
                      style={HANDLE_POSITION[handle]}
                    >
                      <span
                        className="size-2.5 rounded-[3px] bg-background shadow-xs ring-2 transition-transform group-hover:scale-125"
                        style={{ ["--tw-ring-color" as string]: props.accent }}
                      />
                    </span>
                  ))}
                  <div
                    data-annotate-placement-actions=""
                    onPointerDown={(event) => event.stopPropagation()}
                    className={cn(
                      SURFACE_CLASS,
                      "pointer-events-auto absolute flex items-center gap-0.5 rounded-lg p-1",
                      actionsBelow ? "top-full mt-2" : "bottom-full mb-2",
                      actionsLeft ? "left-0" : "right-0",
                    )}
                  >
                    <Button variant="ghost" size="icon-xs" aria-label="Edit text" title="Edit text (double-click)" data-annotate-placement-action="text" onClick={() => setEditing(p.id)}>
                      <Type />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Comment" title="Comment" data-annotate-placement-action="comment" onClick={() => setCommentId(p.id)}>
                      <MessageSquare />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Duplicate" title="Duplicate (Cmd/Ctrl+D)" data-annotate-placement-action="duplicate" onClick={() => duplicate([p.id])}>
                      <CopyPlus />
                    </Button>
                    <ToolbarDivider className="mx-0.5 h-3.5" />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete placement"
                      title="Delete (Delete/Backspace)"
                      data-annotate-placement-action="delete"
                      className="hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => remove([p.id])}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {interactive && armed && ghost && (
        <div
          data-annotate-layout-ghost={armed.type}
          className="pointer-events-none fixed rounded-md bg-background/85 opacity-85 shadow-sm backdrop-blur-xs"
          style={{
            left: ghost.x - armed.width / 2,
            top: ghost.y - armed.height / 2,
            width: armed.width,
            height: armed.height,
            outline: `2px dashed ${props.accent}`,
          }}
        >
          <Wireframe type={armed.type} width={armed.width} height={armed.height} className="absolute inset-0" />
          <span aria-hidden className={cn(PILL_CLASS, "absolute right-1.5 bottom-1.5 px-1 py-0.5 font-mono text-[10px] leading-none tabular-nums")}>
            {`${armed.width}×${armed.height}`}
          </span>
        </div>
      )}
      {interactive && (
        <LayoutPalette
          ref={palette}
          armed={armed?.type}
          onPointerDownItem={(item, event) => {
            if (event.button !== 0) return;
            begin({ kind: "palette", start: { x: event.clientX, y: event.clientY }, item, moved: false }, event);
          }}
        />
      )}
      {interactive && commentTarget && commentRect && (
        <Popup
          key={commentTarget.id}
          element={`${componentLabel(commentTarget.placement.componentType)} placement`}
          initialComment={commentTarget.comment}
          editing={Boolean(commentTarget.comment)}
          allowEmpty
          accent={props.accent}
          point={{ x: commentRect.x + commentRect.width / 2 - window.scrollX, y: commentRect.y + commentRect.height - window.scrollY }}
          closing={false}
          shake={0}
          onCancel={() => setCommentId(null)}
          onDelete={() => remove([commentTarget.id])}
          onSubmit={(comment) => {
            setCommentId(null);
            patch(commentTarget.id, (current) => (current.comment === comment ? current : { ...current, comment }));
          }}
        />
      )}
    </>
  );
}
