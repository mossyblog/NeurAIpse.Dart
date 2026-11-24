import type { Point, Rect } from "./types.ts";

/**
 * Rearrange preview (parity spec 10.2): one `<style data-annotate-rearrange>` first in
 * `<head>` and a `data-annotate-rearrange-id` attribute per previewed element. Moves use
 * the `translate` property (it composes with the element's own `transform` and never
 * reflows siblings); resizes override `width` / `height`; removal hides with
 * `visibility: hidden`, keeping the element's space. `revert()` leaves no trace.
 */

export const REARRANGE_STYLE_ATTRIBUTE = "data-annotate-rearrange";
export const REARRANGE_ID_ATTRIBUTE = "data-annotate-rearrange-id";
export const REARRANGE_LAYER = "annotate-rearrange";

export type RearrangeRule = {
  id: string;
  translate: Point;
  width?: number;
  height?: number;
  removed?: boolean;
  /** Inline boxes ignore translate and sizes: previewed as `inline-block`. */
  inline?: boolean;
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** CSS for the rules, in `@layer annotate-rearrange` with `!important` ("" when empty). */
export function buildRearrangeCss(rules: readonly RearrangeRule[]): string {
  const body: string[] = [];
  for (const rule of rules) {
    if (!/^[\w-]+$/.test(rule.id)) continue;
    const decls: string[] = [];
    const finite = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);
    if (finite(rule.translate.x) && finite(rule.translate.y) && (rule.translate.x || rule.translate.y)) decls.push(`translate: ${px(rule.translate.x)} ${px(rule.translate.y)}`);
    if (finite(rule.width) || finite(rule.height)) decls.push("box-sizing: border-box");
    if (finite(rule.width)) decls.push(`width: ${px(rule.width)}`, `min-width: ${px(rule.width)}`, `max-width: ${px(rule.width)}`, "flex-shrink: 0");
    if (finite(rule.height)) decls.push(`height: ${px(rule.height)}`, `min-height: ${px(rule.height)}`, `max-height: ${px(rule.height)}`);
    if (rule.removed) decls.push("visibility: hidden");
    if (rule.inline && decls.length) decls.push("display: inline-block");
    if (!decls.length) continue;
    body.push(`  [${REARRANGE_ID_ATTRIBUTE}="${rule.id}"] { ${decls.map((d) => `${d} !important;`).join(" ")} }`);
  }
  if (!body.length) return "";
  return `@layer ${REARRANGE_LAYER} {\n${body.join("\n")}\n}\n`;
}

/** One previewed element: where it should appear (document px) relative to its own layout box. */
export type RearrangeTarget = {
  element: Element;
  /** Position offset from the element's unpreviewed layout box (current minus original). */
  offset: Point;
  /** New size when resized. */
  size?: { width: number; height: number };
  removed?: boolean;
};

export type RearrangePreview = {
  /** Replaces the preview with these targets (empty reverts). Returns each element's unpreviewed rect (document px). */
  apply(targets: readonly RearrangeTarget[]): Map<Element, Rect>;
  revert(): void;
};

const docRect = (el: Element, view: Window): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.left + view.scrollX, y: b.top + view.scrollY, width: b.width, height: b.height };
};

/**
 * Live preview in a real document. Each apply measures every element unpreviewed (after
 * a synchronous revert, so nothing paints in between), writes the sizes, re-measures to
 * catch layout shifts a resize causes (centred flex items), then writes the translates
 * that land each box at its unpreviewed position plus its offset.
 */
export function createRearrangePreview(doc: Document): RearrangePreview {
  const view = doc.defaultView ?? window;
  let style: HTMLStyleElement | null = null;
  const ids = new Map<Element, string>();
  let counter = 0;

  const clear = () => {
    for (const node of Array.from(doc.querySelectorAll(`[${REARRANGE_ID_ATTRIBUTE}]`))) node.removeAttribute(REARRANGE_ID_ATTRIBUTE);
    if (style) style.textContent = "";
  };

  const write = (rules: RearrangeRule[], final: boolean) => {
    const css = buildRearrangeCss(rules);
    if (!css) {
      if (final) revert();
      else if (style) style.textContent = "";
      return;
    }
    if (!style || !style.isConnected) {
      style = doc.createElement("style");
      style.setAttribute(REARRANGE_STYLE_ATTRIBUTE, "");
      doc.head.insertBefore(style, doc.head.firstChild);
    }
    if (style.textContent !== css) style.textContent = css;
  };

  const revert = () => {
    for (const node of Array.from(doc.querySelectorAll(`[${REARRANGE_ID_ATTRIBUTE}]`))) node.removeAttribute(REARRANGE_ID_ATTRIBUTE);
    style?.remove();
    style = null;
    for (const stale of Array.from(doc.querySelectorAll(`style[${REARRANGE_STYLE_ATTRIBUTE}]`))) stale.remove();
  };

  const idFor = (el: Element) => {
    let id = ids.get(el);
    if (!id) ids.set(el, (id = `r${++counter}`));
    return id;
  };

  const apply = (targets: readonly RearrangeTarget[]) => {
    const bases = new Map<Element, Rect>();
    const live = targets.filter((t) => t.element.isConnected);
    clear();
    for (const t of live) bases.set(t.element, docRect(t.element, view));
    if (!live.length) {
      revert();
      return bases;
    }
    const inline = new Map<Element, boolean>();
    for (const t of live) inline.set(t.element, view.getComputedStyle(t.element).display === "inline");
    const rule = (t: RearrangeTarget, translate: Point): RearrangeRule => ({
      id: idFor(t.element),
      translate,
      ...(t.size ? { width: t.size.width, height: t.size.height } : {}),
      ...(t.removed ? { removed: true } : {}),
      ...(inline.get(t.element) && (t.size || t.offset.x || t.offset.y) ? { inline: true } : {}),
    });
    for (const t of live) t.element.setAttribute(REARRANGE_ID_ATTRIBUTE, idFor(t.element));
    // Pass 1: sizes only, so a resize's own layout shift can be measured.
    write(live.map((t) => rule(t, { x: 0, y: 0 })), false);
    const shifted = new Map<Element, Rect>();
    for (const t of live) shifted.set(t.element, t.size || inline.get(t.element) ? docRect(t.element, view) : bases.get(t.element)!);
    // Pass 2: translate from where the box now sits to base + offset.
    write(
      live.map((t) => {
        const base = bases.get(t.element)!;
        const now = shifted.get(t.element)!;
        return rule(t, { x: base.x + t.offset.x - now.x, y: base.y + t.offset.y - now.y });
      }),
      true,
    );
    return bases;
  };

  return { apply, revert };
}
