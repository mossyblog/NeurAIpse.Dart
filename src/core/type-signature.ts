/**
 * Type inspector (inspector spec 4): signature keys, candidate filtering, grouping and
 * the steppers. Pure functions; the DOM walk lives in `type-dom.ts`.
 */

export const TYPE_PROPERTIES = ["font-family", "font-size", "line-height", "font-weight", "letter-spacing"] as const;
export type TypeProperty = (typeof TYPE_PROPERTIES)[number];

/** Resolved computed values, compared as exact strings (spec 4 normalisation). */
export type TypeStyle = Record<TypeProperty, string>;

/** `family|size|line-height|weight|letter-spacing`; `normal` stays `normal`. */
export function typeSignature(style: TypeStyle): string {
  return TYPE_PROPERTIES.map((p) => style[p].trim()).join("|");
}

/**
 * Same-token key (spec 4 "Same token only"): token names per property, falling back to
 * the value where a property has no token. Null when the font size has no token: those
 * elements are excluded and counted as unknown.
 */
export function sameTokenKey(style: TypeStyle, tokens: Partial<Record<TypeProperty, string | undefined>>): string | null {
  if (!tokens["font-size"]) return null;
  return TYPE_PROPERTIES.map((p) => tokens[p] ?? `=${style[p].trim()}`).join("|");
}

/** Inputs for the candidate test, read by the DOM layer. */
export type TextNodeInfo = {
  tag: string;
  /** At least one direct child text node with non-whitespace content. */
  hasDirectText: boolean;
  display: string;
  visibility: string;
  width: number;
  height: number;
  /** The overlay root, the toolbar or anything inside them. */
  overlay: boolean;
};

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "title", "meta", "link", "svg", "math", "textarea", "select", "option"]);

/** Spec 4 candidate rule: direct non-empty text, visible, not ours, not script/style. */
export function isTextCandidate(info: TextNodeInfo): boolean {
  if (info.overlay || !info.hasDirectText) return false;
  if (SKIP_TAGS.has(info.tag.toLowerCase())) return false;
  if (info.display === "none" || info.display === "contents" || info.visibility === "hidden" || info.visibility === "collapse") return false;
  return info.width > 0 && info.height > 0;
}

/** Groups items by key, keeping first-seen order; null keys are counted as unknown. */
export function groupByKey<T>(items: readonly T[], key: (item: T) => string | null): { groups: Map<string, T[]>; unknown: T[] } {
  const groups = new Map<string, T[]>();
  const unknown: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (k == null) {
      unknown.push(item);
      continue;
    }
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return { groups, unknown };
}

/** First family of a resolved list, unquoted: `"Geist", "Geist Fallback"` -> `Geist`. */
export function primaryFamily(family: string): string {
  const first = family.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

/** Spec 7.2 signature line: `Inter, 14px / 20px, 500, 0` (letter-spacing `normal` is 0). */
export function signatureLabel(style: TypeStyle): string {
  const tracking = style["letter-spacing"].trim();
  return `${primaryFamily(style["font-family"])}, ${style["font-size"]} / ${style["line-height"]}, ${style["font-weight"]}, ${tracking === "normal" || tracking === "0px" ? "0" : tracking}`;
}

/** Display name for a type group: the font-size token as a utility (`--text-sm` -> `text-sm`), else size/line-height. */
export function typeGroupName(style: TypeStyle, fontSizeToken?: string): string {
  if (fontSizeToken && /^--text-/.test(fontSizeToken)) return fontSizeToken.slice(2);
  if (fontSizeToken) return fontSizeToken;
  return `${style["font-size"]} / ${style["line-height"]}`;
}

/**
 * Type steppers: font-size ±2px (Shift ±1), line-height ±4px (Shift ±1), weight ±100
 * (Shift ±10, kept within 1-1000), letter-spacing ±0.5px (Shift ±0.1).
 */
export function stepTypeValue(property: TypeProperty, current: number, direction: 1 | -1, fine = false): number {
  const steps: Record<TypeProperty, [number, number]> = {
    "font-family": [0, 0],
    "font-size": [2, 1],
    "line-height": [4, 1],
    "font-weight": [100, 10],
    "letter-spacing": [0.5, 0.1],
  };
  const step = steps[property][fine ? 1 : 0];
  let next = current + direction * step;
  if (property === "font-weight") {
    if (!fine) next = Math.round(next / 100) * 100;
    next = Math.min(1000, Math.max(1, next));
  } else if (property === "font-size") next = Math.max(1, next);
  else if (property === "line-height") next = Math.max(0, next);
  return Math.round(next * 1000) / 1000;
}

/** Raw type input as a CSS value, or null when invalid. Weight is unitless; others px/em/rem. */
export function rawTypeValue(property: TypeProperty, input: string, unit: "px" | "em" | "rem" | "" = "px"): string | null {
  const text = input.trim();
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) return null;
  if (property === "font-weight") return n >= 1 && n <= 1000 ? String(Math.round(n)) : null;
  if (property === "font-family") return null;
  if ((property === "font-size" && n <= 0) || (property === "line-height" && n < 0)) return null;
  return `${Math.round(n * 1000) / 1000}${property === "line-height" && unit === "" ? "" : unit || "px"}`;
}
