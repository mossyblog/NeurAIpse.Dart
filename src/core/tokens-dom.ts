import { createLayerRegistry, pickWinner, type CascadeCandidate, type LayerContext, type LayerKey } from "./cascade.ts";
import { isInheritedProperty, propertyAliases, topLevelParts, type FlowContext } from "./longhands.ts";
import { resolveNestedSelector, rightmostKey, specificity, splitSelectorList, utilityClass, type Specificity } from "./specificity.ts";
import { GROUP_ATTRIBUTE, PREVIEW_ATTRIBUTE } from "./style-change.ts";
import { guessCandidates } from "./token-catalog.ts";
import {
  driftFlags,
  effectiveReference,
  guessTokens,
  hasVarReference,
  isInternalVar,
  lengthPx,
  lineHeightPx,
  multiplierToken,
  tokenDisplayLabel,
  type DeclarationForm,
  type TokenStatus,
} from "./token-values.ts";

/**
 * Token resolution by stylesheet scan (inspector spec 5.1, phase I5). Reads authored
 * declarations through CSS Typed OM, picks the cascade winner, follows custom-property
 * chains to the design token, and falls back to the `:root` guess (5.2). Results are
 * cached per stylesheet version; `peek` never computes on the caller's frame.
 */

export type TokenOrigin = { href: string; layer?: string; selector?: string; inherited?: boolean };

export type TokenResolution = {
  property: string;
  status: TokenStatus;
  /** Record token: `--text-sm`, `--spacing × 4`, `--card-padding`. */
  token?: string;
  /** Utility class of the winning rule, e.g. `p-4`, when it is a single-class selector. */
  utility?: string;
  /** Authored text of the winning declaration. */
  css?: string;
  /** Custom-property chain followed from the declaration: [`--card-padding`, `--spacing × 2`]. */
  chain?: string[];
  /** Guess candidates (status `guess`). */
  guesses?: string[];
  origin?: TokenOrigin;
  /** Why the token is unknown: `cross-origin stylesheet`, `container query`, `cascade mismatch`, `shorthand`. */
  reason?: string;
  /** Computed value at resolution time. */
  computed: string;
  /** Drift flags (spec 5.3). */
  flags: string[];
};

type Condition = { kind: "media" | "supports" | "container" | "scope"; text: string };

type Declarations = { style: CSSStyleDeclaration; styleMap?: StylePropertyMapReadOnly };

type Entry = {
  selector: string;
  specificity: Specificity;
  decl: Declarations;
  layer: LayerKey;
  layerName: string;
  order: number;
  href: string;
  conditions: Condition[];
};

type Index = {
  byId: Map<string, Entry[]>;
  byClass: Map<string, Entry[]>;
  byTag: Map<string, Entry[]>;
  any: Entry[];
  unreadable: number;
  /** Custom property names declared anywhere (for the `:root` catalogue). */
  declaredVars: Set<string>;
};

const sheetIds = new WeakMap<object, number>();
let sheetCounter = 0;
const idOf = (o: object) => {
  let id = sheetIds.get(o);
  if (id == null) sheetIds.set(o, (id = ++sheetCounter));
  return id;
};

function push(map: Map<string, Entry[]>, key: string, entry: Entry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function hrefOf(sheet: CSSStyleSheet): string {
  if (sheet.href) return sheet.href;
  const owner = sheet.ownerNode as Element | null;
  const id = owner?.getAttribute?.("id");
  return id ? `<style#${id}>` : "<style>";
}

function rulesOf(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    // Cross-origin sheet without CORS: spec 5.1 step 5.
    return null;
  }
}

/** True for our own preview sheet, which must never be the authored winner. */
function isOwnSheet(sheet: CSSStyleSheet): boolean {
  const owner = sheet.ownerNode as Element | null;
  return Boolean(owner?.hasAttribute?.(PREVIEW_ATTRIBUTE));
}

function buildIndex(sheets: readonly CSSStyleSheet[]): Index {
  const index: Index = { byId: new Map(), byClass: new Map(), byTag: new Map(), any: [], unreadable: 0, declaredVars: new Set() };
  const layers = createLayerRegistry();
  let order = 0;

  const add = (selectorText: string, decl: Declarations, layer: LayerContext, conditions: Condition[], href: string) => {
    order++;
    const style = decl.style;
    for (let i = 0; i < style.length; i++) if (style[i].startsWith("--")) index.declaredVars.add(style[i]);
    for (const selector of splitSelectorList(selectorText)) {
      const entry: Entry = { selector, specificity: specificity(selector), decl, layer: layers.key(layer), layerName: layer.name, order, href, conditions };
      const key = rightmostKey(selector);
      if (key.kind === "id") push(index.byId, key.name, entry);
      else if (key.kind === "class") push(index.byClass, key.name, entry);
      else if (key.kind === "tag") push(index.byTag, key.name, entry);
      else index.any.push(entry);
    }
  };

  const walk = (rules: CSSRuleList, layer: LayerContext, conditions: Condition[], href: string, parent: string | null, depth: number) => {
    if (depth > 32) return;
    for (const rule of Array.from(rules)) {
      const type = rule.constructor?.name ?? "";
      if (type === "CSSStyleRule") {
        const styleRule = rule as CSSStyleRule;
        const selector = parent ? resolveNestedSelector(parent, styleRule.selectorText) : styleRule.selectorText;
        add(selector, { style: styleRule.style, styleMap: styleRule.styleMap }, layer, conditions, href);
        if (styleRule.cssRules?.length) walk(styleRule.cssRules, layer, conditions, href, selector, depth + 1);
      } else if (type === "CSSNestedDeclarations") {
        if (parent) add(parent, { style: (rule as CSSStyleRule).style }, layer, conditions, href);
      } else if (type === "CSSImportRule") {
        const imp = rule as CSSImportRule & { layerName?: string | null; supportsText?: string | null };
        if (!imp.styleSheet) continue;
        const nested = rulesOf(imp.styleSheet);
        if (!nested) {
          index.unreadable++;
          continue;
        }
        const next = imp.layerName != null ? layers.enter(layer, imp.layerName || null) : layer;
        const conds = [...conditions];
        if (imp.media?.mediaText) conds.push({ kind: "media", text: imp.media.mediaText });
        if (imp.supportsText) conds.push({ kind: "supports", text: imp.supportsText });
        walk(nested, next, conds, imp.styleSheet.href ?? href, null, depth + 1);
      } else if (type === "CSSLayerStatementRule") {
        for (const name of (rule as CSSLayerStatementRule).nameList) layers.enter(layer, name);
      } else if (type === "CSSLayerBlockRule") {
        const block = rule as CSSLayerBlockRule;
        walk(block.cssRules, layers.enter(layer, block.name || null), conditions, href, parent, depth + 1);
      } else if (type === "CSSMediaRule") {
        const media = rule as CSSMediaRule;
        walk(media.cssRules, layer, [...conditions, { kind: "media", text: media.media.mediaText }], href, parent, depth + 1);
      } else if (type === "CSSSupportsRule") {
        const supports = rule as CSSSupportsRule;
        walk(supports.cssRules, layer, [...conditions, { kind: "supports", text: supports.conditionText }], href, parent, depth + 1);
      } else if (type === "CSSContainerRule") {
        const container = rule as CSSGroupingRule & { conditionText: string };
        walk(container.cssRules, layer, [...conditions, { kind: "container", text: container.conditionText }], href, parent, depth + 1);
      } else if (type === "CSSScopeRule") {
        const scope = rule as CSSGroupingRule & { start?: string | null };
        walk(scope.cssRules, layer, [...conditions, { kind: "scope", text: scope.start ?? "" }], href, parent, depth + 1);
      }
      // @starting-style, @keyframes, @font-face, @property, @page: never the live value.
    }
  };

  for (const sheet of sheets) {
    if (isOwnSheet(sheet) || sheet.disabled) continue;
    const rules = rulesOf(sheet);
    if (!rules) {
      index.unreadable++;
      continue;
    }
    const conds: Condition[] = sheet.media?.mediaText ? [{ kind: "media", text: sheet.media.mediaText }] : [];
    walk(rules, layers.root, conds, hrefOf(sheet), null, 0);
  }
  return index;
}

/** The sheets that style elements of this root (document or an open shadow root). */
function sheetsFor(root: Document | ShadowRoot): CSSStyleSheet[] {
  const list = Array.from(root.styleSheets) as CSSStyleSheet[];
  const adopted = (root as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  return [...list, ...adopted];
}

function fingerprint(sheets: readonly CSSStyleSheet[]): string {
  return sheets
    .filter((s) => !isOwnSheet(s))
    .map((s) => {
      const rules = rulesOf(s);
      return `${idOf(s)}:${rules ? rules.length : "x"}:${s.disabled ? 0 : 1}`;
    })
    .join(",");
}

/** A declaration of one property found in one rule (or the style attribute). */
type Candidate = CascadeCandidate & { text: string; entry?: Entry; shorthandUnknown?: boolean };

/** Reads the authored text of `name` from a declaration block, via Typed OM where present. */
function authored(decl: Declarations, name: string): string {
  try {
    const value = decl.styleMap?.get(name);
    if (value != null) {
      const text = String(value);
      // CSSUnparsedValue / CSSVariableReferenceValue keep the var() text; others serialise the same.
      if (text) return text;
    }
  } catch {
    // Unknown property for Typed OM.
  }
  return decl.style.getPropertyValue(name);
}

/**
 * The declaration of the physical longhand `property` in one block, or null. Longhands
 * pending var() substitution read "" and their text is found on the shorthand (spec 5.1
 * step 6): a single-value shorthand maps to the longhand, a multi-value one is unknown.
 */
function declarationIn(decl: Declarations, property: string, flow: FlowContext): Omit<Candidate, "layer" | "specificity" | "order"> | null {
  const aliases = propertyAliases(property, flow);
  const longhands = aliases.filter((a) => !a.shorthand).map((a) => a.name);
  const style = decl.style;
  let listed: string | null = null;
  if (property.startsWith("--")) {
    listed = style.getPropertyValue(property) !== "" || Array.from({ length: style.length }, (_, i) => style[i]).includes(property) ? property : null;
  } else {
    for (let i = 0; i < style.length; i++) if (longhands.includes(style[i])) listed = style[i];
  }
  if (!listed) return null;
  const important = style.getPropertyPriority(listed) === "important";
  const text = authored(decl, listed).trim();
  if (text) return { text, important };
  for (const alias of aliases.filter((a) => a.shorthand)) {
    const value = style.getPropertyValue(alias.name).trim();
    if (!value) continue;
    const imp = style.getPropertyPriority(alias.name) === "important" || important;
    if (hasVarReference(value) && topLevelParts(value).length > 1) return { text: value, important: imp, shorthandUnknown: true };
    return { text: value, important: imp };
  }
  return { text: "", important, shorthandUnknown: true };
}

export type TokenResolverOptions = {
  /** Elements to skip entirely (the overlay host). */
  isOverlay?: (el: Element) => boolean;
  /** rAF/idle scheduler (tests and SSR-safe default). */
  idle?: (fn: () => void) => void;
  /** Colour guess (spec 5.2) for colour properties without a token: candidate names. */
  colorGuess?: (el: Element, property: string, computed: string) => string[];
};

const COLOR_PROPS = /color$|^fill$|^stroke$/;

/** Live :root custom properties, for pickers and guesses. */
export function readRootVars(doc: Document, names: Iterable<string> = []): Record<string, string> {
  const style = getComputedStyle(doc.documentElement);
  const vars: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (name.startsWith("--")) vars[name] = style.getPropertyValue(name).trim();
  }
  for (const name of names) {
    if (vars[name] != null) continue;
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

function flowOf(el: Element): FlowContext {
  const cs = getComputedStyle(el);
  return { direction: cs.direction === "rtl" ? "rtl" : "ltr", writingMode: cs.writingMode };
}

const LENGTH_PROPS = /^(margin|padding)-|gap$|^font-size$|^letter-spacing$/;

export function createTokenResolver(doc: Document, options: TokenResolverOptions = {}) {
  const win = doc.defaultView ?? window;
  const indexes = new Map<Document | ShadowRoot, { key: string; index: Index }>();
  const cache = new WeakMap<Element, Map<string, { key: string; result: TokenResolution }>>();
  const queue = new Map<string, { el: Element; property: string }>();
  const listeners = new Set<() => void>();
  let scheduled = false;
  let version = 0;
  const idle =
    options.idle ??
    ((fn: () => void) => {
      const ric = (win as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(fn, { timeout: 300 });
      else win.setTimeout(fn, 16);
    });

  const indexFor = (el: Element): Index => {
    const root = el.getRootNode() as Document | ShadowRoot;
    const scope = root instanceof win.ShadowRoot || root === doc ? root : doc;
    const sheets = sheetsFor(scope);
    const key = fingerprint(sheets);
    const cached = indexes.get(scope);
    if (cached && cached.key === key) return cached.index;
    const index = buildIndex(sheets);
    indexes.set(scope, { key, index });
    version++;
    return index;
  };

  const conditionCache = new Map<string, boolean | null>();
  let conditionKey = "";
  /** true / false when evaluable now; null for container queries (unknown). */
  const conditionHolds = (el: Element, c: Condition): boolean | null => {
    if (c.kind === "scope") return c.text ? safeClosest(el, c.text) : true;
    const key = `${win.innerWidth}x${win.innerHeight}`;
    if (key !== conditionKey) {
      conditionCache.clear();
      conditionKey = key;
    }
    const id = `${c.kind}:${c.text}`;
    if (conditionCache.has(id)) return conditionCache.get(id) ?? null;
    let result: boolean | null;
    if (c.kind === "media") result = c.text === "" || win.matchMedia(c.text).matches;
    else if (c.kind === "supports") {
      try {
        result = win.CSS.supports(c.text);
      } catch {
        result = false;
      }
    } else result = null;
    conditionCache.set(id, result);
    return result;
  };

  const matching = (el: Element, index: Index): { entry: Entry; specificity: Specificity; uncertain: boolean }[] => {
    const buckets: Entry[][] = [index.any];
    if (el.id) buckets.push(index.byId.get(el.id) ?? []);
    for (const cls of Array.from(el.classList)) buckets.push(index.byClass.get(cls) ?? []);
    buckets.push(index.byTag.get(el.localName) ?? []);
    const byDecl = new Map<Declarations, { entry: Entry; specificity: Specificity; uncertain: boolean }>();
    for (const bucket of buckets) {
      for (const entry of bucket) {
        let ok = false;
        try {
          ok = el.matches(entry.selector);
        } catch {
          ok = false;
        }
        if (!ok) continue;
        let uncertain = false;
        let applies = true;
        for (const c of entry.conditions) {
          const holds = conditionHolds(el, c);
          if (holds === false) applies = false;
          if (holds === null) uncertain = true;
        }
        if (!applies) continue;
        const prev = byDecl.get(entry.decl);
        if (!prev || specCmp(entry.specificity, prev.specificity) > 0) byDecl.set(entry.decl, { entry, specificity: entry.specificity, uncertain });
      }
    }
    return [...byDecl.values()];
  };

  /** Cascade winner for `property` on `el` alone (no inheritance). */
  const winnerOn = (el: Element, property: string): { winner?: Candidate; uncertain: boolean; index: Index } => {
    const index = indexFor(el);
    const flow = flowOf(el);
    const candidates: Candidate[] = [];
    let uncertain = false;
    for (const m of matching(el, index)) {
      const found = declarationIn(m.entry.decl, property, flow);
      if (!found) continue;
      if (m.uncertain) uncertain = true;
      candidates.push({ ...found, layer: m.entry.layer, specificity: m.specificity, order: m.entry.order, entry: m.entry });
    }
    const inline = (el as HTMLElement).style;
    if (inline && inline.length) {
      const found = declarationIn({ style: inline, styleMap: (el as HTMLElement).attributeStyleMap }, property, flow);
      if (found) candidates.push({ ...found, inline: true, layer: [], specificity: [0, 0, 0], order: Number.MAX_SAFE_INTEGER });
    }
    return { winner: pickWinner(candidates), uncertain, index };
  };

  const parentOf = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof win.ShadowRoot ? root.host : null;
  };

  const originOf = (c: Candidate, inherited: boolean): TokenOrigin =>
    c.inline ? { href: "inline", ...(inherited ? { inherited } : {}) } : { href: c.entry?.href ?? "", ...(c.entry?.layerName ? { layer: c.entry.layerName } : {}), selector: c.entry?.selector, ...(inherited ? { inherited } : {}) };

  /** Winner walking up for inherited properties; `inherit` keywords defer to the parent. */
  const declared = (el: Element, property: string): { winner?: Candidate; owner?: Element; uncertain: boolean; index: Index } => {
    let current: Element | null = el;
    let uncertain = false;
    let index = indexFor(el);
    const inherited = isInheritedProperty(property);
    for (let depth = 0; current && depth < 64; depth++) {
      const r = winnerOn(current, property);
      index = r.index;
      uncertain ||= r.uncertain;
      const keyword = r.winner?.text.trim().toLowerCase();
      if (r.winner && keyword !== "inherit" && !(inherited && keyword === "unset")) return { winner: r.winner, owner: current, uncertain, index };
      if (!r.winner && !inherited) break;
      current = parentOf(current);
    }
    return { uncertain, index };
  };

  /** Follows a custom property to its own declaration (custom properties inherit). */
  const followVar = (el: Element, name: string): { form: DeclarationForm; candidate?: Candidate } | null => {
    const d = declared(el, name);
    if (!d.winner || !d.owner) return null;
    const lookup = (n: string) => getComputedStyle(d.owner as Element).getPropertyValue(n);
    return { form: effectiveReference(d.winner.text, lookup), candidate: d.winner };
  };

  const rootFontPx = () => Number.parseFloat(getComputedStyle(doc.documentElement).fontSize) || 16;

  /** Expected px of the winning form, to cross-check against the computed value (risk 1). */
  const expectedPx = (el: Element, property: string, form: DeclarationForm, text: string): number | undefined => {
    const cs = getComputedStyle(el);
    const fontPx = Number.parseFloat(cs.fontSize) || 16;
    const ctx = { rootFontPx: rootFontPx(), fontPx: property === "font-size" ? Number.parseFloat(getComputedStyle(parentOf(el) ?? el).fontSize) || 16 : fontPx };
    const evalText = (t: string) => (property === "line-height" ? lineHeightPx(t, fontPx, ctx.rootFontPx) : lengthPx(t, ctx));
    if (form.kind === "multiplier") {
      const base = lengthPx(cs.getPropertyValue(form.name), ctx);
      return base == null ? undefined : base * form.multiplier;
    }
    if (form.kind === "var") return evalText(cs.getPropertyValue(form.name).trim());
    if (form.kind === "raw") return evalText(text);
    return undefined;
  };

  const compute = (el: Element, property: string): TokenResolution => {
    const cs = getComputedStyle(el);
    const computed = cs.getPropertyValue(property).trim();
    const d = declared(el, property);
    const vars = readRootVars(doc, d.index.declaredVars);
    const fontPx = Number.parseFloat(cs.fontSize) || 16;
    const px = LENGTH_PROPS.test(property) || property === "line-height" || property === "font-weight" ? Number.parseFloat(computed) : undefined;
    const finish = (r: Omit<TokenResolution, "flags" | "computed" | "property">): TokenResolution => {
      let result: TokenResolution = { property, computed, ...r, flags: [] };
      if ((result.status === "none" || result.status === "unknown") && px != null && Number.isFinite(px)) {
        const guesses = guessTokens(px, guessCandidates(property, vars, { rootFontPx: rootFontPx(), fontPx }));
        if (guesses.length) result = { ...result, status: result.status === "none" ? "guess" : result.status, guesses };
      } else if ((result.status === "none" || result.status === "unknown") && COLOR_PROPS.test(property) && options.colorGuess) {
        const guesses = options.colorGuess(el, property, computed);
        if (guesses.length) result = { ...result, status: result.status === "none" ? "guess" : result.status, guesses };
      }
      result.flags = driftFlags({ property, px: px != null && Number.isFinite(px) ? px : undefined, status: result.status, guesses: result.guesses });
      return result;
    };
    const unreadable = d.index.unreadable > 0;
    if (!d.winner) {
      return finish(unreadable ? { status: "unknown", reason: "cross-origin stylesheet" } : { status: "none" });
    }
    const inherited = d.owner !== el;
    const origin = originOf(d.winner, inherited);
    const owner = d.owner ?? el;
    const lookup = (n: string) => getComputedStyle(owner).getPropertyValue(n);
    if (d.winner.shorthandUnknown) return finish({ status: "unknown", reason: "shorthand", css: d.winner.text, origin });
    let form = effectiveReference(d.winner.text, lookup);
    const chain: string[] = [];
    // Utility names are reported for the Tailwind multiplier form only (`p-4 · 16`); a
    // single-class selector is not proof of a utility otherwise (`.aui-card`).
    let utilityRule = d.winner.entry;
    let token: string | undefined;
    // Internal Tailwind variables (`--tw-leading`) are followed to their declaration.
    for (let guard = 0; guard < 4; guard++) {
      if (form.kind === "var") {
        if (!isInternalVar(form.name)) {
          token ??= form.name;
          chain.push(form.name);
        }
        const next = followVar(owner, form.name);
        if (!next || next.form.kind === "raw") break;
        if (isInternalVar(form.name) && next.candidate?.entry) utilityRule = next.candidate.entry;
        form = next.form;
        continue;
      }
      if (form.kind === "multiplier") {
        const t = multiplierToken(form.name, form.multiplier);
        token ??= t;
        chain.push(t);
      } else if (form.kind === "expression") {
        const name = form.names.find((n) => !isInternalVar(n));
        if (name) {
          token ??= name;
          chain.push(name);
        }
      }
      break;
    }
    // Cross-check lengths: a winner that cannot produce the computed value means a rule we
    // could not see (cross-origin) or a cascade we modelled wrong. Report unknown, never guess.
    const firstForm = effectiveReference(d.winner.text, lookup);
    if (!inherited && px != null && Number.isFinite(px) && !el.hasAttribute(GROUP_ATTRIBUTE)) {
      const expected = expectedPx(el, property, firstForm, d.winner.text);
      if (expected != null && Math.abs(expected - px) > 0.5) {
        return finish({ status: "unknown", reason: unreadable ? "cross-origin stylesheet" : "cascade mismatch", css: d.winner.text, origin });
      }
    }
    if (d.uncertain) return finish({ status: "unknown", reason: "container query", css: d.winner.text, origin, ...(token ? { guesses: [token] } : {}) });
    if (!token) return finish({ status: "none", css: d.winner.text, origin });
    // A single-class selector is a utility only when it ends in the multiplier (`p-4` at ×4);
    // `.fx-imp { padding: calc(var(--spacing) * 2) }` is an authored class, not `p-2`.
    const candidate = form.kind === "multiplier" && chain.length === 1 && utilityRule ? utilityClass(utilityRule.selector) : undefined;
    const utility = candidate && form.kind === "multiplier" && utilityMatches(candidate, form.multiplier) ? candidate : undefined;
    return finish({ status: "token", token, ...(utility ? { utility } : {}), css: d.winner.text, chain, origin });
  };

  const keyFor = (el: Element, property: string) => {
    indexFor(el);
    const previewed = el.hasAttribute(GROUP_ATTRIBUTE);
    // A previewed element keeps its pre-preview answer: the authored token is what changes.
    const computed = previewed ? "" : getComputedStyle(el).getPropertyValue(property);
    return `${version}|${el.getAttribute("class") ?? ""}|${el.getAttribute("style") ?? ""}|${computed}|${previewed ? "" : "live"}`;
  };

  const cached = (el: Element, property: string): TokenResolution | undefined => {
    const entry = cache.get(el)?.get(property);
    if (!entry) return undefined;
    if (el.hasAttribute(GROUP_ATTRIBUTE)) return entry.result;
    return entry.key === keyFor(el, property) ? entry.result : undefined;
  };

  const store = (el: Element, property: string, result: TokenResolution) => {
    let map = cache.get(el);
    if (!map) cache.set(el, (map = new Map()));
    map.set(property, { key: keyFor(el, property), result });
  };

  /** Synchronous resolution (click, pin, panel). */
  const resolve = (el: Element, property: string): TokenResolution => {
    if (options.isOverlay?.(el)) return { property, status: "none", computed: "", flags: [] };
    const hit = cached(el, property);
    if (hit) return hit;
    let result: TokenResolution;
    try {
      result = compute(el, property);
    } catch {
      result = { property, status: "unknown", reason: "error", computed: getComputedStyle(el).getPropertyValue(property).trim(), flags: ["token unknown"] };
    }
    store(el, property, result);
    return result;
  };

  const flush = () => {
    scheduled = false;
    const jobs = [...queue.values()];
    queue.clear();
    for (const job of jobs) if (job.el.isConnected) resolve(job.el, job.property);
    for (const listener of listeners) listener();
  };

  /** Cache-only read for render paths (hover labels). Misses resolve in idle time. */
  const peek = (el: Element, property: string): TokenResolution | undefined => {
    const hit = cache.get(el)?.get(property);
    if (hit && (el.hasAttribute(GROUP_ATTRIBUTE) || hit.key === keyFor(el, property))) return hit.result;
    queue.set(`${idOf(el)}|${property}`, { el, property });
    if (!scheduled) {
      scheduled = true;
      idle(flush);
    }
    return hit?.result;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** Root custom properties including names found by the scan. */
  const rootVars = () => readRootVars(doc, indexFor(doc.documentElement).declaredVars);

  return { resolve, peek, subscribe, rootVars, get version() { return version; } };
}

export type TokenResolverApi = ReturnType<typeof createTokenResolver>;

/** `p-4` / `-mt-4` / `gap-y-0.5` / `md:p-4` end in the multiplier's absolute value. */
export function utilityMatches(utility: string, multiplier: number): boolean {
  const m = /-(\d*\.?\d+)$/.exec(utility);
  return Boolean(m && Number(m[1]) === Math.abs(multiplier));
}

function safeClosest(el: Element, selector: string): boolean {
  try {
    return Boolean(el.closest(selector));
  } catch {
    return true;
  }
}

function specCmp(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Overlay label for a resolution: utility, else token. Guesses and unknowns are not shown on the canvas. */
export function resolutionLabel(r: TokenResolution | undefined): string | undefined {
  if (!r || r.status !== "token") return undefined;
  return tokenDisplayLabel(r.token, r.utility);
}
