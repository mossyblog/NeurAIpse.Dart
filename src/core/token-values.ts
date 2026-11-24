/**
 * Token resolution helpers (inspector spec 5): reading authored declaration text,
 * evaluating simple `calc()` lengths, guess inversion over `:root` values, and drift
 * flags. Pure functions over strings and numbers; the DOM scanner lives in `tokens-dom.ts`.
 */

import { GRID } from "./style-change.ts";

export type VarReference = { name: string; fallback?: string };

/** Index just past the `)` matching the `(` at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Index of the first top-level comma in `text`, or -1. */
function topLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return i;
  }
  return -1;
}

/** Every `var()` call in document order, outermost first (fallbacks are searched too). */
export function parseVarReferences(text: string): VarReference[] {
  const out: VarReference[] = [];
  const re = /var\(\s*/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const open = match.index + 3;
    const end = matchParen(text, open);
    const inner = text.slice(open + 1, end - 1);
    const comma = topLevelComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    if (!name.startsWith("--")) continue;
    out.push(comma < 0 ? { name } : { name, fallback: inner.slice(comma + 1).trim() });
  }
  return out;
}

/** True when the text holds a `var()` reference (Typed OM gives the same text for unparsed values). */
export function hasVarReference(text: string): boolean {
  return /var\(\s*--/i.test(text);
}

export type DeclarationForm =
  /** Exactly `var(--x)` or `var(--x, fallback)`. */
  | { kind: "var"; name: string; fallback?: string }
  /** Tailwind spacing: `calc(var(--spacing) * N)` (or `N * var(--spacing)`). */
  | { kind: "multiplier"; name: string; multiplier: number }
  /** Any other expression with `var()`s, e.g. `color-mix(in oklab, var(--primary) 50%, transparent)`. */
  | { kind: "expression"; names: string[] }
  /** No custom property: a plain value, never token-backed. */
  | { kind: "raw" };

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const MULTIPLIER_A = new RegExp(String.raw`^calc\(\s*var\(\s*(--[\w-]+)\s*\)\s*\*\s*(${NUMBER})\s*\)$`, "i");
const MULTIPLIER_B = new RegExp(String.raw`^calc\(\s*(${NUMBER})\s*\*\s*var\(\s*(--[\w-]+)\s*\)\s*\)$`, "i");

/** Classifies authored declaration text (spec 5.1 step 3 and the Tailwind v4 notes). */
export function classifyDeclaration(text: string): DeclarationForm {
  const value = text.trim().replace(/\s*!important\s*$/i, "");
  const a = MULTIPLIER_A.exec(value);
  if (a) return { kind: "multiplier", name: a[1], multiplier: Number(a[2]) };
  const b = MULTIPLIER_B.exec(value);
  if (b) return { kind: "multiplier", name: b[2], multiplier: Number(b[1]) };
  // Tailwind v4 writes the ×1 step as a bare `var(--spacing)` (`p-1`, `pt-1`): same token family.
  if (/^var\(\s*--spacing\s*\)$/i.test(value)) return { kind: "multiplier", name: "--spacing", multiplier: 1 };
  if (/^var\(/i.test(value) && matchParen(value, 3) === value.length) {
    const [ref] = parseVarReferences(value);
    if (ref) return ref.fallback == null ? { kind: "var", name: ref.name } : { kind: "var", name: ref.name, fallback: ref.fallback };
  }
  const names = parseVarReferences(value).map((r) => r.name);
  return names.length ? { kind: "expression", names: [...new Set(names)] } : { kind: "raw" };
}

/** Tailwind's internal plumbing variables are never the design token. */
export function isInternalVar(name: string): boolean {
  return /^--tw-/.test(name);
}

/**
 * Follows `var(--a, var(--b))` fallbacks: returns the first reference whose custom
 * property is set on the element (lookup returns its computed value, "" when unset or
 * guaranteed-invalid). Tailwind's `line-height: var(--tw-leading, var(--text-sm--line-height))`
 * resolves to `--text-sm--line-height` unless a `leading-*` utility set `--tw-leading`.
 */
export function effectiveReference(text: string, lookup: (name: string) => string): DeclarationForm {
  let form = classifyDeclaration(text);
  for (let guard = 0; guard < 8 && form.kind === "var"; guard++) {
    if (lookup(form.name).trim() !== "" || form.fallback == null) return form;
    form = classifyDeclaration(form.fallback);
  }
  return form;
}

/* ---------------- calc() evaluation ---------------- */

/** A dimension: px (length) or a plain number. */
type Dim = { n: number; px: boolean };

export type LengthContext = { rootFontPx?: number; fontPx?: number };

/**
 * Evaluates a length or number expression: px, rem, em, unitless numbers, `calc()`
 * with + - * / and parentheses. Returns undefined for anything else (`var()`, %, vw).
 * Results: `{ px }` for lengths, `{ number }` for unitless values.
 */
export function evaluateLength(text: string, ctx: LengthContext = {}): { px: number } | { number: number } | undefined {
  const v = evaluateRaw(text, ctx);
  if (!v) return undefined;
  const n = Math.round(v.n * 1000) / 1000;
  return v.px ? { px: n } : { number: n };
}

function evaluateRaw(text: string, ctx: LengthContext): Dim | undefined {
  const root = ctx.rootFontPx ?? 16;
  const font = ctx.fontPx ?? root;
  const src = text.trim();
  let i = 0;
  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const fail = (): never => {
    throw new Error("unsupported");
  };
  const primary = (): Dim => {
    skip();
    if (src.startsWith("calc(", i)) {
      i += 5;
      const v = sum();
      skip();
      if (src[i] !== ")") fail();
      i++;
      return v;
    }
    if (src[i] === "(") {
      i++;
      const v = sum();
      skip();
      if (src[i] !== ")") fail();
      i++;
      return v;
    }
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)/i.exec(src.slice(i));
    if (!m) return fail();
    i += m[0].length;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === "") return { n, px: false };
    if (unit === "px") return { n, px: true };
    if (unit === "rem") return { n: n * root, px: true };
    if (unit === "em") return { n: n * font, px: true };
    return fail();
  };
  const product = (): Dim => {
    let left = primary();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/") return left;
      i++;
      const right = primary();
      if (op === "*") {
        if (left.px && right.px) fail();
        left = { n: left.n * right.n, px: left.px || right.px };
      } else {
        if (right.px || right.n === 0) fail();
        left = { n: left.n / right.n, px: left.px };
      }
    }
  };
  const sum = (): Dim => {
    let left = product();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") return left;
      i++;
      const right = product();
      if (left.px !== right.px && left.n !== 0 && right.n !== 0) fail();
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, px: left.px || right.px };
    }
  };
  try {
    const v = sum();
    skip();
    if (i !== src.length) return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/** px for a length expression; unitless 0 counts as 0px. */
export function lengthPx(text: string, ctx: LengthContext = {}): number | undefined {
  const v = evaluateLength(text, ctx);
  if (!v) return undefined;
  if ("px" in v) return v.px;
  return v.number === 0 ? 0 : undefined;
}

/**
 * px for a line-height value: lengths as-is, unitless numbers (`1.5`, `calc(1.25 / .875)`)
 * times the font size.
 */
export function lineHeightPx(text: string, fontPx: number, rootFontPx = 16): number | undefined {
  const v = evaluateRaw(text, { rootFontPx, fontPx });
  if (!v) return undefined;
  return Math.round((v.px ? v.n : v.n * fontPx) * 1000) / 1000;
}

/* ---------------- Token display ---------------- */

/** Record token for the multiplier form: `--spacing × 4`. */
export function multiplierToken(name: string, multiplier: number): string {
  return `${name} × ${multiplier}`;
}

const MULTIPLIER_TOKEN = /^(--[\w-]+) × (-?\d*\.?\d+)$/;

/**
 * CSS for a record token: `--spacing × 4` -> `calc(var(--spacing) * 4)`, `--text-sm` ->
 * `var(--text-sm)`. Shared by the preview and the serializer so both write the same value.
 */
export function tokenCss(token: string): string {
  const m = MULTIPLIER_TOKEN.exec(token);
  if (m) return `calc(var(${m[1]}) * ${m[2]})`;
  return `var(${token})`;
}

/**
 * Canvas label for a token (spec 3.1 `p-4 · 16`): the utility when known, else a human
 * name. Multiplier tokens read `spacing×4`; the bare base var never shows as `--spacing`.
 */
export function tokenDisplayLabel(token: string | undefined, utility?: string): string | undefined {
  if (utility) return utility;
  if (!token) return undefined;
  const m = MULTIPLIER_TOKEN.exec(token);
  if (m) return `${m[1].replace(/^--/, "")}×${m[2]}`;
  if (token === "--spacing") return "spacing×1";
  return token;
}

/** Parses `--spacing × 4` back to its parts. */
export function parseMultiplierToken(token: string): { name: string; multiplier: number } | undefined {
  const m = MULTIPLIER_TOKEN.exec(token);
  return m ? { name: m[1], multiplier: Number(m[2]) } : undefined;
}

/**
 * Utility for a new multiplier, from the old one: `p-4` at ×4 -> `p-6` at ×6. Undefined
 * when the old utility does not end in its multiplier.
 */
export function shiftUtility(utility: string | undefined, from: number, to: number): string | undefined {
  if (!utility) return undefined;
  const m = /^(-?)(.*-)(\d*\.?\d+)$/.exec(utility);
  if (!m || Number(m[3]) !== Math.abs(from)) return undefined;
  return `${to < 0 ? "-" : ""}${m[2]}${Math.abs(to)}`;
}

/* ---------------- Guess inversion (spec 5.2) ---------------- */

export type TokenCandidate = { name: string; px: number };

/**
 * Every token whose resolved value equals `px` (within 0.01). Never auto-picks: the
 * caller shows all of them with a `guess` label. Sorted by name for stable output.
 */
export function guessTokens(px: number, candidates: readonly TokenCandidate[]): string[] {
  const names = candidates.filter((c) => Math.abs(c.px - px) < 0.01).map((c) => c.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/* ---------------- Drift flags (spec 5.3) ---------------- */

/** 8px grid; 4px tolerated only when the value is exactly 4 (or -4). */
export function isGridValue(px: number, grid = GRID): boolean {
  const abs = Math.abs(px);
  if (grid === GRID && Math.abs(abs - GRID / 2) < 0.01) return true;
  const r = abs % grid;
  return r < 0.01 || grid - r < 0.01;
}

export function formatPx(px: number): string {
  return `${Math.round(px * 100) / 100}px`;
}

export type TokenStatus = "token" | "none" | "guess" | "unknown";

/**
 * Drift flags for one property value: `off-grid: 14px` (spacing on the 8px grid,
 * line-height on a 4px grid, informational), `no token`, `token unknown (guess: …)` or
 * `token unknown`. Font sizes, weights, tracking and colours have no grid check.
 */
export function driftFlags(input: {
  property: string;
  px?: number;
  status: TokenStatus;
  guesses?: readonly string[];
}): string[] {
  const flags: string[] = [];
  const spacing = /^(margin|padding)-|gap$/.test(input.property);
  if (input.px != null && Number.isFinite(input.px)) {
    if (spacing && !isGridValue(input.px)) flags.push(`off-grid: ${formatPx(input.px)}`);
    if (input.property === "line-height" && !isGridValue(input.px, 4)) flags.push(`off-grid: ${formatPx(input.px)}`);
  }
  if (input.status === "none") flags.push("no token");
  else if (input.status === "guess") flags.push(input.guesses?.length ? `token unknown (guess: ${input.guesses.join(", ")})` : "token unknown");
  else if (input.status === "unknown") flags.push("token unknown");
  return flags;
}
