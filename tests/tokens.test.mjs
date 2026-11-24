import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  classifyDeclaration,
  driftFlags,
  effectiveReference,
  evaluateLength,
  fontSizeTokens,
  fontWeightTokens,
  guessCandidates,
  guessTokens,
  isGridValue,
  lineHeightPx,
  lineHeightTokens,
  logicalSide,
  parseMultiplierToken,
  parseVarReferences,
  propertyAliases,
  shiftUtility,
  tokenCss,
  tokensForProperty,
  topLevelParts,
  trackingTokens,
} from "../dist/core/index.js";

/** The custom properties the host's Tailwind v4 build exposes on :root (probed on /components/card). */
const ROOT = {
  "--spacing": ".25rem",
  "--text-sm": ".875rem",
  "--text-sm--line-height": "calc(1.25 / .875)",
  "--text-base": "1rem",
  "--text-base--line-height": "calc(1.5 / 1)",
  "--text-lg": "1.125rem",
  "--text-lg--line-height": "calc(1.75 / 1.125)",
  "--leading-tight": "1.25",
  "--font-weight-medium": "500",
  "--font-weight-semibold": "600",
  "--tracking-tight": "-.025em",
  "--spacing-fx-md": "24px",
  "--spacing-fx-alt": "1.5rem",
};

test("declaration forms: var, Tailwind multiplier, expression, raw", () => {
  // INTENTION: spec 5.1 step 3 + Tailwind notes. `p-4` compiles to the multiplier form,
  // `text-lg` to a plain var; both are tokens. Expressions keep their var names so
  // `color-mix(var(--primary) 50%)` still names --primary; raw values are never tokens.
  assert.deepEqual(classifyDeclaration("calc(var(--spacing) * 4)"), { kind: "multiplier", name: "--spacing", multiplier: 4 });
  assert.deepEqual(classifyDeclaration("calc(var(--spacing) * .5)"), { kind: "multiplier", name: "--spacing", multiplier: 0.5 });
  assert.deepEqual(classifyDeclaration("calc(var(--spacing) * -4)"), { kind: "multiplier", name: "--spacing", multiplier: -4 });
  assert.deepEqual(classifyDeclaration("calc(2 * var(--spacing))"), { kind: "multiplier", name: "--spacing", multiplier: 2 });
  assert.deepEqual(classifyDeclaration("var(--text-lg)"), { kind: "var", name: "--text-lg" });
  assert.deepEqual(classifyDeclaration("var(--tw-leading, var(--text-sm--line-height))"), { kind: "var", name: "--tw-leading", fallback: "var(--text-sm--line-height)" });
  assert.deepEqual(classifyDeclaration("color-mix(in oklab, var(--primary) 50%, transparent)"), { kind: "expression", names: ["--primary"] });
  assert.deepEqual(classifyDeclaration("14px"), { kind: "raw" });
  assert.deepEqual(classifyDeclaration("var(--a) var(--b)"), { kind: "expression", names: ["--a", "--b"] });
});

test("var() fallbacks follow the first custom property that is set", () => {
  // INTENTION: Tailwind `text-sm` line-height is var(--tw-leading, var(--text-sm--line-height));
  // the companion token applies unless a leading-* utility set --tw-leading.
  const unset = effectiveReference("var(--tw-leading, var(--text-sm--line-height))", () => "");
  assert.deepEqual(unset, { kind: "var", name: "--text-sm--line-height" });
  const set = effectiveReference("var(--tw-leading, var(--text-sm--line-height))", (n) => (n === "--tw-leading" ? "calc(.25rem * 5)" : ""));
  assert.equal(set.name, "--tw-leading");
  assert.deepEqual(parseVarReferences("var(--a, var(--b, 4px))").map((r) => r.name), ["--a", "--b"]);
});

test("calc evaluation for lengths and unitless line-height ratios", () => {
  // INTENTION: verifying the cascade winner against the computed value (risk 1) needs
  // Tailwind's calc() forms in px; companions are unitless ratios times the font size.
  assert.deepEqual(evaluateLength("calc(.25rem * 4)"), { px: 16 });
  assert.deepEqual(evaluateLength("calc(1.25 / .875)"), { number: 1.429 });
  assert.deepEqual(evaluateLength("calc(8px + 1rem)"), { px: 24 });
  assert.deepEqual(evaluateLength("calc((2 + 2) * 2px)"), { px: 8 });
  assert.equal(evaluateLength("calc(100% - 8px)"), undefined);
  assert.equal(evaluateLength("var(--x)"), undefined);
  assert.equal(lineHeightPx("calc(1.25 / .875)", 14), 20);
  assert.equal(lineHeightPx("24px", 14), 24);
  assert.equal(lineHeightPx("1.5", 16), 24);
});

test("record tokens map to one CSS value for preview and output", () => {
  // INTENTION: the multiplier must serialise as calc(var(--spacing) * N), never var(--spacing × N).
  assert.equal(tokenCss("--spacing × 4"), "calc(var(--spacing) * 4)");
  assert.equal(tokenCss("--spacing × 0.5"), "calc(var(--spacing) * 0.5)");
  assert.equal(tokenCss("--text-sm"), "var(--text-sm)");
  assert.deepEqual(parseMultiplierToken("--spacing × -2"), { name: "--spacing", multiplier: -2 });
  assert.equal(shiftUtility("p-4", 4, 6), "p-6");
  assert.equal(shiftUtility("gap-y-0.5", 0.5, 1), "gap-y-1");
  assert.equal(shiftUtility("-mt-4", -4, -2), "-mt-2");
  assert.equal(shiftUtility("aui-card", 4, 6), undefined);
});

test("guess inversion lists every token with the same value, never one", () => {
  // INTENTION: spec 5.2. Raw 24px padding maps to three tokens (the ×6 multiple and two
  // named duplicates): all are returned, sorted, for the `guess` label.
  const candidates = guessCandidates("padding-top", ROOT, { rootFontPx: 16 });
  assert.deepEqual(guessTokens(24, candidates), ["--spacing × 6", "--spacing-fx-alt", "--spacing-fx-md"]);
  assert.deepEqual(guessTokens(13, candidates), []);
  // Category matters: 24px font-size is not a spacing guess.
  assert.deepEqual(guessTokens(18, guessCandidates("font-size", ROOT)), ["--text-lg"]);
  assert.deepEqual(guessTokens(500, guessCandidates("font-weight", ROOT)), ["--font-weight-medium"]);
});

test("drift flags: off-grid spacing, 4px tolerated, line-height on a 4px grid", () => {
  // INTENTION: spec 5.3. 14px padding is off-grid; 4 is the single tolerated off-grid
  // value; line-height uses a 4px informational grid (20 ok, 21 off); guess and none
  // statuses produce their own flags.
  assert.deepEqual(driftFlags({ property: "padding-top", px: 14, status: "none" }), ["off-grid: 14px", "no token"]);
  assert.deepEqual(driftFlags({ property: "padding-top", px: 4, status: "token" }), []);
  assert.deepEqual(driftFlags({ property: "margin-left", px: -16, status: "token" }), []);
  assert.deepEqual(driftFlags({ property: "row-gap", px: 12, status: "token" }), ["off-grid: 12px"]);
  assert.deepEqual(driftFlags({ property: "line-height", px: 20, status: "token" }), []);
  assert.deepEqual(driftFlags({ property: "line-height", px: 21, status: "none" }), ["off-grid: 21px", "no token"]);
  assert.deepEqual(driftFlags({ property: "font-size", px: 14, status: "token" }), []);
  assert.deepEqual(driftFlags({ property: "padding-top", px: 24, status: "guess", guesses: ["--a", "--b"] }), ["token unknown (guess: --a, --b)"]);
  assert.deepEqual(driftFlags({ property: "padding-top", px: 24, status: "unknown" }), ["token unknown"]);
  assert.equal(isGridValue(0), true);
  assert.equal(isGridValue(4), true);
  assert.equal(isGridValue(12), false);
});

test("longhand aliases: logical twins by direction, shorthands last", () => {
  // INTENTION: spec 5.1 step 6. Tailwind `px-4` is `padding-inline`, `p-4` is `padding`;
  // matching padding-left must consider both, flipping inline-start/end in RTL.
  assert.deepEqual(propertyAliases("padding-left").map((a) => a.name), ["padding-left", "padding-inline-start", "padding-inline", "padding"]);
  assert.deepEqual(propertyAliases("padding-left", { direction: "rtl" }).map((a) => a.name), ["padding-left", "padding-inline-end", "padding-inline", "padding"]);
  assert.deepEqual(propertyAliases("margin-top").map((a) => [a.name, a.shorthand]), [["margin-top", false], ["margin-block-start", false], ["margin-block", true], ["margin", true]]);
  assert.deepEqual(propertyAliases("row-gap").map((a) => a.name), ["row-gap", "gap"]);
  assert.deepEqual(propertyAliases("font-size").map((a) => a.name), ["font-size", "font"]);
  assert.equal(logicalSide("top", { writingMode: "vertical-rl" }), "inline-start");
  assert.equal(logicalSide("right", { writingMode: "vertical-rl" }), "block-start");
  assert.deepEqual(topLevelParts("calc(var(--spacing) * 4)"), ["calc(var(--spacing) * 4)"]);
  assert.deepEqual(topLevelParts("var(--a) 8px"), ["var(--a)", "8px"]);
});

test("type token catalogues come from the runtime :root variables", () => {
  // INTENTION: I6 pickers list real tokens only (--text-*, companions, --leading-*,
  // --font-weight-*, --tracking-*), with px resolved for the element's font size.
  assert.deepEqual(fontSizeTokens(ROOT).map((t) => [t.token, t.px]), [["--text-sm", 14], ["--text-base", 16], ["--text-lg", 18]]);
  const lh = lineHeightTokens(ROOT, 14);
  assert.deepEqual(lh.slice(0, 3).map((t) => [t.token, t.px]), [["--leading-tight", 17.5], ["--text-sm--line-height", 20], ["--text-base--line-height", 21]]);
  assert.ok(lh.some((t) => t.token === "--spacing × 5" && t.px === 20 && t.css === "calc(var(--spacing) * 5)"));
  assert.deepEqual(fontWeightTokens(ROOT).map((t) => [t.token, t.number]), [["--font-weight-medium", 500], ["--font-weight-semibold", 600]]);
  assert.deepEqual(trackingTokens(ROOT, 16).map((t) => [t.token, t.px]), [["--tracking-tight", -0.4]]);
  assert.deepEqual(tokensForProperty("font-size", {}), []);
  assert.ok(tokensForProperty("padding-top", ROOT).some((t) => t.token === "--spacing × 4" && t.px === 16));
});

test("a single-class winner is a utility only when it ends in its multiplier", async () => {
  // INTENTION: `p-4 · 16` labels and `(py-2)` hints must never name an authored class
  // (`.fx-imp { padding: calc(var(--spacing) * 2) }` is not a Tailwind utility).
  const { utilityMatches } = await import("../dist/core/index.js");
  assert.equal(utilityMatches("p-4", 4), true);
  assert.equal(utilityMatches("-mt-4", -4), true);
  assert.equal(utilityMatches("gap-y-0.5", 0.5), true);
  assert.equal(utilityMatches("md:p-4", 4), true);
  assert.equal(utilityMatches("fx-imp", 2), false);
  assert.equal(utilityMatches("p-4", 6), false);
});

test("canvas labels are human token names, never the bare --spacing variable", async () => {
  // INTENTION: I5 overlay labels read `pt-1 · 4` / `spacing×1 · 4`. Tailwind v4 emits the
  // ×1 step as a bare var(--spacing); it must classify as the ×1 multiplier and no label
  // may print `--spacing` (bug report: `--spacing · 4` on the top padding band).
  const { tokenDisplayLabel, resolutionLabel, regionLabel } = await import("../dist/core/index.js");
  assert.deepEqual(classifyDeclaration("var(--spacing)"), { kind: "multiplier", name: "--spacing", multiplier: 1 });
  assert.equal(tokenDisplayLabel("--spacing × 1", "pt-1"), "pt-1");
  assert.equal(tokenDisplayLabel("--spacing × 1"), "spacing×1");
  assert.equal(tokenDisplayLabel("--spacing × 0.5"), "spacing×0.5");
  assert.equal(tokenDisplayLabel("--spacing"), "spacing×1");
  assert.equal(tokenDisplayLabel("--card-padding"), "--card-padding");
  assert.equal(resolutionLabel({ status: "token", token: "--spacing × 1", property: "padding-top", computed: "4px", flags: [] }), "spacing×1");
  const region = { kind: "padding", side: "top", rect: { x: 0, y: 0, width: 1, height: 4 }, value: 4, element: null };
  assert.equal(regionLabel(region, resolutionLabel({ status: "token", token: "--spacing × 1", utility: "pt-1", property: "padding-top", computed: "4px", flags: [] })), "pt-1 · 4");
  assert.doesNotMatch(regionLabel(region, tokenDisplayLabel("--spacing")), /--spacing/);
});
