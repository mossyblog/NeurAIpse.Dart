import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isEditableElement } from "../core/shortcuts.ts";
import { applyToPoint, collectFrameWindows, frameDocument, frameGeometry } from "../core/frames.ts";
import { classifyGesture, isDrag, normalizeRect, normalizeSelectedText } from "../core/select.ts";
import type { Point, Rect } from "../core/types.ts";
import { isFromSurface, realTarget, type Surface } from "./shadow-surface.ts";

export type PickerOptions = {
  surface: Surface;
  /** Same-origin frame windows to listen in, besides the top window. */
  frameWindows?: readonly Window[];
  /** Toolbar is active in Annotate mode. */
  active: boolean;
  popupOpen: boolean;
  blockInteractions: boolean;
  /** A Cmd/Ctrl multi-select is pending, so Enter finalizes it. */
  multiPending: boolean;
  onHover: (element: Element | null) => void;
  /** Plain click, or a text selection (with its normalized text). */
  onPick: (element: Element, point: Point, selectedText?: string) => void;
  /** Cmd/Ctrl+click: add or remove the element from the pending group. */
  onMultiToggle: (element: Element) => void;
  /** Cmd/Ctrl released (or the window lost focus): finalize the pending group. */
  onMultiRelease: () => void;
  /** Live drawn region in viewport px, or null when the drag ends. */
  onAreaChange: (region: Rect | null) => void;
  onAreaDone: (region: Rect, start: Point) => void;
  onOutsideClick: () => void;
};

/** Events stopped before page handlers see them while interactions are blocked. */
const BLOCKED = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "dblclick",
  "auxclick",
  "contextmenu",
  "touchstart",
  "touchend",
] as const;

const EMPTY: readonly Window[] = [];

type Press = {
  start: Point;
  last: Point;
  onText: boolean;
  modifier: boolean;
  dragging: boolean;
  /** Press started inside a frame: area drawing is top-document only. */
  inFrame: boolean;
};

function pageElement(event: Event, surface: Surface): Element | null {
  const target = realTarget(event) as Node | null;
  if (!target || target === surface.host) return null;
  const el = target.nodeType === 1 ? (target as Element) : target.parentElement;
  return el && el !== surface.host ? el : null;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** True when the point is over rendered glyphs of a text node (not padding or gaps). */
export function isPointOverText(doc: Document, x: number, y: number): boolean {
  const caretDoc = doc as CaretDocument;
  let node: Node | null = null;
  try {
    node = caretDoc.caretPositionFromPoint?.(x, y)?.offsetNode ??
      caretDoc.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
  } catch {
    node = null;
  }
  if (!node || node.nodeType !== 3 || !node.textContent?.trim()) return false;
  const range = doc.createRange();
  range.selectNodeContents(node);
  return Array.from(range.getClientRects()).some(
    (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
  );
}

/** The selected text and the element that contains it, unless the selection is empty. */
function readSelection(doc: Document, surface: Surface): { element: Element; text: string } | null {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = normalizeSelectedText(selection.toString());
  if (!text) return null;
  const container = selection.getRangeAt(0).commonAncestorContainer;
  const element = container.nodeType === 1 ? (container as Element) : container.parentElement;
  if (!element || surface.host.contains(element)) return null;
  return { element, text };
}

/**
 * Window-level capture listeners for every Annotate gesture: hover, click, text select,
 * Cmd/Ctrl multi-select, area drag, and interaction blocking for page elements.
 */
export function usePicker(options: PickerOptions) {
  const { surface, active, popupOpen, blockInteractions, multiPending } = options;
  const hover = useEffectEvent((element: Element | null) => options.onHover(element));
  const pick = useEffectEvent((element: Element, point: Point, text?: string) =>
    options.onPick(element, point, text),
  );
  const toggle = useEffectEvent((element: Element) => options.onMultiToggle(element));
  const release = useEffectEvent(() => options.onMultiRelease());
  const areaChange = useEffectEvent((region: Rect | null) => options.onAreaChange(region));
  const areaDone = useEffectEvent((region: Rect, start: Point) => options.onAreaDone(region, start));
  const outside = useEffectEvent(() => options.onOutsideClick());
  const press = useRef<Press | null>(null);
  /**
   * Set when a gesture already handled the press (area, text select), so its trailing
   * click is swallowed. A ref, because the gesture opens the popup and the listeners
   * re-subscribe before that click arrives.
   */
  const swallowClick = useRef(false);

  const frameKey = options.frameWindows ?? EMPTY;

  useEffect(() => {
    if (!active) return;
    let frame = 0;

    const stop = (event: Event, prevent = true) => {
      if (prevent) event.preventDefault();
      event.stopPropagation();
    };

    /** Listeners for one window. Child frames report points in top-viewport px. */
    const attach = (win: Window): (() => void) => {
      const doc = win.document;
      const inFrame = win !== window;
      const toTop = (p: Point): Point => (inFrame ? applyToPoint(frameGeometry(doc).transform, p) : p);

      // Cross-origin frames swallow events in their own process. While annotating they get
      // pointer-events: none, and a press over one selects the frame element itself.
      const opaque = new Map<HTMLElement, [string, string]>();
      const restore = (frameEl: HTMLElement) => {
        const [value, priority] = opaque.get(frameEl) ?? ["", ""];
        if (value) frameEl.style.setProperty("pointer-events", value, priority);
        else frameEl.style.removeProperty("pointer-events");
        opaque.delete(frameEl);
      };
      const syncOpaque = () => {
        for (const node of Array.from(doc.querySelectorAll("iframe, frame"))) {
          const frameEl = node as HTMLElement;
          const isOpaque = frameDocument(frameEl) === null;
          if (isOpaque && !opaque.has(frameEl)) {
            opaque.set(frameEl, [frameEl.style.getPropertyValue("pointer-events"), frameEl.style.getPropertyPriority("pointer-events")]);
            frameEl.style.setProperty("pointer-events", "none", "important");
          } else if (!isOpaque && opaque.has(frameEl)) {
            restore(frameEl);
          }
        }
        for (const frameEl of opaque.keys()) if (!frameEl.isConnected) opaque.delete(frameEl);
      };
      syncOpaque();
      const opaqueTimer = win.setInterval(syncOpaque, 500);
      const opaqueAt = (x: number, y: number): Element | null => {
        let hit: Element | null = null;
        for (const frameEl of opaque.keys()) {
          const r = frameEl.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = frameEl;
        }
        return hit;
      };
      const targetOf = (event: MouseEvent): Element | null =>
        opaqueAt(event.clientX, event.clientY) ?? pageElement(event, surface);

      const onPointerDown = (event: PointerEvent) => {
        if (isFromSurface(event, surface) || event.button !== 0) return;
        swallowClick.current = false;
        if (popupOpen) return;
        const local = { x: event.clientX, y: event.clientY };
        const point = toTop(local);
        press.current = {
          start: point,
          last: point,
          onText: isPointOverText(doc, local.x, local.y),
          modifier: event.metaKey || event.ctrlKey,
          dragging: false,
          inFrame,
        };
      };

      const onMouseDown = (event: MouseEvent) => {
        if (isFromSurface(event, surface) || event.button !== 0) return;
        const current = press.current;
        // Off-text presses may become an area drag, so keep the browser from selecting
        // or focusing. Over text, the default runs so native selection works.
        const target = realTarget(event);
        if (
          popupOpen ||
          event.metaKey ||
          event.ctrlKey ||
          (current && !current.onText) ||
          (blockInteractions && isEditableElement(target))
        ) {
          event.preventDefault();
        }
      };

      const onMove = (event: PointerEvent) => {
        if (popupOpen) return;
        const current = press.current;
        if (current && (event.buttons & 1) === 1) {
          current.last = toTop({ x: event.clientX, y: event.clientY });
          if (
            !current.onText &&
            !current.modifier &&
            !current.inFrame &&
            (current.dragging || isDrag(current.start, current.last))
          ) {
            current.dragging = true;
            areaChange(normalizeRect(current.start, current.last));
            window.cancelAnimationFrame(frame);
            hover(null);
            return;
          }
        }
        // composedPath() is only populated during dispatch, so resolve now and defer the update.
        const element = isFromSurface(event, surface) ? null : targetOf(event);
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => hover(element));
      };

      const onPointerUp = (event: PointerEvent) => {
        const current = press.current;
        press.current = null;
        if (!current || isFromSurface(event, surface)) return;
        const end = toTop({ x: event.clientX, y: event.clientY });
        const selection = current.onText ? readSelection(doc, surface) : null;
        let gesture = classifyGesture({
          start: current.start,
          end,
          modifier: current.modifier,
          startedOnText: current.onText,
          hasSelection: Boolean(selection),
        });
        if (gesture === "area" && current.inFrame) gesture = "none";
        if (gesture === "area") {
          swallowClick.current = true;
          areaChange(null);
          areaDone(normalizeRect(current.start, end), current.start);
        } else if (gesture === "text" && selection) {
          swallowClick.current = true;
          hover(null);
          pick(selection.element, end, selection.text);
        } else if (gesture === "none") {
          swallowClick.current = true;
        } else if (gesture === "multi") {
          // Toggle on release: macOS Ctrl+click opens a context menu and sends no click.
          swallowClick.current = true;
          const element = targetOf(event);
          if (element) toggle(element);
        }
      };

      const onPointerCancel = () => {
        if (press.current?.dragging) areaChange(null);
        press.current = null;
      };

      const onScroll = () => {
        if (!popupOpen) hover(null);
      };

      const block = (event: Event) => {
        if (isFromSurface(event, surface)) return;
        // macOS Ctrl+click is a multi-select press here, not a context menu.
        if (event.type === "contextmenu" && (event as MouseEvent).ctrlKey) {
          stop(event);
          return;
        }
        if (!popupOpen && !blockInteractions) return;
        event.stopPropagation();
        if (event.type === "contextmenu" || event.type === "auxclick") event.preventDefault();
      };

      const onClick = (event: MouseEvent) => {
        if (isFromSurface(event, surface)) return;
        if (swallowClick.current) {
          swallowClick.current = false;
          stop(event);
          return;
        }
        if (popupOpen) {
          stop(event);
          outside();
          return;
        }
        const element = targetOf(event);
        if (event.metaKey || event.ctrlKey) {
          // Cmd/Ctrl+click would open links in a new tab even with blocking off.
          stop(event);
          if (element) toggle(element);
          return;
        }
        if (blockInteractions) stop(event);
        if (element) pick(element, toTop({ x: event.clientX, y: event.clientY }));
      };

      const onDragStart = (event: DragEvent) => {
        if (!isFromSurface(event, surface)) event.preventDefault();
      };

      const onKeyUp = (event: KeyboardEvent) => {
        if (event.key === "Meta" || event.key === "Control") release();
      };

      // Enter is the keyboard equivalent of releasing the modifier.
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || !multiPending || isEditableElement(realTarget(event))) return;
        stop(event);
        release();
      };

      const onBlur = () => {
        // Focus moving into one of our own frames is not a modifier release.
        if (inFrame) return;
        release();
      };

      win.addEventListener("pointerdown", onPointerDown, true);
      win.addEventListener("mousedown", onMouseDown, true);
      win.addEventListener("pointermove", onMove, { capture: true, passive: true });
      win.addEventListener("pointerup", onPointerUp, true);
      win.addEventListener("pointercancel", onPointerCancel, true);
      win.addEventListener("scroll", onScroll, { capture: true, passive: true });
      win.addEventListener("click", onClick, true);
      win.addEventListener("dragstart", onDragStart, true);
      win.addEventListener("keyup", onKeyUp, true);
      win.addEventListener("keydown", onKeyDown, true);
      if (!inFrame) win.addEventListener("blur", onBlur);
      for (const type of BLOCKED) win.addEventListener(type, block, true);
      return () => {
        win.clearInterval(opaqueTimer);
        for (const frameEl of Array.from(opaque.keys())) restore(frameEl);
        win.removeEventListener("pointerdown", onPointerDown, true);
        win.removeEventListener("mousedown", onMouseDown, true);
        win.removeEventListener("pointermove", onMove, true);
        win.removeEventListener("pointerup", onPointerUp, true);
        win.removeEventListener("pointercancel", onPointerCancel, true);
        win.removeEventListener("scroll", onScroll, true);
        win.removeEventListener("click", onClick, true);
        win.removeEventListener("dragstart", onDragStart, true);
        win.removeEventListener("keyup", onKeyUp, true);
        win.removeEventListener("keydown", onKeyDown, true);
        win.removeEventListener("blur", onBlur);
        for (const type of BLOCKED) win.removeEventListener(type, block, true);
      };
    };

    const detachers = [window, ...frameKey].map((win) => {
      try {
        return attach(win);
      } catch {
        // A frame that navigated cross-origin or closed: skip it.
        return () => {};
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      press.current = null;
      for (const detach of detachers) {
        try {
          detach();
        } catch {
          // Frame window already gone.
        }
      }
    };
  }, [active, popupOpen, blockInteractions, multiPending, surface, frameKey]);
}

/** Same-origin frame windows (nested), re-scanned while active and on frame loads. */
export function useFrameWindows(active: boolean): readonly Window[] {
  const [windows, setWindows] = useState<readonly Window[]>(EMPTY);
  useEffect(() => {
    if (!active) return;
    // A navigated frame keeps its WindowProxy but gets a new Window, so compare documents.
    let docs: Document[] = [];
    const scan = () => {
      const next = collectFrameWindows(document);
      const nextDocs = next.map((win) => win.document);
      if (nextDocs.length === docs.length && nextDocs.every((doc, index) => doc === docs[index])) return;
      docs = nextDocs;
      setWindows(next);
    };
    const first = window.setTimeout(scan, 0);
    const timer = window.setInterval(scan, 500);
    const onLoad = (event: Event) => {
      if ((event.target as Element | null)?.localName === "iframe") scan();
    };
    window.addEventListener("load", onLoad, true);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("load", onLoad, true);
    };
  }, [active]);
  return active ? windows : EMPTY;
}
