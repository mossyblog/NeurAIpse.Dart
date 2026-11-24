import { useEffect, useEffectEvent, useRef, useState } from "react";
import { clickSelect, type BoxCell, type BoxGroup, type BoxSelection } from "../core/box-select.ts";
import { GROUP_ATTRIBUTE, PREVIEW_ATTRIBUTE, PROBE_ATTRIBUTE } from "../core/style-change.ts";
import { sameRegion, type SpacingRegion } from "../core/spacing.ts";
import { deepElementFromPoint, elementSpacing, hitTestBox, hitTestSpacing, type ElementSpacing } from "../core/spacing-dom.ts";
import { SUB_MODE_BEHAVIOUR, type InspectorSubMode } from "../core/spacing-modes.ts";
import type { Point, Rect } from "../core/types.ts";
import { HOST_ATTRIBUTE, isFromSurface, type Surface } from "./shadow-surface.ts";

/** What a pointer position resolves to (Lines). Identity only; geometry is recomputed every draw. */
export type SpacingTarget = { element: Element; region: SpacingRegion | null };

/** Box hover: the element and the zone under the cursor (a group and its cell, or the content). */
export type BoxHover = { element: Element; group: BoxGroup | "content"; cell: BoxCell | null };

/** Box selection: one element and the selected ring sides (spec 14.2). */
export type BoxSelected = BoxSelection & { element: Element };

/** Live geometry for a target, or null when its element is gone or has no box. */
export function resolveTarget(target: SpacingTarget | null): { spacing: ElementSpacing; region: SpacingRegion | null } | null {
  if (!target || !target.element.isConnected) return null;
  const spacing = elementSpacing(target.element);
  if (!spacing) return null;
  const region = target.region ? spacing.regions.find((r) => sameRegion(r, target.region)) ?? null : null;
  return { spacing, region };
}

/** Measure rect of a target: its region strip, or the element's border box (edge measure). */
export function targetRect(resolved: { spacing: ElementSpacing; region: SpacingRegion | null }): Rect {
  return resolved.region?.rect ?? resolved.spacing.border;
}

function sameTarget(a: SpacingTarget | null, b: SpacingTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.element === b.element && (a.region === b.region || sameRegion(a.region, b.region));
}

const sameHover = (a: BoxHover | null, b: BoxHover | null) =>
  !a || !b ? a === b : a.element === b.element && a.group === b.group && a.cell === b.cell;

export type SpacingInspectorOptions = {
  surface: Surface;
  enabled: boolean;
  /** Box selects a ring per click; Lines pins A then B, measures and shows a crosshair (spec 14). */
  subMode: InspectorSubMode;
};

/** Marks the Lines-mode cursor tag in the page head (removed on switch and exit). */
export const CURSOR_ATTRIBUTE = "data-annotate-cursor";

const isOwnNode = (node: Node) =>
  node.nodeType === 1 &&
  ((node as Element).hasAttribute?.(PREVIEW_ATTRIBUTE) || (node as Element).hasAttribute?.(PROBE_ATTRIBUTE) || (node as Element).hasAttribute?.(CURSOR_ATTRIBUTE));

/** Page interaction events swallowed while the inspector is on (clicks pin, they never reach the page). */
const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick", "contextmenu"] as const;

/**
 * Spacing inspector input: hover hit-testing, Box ring selection (spec 14.2), Lines
 * click-click pins and Alt quick measure, and a rAF-throttled redraw tick on scroll,
 * resize and page mutations (spec 3.1, 3.2).
 */
export function useSpacingInspector({ surface, enabled, subMode }: SpacingInspectorOptions) {
  const behaviour = SUB_MODE_BEHAVIOUR[subMode];
  const box = subMode === "box";
  const [hover, setHover] = useState<SpacingTarget | null>(null);
  const [pins, setPins] = useState<{ a: SpacingTarget | null; b: SpacingTarget | null }>({ a: null, b: null });
  const [boxHover, setBoxHover] = useState<BoxHover | null>(null);
  const [selection, setSelection] = useState<BoxSelected | null>(null);
  const [alt, setAlt] = useState(false);
  const [tick, setTick] = useState(0);
  const hoverRef = useRef<SpacingTarget | null>(null);
  const boxHoverRef = useRef<BoxHover | null>(null);
  const selectionRef = useRef<BoxSelected | null>(null);
  const frame = useRef(0);
  /** Set when a handle drag is cancelled (Esc): the click that ends that gesture must not select or deselect. */
  const swallowClick = useRef(false);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Stable across renders so callers can schedule a redraw after preview writes.
  const [redraw] = useState(() => () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setTick((t) => t + 1));
  });

  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;

  const elementAt = (point: Point) => {
    const el = deepElementFromPoint(document, point.x, point.y, isOverlay);
    return !el || el === document.documentElement ? null : el;
  };

  const hitAt = (point: Point): SpacingTarget | null => {
    const el = elementAt(point);
    if (!el) return null;
    const hit = hitTestSpacing(el, point, hoverRef.current?.element);
    return hit ? { element: hit.spacing.element, region: hit.region } : null;
  };

  const boxHitAt = (point: Point): BoxHover | null => {
    const el = elementAt(point);
    if (!el) return null;
    const hit = hitTestBox(el, point, boxHoverRef.current?.element, selectionRef.current?.element);
    return hit ? { element: hit.spacing.element, group: hit.group, cell: hit.cell } : null;
  };

  const onMove = useEffectEvent((event: PointerEvent) => {
    if (isFromSurface(event, surface)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (box) {
      const next = boxHitAt(point);
      if (!sameHover(next, boxHoverRef.current)) {
        boxHoverRef.current = next;
        setBoxHover(next);
      }
      return;
    }
    setAlt(behaviour.altQuickMeasure && event.altKey);
    const next = hitAt(point);
    if (!sameTarget(next, hoverRef.current)) {
      hoverRef.current = next;
      setHover(next);
    }
  });

  /** Box: replaces the selection (canvas, panel diagram, presets, Esc, Edit). */
  const selectBox = (next: BoxSelected | null) => {
    selectionRef.current = next;
    setSelection(next);
  };

  const onClick = useEffectEvent((event: MouseEvent) => {
    if (isFromSurface(event, surface)) return;
    event.preventDefault();
    event.stopPropagation();
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (box) {
      // Click outside every zone (or on an element's content) deselects (spec 14.2).
      const hit = boxHitAt(point);
      const current = selectionRef.current;
      if (!hit || hit.group === "content" || hit.cell == null) return selectBox(null);
      const next = clickSelect(current, current?.element === hit.element, { group: hit.group, cell: hit.cell }, event.shiftKey);
      return selectBox({ ...next, element: hit.element });
    }
    const target = hitAt(point);
    if (!target) return;
    if (!behaviour.secondClickMeasures) return setPins({ a: target, b: null });
    setPins((current) => (!current.a || current.b ? { a: target, b: null } : { a: current.a, b: target }));
  });

  const clear = () => {
    setPins({ a: null, b: null });
    setHover(null);
    hoverRef.current = null;
  };

  useEffect(() => {
    if (!enabled) return;
    const block = (event: Event) => {
      // A new press starts a new gesture: a swallowed click only belongs to the cancelled drag.
      if (event.type === "pointerdown") swallowClick.current = false;
      if (isFromSurface(event, surface)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: PointerEvent) => onMove(event);
    const click = (event: MouseEvent) => onClick(event);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAlt(behaviour.altQuickMeasure && event.type === "keydown");
    };
    const blur = () => setAlt(false);
    const leave = (event: PointerEvent) => {
      // Pointer left the window: drop the Box hover preview.
      if (event.relatedTarget === null && box) {
        boxHoverRef.current = null;
        setBoxHover(null);
      }
    };
    const schedule = () => redraw();
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", click, true);
    for (const type of BLOCKED) window.addEventListener(type, block, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerout", leave);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    // Page mutations move boxes. Our own preview tag and group attributes are ignored
    // (risk 8); preview writes schedule their redraw explicitly.
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const node = record.target as Element;
        if (node === surface.host) return false;
        if (record.type === "attributes" && record.attributeName === GROUP_ATTRIBUTE) return false;
        if (isOwnNode(node)) return false;
        if (record.type === "childList") {
          const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
          if (nodes.length > 0 && nodes.every((n) => n === surface.host || isOwnNode(n))) return false;
        }
        return true;
      });
      if (relevant) redraw();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", click, true);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("pointerout", leave);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [enabled, surface, redraw, behaviour, box]);

  // Lines: crosshair over the page (spec 14.3). The toolbar host keeps its own cursors.
  useEffect(() => {
    if (!enabled || behaviour.cursor !== "crosshair") return;
    const style = document.createElement("style");
    style.setAttribute(CURSOR_ATTRIBUTE, "crosshair");
    style.textContent = `html, html *:not([${HOST_ATTRIBUTE}]) { cursor: crosshair !important; }`;
    document.head.append(style);
    return () => style.remove();
  }, [enabled, behaviour]);

  /** Pins a target as pin A (Lines; Edit from the pending list). */
  const pinTo = (target: SpacingTarget) => setPins({ a: target, b: null });

  /** Whether anything is pinned (Lines: the first Esc clears pins, spec 14.4). */
  const hasPins = Boolean(pins.a || pins.b);

  /** Box: the next page click ends a cancelled handle drag and is swallowed (spec 13.1 Esc). */
  const swallowNextClick = () => {
    swallowClick.current = true;
  };

  return { hover, pins, alt, tick, clear, redraw, pinTo, hasPins, boxHover, selection, selectBox, swallowNextClick };
}
