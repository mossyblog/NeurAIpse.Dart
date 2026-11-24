import { collapseWhitespace, parentCrossingShadow, truncate } from "./dom.ts";
import {
  DEFAULT_IDENTIFYING_ATTRIBUTES,
  describeElement,
  getElementClasses,
  getFullPath,
  getIdentifyingAttributes,
  identifyElement,
} from "./identify.ts";
import {
  applyToRect,
  frameElementsOf,
  frameGeometry,
  framePathFor,
  invertPoint,
} from "./frames.ts";
import type { Annotation, Point, Rect } from "./types.ts";

const NEARBY_TEXT_LIMIT = 200;
const SIBLING_TEXT_LIMIT = 80;
const NEARBY_ELEMENT_LIMIT = 4;

function textOf(node: Element | null): string {
  return node ? collapseWhitespace(node.textContent ?? "") : "";
}

/** Text of the element and its neighbouring siblings, or the parent when it has none. */
export function getNearbyText(el: Element): string {
  const parts: string[] = [];
  const own = textOf(el);
  if (own) parts.push(truncate(own, SIBLING_TEXT_LIMIT));
  const previous = textOf(el.previousElementSibling);
  const next = textOf(el.nextElementSibling);
  if (previous) parts.push(`[before: "${truncate(previous, SIBLING_TEXT_LIMIT)}"]`);
  if (next) parts.push(`[after: "${truncate(next, SIBLING_TEXT_LIMIT)}"]`);
  if (!previous && !next) {
    const parentText = textOf(parentCrossingShadow(el));
    if (parentText && parentText !== own) {
      parts.push(`[parent: "${truncate(parentText, SIBLING_TEXT_LIMIT)}"]`);
    }
  }
  return truncate(parts.join(" "), NEARBY_TEXT_LIMIT);
}

export function getNearbyElements(el: Element): string {
  const parent = el.parentNode;
  if (!parent) return "";
  const siblings = Array.from(parent.children).filter((child) => child !== el);
  const shown = siblings.slice(0, NEARBY_ELEMENT_LIMIT).map(describeElement);
  if (siblings.length > shown.length) shown.push(`+${siblings.length - shown.length} more`);
  return shown.join(", ");
}

const STYLE_PROPERTIES = [
  "display",
  "position",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "padding",
  "margin",
  "border-radius",
  "opacity",
];

const SKIPPED_VALUES = new Set(["", "rgba(0, 0, 0, 0)", "transparent", "0px", "normal", "static"]);

export function getComputedStylesSummary(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view) return "";
  const style = view.getComputedStyle(el);
  const parts: string[] = [];
  for (const property of STYLE_PROPERTIES) {
    const value = style.getPropertyValue(property).trim();
    if (SKIPPED_VALUES.has(value) || (property === "opacity" && value === "1")) continue;
    parts.push(`${property}: ${value}`);
  }
  return parts.join("; ");
}

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  img: "img",
  input: "textbox",
  textarea: "textbox",
  select: "combobox",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  ul: "list",
  ol: "list",
  li: "listitem",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

const ARIA_STATES = ["aria-expanded", "aria-pressed", "aria-checked", "aria-selected", "aria-disabled", "aria-hidden"];

export function getAccessibilityInfo(el: Element): string {
  const tag = el.localName;
  const parts: string[] = [];
  const role = el.getAttribute("role") ?? IMPLICIT_ROLES[tag];
  if (role) parts.push(`role=${role}`);
  const label = el.getAttribute("aria-label");
  if (label) parts.push(`aria-label="${collapseWhitespace(label)}"`);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) parts.push(`aria-labelledby=${labelledBy}`);
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) parts.push(`aria-describedby=${describedBy}`);
  for (const state of ARIA_STATES) {
    const value = el.getAttribute(state);
    if (value != null) parts.push(`${state}=${value}`);
  }
  const tabIndex = el.getAttribute("tabindex");
  const focusable =
    (tabIndex != null && Number(tabIndex) >= 0) ||
    ["button", "input", "select", "textarea"].includes(tag) ||
    (tag === "a" && el.hasAttribute("href"));
  if (focusable) parts.push("focusable");
  if (el.hasAttribute("disabled")) parts.push("disabled");
  return parts.join(", ");
}

/** True when the element or an ancestor is `position: fixed`. */
export function isFixedElement(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  let current: Element | null = el;
  while (current) {
    if (view.getComputedStyle(current).position === "fixed") return true;
    current = parentCrossingShadow(current);
  }
  return false;
}

/** Converts a viewport rect to document coordinates unless the element is fixed. */
export function toPageRect(rect: Rect, scroll: { x: number; y: number }, fixed: boolean): Rect {
  return fixed
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : { x: rect.x + scroll.x, y: rect.y + scroll.y, width: rect.width, height: rect.height };
}

/** Marker position: x as % of viewport width, y in page (or viewport, when fixed) px. */
export function markerPosition(
  client: { x: number; y: number },
  viewportWidth: number,
  scrollY: number,
  fixed: boolean,
): { x: number; y: number } {
  const x = viewportWidth > 0 ? (client.x / viewportWidth) * 100 : 0;
  return { x, y: fixed ? client.y : client.y + scrollY };
}

export type CaptureOptions = {
  attributeNames?: readonly string[];
};

export type ElementCapture = Omit<Annotation, "id" | "comment" | "timestamp">;

/** Everything an annotation records about its target, except the comment. */
export function captureElement(
  el: Element,
  client: { x: number; y: number },
  options: CaptureOptions = {},
): ElementCapture {
  const view = el.ownerDocument.defaultView;
  const attributeNames = options.attributeNames ?? DEFAULT_IDENTIFYING_ATTRIBUTES;
  const { name, path } = identifyElement(el, attributeNames);
  const fixed = isFixedElement(el);
  const scroll = { x: view?.scrollX ?? 0, y: view?.scrollY ?? 0 };
  const rect = el.getBoundingClientRect();
  const position = markerPosition(client, view?.innerWidth ?? 0, scroll.y, fixed);
  const capture: ElementCapture = {
    x: position.x,
    y: position.y,
    element: name,
    elementPath: path,
    boundingBox: toPageRect(rect, scroll, fixed),
    fullPath: getFullPath(el),
    url: view?.location.href,
  };
  const optional = {
    nearbyText: getNearbyText(el),
    cssClasses: getElementClasses(el),
    nearbyElements: getNearbyElements(el),
    computedStyles: getComputedStylesSummary(el),
    accessibility: getAccessibilityInfo(el),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) (capture as Record<string, unknown>)[key] = value;
  }
  if (fixed) capture.isFixed = true;
  const attributes = getIdentifyingAttributes(el, attributeNames);
  if (attributes) capture.attributes = attributes;
  return capture;
}

/**
 * `captureElement` for an element that may live in a same-origin iframe. `topPoint` is in
 * top-viewport px. Inside a frame, x / y / boundingBox / isFixed / url describe the top
 * page (so markers place correctly) and `frame` keeps the child-document geometry.
 */
export function captureInFrames(el: Element, topPoint: Point, options: CaptureOptions = {}): ElementCapture {
  const frames = frameElementsOf(el);
  if (frames.length === 0) return captureElement(el, topPoint, options);
  const geometry = frameGeometry(el);
  const inner = captureElement(el, invertPoint(geometry.transform, topPoint), options);
  const outermost = frames[frames.length - 1];
  const top = outermost.ownerDocument.defaultView;
  const topFixed = isFixedElement(outermost);
  const r = el.getBoundingClientRect();
  const box = applyToRect(geometry.transform, { x: r.x, y: r.y, width: r.width, height: r.height });
  const position = markerPosition(topPoint, top?.innerWidth ?? 0, top?.scrollY ?? 0, topFixed);
  const result: ElementCapture = {
    ...inner,
    x: position.x,
    y: position.y,
    boundingBox: toPageRect(box, { x: top?.scrollX ?? 0, y: top?.scrollY ?? 0 }, topFixed),
    url: top?.location.href ?? inner.url,
    frame: {
      path: framePathFor(el),
      x: inner.x,
      y: inner.y,
      fixed: Boolean(inner.isFixed),
      boundingBox: inner.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
    },
  };
  if (topFixed) result.isFixed = true;
  else delete result.isFixed;
  return result;
}
