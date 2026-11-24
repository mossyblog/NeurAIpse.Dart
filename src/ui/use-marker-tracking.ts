import { useEffect, useRef, useState, type RefObject } from "react";
import { toPageRect } from "../core/capture.ts";
import { querySelectorAllDeep } from "../core/dom.ts";
import { applyToRect, frameGeometry, pointInRect, resolveFramePath } from "../core/frames.ts";
import { identifyElement } from "../core/identify.ts";
import { markerAnchor, placeOnRect, rectCenter, type MarkerAnchor } from "../core/select.ts";
import type { Annotation, Point } from "../core/types.ts";

/** Frames between attempts to re-find an element that was not in the DOM. */
const RESOLVE_EVERY = 30;
/** Smallest movement (px) that re-renders markers. */
const EPSILON = 0.5;

/** Live marker position per annotation id; `null` means hide the marker. */
export type TrackedPositions = ReadonlyMap<string, Point | null>;

/** The document an annotation lives in: the top page, or its (unchanged) frame. */
function documentFor(annotation: Annotation): Document | null {
  return annotation.frame ? resolveFramePath(document, annotation.frame.path) : document;
}

/** Re-finds a saved annotation's element: a unique match (crossing shadow roots) whose name still matches. */
function resolveElement(annotation: Annotation, attributeNames: readonly string[]): Element | null {
  const doc = documentFor(annotation);
  if (!doc) return null;
  try {
    // A short path may match several elements; only a unique match is trusted.
    const matches = querySelectorAllDeep(doc, annotation.elementPath);
    const el = matches.length === 1 ? matches[0] : null;
    if (el && identifyElement(el, attributeNames).name === annotation.element) return el;
  } catch {
    // Selector may not be valid CSS (e.g. a group path); no tracking.
  }
  return null;
}

/**
 * True while an element inside a frame still belongs to the frame's current document at
 * the recorded URL. A navigated frame leaves the old element "connected" to a dead document.
 */
function frameStillValid(el: Element, annotation: Annotation): boolean {
  if (!annotation.frame) return true;
  const doc = el.ownerDocument;
  if (!doc.defaultView) return false;
  const last = annotation.frame.path[annotation.frame.path.length - 1];
  try {
    return doc.location.href === last?.url && documentFor(annotation) === doc;
  } catch {
    return false;
  }
}

function samePositions(a: TrackedPositions, b: TrackedPositions): boolean {
  if (a.size !== b.size) return false;
  for (const [id, point] of a) {
    if (!b.has(id)) return false;
    const other = b.get(id);
    if (point === null || other === null || other === undefined) {
      if (point !== other) return false;
      continue;
    }
    if (Math.abs(other.x - point.x) > EPSILON || Math.abs(other.y - point.y) > EPSILON) return false;
  }
  return true;
}

/**
 * Live marker positions (page px, or viewport px for fixed elements) for single-element
 * annotations whose element is still in the DOM. A rAF loop follows scroll, resize and
 * layout changes, including scrolling inside same-origin frames. Frame annotations are
 * hidden (`null`) while their frame is navigated away, removed, or scrolled out of view.
 * Groups and areas are snapshots and keep their stored position.
 * Display only: nothing is written to storage.
 */
export function useMarkerTracking(
  annotations: readonly Annotation[],
  elements: RefObject<Map<string, Element>>,
  attributeNames: readonly string[],
  enabled: boolean,
): TrackedPositions {
  const [positions, setPositions] = useState<TrackedPositions>(() => new Map());
  /**
   * Anchor per annotation id, computed once (at creation, or first sight after reload)
   * so later viewport resizes do not shift where the marker sits on its element.
   */
  const anchors = useRef(new Map<string, MarkerAnchor | null>());
  const namesKey = attributeNames.join("|");

  useEffect(() => {
    if (!enabled || annotations.length === 0) return;
    const names = namesKey.split("|").filter(Boolean);
    let frame = 0;
    let tick = 0;
    let previous: TrackedPositions = new Map();

    const step = () => {
      const map = elements.current;
      const next = new Map<string, Point | null>();
      const width = window.innerWidth;
      const scroll = { x: window.scrollX, y: window.scrollY };
      for (const annotation of annotations) {
        let anchor = anchors.current.get(annotation.id);
        if (anchor === undefined) {
          anchor = markerAnchor(annotation, width);
          anchors.current.set(annotation.id, anchor);
        }
        if (!anchor) continue;
        let el = map.get(annotation.id) ?? null;
        if (el && (!el.isConnected || !frameStillValid(el, annotation))) {
          map.delete(annotation.id);
          el = null;
        }
        if (!el && tick % RESOLVE_EVERY === 0) {
          el = resolveElement(annotation, names);
          if (el) map.set(annotation.id, el);
        }
        if (!el) {
          // A frame annotation without its frame document has nowhere valid to sit.
          if (annotation.frame) next.set(annotation.id, null);
          continue;
        }
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        let rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        if (annotation.frame) {
          const geometry = frameGeometry(el);
          rect = applyToRect(geometry.transform, rect);
          if (!geometry.clip || !pointInRect(rectCenter(rect), geometry.clip)) {
            next.set(annotation.id, null);
            continue;
          }
        }
        const box = toPageRect(rect, scroll, Boolean(annotation.isFixed));
        next.set(annotation.id, placeOnRect(box, anchor));
      }
      tick += 1;
      if (!samePositions(previous, next)) {
        previous = next;
        setPositions(next);
      }
      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [annotations, elements, namesKey, enabled]);

  return positions;
}
