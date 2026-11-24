import { effectiveBackground, parseColor, type RGBA } from "./color.ts";
import { PROBE_ATTRIBUTE } from "./style-change.ts";
import { isTextCandidate, TYPE_PROPERTIES, type TypeStyle } from "./type-signature.ts";

/**
 * DOM readers for the type (I6) and colour (I8) inspectors. Thin wrappers over
 * getComputedStyle and a TreeWalker; the decisions live in the pure modules.
 */

/** True when the element has a direct text child with non-whitespace content. */
export function hasDirectText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

export function readTypeStyle(el: Element): TypeStyle {
  const cs = getComputedStyle(el);
  return Object.fromEntries(TYPE_PROPERTIES.map((p) => [p, cs.getPropertyValue(p).trim()])) as TypeStyle;
}

/** Nearest element (self or ancestor) that has its own text, skipping the overlay. */
export function textTarget(el: Element | null, isOverlay: (el: Element) => boolean): Element | null {
  for (let current = el; current && current !== document.documentElement; current = current.parentElement) {
    if (isOverlay(current)) return null;
    if (hasDirectText(current) && candidateOk(current, isOverlay)) return current;
  }
  return null;
}

function candidateOk(el: Element, isOverlay: (el: Element) => boolean): boolean {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return isTextCandidate({
    tag: el.localName,
    hasDirectText: hasDirectText(el),
    display: cs.display,
    visibility: cs.visibility,
    width: rect.width,
    height: rect.height,
    overlay: isOverlay(el),
  });
}

/** Single TreeWalker pass over the body: every text candidate (spec 4, scan cost). */
export function textCandidates(root: Element, isOverlay: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (isOverlay(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    if (node === root && root === document.body) continue;
    if (hasDirectText(node) && candidateOk(node, isOverlay)) out.push(node);
  }
  return out;
}

/** Runs `fn` with a hidden probe element inside `parent`, then removes it. */
export function withProbe<T>(parent: Element, fn: (probe: HTMLElement) => T): T {
  const probe = document.createElement("span");
  probe.setAttribute(PROBE_ATTRIBUTE, "");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute !important;visibility:hidden !important;pointer-events:none !important;left:-9999px;top:0;";
  parent.appendChild(probe);
  try {
    return fn(probe);
  } finally {
    probe.remove();
  }
}

/** Resolved px of `line-height: normal` for the element's font (spec 4 normalisation). */
export function normalLineHeightPx(el: Element): number {
  const cs = getComputedStyle(el);
  return withProbe(el.parentElement ?? document.body, (probe) => {
    probe.style.font = cs.font;
    probe.style.lineHeight = "normal";
    probe.style.display = "inline-block";
    probe.textContent = "Hg";
    return Math.round(probe.getBoundingClientRect().height * 100) / 100;
  });
}

/**
 * sRGB for any colour value (tokens, `light-dark()`, `color-mix()`, names) resolved in
 * the context of `context` through a probe; pure parsing first.
 */
export function resolveColorValue(value: string, context: Element = document.documentElement): RGBA | undefined {
  const direct = parseColor(value);
  if (direct) return direct;
  if (typeof CSS !== "undefined" && !CSS.supports("color", value) && !/var\(/.test(value)) return undefined;
  return withProbe(context.parentElement && context !== document.documentElement ? context.parentElement : document.body, (probe) => {
    probe.style.color = "rgb(1, 2, 3)";
    probe.style.setProperty("color", value);
    const computed = getComputedStyle(probe).color;
    if (computed === "rgb(1, 2, 3)" && value.trim() !== "rgb(1, 2, 3)") return undefined;
    return parseColor(computed);
  });
}

/** Element's own and ancestors' backgrounds, innermost first, composited (spec 8 contrast). */
export function backgroundBehind(el: Element, skipSelf = false): { color: RGBA; approximate: boolean } {
  const layers: { color: RGBA; image?: boolean }[] = [];
  for (let current: Element | null = skipSelf ? el.parentElement : el; current; current = current.parentElement) {
    const cs = getComputedStyle(current);
    const color = parseColor(cs.backgroundColor) ?? resolveColorValue(cs.backgroundColor, current) ?? { r: 0, g: 0, b: 0, a: 0 };
    layers.push({ color, image: cs.backgroundImage !== "none" });
    if (color.a >= 1) break;
  }
  return effectiveBackground(layers);
}

/** Colour properties that apply to an element (fill/stroke for SVG only, border when drawn). */
export function colorProperties(el: Element): string[] {
  const cs = getComputedStyle(el);
  const props = ["color", "background-color"];
  if (Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") props.push("border-color");
  if (el instanceof SVGElement) props.push("fill", "stroke");
  return props;
}

/** Computed value for a colour property (`border-color` reads the top side). */
export function computedColor(el: Element, property: string): string {
  const cs = getComputedStyle(el);
  return cs.getPropertyValue(property === "border-color" ? "border-top-color" : property).trim();
}
