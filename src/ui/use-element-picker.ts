import { useEffect, useEffectEvent, useRef, useState } from "react";
import { deepElementFromPoint } from "../core/spacing-dom.ts";
import { GROUP_ATTRIBUTE, PREVIEW_ATTRIBUTE, PROBE_ATTRIBUTE } from "../core/style-change.ts";
import { isFromSurface, type Surface } from "./shadow-surface.ts";

/** Page interaction events swallowed while an inspector is on (clicks pick, never reach the page). */
const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick", "contextmenu"] as const;

const ours = (node: Node) =>
  node.nodeType === 1 && ((node as Element).hasAttribute(PREVIEW_ATTRIBUTE) || (node as Element).hasAttribute(PROBE_ATTRIBUTE));

/**
 * Hover and click input for the type and colour inspectors: `resolve` maps the element
 * under the pointer to a target (or null); clicks call `onPick` with Shift state. A tick
 * bumps (rAF-throttled) on scroll, resize and page mutations, ignoring our own preview,
 * probe and group-attribute writes (risk 8).
 */
export function useElementPicker(options: {
  surface: Surface;
  resolve: (el: Element) => Element | null;
  onPick: (el: Element, shift: boolean) => void;
}) {
  const { surface } = options;
  const [hover, setHover] = useState<Element | null>(null);
  const [tick, setTick] = useState(0);
  const frameRef = useRef(0);
  const [redraw] = useState(() => () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => setTick((t) => t + 1));
  });
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;
  const at = (x: number, y: number) => {
    const el = deepElementFromPoint(document, x, y, isOverlay);
    return el && el !== document.documentElement ? options.resolve(el) : null;
  };

  const onMove = useEffectEvent((event: PointerEvent) => {
    if (isFromSurface(event, surface)) {
      setHover(null);
      return;
    }
    const next = at(event.clientX, event.clientY);
    setHover((current) => (current === next ? current : next));
  });
  const onClick = useEffectEvent((event: MouseEvent) => {
    if (isFromSurface(event, surface)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = at(event.clientX, event.clientY);
    if (target) options.onPick(target, event.shiftKey);
  });

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const block = (event: Event) => {
      if (isFromSurface(event, surface)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: PointerEvent) => onMove(event);
    const click = (event: MouseEvent) => onClick(event);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", click, true);
    for (const type of BLOCKED) window.addEventListener(type, block, true);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const node = record.target as Element;
        if (node === surface.host || ours(node)) return false;
        if (record.type === "attributes" && record.attributeName === GROUP_ATTRIBUTE) return false;
        if (record.type === "childList") {
          const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
          if (nodes.length > 0 && nodes.every((n) => n === surface.host || ours(n))) return false;
        }
        return true;
      });
      if (relevant) schedule();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", click, true);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [surface]);

  return { hover, tick, isOverlay, redraw };
}
