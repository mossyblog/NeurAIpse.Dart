import { buildPreviewCss, GROUP_ATTRIBUTE, PREVIEW_ATTRIBUTE, type PreviewRule } from "./style-change.ts";

/**
 * Live preview (inspector spec 6): one `<style data-annotate-preview>` first in `<head>`
 * and a generated `data-annotate-group` attribute per inspected element. No inline
 * styles, no class changes. Works with any DOM-like document (tests use a fake).
 */

type PreviewElement = {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
};

type PreviewDocument = {
  head: { insertBefore(node: unknown, ref: unknown): unknown; firstChild: unknown };
  createElement(tag: "style"): { setAttribute(name: string, value: string): void; textContent: string | null; remove(): void; isConnected?: boolean };
  querySelectorAll(selector: string): ArrayLike<PreviewElement> & Iterable<PreviewElement>;
};

/**
 * One declaration for one element. `key` names the change group the entry belongs to
 * (a type group, a colour group); elements with the same set of keys share one
 * `data-annotate-group` value, so a group's members carry one attribute and one rule.
 * Without a key each element is its own group.
 */
export type PreviewEntry<E> = { element: E; property: string; value: string; key?: string };

export type Preview<E extends PreviewElement> = {
  /** Replaces the whole preview with these entries (empty reverts). Returns the CSS. */
  apply(entries: readonly PreviewEntry<E>[]): string;
  /** Removes the style element and every group attribute. Safe to call repeatedly. */
  revert(): void;
};

export function createPreview<E extends PreviewElement>(doc: PreviewDocument): Preview<E> {
  let style: ReturnType<PreviewDocument["createElement"]> | null = null;
  const ids = new Map<E, string>();
  /** Membership signature (sorted keys) -> attribute value, stable across applies. */
  const groupIds = new Map<string, string>();
  const serials = new Map<E, number>();
  let counter = 0;
  let serial = 0;

  const clearAttributes = (keep: ReadonlySet<E>) => {
    for (const [element] of ids) {
      if (keep.has(element)) continue;
      element.removeAttribute(GROUP_ATTRIBUTE);
      ids.delete(element);
    }
    // Stale attributes from an earlier session or a lost reference.
    for (const node of Array.from(doc.querySelectorAll(`[${GROUP_ATTRIBUTE}]`))) {
      if (!keep.has(node as E)) node.removeAttribute(GROUP_ATTRIBUTE);
    }
  };

  const revert = () => {
    clearAttributes(new Set());
    style?.remove();
    style = null;
  };

  const apply = (entries: readonly PreviewEntry<E>[]) => {
    const elements = new Set(entries.map((entry) => entry.element));
    clearAttributes(elements);
    const keys = new Map<E, Set<string>>();
    for (const entry of entries) {
      let own = serials.get(entry.element);
      if (own == null) serials.set(entry.element, (own = ++serial));
      const set = keys.get(entry.element) ?? new Set<string>();
      set.add(entry.key ?? `@${own}`);
      keys.set(entry.element, set);
    }
    const rules: PreviewRule[] = [];
    for (const entry of entries) {
      const signature = [...(keys.get(entry.element) ?? [])].sort().join(" ");
      let id = groupIds.get(signature);
      if (!id) {
        id = `g${++counter}`;
        groupIds.set(signature, id);
      }
      ids.set(entry.element, id);
      if (entry.element.getAttribute(GROUP_ATTRIBUTE) !== id) entry.element.setAttribute(GROUP_ATTRIBUTE, id);
      rules.push({ group: id, property: entry.property, value: entry.value });
    }
    const css = buildPreviewCss(rules);
    if (!css) {
      revert();
      return "";
    }
    if (!style || style.isConnected === false) {
      style = doc.createElement("style");
      style.setAttribute(PREVIEW_ATTRIBUTE, "");
      // First in <head>: the preview layer is declared before every page layer (see buildPreviewCss).
      doc.head.insertBefore(style, doc.head.firstChild);
    }
    if (style.textContent !== css) style.textContent = css;
    return css;
  };

  return { apply, revert };
}
