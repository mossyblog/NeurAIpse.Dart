"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { X } from "lucide-react";
import { isEditableElement } from "../core/shortcuts.ts";
import { deepElementFromPoint } from "../core/spacing-dom.ts";
import { spacingTokens } from "../core/style-change.ts";
import { readRootVars } from "../core/tokens-dom.ts";
import { isFromSurface, realTarget, type Surface } from "./shadow-surface.ts";

/** One persistent vertical or horizontal ruler measurement in document coordinates (px). */
export type RulerMeasurement = {
  id: string;
  axis: "x" | "y";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type RulerLayerProps = {
  surface: Surface;
  rulers: readonly RulerMeasurement[];
  /** Non-null when actively drawing a vertical ("y", key 1) or horizontal ("x", key 2) ruler. */
  drawAxis: "x" | "y" | null;
  onAdd: (ruler: RulerMeasurement) => void;
  onUpdate: (ruler: RulerMeasurement) => void;
  onDelete: (id: string) => void;
  setEscape?: (handler: (() => boolean) | null) => void;
};

const COLOR = "var(--annotate-marker-pink, #ec4899)";
const SNAP_DISTANCE = 6;
const DRAG_THRESHOLD = 6;
const CAP = 5;
const IGNORED_TAGS = new Set(["html", "body", "head", "script", "style", "link", "meta", "noscript", "template", "br"]);

let rulerCounter = 0;
const nextId = () => `ruler-${Date.now()}-${++rulerCounter}`;

type SnapResult = { value: number; guide?: { axis: "x" | "y"; pos: number; from: number; to: number } };
type SpanGuide = { axis: "x" | "y"; pos: number; from: number; to: number };
type AutoSpan = {
  axis: "x" | "y";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  guides: SpanGuide[];
};

/**
 * Raycasts from viewport point `(vx, vy)` in both directions along `axis` to find the
 * nearest opposing element boundaries (gaps between siblings, padding between container
 * and child, or width/height of the hovered element itself).
 */
function autoSpanAt(
  vx: number,
  vy: number,
  axis: "x" | "y",
  isOverlay: (el: Element) => boolean,
): AutoSpan | null {
  const under = deepElementFromPoint(document, vx, vy, isOverlay);
  if (!under) return null;

  const isRoot = under === document.documentElement || under === document.body;
  const cursor = axis === "x" ? vx : vy;
  const cross = axis === "x" ? vy : vx;

  type Edge = { pos: number; from: number; to: number };
  const edges: Edge[] = [];
  const pushRect = (r: DOMRect) => {
    if (r.width < 1 || r.height < 1) return;
    if (axis === "x") {
      if (cross < r.top - 1 || cross > r.bottom + 1) return;
      edges.push({ pos: r.left, from: r.top, to: r.bottom });
      edges.push({ pos: r.right, from: r.top, to: r.bottom });
    } else {
      if (cross < r.left - 1 || cross > r.right + 1) return;
      edges.push({ pos: r.top, from: r.left, to: r.right });
      edges.push({ pos: r.bottom, from: r.left, to: r.right });
    }
  };

  if (!isRoot) {
    pushRect(under.getBoundingClientRect());
    // Include visible children of `under` whose cross-axis overlaps the ray so gaps and padding resolve automatically.
    for (const child of Array.from(under.children)) {
      if (IGNORED_TAGS.has(child.localName) || isOverlay(child)) continue;
      pushRect(child.getBoundingClientRect());
    }
  } else {
    for (const child of Array.from(document.body.children)) {
      if (IGNORED_TAGS.has(child.localName) || isOverlay(child)) continue;
      pushRect(child.getBoundingClientRect());
    }
    if (axis === "x") {
      edges.push({ pos: 0, from: Math.max(0, vy - 24), to: vy + 24 });
      edges.push({ pos: window.innerWidth, from: Math.max(0, vy - 24), to: vy + 24 });
    } else {
      edges.push({ pos: 0, from: Math.max(0, vx - 24), to: vx + 24 });
      edges.push({ pos: window.innerHeight, from: Math.max(0, vx - 24), to: vx + 24 });
    }
  }

  let before: Edge | null = null;
  let after: Edge | null = null;
  for (const e of edges) {
    if (e.pos <= cursor + 0.5) {
      if (!before || e.pos > before.pos) before = e;
    }
    if (e.pos >= cursor - 0.5) {
      if (!after || e.pos < after.pos) after = e;
    }
  }

  // If the cursor sits right on an edge, nudge slightly past to pick the real interval.
  if (before && after && Math.abs(after.pos - before.pos) < 1) {
    const strictBefore = edges.filter((e) => e.pos < cursor - 0.5).sort((a, b) => b.pos - a.pos)[0] ?? null;
    const strictAfter = edges.filter((e) => e.pos > cursor + 0.5).sort((a, b) => a.pos - b.pos)[0] ?? null;
    if (strictAfter && (!strictBefore || strictAfter.pos - cursor <= cursor - strictBefore.pos)) {
      after = strictAfter;
    } else if (strictBefore) {
      before = strictBefore;
    }
  }

  if (!before || !after || after.pos - before.pos < 2) return null;

  const sx = window.scrollX;
  const sy = window.scrollY;
  if (axis === "x") {
    const y = Math.round(vy + sy);
    return {
      axis: "x",
      x1: Math.round(before.pos + sx),
      y1: y,
      x2: Math.round(after.pos + sx),
      y2: y,
      guides: [
        { axis: "x", pos: Math.round(before.pos + sx), from: Math.round(before.from + sy) - 6, to: Math.round(before.to + sy) + 6 },
        { axis: "x", pos: Math.round(after.pos + sx), from: Math.round(after.from + sy) - 6, to: Math.round(after.to + sy) + 6 },
      ],
    };
  }
  const x = Math.round(vx + sx);
  return {
    axis: "y",
    x1: x,
    y1: Math.round(before.pos + sy),
    x2: x,
    y2: Math.round(after.pos + sy),
    guides: [
      { axis: "y", pos: Math.round(before.pos + sy), from: Math.round(before.from + sx) - 6, to: Math.round(before.to + sx) + 6 },
      { axis: "y", pos: Math.round(after.pos + sy), from: Math.round(after.from + sx) - 6, to: Math.round(after.to + sx) + 6 },
    ],
  };
}

/** Snaps a viewport coordinate along `axis` to the nearest edge of the element under `(vx, vy)`. */
function snapEdge(
  vx: number,
  vy: number,
  axis: "x" | "y",
  isOverlay: (el: Element) => boolean,
  bypass: boolean,
): SnapResult {
  const raw = axis === "x" ? vx : vy;
  if (bypass) return { value: Math.round(raw) };
  const el = deepElementFromPoint(document, vx, vy, isOverlay);
  if (!el || el === document.documentElement || el === document.body) return { value: Math.round(raw) };
  const rect = el.getBoundingClientRect();
  const candidates = axis === "x" ? [rect.left, rect.right] : [rect.top, rect.bottom];
  let best: number | null = null;
  for (const edge of candidates) {
    const d = edge - raw;
    if (Math.abs(d) <= SNAP_DISTANCE && (best === null || Math.abs(d) < Math.abs(best - raw))) {
      best = edge;
    }
  }
  if (best === null) return { value: Math.round(raw) };
  const guide =
    axis === "x"
      ? { axis: "x" as const, pos: best + window.scrollX, from: rect.top + window.scrollY - 8, to: rect.bottom + window.scrollY + 8 }
      : { axis: "y" as const, pos: best + window.scrollY, from: rect.left + window.scrollX - 8, to: rect.right + window.scrollX + 8 };
  return { value: Math.round(best), guide };
}

function matchingSpacingToken(px: number): string | null {
  if (px <= 0) return null;
  const rootFontPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const tokens = spacingTokens(readRootVars(document), rootFontPx);
  const hit = tokens.find((t) => Math.abs(t.px - px) < 0.5);
  return hit ? hit.name : null;
}

function rulerDistance(r: Pick<RulerMeasurement, "axis" | "x1" | "y1" | "x2" | "y2">): number {
  return Math.round(Math.abs(r.axis === "x" ? r.x2 - r.x1 : r.y2 - r.y1));
}

function rulerLabel(r: Pick<RulerMeasurement, "axis" | "x1" | "y1" | "x2" | "y2">): string {
  const dist = rulerDistance(r);
  const token = matchingSpacingToken(dist);
  return token ? `${dist}px · ${token}` : `${dist}px`;
}

type ActiveEdit =
  | { kind: "move"; id: string; startX: number; startY: number; origin: RulerMeasurement }
  | { kind: "end"; id: string; which: "start" | "end"; origin: RulerMeasurement };

type DrawState = {
  axis: "x" | "y";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True while holding mouse down from the initial press; false once released for click-to-click. */
  dragging: boolean;
  moved: boolean;
  startClientX: number;
  startClientY: number;
};

/**
 * Persistent vertical (`1`) and horizontal (`2`) measurement rulers.
 * Completed rulers stay pinned in document coordinates across mode switches and remain
 * clickable to select, drag-move, adjust endpoints, or delete (Delete/Backspace or ×).
 */
export function RulerLayer({ surface, rulers, drawAxis, onAdd, onUpdate, onDelete, setEscape }: RulerLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [hoverSpan, setHoverSpan] = useState<AutoSpan | null>(null);
  const [guides, setGuides] = useState<SpanGuide[]>([]);
  const drawRef = useRef<DrawState | null>(null);
  const hoverSpanRef = useRef<AutoSpan | null>(null);
  const editRef = useRef<ActiveEdit | null>(null);
  const [editDraft, setEditDraft] = useState<RulerMeasurement | null>(null);

  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;

  // Keep document-space layer aligned with scroll.
  useEffect(() => {
    const sync = () => {
      if (layerRef.current) {
        layerRef.current.style.transform = `translate(${-window.scrollX}px, ${-window.scrollY}px)`;
      }
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  // Clear in-progress draw if drawAxis changes or exits.
  useEffect(() => {
    drawRef.current = null;
    hoverSpanRef.current = null;
    setDraw(null);
    setHoverSpan(null);
    setGuides([]);
  }, [drawAxis]);

  // Clear selection if selected ruler was deleted.
  const activeSelectedId = selectedId && rulers.some((r) => r.id === selectedId) ? selectedId : null;

  // Crosshair cursor while drawing.
  useEffect(() => {
    if (!drawAxis) return;
    const style = document.createElement("style");
    style.setAttribute("data-annotate-ruler-cursor", "");
    style.textContent = "* { cursor: crosshair !important; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [drawAxis]);

  const commitSpan = (span: Pick<RulerMeasurement, "axis" | "x1" | "y1" | "x2" | "y2">) => {
    const dist = rulerDistance(span);
    drawRef.current = null;
    setDraw(null);
    setGuides([]);
    if (dist < 2) return;
    const created: RulerMeasurement = {
      id: nextId(),
      axis: span.axis,
      x1: Math.round(span.x1),
      y1: Math.round(span.y1),
      x2: Math.round(span.x2),
      y2: Math.round(span.y2),
    };
    onAdd(created);
    setSelectedId(created.id);
  };

  // Pointer handlers for auto-span click OR manual drag measuring when drawAxis is active.
  const onDrawDown = useEffectEvent((event: PointerEvent) => {
    if (!drawAxis || event.button !== 0 || editRef.current) return;
    if (isFromSurface(event, surface)) return;
    event.preventDefault();
    event.stopPropagation();

    setSelectedId(null);
    const span = event.altKey ? null : autoSpanAt(event.clientX, event.clientY, drawAxis, isOverlay);
    hoverSpanRef.current = span;
    setHoverSpan(span);

    const snap = snapEdge(event.clientX, event.clientY, drawAxis, isOverlay, event.altKey);
    const x1 = drawAxis === "x" ? snap.value + window.scrollX : Math.round(event.clientX + window.scrollX);
    const y1 = drawAxis === "y" ? snap.value + window.scrollY : Math.round(event.clientY + window.scrollY);
    const next: DrawState = {
      axis: drawAxis,
      x1,
      y1,
      x2: x1,
      y2: y1,
      dragging: true,
      moved: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    drawRef.current = next;
    setDraw(next);
    setGuides(span ? span.guides : snap.guide ? [snap.guide] : []);
  });

  const onWindowMove = useEffectEvent((event: PointerEvent) => {
    const edit = editRef.current;
    if (edit) {
      event.preventDefault();
      if (edit.kind === "move") {
        const dx = Math.round(event.clientX - edit.startX);
        const dy = Math.round(event.clientY - edit.startY);
        setEditDraft({
          ...edit.origin,
          x1: edit.origin.x1 + dx,
          y1: edit.origin.y1 + dy,
          x2: edit.origin.x2 + dx,
          y2: edit.origin.y2 + dy,
        });
      } else {
        const { origin, which } = edit;
        const snap = snapEdge(event.clientX, event.clientY, origin.axis, isOverlay, event.altKey);
        setGuides(snap.guide ? [snap.guide] : []);
        if (origin.axis === "x") {
          const nextX = snap.value + window.scrollX;
          setEditDraft(which === "start" ? { ...origin, x1: nextX } : { ...origin, x2: nextX });
        } else {
          const nextY = snap.value + window.scrollY;
          setEditDraft(which === "start" ? { ...origin, y1: nextY } : { ...origin, y2: nextY });
        }
      }
      return;
    }

    const current = drawRef.current;
    if (!current) {
      if (drawAxis && !isFromSurface(event, surface)) {
        const span = event.altKey ? null : autoSpanAt(event.clientX, event.clientY, drawAxis, isOverlay);
        hoverSpanRef.current = span;
        setHoverSpan(span);
        setGuides(span ? span.guides : []);
      } else if (hoverSpanRef.current || guides.length) {
        hoverSpanRef.current = null;
        setHoverSpan(null);
        setGuides([]);
      }
      return;
    }

    const moved =
      current.moved ||
      Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) >= DRAG_THRESHOLD;
    if (!moved) return;
    // Once the user drags past threshold, switch from auto-span to explicit snapped drag.
    hoverSpanRef.current = null;
    setHoverSpan(null);
    const snap = snapEdge(event.clientX, event.clientY, current.axis, isOverlay, event.altKey);
    const x2 = current.axis === "x" ? snap.value + window.scrollX : current.x1;
    const y2 = current.axis === "y" ? snap.value + window.scrollY : current.y1;
    const updated: DrawState = { ...current, x2, y2, moved: true };
    drawRef.current = updated;
    setDraw(updated);
    setGuides(snap.guide ? [snap.guide] : []);
  });

  const onWindowUp = useEffectEvent((event: PointerEvent) => {
    const edit = editRef.current;
    if (edit) {
      editRef.current = null;
      setGuides([]);
      setEditDraft((draft) => {
        if (draft) onUpdate(draft);
        return null;
      });
      return;
    }

    const current = drawRef.current;
    if (!current || !current.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    if (current.moved && rulerDistance(current) >= 2) {
      commitSpan(current);
      return;
    }
    // Single click: pin the auto-measured span immediately!
    const span = hoverSpanRef.current ?? (event.altKey ? null : autoSpanAt(event.clientX, event.clientY, current.axis, isOverlay));
    if (span) {
      commitSpan(span);
    } else {
      drawRef.current = null;
      setDraw(null);
      setGuides([]);
    }
  });

  // Block page clicks while drawAxis is active so measuring doesn't click page buttons/links.
  useEffect(() => {
    const move = (e: PointerEvent) => onWindowMove(e);
    const up = (e: PointerEvent) => onWindowUp(e);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    if (!drawAxis) {
      return () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
      };
    }
    const down = (e: PointerEvent) => onDrawDown(e);
    const block = (e: Event) => {
      if (isFromSurface(e, surface)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const blocked = ["mousedown", "mouseup", "click", "dblclick", "contextmenu"] as const;
    window.addEventListener("pointerdown", down, true);
    for (const type of blocked) window.addEventListener(type, block, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointerdown", down, true);
      for (const type of blocked) window.removeEventListener(type, block, true);
    };
  }, [drawAxis, surface]);

  // Delete / Backspace removes selected ruler.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!activeSelectedId) return;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableElement(realTarget(event))) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      onDelete(activeSelectedId);
      setSelectedId(null);
    }
  });

  useEffect(() => {
    if (!activeSelectedId) return;
    const key = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [activeSelectedId]);

  // Register Escape when drawAxis is active (cancel draw -> deselect -> exit mode).
  const onEscape = useEffectEvent(() => {
    if (drawRef.current) {
      drawRef.current = null;
      setDraw(null);
      setGuides([]);
      return true;
    }
    if (activeSelectedId) {
      setSelectedId(null);
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!drawAxis || !setEscape) return;
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [drawAxis, setEscape]);

  // Deselect when clicking outside any ruler while not drawing.
  useEffect(() => {
    if (!activeSelectedId || drawAxis) return;
    const down = (e: PointerEvent) => {
      const target = realTarget(e) as Element | null;
      if (target?.closest?.("[data-annotate-ruler]")) return;
      setSelectedId(null);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [activeSelectedId, drawAxis]);

  const displayedRulers = rulers.map((r) => (editDraft && editDraft.id === r.id ? editDraft : r));
  const previewRuler: RulerMeasurement | null =
    draw && draw.moved
      ? { id: "__draft__", axis: draw.axis, x1: draw.x1, y1: draw.y1, x2: draw.x2, y2: draw.y2 }
      : hoverSpan
        ? { id: "__hover__", axis: hoverSpan.axis, x1: hoverSpan.x1, y1: hoverSpan.y1, x2: hoverSpan.x2, y2: hoverSpan.y2 }
        : null;
  if (!displayedRulers.length && !previewRuler && !guides.length) return null;

  const renderRuler = (r: RulerMeasurement, isDraft: boolean) => {
    const selected = !isDraft && activeSelectedId === r.id;
    const dist = rulerDistance(r);
    const label = rulerLabel(r);
    const midX = (r.x1 + r.x2) / 2;
    const midY = (r.y1 + r.y2) / 2;
    // Offset label cleanly away from the line so it never covers endpoints or measured text.
    const pillLeft = r.axis === "y" ? midX + 12 : midX;
    const pillTop = r.axis === "x" ? midY - 14 : midY;

    const startMove = (event: React.PointerEvent) => {
      if (isDraft || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(r.id);
      editRef.current = { kind: "move", id: r.id, startX: event.clientX, startY: event.clientY, origin: r };
    };

    const startEnd = (which: "start" | "end", event: React.PointerEvent) => {
      if (isDraft || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(r.id);
      editRef.current = { kind: "end", id: r.id, which, origin: r };
    };

    return (
      <div key={r.id} data-annotate-ruler={r.axis} data-selected={selected ? "" : undefined}>
        <svg className="pointer-events-none fixed top-0 left-0 overflow-visible" width="1" height="1" style={{ zIndex: selected ? 9 : 8 }}>
          {/* Wide invisible hit target for easy selection & dragging */}
          {!isDraft && (
            <line
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke="transparent"
              strokeWidth={16}
              className="pointer-events-auto cursor-move"
              onPointerDown={startMove}
            />
          )}
          <line
            x1={r.x1}
            y1={r.y1}
            x2={r.x2}
            y2={r.y2}
            stroke={COLOR}
            strokeWidth={selected ? 2 : 1.5}
            strokeDasharray={isDraft ? "4 3" : undefined}
          />
          {r.axis === "y" ? (
            <>
              <line x1={r.x1 - CAP} y1={r.y1} x2={r.x1 + CAP} y2={r.y1} stroke={COLOR} strokeWidth={1.5} />
              <line x1={r.x2 - CAP} y1={r.y2} x2={r.x2 + CAP} y2={r.y2} stroke={COLOR} strokeWidth={1.5} />
            </>
          ) : (
            <>
              <line x1={r.x1} y1={r.y1 - CAP} x2={r.x1} y2={r.y1 + CAP} stroke={COLOR} strokeWidth={1.5} />
              <line x1={r.x2} y1={r.y2 - CAP} x2={r.x2} y2={r.y2 + CAP} stroke={COLOR} strokeWidth={1.5} />
            </>
          )}
        </svg>

        {selected && (
          <>
            {(["start", "end"] as const).map((which) => {
              const hx = which === "start" ? r.x1 : r.x2;
              const hy = which === "start" ? r.y1 : r.y2;
              return (
                <button
                  key={which}
                  type="button"
                  aria-label={`Adjust ${which} point`}
                  data-annotate-ruler-handle={which}
                  onPointerDown={(e) => startEnd(which, e)}
                  className="pointer-events-auto fixed flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
                  style={{
                    left: hx,
                    top: hy,
                    zIndex: 10,
                    cursor: r.axis === "y" ? "ns-resize" : "ew-resize",
                  }}
                >
                  <span
                    className="size-2.5 rounded-full border-[1.5px] border-white shadow-xs"
                    style={{ backgroundColor: COLOR }}
                  />
                </button>
              );
            })}
          </>
        )}

        {(dist > 0 || !isDraft) && (
          <div
            data-annotate-ruler-label=""
            onPointerDown={startMove}
            className="pointer-events-auto fixed inline-flex cursor-move items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-white tabular-nums select-none"
            style={{
              left: pillLeft,
              top: pillTop,
              transform: r.axis === "y" ? "translate(0, -50%)" : "translate(-50%, -100%)",
              zIndex: selected ? 10 : 9,
              backgroundColor: `color-mix(in oklch, ${COLOR} 78%, #09090b)`,
              boxShadow: selected
                ? `0 0 0 1.5px #ffffff, 0 0 0 3px ${COLOR}, 0 2px 6px rgba(0,0,0,0.35)`
                : `0 0 0 1px color-mix(in oklch, ${COLOR} 55%, rgba(0, 0, 0, 0.25)), 0 1px 3px rgba(0, 0, 0, 0.28)`,
              textShadow: "0 1px 1px rgba(0, 0, 0, 0.28)",
            }}
          >
            <span>{label}</span>
            {selected && (
              <button
                type="button"
                aria-label="Delete measurement"
                data-annotate-ruler-delete=""
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(r.id);
                  setSelectedId(null);
                }}
                className="-mr-0.5 inline-flex size-4 cursor-pointer items-center justify-center rounded-sm text-white/85 hover:bg-white/20 hover:text-white"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={layerRef} data-annotate-rulers-layer="" className="pointer-events-none fixed top-0 left-0 z-10">
      {guides.length > 0 && (
        <svg className="pointer-events-none fixed top-0 left-0 overflow-visible" width="1" height="1" style={{ zIndex: 7 }}>
          {guides.map((g, i) =>
            g.axis === "x" ? (
              <line key={i} x1={g.pos} y1={g.from} x2={g.pos} y2={g.to} stroke={COLOR} strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
            ) : (
              <line key={i} x1={g.from} y1={g.pos} x2={g.to} y2={g.pos} stroke={COLOR} strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
            ),
          )}
        </svg>
      )}
      {displayedRulers.map((r) => renderRuler(r, false))}
      {previewRuler && renderRuler(previewRuler, true)}
    </div>
  );
}
