import { compareSpecificity, type Specificity } from "./specificity.ts";

/**
 * Cascade winner (inspector spec 5.1) for author declarations of one property on one
 * element. Pure: candidates are plain records built by the DOM scanner.
 *
 * Rank, highest first:
 *  1. importance: `!important` beats normal;
 *  2. element-attached (inline `style`) beats rules of the same importance;
 *  3. `@layer` order: normal: later layer wins and unlayered beats layered; important:
 *     reversed (earlier layer wins, layered beats unlayered);
 *  4. specificity of the most specific matching selector in the list;
 *  5. source order: later sheet, later rule.
 */

/**
 * Layer position, compared element by element. Each entry is the layer's index among its
 * siblings in first-declaration order; `UNLAYERED` (Infinity) marks styles declared
 * directly at that level, which beat every sublayer there for normal declarations.
 * Unlayered page styles are `[UNLAYERED]`; styles directly in `@layer a` are `[i(a), UNLAYERED]`.
 */
export type LayerKey = readonly number[];
export const UNLAYERED = Number.POSITIVE_INFINITY;

export type CascadeCandidate = {
  important: boolean;
  /** From the element's `style` attribute. */
  inline?: boolean;
  layer: LayerKey;
  specificity: Specificity;
  /** Document order of the rule (sheet order, then rule order within the flattened sheet). */
  order: number;
};

export function compareLayers(a: LayerKey, b: LayerKey): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? UNLAYERED;
    const y = b[i] ?? UNLAYERED;
    if (x !== y) return x === UNLAYERED ? 1 : y === UNLAYERED ? -1 : x - y;
  }
  return 0;
}

/** Positive when `a` beats `b`. */
export function compareCandidates(a: CascadeCandidate, b: CascadeCandidate): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  const ai = Boolean(a.inline);
  const bi = Boolean(b.inline);
  if (ai !== bi) return ai ? 1 : -1;
  const layer = compareLayers(a.layer, b.layer);
  if (layer !== 0) return a.important ? -layer : layer;
  const spec = compareSpecificity(a.specificity, b.specificity);
  if (spec !== 0) return spec;
  return a.order - b.order;
}

export function pickWinner<T extends CascadeCandidate>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!best || compareCandidates(candidate, best) > 0) best = candidate;
  }
  return best;
}

/**
 * Assigns layer keys in first-declaration order, as the browser does: `@layer a, b;`
 * statements, `@layer a { }` blocks and `@import ... layer(a)` all register names.
 * Anonymous layers get a fresh slot each time.
 */
export type LayerContext = {
  /** Index path from the root; styles directly here get `[...path, UNLAYERED]`. */
  readonly path: readonly number[];
  /** Dotted display name, e.g. `utilities` or `a.b`; "" when unlayered. */
  readonly name: string;
  readonly children: Map<string, LayerContext>;
  anon: number;
};

export function createLayerRegistry() {
  const root: LayerContext = { path: [], name: "", children: new Map(), anon: 0 };
  const enterOne = (parent: LayerContext, name: string | null): LayerContext => {
    const key = name ?? `\u0000anon${parent.anon++}`;
    let node = parent.children.get(key);
    if (!node) {
      const label = name ?? "(anonymous)";
      node = { path: [...parent.path, parent.children.size], name: parent.name ? `${parent.name}.${label}` : label, children: new Map(), anon: 0 };
      parent.children.set(key, node);
    }
    return node;
  };
  return {
    root,
    /** Enters `@layer name` (dotted names are several levels; null is anonymous), registering it. */
    enter(parent: LayerContext, name: string | null): LayerContext {
      if (name == null) return enterOne(parent, null);
      let node = parent;
      for (const part of name.split(".")) node = enterOne(node, part.trim());
      return node;
    },
    /** Key for styles declared directly in `context`. */
    key(context: LayerContext): LayerKey {
      return [...context.path, UNLAYERED];
    },
  };
}
