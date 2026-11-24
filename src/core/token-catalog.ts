import { colorKey, parseColor, toHex, type RGBA } from "./color.ts";
import { spacingTokens } from "./style-change.ts";
import { evaluateLength, lengthPx, lineHeightPx, multiplierToken, type TokenCandidate } from "./token-values.ts";

/**
 * Token catalogues built from the custom properties read off `:root` at runtime
 * (inspector spec 5.1 Tailwind notes, 5.2, 8). Nothing is hardcoded: an empty variable
 * map gives empty lists. Used by the pickers and by the guess inversion.
 */

export type Vars = Readonly<Record<string, string>>;

/** One picker entry: record token, the CSS the preview writes, and a resolved readout. */
export type PickerToken = {
  token: string;
  css: string;
  /** Resolved readout: px for lengths, the number for weights, hex for colours. */
  px?: number;
  number?: number;
  hex?: string;
  color?: RGBA;
};

const isCompanion = (name: string) => /^--text-[\w-]+?--/.test(name);

export function fontSizeTokens(vars: Vars, rootFontPx = 16): PickerToken[] {
  const out: PickerToken[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!/^--text-[\w-]+$/.test(name) || isCompanion(name)) continue;
    const px = lengthPx(value, { rootFontPx });
    if (px != null) out.push({ token: name, css: `var(${name})`, px });
  }
  return out.sort((a, b) => (a.px ?? 0) - (b.px ?? 0));
}

/**
 * Line-height tokens for an element whose font size is `fontPx`: `--text-*--line-height`
 * companions and `--leading-*` ratios (times the font size), then `--spacing` multiples
 * from 12 to 64px (Tailwind `leading-N`).
 */
export function lineHeightTokens(vars: Vars, fontPx: number, rootFontPx = 16): PickerToken[] {
  const out: PickerToken[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!/^--text-[\w-]+--line-height$/.test(name) && !/^--leading-[\w-]+$/.test(name)) continue;
    const px = lineHeightPx(value, fontPx, rootFontPx);
    if (px != null) out.push({ token: name, css: `var(${name})`, px: Math.round(px * 100) / 100 });
  }
  out.sort((a, b) => (a.px ?? 0) - (b.px ?? 0));
  const base = vars["--spacing"] != null ? lengthPx(vars["--spacing"], { rootFontPx }) : undefined;
  if (base && base > 0) {
    for (let n = 1; n * base <= 64; n++) {
      const px = Math.round(n * base * 100) / 100;
      if (px < 12) continue;
      out.push({ token: multiplierToken("--spacing", n), css: `calc(var(--spacing) * ${n})`, px });
    }
  }
  return out;
}

export function fontWeightTokens(vars: Vars): PickerToken[] {
  const out: PickerToken[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!/^--font-weight-[\w-]+$/.test(name)) continue;
    const v = evaluateLength(value);
    if (v && "number" in v) out.push({ token: name, css: `var(${name})`, number: v.number });
  }
  return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

export function trackingTokens(vars: Vars, fontPx: number, rootFontPx = 16): PickerToken[] {
  const out: PickerToken[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!/^--tracking-[\w-]+$/.test(name)) continue;
    const px = lengthPx(value, { rootFontPx, fontPx });
    if (px != null) out.push({ token: name, css: `var(${name})`, px: Math.round(px * 1000) / 1000 });
  }
  return out.sort((a, b) => (a.px ?? 0) - (b.px ?? 0));
}

/**
 * Colour tokens: `--color-*` first, then any other custom property whose value is a
 * colour (with `@theme inline`, Tailwind utilities reference `--card`, `--primary`...
 * directly, so those names are the real tokens). `resolve` turns a value into sRGB.
 */
export function colorTokens(vars: Vars, resolve: (value: string, name: string) => RGBA | undefined = (v) => parseColor(v)): PickerToken[] {
  const out: PickerToken[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!name.startsWith("--") || /^--tw-/.test(name)) continue;
    const color = resolve(value, name);
    if (!color) continue;
    out.push({ token: name, css: `var(${name})`, hex: toHex(color), color });
  }
  const rank = (n: string) => (n.startsWith("--color-") ? 0 : 1);
  return out.sort((a, b) => rank(a.token) - rank(b.token) || a.token.localeCompare(b.token));
}

/** Picker list for a property (colour properties need `colorTokens` instead). */
export function tokensForProperty(property: string, vars: Vars, ctx: { rootFontPx?: number; fontPx?: number } = {}): PickerToken[] {
  const root = ctx.rootFontPx ?? 16;
  const font = ctx.fontPx ?? root;
  if (/^(margin|padding)-|gap$/.test(property)) {
    return spacingTokens(vars, root).map((t) => ({ token: t.name, css: t.value, px: t.px }));
  }
  if (property === "font-size") return fontSizeTokens(vars, root);
  if (property === "line-height") return lineHeightTokens(vars, font, root);
  if (property === "font-weight") return fontWeightTokens(vars);
  if (property === "letter-spacing") return trackingTokens(vars, font, root);
  return [];
}

/** Guess candidates (spec 5.2) for a numeric property: name and resolved value. */
export function guessCandidates(property: string, vars: Vars, ctx: { rootFontPx?: number; fontPx?: number } = {}): TokenCandidate[] {
  return tokensForProperty(property, vars, ctx).map((t) => ({ name: t.token, px: t.px ?? t.number ?? Number.NaN }));
}

/** Colour guesses: every colour token with the same 8-bit value. Sorted by name. */
export function guessColorTokens(color: RGBA, tokens: readonly PickerToken[]): string[] {
  const key = colorKey(color);
  return tokens.filter((t) => t.color && colorKey(t.color) === key).map((t) => t.token).sort((a, b) => a.localeCompare(b));
}
