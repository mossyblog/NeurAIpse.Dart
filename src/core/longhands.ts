/**
 * Which declarations can set a physical longhand (inspector spec 5.1 step 6): the
 * longhand itself, its flow-relative twin for the element's writing mode and
 * direction, then the shorthands that include either. Pure.
 */

export type FlowContext = { direction?: "ltr" | "rtl"; writingMode?: string };

export type Alias = { name: string; shorthand: boolean };

type Side = "top" | "right" | "bottom" | "left";

/** Flow-relative name of a physical side: `block-start`, `inline-end`... */
export function logicalSide(side: Side, flow: FlowContext = {}): string {
  const rtl = flow.direction === "rtl";
  const vertical = /^vertical|^sideways/.test(flow.writingMode ?? "horizontal-tb");
  if (!vertical) {
    if (side === "top") return "block-start";
    if (side === "bottom") return "block-end";
    if (side === "left") return rtl ? "inline-end" : "inline-start";
    return rtl ? "inline-start" : "inline-end";
  }
  // vertical-rl / sideways-rl: block flows right to left; vertical-lr: left to right.
  const rl = /-rl$/.test(flow.writingMode ?? "");
  if (side === "top") return rtl ? "inline-end" : "inline-start";
  if (side === "bottom") return rtl ? "inline-start" : "inline-end";
  if (side === "right") return rl ? "block-start" : "block-end";
  return rl ? "block-end" : "block-start";
}

const BOX = /^(margin|padding|scroll-margin|scroll-padding)-(top|right|bottom|left)$/;
const BORDER_SIDE = /^border-(top|right|bottom|left)-(color|width|style)$/;

/**
 * Declarations that may set `property`, most specific first. Shorthands are flagged:
 * their text only maps to the longhand when it holds a single value.
 */
export function propertyAliases(property: string, flow: FlowContext = {}): Alias[] {
  const long = (name: string): Alias => ({ name, shorthand: false });
  const short = (name: string): Alias => ({ name, shorthand: true });
  const box = BOX.exec(property);
  if (box) {
    const [, family, side] = box;
    const logical = logicalSide(side as Side, flow);
    const axis = logical.split("-")[0];
    return [long(property), long(`${family}-${logical}`), short(`${family}-${axis}`), short(family)];
  }
  const border = BORDER_SIDE.exec(property);
  if (border) {
    const [, side, part] = border;
    const logical = logicalSide(side as Side, flow);
    const axis = logical.split("-")[0];
    return [
      long(property),
      long(`border-${logical}-${part}`),
      short(`border-${part}`),
      short(`border-${axis}-${part}`),
      short(`border-${side}`),
      short(`border-${logical}`),
      short(`border-${axis}`),
      short("border"),
    ];
  }
  switch (property) {
    case "row-gap":
    case "column-gap":
      return [long(property), short("gap")];
    case "background-color":
      return [long(property), short("background")];
    case "font-size":
    case "line-height":
    case "font-weight":
    case "font-family":
    case "font-style":
      return [long(property), short("font")];
    default:
      return [long(property)];
  }
}

/** Inherited properties among those the inspectors read (custom properties inherit too). */
export function isInheritedProperty(property: string): boolean {
  return (
    property.startsWith("--") ||
    ["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "font-style", "fill", "stroke"].includes(property)
  );
}

/** Splits a value at top-level whitespace and commas (not inside functions or strings). */
export function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote = "";
  for (const ch of value.trim()) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (/\s/.test(ch) || ch === ",")) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}
