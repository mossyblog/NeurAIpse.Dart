/**
 * Selector specificity and selector-list helpers for token resolution (inspector spec
 * 5.1, cascade rank 3). Pure string functions: no DOM. Follows Selectors Level 4:
 * `:is()`, `:not()`, `:has()` and `:nth-child(An+B of S)` take their most specific
 * argument, `:where()` counts zero, pseudo-elements count as type selectors.
 */

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements]. */
export type Specificity = [number, number, number];

const ZERO: Specificity = [0, 0, 0];

/** Pseudo-classes whose argument list contributes its maximum specificity. */
const MAX_ARG = new Set(["is", "not", "has", "matches", "-webkit-any", "-moz-any"]);
/** Single-colon spellings of pseudo-elements (CSS 2), counted as pseudo-elements. */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function addSpecificity(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function maxSpecificity(list: readonly Specificity[]): Specificity {
  let best: Specificity = ZERO;
  for (const s of list) if (compareSpecificity(s, best) > 0) best = s;
  return best;
}

/** Length of a CSS escape starting at `i` (the backslash): `\.` is 2, `\31 ` is 4. */
function escapeLength(text: string, i: number): number {
  const hex = /^[0-9a-fA-F]{1,6}[ \t\n]?/.exec(text.slice(i + 1, i + 8));
  return hex ? 1 + hex[0].length : Math.min(2, text.length - i);
}

/** Index of the bracket that closes the one opened at `open`, skipping strings and escapes. */
function closingIndex(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]" };
  const stack: string[] = [pairs[text[open]]];
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i += escapeLength(text, i) - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      i = end - 1;
      continue;
    }
    if (ch === "(" || ch === "[") stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return text.length - 1;
}

/** Index just past a quoted string starting at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Splits a selector list at top-level commas (not inside brackets, strings or escapes). */
export function splitSelectorList(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i += escapeLength(text, i) - 1;
    } else if (ch === '"' || ch === "'") {
      i = skipString(text, i) - 1;
    } else if (ch === "(" || ch === "[") {
      i = closingIndex(text, i);
    } else if (ch === ",") {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Reads an identifier (with escapes) from `i`; returns its end index. */
function identEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") j += escapeLength(text, j);
    else if (/[\w\- -￿]/.test(ch)) j++;
    else break;
  }
  return j;
}

/** Decodes CSS escapes in an identifier: `gap-y-0\.5` -> `gap-y-0.5`, `\31 0` -> `10`. */
export function cssUnescape(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([\s\S])/g, (_, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd) : (ch ?? ""),
  );
}

/** Specificity of one complex selector (no top-level commas). `&` must be resolved first. */
export function specificity(selector: string): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  let extra: Specificity = ZERO;
  const text = selector.trim();
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "#") {
      a++;
      i = identEnd(text, i + 1);
    } else if (ch === ".") {
      b++;
      i = identEnd(text, i + 1);
    } else if (ch === "[") {
      b++;
      i = closingIndex(text, i) + 1;
    } else if (ch === ":") {
      const element = text[i + 1] === ":";
      const nameStart = i + (element ? 2 : 1);
      const nameStop = identEnd(text, nameStart);
      const name = text.slice(nameStart, nameStop).toLowerCase();
      let args: string | null = null;
      let next = nameStop;
      if (text[nameStop] === "(") {
        const close = closingIndex(text, nameStop);
        args = text.slice(nameStop + 1, close);
        next = close + 1;
      }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        c++;
        // ::slotted(S) adds the specificity of its argument.
        if (name === "slotted" && args) extra = addSpecificity(extra, listSpecificity(args));
      } else if (name === "where") {
        // Zero by definition.
      } else if (MAX_ARG.has(name)) {
        if (args) extra = addSpecificity(extra, listSpecificity(args));
      } else if ((name === "nth-child" || name === "nth-last-child") && args && /\sof\s/i.test(args)) {
        b++;
        extra = addSpecificity(extra, listSpecificity(args.slice(args.search(/\sof\s/i) + 4)));
      } else if ((name === "host" || name === "host-context") && args) {
        b++;
        extra = addSpecificity(extra, listSpecificity(args));
      } else {
        b++;
      }
      i = next;
    } else if (ch === "*" || ch === "&" || ch === "|" || ch === ">" || ch === "+" || ch === "~" || /\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'") {
      i = skipString(text, i);
    } else if (ch === "\\" || /[\w\- -￿]/.test(ch)) {
      const end = identEnd(text, i);
      // `ns|tag`: the namespace prefix is not a type selector.
      if (text[end] !== "|" || text[end + 1] === "=") c++;
      i = Math.max(end, i + 1);
    } else {
      i++;
    }
  }
  return addSpecificity([a, b, c], extra);
}

/** Maximum specificity over a selector list (used for `:is()` and `&`). */
export function listSpecificity(list: string): Specificity {
  return maxSpecificity(splitSelectorList(list).map(specificity));
}

/**
 * Resolves a nested style rule selector against its parent (CSS Nesting): `&` becomes
 * `:is(parent)`; a selector without `&` is a descendant of the parent. Relative
 * selectors starting with a combinator keep it (`> a` -> `:is(p) > a`).
 */
export function resolveNestedSelector(parent: string, child: string): string {
  const parentIs = splitSelectorList(parent).length > 1 || /[\s>+~]/.test(parent.trim()) ? `:is(${parent})` : parent.trim();
  return splitSelectorList(child)
    .map((part) => (part.includes("&") ? replaceNesting(part, parentIs) : `${parentIs} ${part}`))
    .join(", ");
}

function replaceNesting(selector: string, replacement: string): string {
  let out = "";
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "\\") {
      const len = escapeLength(selector, i);
      out += selector.slice(i, i + len);
      i += len - 1;
    } else if (ch === '"' || ch === "'") {
      const end = skipString(selector, i);
      out += selector.slice(i, end);
      i = end - 1;
    } else if (ch === "&") {
      out += replacement;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Bucket keys for a selector's rightmost compound, for the rule index (spec risk 4). */
export type RightmostKey = { kind: "id" | "class" | "tag" | "any"; name: string };

/**
 * The most selective simple key in the last compound selector: id, else first class,
 * else type, else `any` (universal, attribute-only, pseudo-only or functional compounds).
 * Only rules in the buckets for an element's id, classes and tag (plus `any`) can match it.
 */
export function rightmostKey(selector: string): RightmostKey {
  const text = selector.trim();
  // Find the start of the last compound: after the last top-level combinator or space.
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i += escapeLength(text, i) - 1;
    else if (ch === '"' || ch === "'") i = skipString(text, i) - 1;
    else if (ch === "(" || ch === "[") i = closingIndex(text, i);
    else if (ch === ">" || ch === "+" || ch === "~" || /\s/.test(ch)) start = i + 1;
  }
  const compound = text.slice(start);
  let id: string | null = null;
  let cls: string | null = null;
  let tag: string | null = null;
  for (let i = 0; i < compound.length; ) {
    const ch = compound[i];
    if (ch === "#" || ch === ".") {
      const end = identEnd(compound, i + 1);
      const name = cssUnescape(compound.slice(i + 1, end));
      if (ch === "#") id ??= name;
      else cls ??= name;
      i = end;
    } else if (ch === "[") {
      i = closingIndex(compound, i) + 1;
    } else if (ch === ":") {
      const nameStop = identEnd(compound, i + (compound[i + 1] === ":" ? 2 : 1));
      i = compound[nameStop] === "(" ? closingIndex(compound, nameStop) + 1 : nameStop;
    } else if (i === 0 && (ch === "\\" || /[\w-]/.test(ch))) {
      const end = identEnd(compound, i);
      if (compound[end] !== "|") tag = cssUnescape(compound.slice(i, end)).toLowerCase();
      i = Math.max(end, i + 1);
    } else {
      i++;
    }
  }
  if (id) return { kind: "id", name: id };
  if (cls) return { kind: "class", name: cls };
  if (tag) return { kind: "tag", name: tag };
  return { kind: "any", name: "" };
}

/**
 * Tailwind-style utility name from a winning selector that is exactly one class plus
 * optional pseudo-classes or attribute conditions: `.p-4` -> `p-4`, `.md\:p-4` -> `md:p-4`.
 */
export function utilityClass(selector: string): string | undefined {
  const text = selector.trim();
  if (!text.startsWith(".")) return undefined;
  const end = identEnd(text, 1);
  const rest = text.slice(end);
  if (rest && !/^(?::[\w-]+(?:\([^)]*\))?|\[[^\]]*\])+$/.test(rest)) return undefined;
  return cssUnescape(text.slice(1, end));
}
