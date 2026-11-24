/**
 * Colour normalisation and WCAG contrast (inspector spec 8, phase I8). Pure: parses the
 * forms Chromium returns from getComputedStyle (rgb/rgba, hex, hsl, lab, lch, oklab,
 * oklch, color(srgb | srgb-linear | display-p3 ...)) into sRGB. The DOM layer resolves
 * anything else (named colours, light-dark(), color-mix()) through a probe element.
 */

/** sRGB channels 0..1 (may exceed the gamut before clamping) and alpha 0..1. */
export type RGBA = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, RGBA> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
};

type Mat = readonly [readonly number[], readonly number[], readonly number[]];
const mul = (m: Mat, v: readonly number[]): [number, number, number] => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/** CSS Color 4 sample matrices. */
const D50_TO_D65: Mat = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const XYZ65_TO_LINEAR_SRGB: Mat = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LINEAR_P3_TO_XYZ65: Mat = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];

const gammaEncode = (c: number) => {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return sign * (abs <= 0.0031308 ? 12.92 * abs : 1.055 * abs ** (1 / 2.4) - 0.055);
};
const gammaDecode = (c: number) => {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return sign * (abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4);
};

function fromLinear([r, g, b]: readonly number[], a: number): RGBA {
  return { r: gammaEncode(r), g: gammaEncode(g), b: gammaEncode(b), a };
}

function labToRgb(L: number, A: number, B: number, alpha: number): RGBA {
  const kappa = 24389 / 27;
  const eps = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const xr = fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kappa;
  const yr = L > kappa * eps ? ((L + 16) / 116) ** 3 : L / kappa;
  const zr = fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kappa;
  const xyz50 = [xr * 0.3457 / 0.3585, yr, zr * (1 - 0.3457 - 0.3585) / 0.3585];
  return fromLinear(mul(XYZ65_TO_LINEAR_SRGB, mul(D50_TO_D65, xyz50)), alpha);
}

function oklabToRgb(L: number, A: number, B: number, alpha: number): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return fromLinear(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  );
}

function hslToRgb(h: number, s: number, l: number, a: number): RGBA {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), a };
}

/** Number with optional %: a percentage maps 100% to `percentScale`; plain numbers are as-is. */
function num(token: string | undefined, percentScale: number): number {
  if (token == null || token === "none") return 0;
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return Number.NaN;
  return token.endsWith("%") ? (n / 100) * percentScale : n;
}

function hue(token: string | undefined): number {
  if (token == null || token === "none") return 0;
  const n = Number.parseFloat(token);
  if (token.endsWith("turn")) return n * 360;
  if (token.endsWith("rad")) return (n * 180) / Math.PI;
  if (token.endsWith("grad")) return n * 0.9;
  return n;
}

/** Splits `a b c / d` or `a, b, c, d` into channel tokens and alpha. */
function channels(inner: string): { parts: string[]; alpha?: string } {
  const [main, alpha] = inner.split("/").map((s) => s.trim());
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (alpha == null && parts.length === 4 && inner.includes(",")) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts, alpha };
}

const alphaOf = (token: string | undefined) => (token == null ? 1 : clamp01(num(token, 1)));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Parses a CSS colour into sRGB, or undefined for forms this module does not know. */
export function parseColor(input: string): RGBA | undefined {
  const text = input.trim().toLowerCase();
  if (NAMED[text]) return { ...NAMED[text] };
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return undefined;
    const v = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) : 1 };
  }
  const fn = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (!fn) return undefined;
  const [, name, inner] = fn;
  const { parts, alpha } = channels(inner);
  const a = alphaOf(alpha);
  let result: RGBA | undefined;
  switch (name) {
    case "rgb":
    case "rgba":
      result = { r: num(parts[0], 255) / 255, g: num(parts[1], 255) / 255, b: num(parts[2], 255) / 255, a };
      break;
    case "hsl":
    case "hsla":
      result = hslToRgb(hue(parts[0]), num(parts[1], 1) / (parts[1]?.endsWith("%") ? 1 : 100), num(parts[2], 1) / (parts[2]?.endsWith("%") ? 1 : 100), a);
      break;
    case "lab":
      result = labToRgb(num(parts[0], 100), num(parts[1], 125), num(parts[2], 125), a);
      break;
    case "lch": {
      const L = num(parts[0], 100);
      const C = num(parts[1], 150);
      const H = (hue(parts[2]) * Math.PI) / 180;
      result = labToRgb(L, C * Math.cos(H), C * Math.sin(H), a);
      break;
    }
    case "oklab":
      result = oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4), a);
      break;
    case "oklch": {
      const L = num(parts[0], 1);
      const C = num(parts[1], 0.4);
      const H = (hue(parts[2]) * Math.PI) / 180;
      result = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), a);
      break;
    }
    case "color": {
      const [space, ...rest] = parts;
      const v = rest.slice(0, 3).map((p) => num(p, 1));
      if (space === "srgb") result = { r: v[0], g: v[1], b: v[2], a };
      else if (space === "srgb-linear") result = fromLinear(v, a);
      else if (space === "display-p3") result = fromLinear(mul(XYZ65_TO_LINEAR_SRGB, mul(LINEAR_P3_TO_XYZ65, v.map(gammaDecode))), a);
      break;
    }
  }
  if (!result || [result.r, result.g, result.b, result.a].some((n) => !Number.isFinite(n))) return undefined;
  return result;
}

/** Clamped to the sRGB gamut. */
export function clampColor(c: RGBA): RGBA {
  return { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.a) };
}

const byte = (n: number) => Math.round(clamp01(n) * 255);

/** `#rrggbb` (or `#rrggbbaa` when translucent), gamut-clamped. */
export function toHex(c: RGBA): string {
  const h = (n: number) => byte(n).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ""}`;
}

/** Stable key for grouping equal colours: 8-bit channels and alpha. */
export function colorKey(c: RGBA): string {
  return `${byte(c.r)},${byte(c.g)},${byte(c.b)},${Math.round(clamp01(c.a) * 100) / 100}`;
}

/** Source-over composite of `top` on `bottom`. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a };
}

/** WCAG 2.x relative luminance of a gamut-clamped opaque colour. */
export function relativeLuminance(c: RGBA): number {
  const lin = (n: number) => {
    const v = clamp01(n);
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * WCAG contrast ratio of a foreground on a background. A translucent foreground is
 * composited over the background; the background is composited over white first when
 * it is translucent itself (the canvas default).
 */
export function contrastRatio(foreground: RGBA, background: RGBA): number {
  const bg = background.a < 1 ? composite(background, NAMED.white) : background;
  const fg = foreground.a < 1 ? composite(foreground, bg) : foreground;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** `4.54:1` (two decimals, rounded down so 4.499 never reads as passing 4.5). */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

export type WcagRating = { normal: "AAA" | "AA" | "fail"; large: "AAA" | "AA" | "fail" };

export function wcagRating(ratio: number): WcagRating {
  return {
    normal: ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "fail",
    large: ratio >= 4.5 ? "AAA" : ratio >= 3 ? "AA" : "fail",
  };
}

/**
 * Effective background behind an element: its own and its ancestors' background
 * colours from the element outwards, composited until opaque (white canvas below).
 * `layers` is innermost first; `image` marks a layer with a background image or
 * gradient, which makes the result approximate.
 */
export function effectiveBackground(layers: readonly { color: RGBA; image?: boolean }[]): { color: RGBA; approximate: boolean } {
  let approximate = false;
  const stack: RGBA[] = [];
  for (const layer of layers) {
    if (layer.image) approximate = true;
    if (layer.color.a > 0) stack.push(layer.color);
    if (layer.color.a >= 1) break;
  }
  let color: RGBA = { ...NAMED.white };
  for (let i = stack.length - 1; i >= 0; i--) color = composite(stack[i], color);
  return { color, approximate };
}
