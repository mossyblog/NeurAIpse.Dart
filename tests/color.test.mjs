import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  colorKey,
  colorTokens,
  composite,
  contrastRatio,
  effectiveBackground,
  formatRatio,
  guessColorTokens,
  parseColor,
  toHex,
  wcagRating,
} from "../dist/core/index.js";

const hex = (text) => toHex(parseColor(text));

test("colour parsing: legacy and modern forms normalise to sRGB", () => {
  // INTENTION: I8 colour normalisation. getComputedStyle returns rgb()/rgba() for legacy
  // colours but lab()/oklch()/color() for modern ones (Tailwind v4 palette); all must
  // compare and contrast in one space.
  assert.equal(hex("#abc"), "#aabbcc");
  assert.equal(hex("#11223380"), "#11223380");
  assert.equal(hex("rgb(255, 0, 0)"), "#ff0000");
  assert.equal(hex("rgba(0, 0, 0, 0.5)"), "#00000080");
  assert.equal(hex("rgb(0 128 255 / 50%)"), "#0080ff80");
  assert.equal(hex("hsl(120 100% 25%)"), "#008000");
  assert.equal(hex("hsl(0, 100%, 50%)"), "#ff0000");
  assert.equal(hex("oklch(62.8% 0.2577 29.23)"), "#ff0000");
  assert.equal(hex("oklch(1 0 0)"), "#ffffff");
  assert.equal(hex("oklab(0 0 0)"), "#000000");
  assert.equal(hex("lab(54.29% 80.80 69.89)"), "#ff0000");
  assert.equal(hex("lab(100% 0 0)"), "#ffffff");
  assert.equal(hex("lch(54.29 106.84 40.85)"), "#ff0000");
  assert.equal(hex("color(srgb 1 0.5 0)"), "#ff8000");
  assert.equal(hex("color(display-p3 1 1 1)"), "#ffffff");
  assert.equal(hex("white"), "#ffffff");
  assert.equal(hex("transparent"), "#00000000");
  assert.equal(parseColor("light-dark(#fff, #000)"), undefined);
  assert.equal(parseColor("var(--x)"), undefined);
});

test("WCAG contrast ratios match the reference values", () => {
  // INTENTION: the panel readout must equal WCAG 2.x: black/white 21:1, #767676 on
  // white 4.54:1 (the AA threshold colour), #777 on white 4.47:1 (fails AA).
  const white = parseColor("#fff");
  assert.equal(formatRatio(contrastRatio(parseColor("#000"), white)), "21.00:1");
  assert.equal(formatRatio(contrastRatio(parseColor("#767676"), white)), "4.54:1");
  assert.equal(formatRatio(contrastRatio(parseColor("#777"), white)), "4.47:1");
  assert.equal(formatRatio(contrastRatio(white, parseColor("#767676"))), "4.54:1", "order does not matter");
  assert.equal(formatRatio(contrastRatio(white, white)), "1.00:1");
  assert.deepEqual(wcagRating(4.54), { normal: "AA", large: "AAA" });
  assert.deepEqual(wcagRating(4.47), { normal: "fail", large: "AA" });
  assert.deepEqual(wcagRating(21), { normal: "AAA", large: "AAA" });
});

test("translucent foregrounds composite over the background before contrast", () => {
  // INTENTION: rgba text (e.g. rgba(255,255,255,.9) card foreground) is measured as seen.
  const fg = parseColor("rgba(0, 0, 0, 0.5)");
  const mixed = composite(fg, parseColor("#fff"));
  assert.equal(toHex(mixed), "#808080");
  assert.equal(formatRatio(contrastRatio(fg, parseColor("#fff"))), formatRatio(contrastRatio(mixed, parseColor("#fff"))));
});

test("effective background walks translucent layers to the first opaque one", () => {
  // INTENTION: contrast is against what is behind the text: transparent layers are
  // skipped, half-transparent ones composited, an opaque ancestor ends the walk,
  // gradients/images mark the result approximate, nothing opaque means the white canvas.
  const t = { color: parseColor("transparent") };
  const half = { color: parseColor("rgba(0, 0, 0, 0.5)") };
  const blue = { color: parseColor("#0000ff") };
  assert.equal(toHex(effectiveBackground([t, blue]).color), "#0000ff");
  assert.equal(toHex(effectiveBackground([half, { color: parseColor("#ffffff") }]).color), "#808080");
  assert.equal(toHex(effectiveBackground([t]).color), "#ffffff");
  assert.equal(effectiveBackground([{ ...t, image: true }, blue]).approximate, true);
  assert.equal(toHex(effectiveBackground([blue, { color: parseColor("#ff0000") }]).color), "#0000ff", "stops at the first opaque layer");
});

test("colour tokens: --color-* first, every equal token is a guess", () => {
  // INTENTION: I8 picker + colour token inversion. With @theme inline the semantic
  // names (--card, --primary) are the real tokens, so they are listed after --color-*;
  // duplicates resolving to the same colour are all returned as guesses.
  const tokens = colorTokens({ "--color-white": "#fff", "--card": "rgb(255, 255, 255)", "--primary": "oklch(62.8% 0.2577 29.23)", "--spacing": ".25rem", "--tw-ring-color": "#000" });
  assert.deepEqual(tokens.map((t) => [t.token, t.hex]), [["--color-white", "#ffffff"], ["--card", "#ffffff"], ["--primary", "#ff0000"]]);
  assert.deepEqual(guessColorTokens(parseColor("#ffffff"), tokens), ["--card", "--color-white"]);
  assert.deepEqual(guessColorTokens(parseColor("#123456"), tokens), []);
  assert.equal(colorKey(parseColor("rgba(255,255,255,0.9)")), "255,255,255,0.9");
});
