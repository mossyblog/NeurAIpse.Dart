import {
  closestCrossingShadow,
  collapseWhitespace,
  parentCrossingShadow,
  truncate,
} from "./dom.ts";

export const DEFAULT_IDENTIFYING_ATTRIBUTES: readonly string[] = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "data-component",
];

export const MAX_IDENTIFYING_ATTRIBUTES = 16;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 500;
export const DEFAULT_PATH_DEPTH = 4;
/** Longest data-* value placed in a selector path. */
const PATH_ATTRIBUTE_LIMIT = 64;
const MAX_PATH_ATTRIBUTES = 2;
const NAME_TEXT_LIMIT = 40;

/** Dedupes names, appends extras (e.g. a copyFormat attribute, never dropped) and caps at 16. */
export function normalizeAttributeNames(
  names: readonly string[] = DEFAULT_IDENTIFYING_ATTRIBUTES,
  extra: readonly (string | null | undefined)[] = [],
): string[] {
  const unique = (list: readonly (string | null | undefined)[]) => {
    const result: string[] = [];
    for (const name of list) {
      const trimmed = name?.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
    return result;
  };
  // Extras (the copyFormat attribute) always keep their slot within the cap.
  const extras = unique(extra).slice(0, MAX_IDENTIFYING_ATTRIBUTES);
  const base = unique(names).filter((name) => !extras.includes(name));
  return [...base.slice(0, MAX_IDENTIFYING_ATTRIBUTES - extras.length), ...extras];
}

/** Escapes quotes and backslashes for a double-quoted attribute selector value. */
export function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

const GENERATED_ID = /[:«»]|^_r_[a-z0-9]+_$|^radix-/i;
const SIMPLE_IDENT = /^[A-Za-z_][\w-]*$/;

function stableId(el: Element): string | null {
  const id = el.getAttribute("id");
  if (!id || GENERATED_ID.test(id) || !SIMPLE_IDENT.test(id)) return null;
  return id;
}

function tagName(el: Element): string {
  return el.localName || el.tagName.toLowerCase();
}

function pathAttributes(el: Element, attributeNames: readonly string[]): string {
  let selector = "";
  let count = 0;
  for (const name of attributeNames) {
    if (count >= MAX_PATH_ATTRIBUTES) break;
    if (!name.startsWith("data-")) continue;
    const value = el.getAttribute(name);
    if (value == null || value === "" || value.length > PATH_ATTRIBUTE_LIMIT) continue;
    selector += `[${name}="${escapeAttributeValue(value)}"]`;
    count += 1;
  }
  return selector;
}

function nthOfType(el: Element): string {
  const parent = el.parentNode;
  if (!parent) return "";
  const same = Array.from(parent.children).filter((child) => child.localName === el.localName);
  return same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : "";
}

type Segment = { selector: string; anchored: boolean };

function segmentFor(el: Element, attributeNames: readonly string[]): Segment {
  const tag = tagName(el);
  const attributes = pathAttributes(el, attributeNames);
  if (attributes) return { selector: `${tag}${attributes}`, anchored: false };
  const id = stableId(el);
  if (id) return { selector: `${tag}#${id}`, anchored: true };
  return { selector: `${tag}${nthOfType(el)}`, anchored: false };
}

function isRootElement(el: Element): boolean {
  const tag = tagName(el);
  return tag === "html" || tag === "body";
}

/**
 * Selector path, nearest `maxDepth` segments. Prefers identifying data-* attributes,
 * then id (which ends the walk), then tag with nth-of-type. Crosses shadow roots.
 */
export function getElementPath(
  target: Element,
  maxDepth = DEFAULT_PATH_DEPTH,
  attributeNames: readonly string[] = DEFAULT_IDENTIFYING_ATTRIBUTES,
): string {
  const segments: string[] = [];
  let current: Element | null = target;
  while (current && segments.length < maxDepth && !isRootElement(current)) {
    const segment = segmentFor(current, attributeNames);
    segments.unshift(segment.selector);
    if (segment.anchored) break;
    current = parentCrossingShadow(current);
  }
  return segments.length > 0 ? segments.join(" > ") : tagName(target);
}

/** Every ancestor from body down, with id and cleaned classes. */
export function getFullPath(target: Element): string {
  const segments: string[] = [];
  let current: Element | null = target;
  while (current && tagName(current) !== "html") {
    const id = current.getAttribute("id");
    const classes = getElementClasses(current)
      .split(" ")
      .filter(Boolean)
      .map((name) => `.${name}`)
      .join("");
    segments.unshift(`${tagName(current)}${id ? `#${id}` : ""}${classes}`);
    current = parentCrossingShadow(current);
  }
  return segments.join(" > ");
}

const TURBOPACK_MODULE = /^[\w-]+?-module__[\w-]+__([\w-]+)$/;
const HASH_SUFFIX = /^(.+?)_{1,2}([A-Za-z0-9-]{5,})$/;

/** Removes a CSS-module hash: `btn_a1b2c` -> `btn`, `page-module__x1Y2z__main` -> `main`. */
export function stripModuleHash(name: string): string {
  const turbopack = TURBOPACK_MODULE.exec(name);
  if (turbopack) return turbopack[1];
  const suffixed = HASH_SUFFIX.exec(name);
  if (suffixed && /\d/.test(suffixed[2])) return suffixed[1];
  return name;
}

/** Space-separated, deduped class list with CSS-module hashes stripped. */
export function getElementClasses(el: Element): string {
  const raw = el.getAttribute("class") ?? "";
  const names: string[] = [];
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const name = stripModuleHash(token);
    if (!names.includes(name)) names.push(name);
  }
  return names.join(" ");
}

function labelText(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return collapseWhitespace(aria);
  const tag = tagName(el);
  if (tag === "img") return collapseWhitespace(el.getAttribute("alt") ?? "");
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const field = el as HTMLInputElement;
    return collapseWhitespace(
      el.getAttribute("placeholder") ?? field.labels?.[0]?.textContent ?? el.getAttribute("name") ?? "",
    );
  }
  return collapseWhitespace(el.textContent ?? "");
}

function quoted(prefix: string, text: string): string {
  return text ? `${prefix} "${truncate(text, NAME_TEXT_LIMIT)}"` : prefix;
}

const TEXT_TAGS = new Set([
  "p", "span", "label", "li", "td", "th", "strong", "em", "small", "code", "dt", "dd",
  "figcaption", "legend", "summary", "option", "blockquote",
]);

function elementName(el: Element): string {
  const tag = tagName(el);
  const role = el.getAttribute("role");
  const text = labelText(el);
  if (tag === "button" || role === "button") return quoted("button", text);
  if (tag === "a") {
    const inNav = Boolean(closestCrossingShadow(el.parentElement, "nav"));
    return quoted(inNav ? "nav link" : "link", text);
  }
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return quoted(type === "text" ? "input" : `${type} input`, text);
  }
  if (tag === "textarea" || tag === "select") return quoted(tag, text);
  if (tag === "img") return quoted("image", text);
  if (/^h[1-6]$/.test(tag)) return quoted(tag, text);
  if (tag === "svg") return "icon";
  if (tag === "p") return quoted("paragraph", text);
  if (TEXT_TAGS.has(tag) || (el.children.length === 0 && text)) return quoted(tag, text);
  const id = stableId(el);
  if (id) return `${tag}#${id}`;
  const firstClass = getElementClasses(el).split(" ")[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

/** Display name and selector path. */
export function identifyElement(
  el: Element,
  attributeNames: readonly string[] = DEFAULT_IDENTIFYING_ATTRIBUTES,
): { name: string; path: string } {
  return { name: elementName(el), path: getElementPath(el, DEFAULT_PATH_DEPTH, attributeNames) };
}

/** Short descriptor used for sibling lists. */
export function describeElement(el: Element): string {
  return elementName(el);
}

/** Captured identifying attributes. Values over 500 chars are ignored. */
export function getIdentifyingAttributes(
  el: Element,
  attributeNames: readonly string[] = DEFAULT_IDENTIFYING_ATTRIBUTES,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let found = false;
  for (const name of attributeNames.slice(0, MAX_IDENTIFYING_ATTRIBUTES)) {
    const value = el.getAttribute(name);
    if (value == null || value.length > MAX_ATTRIBUTE_VALUE_LENGTH) continue;
    result[name] = value;
    found = true;
  }
  return found ? result : undefined;
}
