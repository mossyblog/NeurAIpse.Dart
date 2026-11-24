import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCopyText, elementSummary, formatMetadata, generateOutput, shortSelector, styleSections } from "../dist/core/index.js";
import { billing, environment, save } from "./fixtures.mjs";
import { measureOnly, offGrid, spacingChange, typeLine, typeSize } from "./style-fixtures.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden-feedback.json", import.meta.url), "utf8"));
const options = { appName: "Demo", environment };
const TIERS = ["compact", "standard", "detailed", "forensic"];

test("annotation-only output is byte-identical to the 0.4.0 goldens at every tier", () => {
  // INTENTION: I7 acceptance "existing tier output byte-identical when no style changes".
  // golden-feedback.json was generated from the 0.4.0 dist before the I7 serializer existed.
  for (const tier of TIERS) assert.equal(generateOutput([save, billing], "/settings", tier, options), golden[tier], tier);
});

test("style changes never renumber or alter the feedback part", () => {
  // INTENTION: style items interleaved with feedback leave the feedback text (and its
  // 1..n numbering) exactly as before; the new sections only follow it.
  for (const tier of TIERS) {
    const out = generateOutput([spacingChange, save, measureOnly, billing], "/settings", tier, options);
    assert.ok(out.startsWith(`${golden[tier]}\n\n### Measurements\n`), tier);
  }
});

const standardSpacing = [
  "### Style changes",
  "**1. Padding · .card-body** (3 elements)",
  "- Selector: `main > section.card > div.card-body`",
  "- Source: apps/host/src/app/components/card/page.tsx:42",
  "- padding-top: `var(--spacing-2)` 8px → `var(--spacing-3)` 24px",
  "- Measure: Distance between `.card-header` and `.card-body`: 24px",
  "- Elements: `.card-body` ×3",
];

const standardType = [
  "**2. Type · text-sm** (12 elements)",
  "- Signature: Inter, 14px / 20px, 500, 0",
  "- font-size: `var(--text-sm)` 14px → `var(--text-base)` 16px",
  "- line-height: `var(--text-sm--line-height)` 20px → 24px",
  "- Elements: `.meta` ×7, `.label` ×4, `.hint` ×1",
  "- Note: line-height was off-grid (21px) in 2 elements",
];

test("standard tier: the spec 7.2 worked examples (spacing with measure, type)", () => {
  // INTENTION: spec 7.1/7.2 template. A two-property type edit is two StyleChanges under
  // one heading (grouped by signature); the note names its property because the heading
  // holds more than one.
  const out = generateOutput([spacingChange, typeSize, typeLine], "/components/card", "standard", { environment });
  assert.equal(out, ["## Page Feedback: /components/card", "**Viewport:** 1440×900", "", ...standardSpacing, ...standardType].join("\n"));
});

test("compact tier: one line per change", () => {
  // INTENTION: spec 7.3 Compact `1. padding-top .card-body ×3: 8px → 24px`.
  const out = generateOutput([spacingChange, typeSize, typeLine, measureOnly], "/components/card", "compact", { environment });
  assert.equal(out, [
    "## Page Feedback: /components/card",
    "",
    "### Measurements",
    "- Distance between `.card-header` and `.card-body`: 24px",
    "",
    "### Style changes",
    "1. padding-top .card-body ×3: 8px → 24px",
    "2. font-size text-sm ×12: 14px → 16px",
    "3. line-height text-sm ×12: 20px → 24px",
  ].join("\n"));
});

test("detailed tier: standard plus every member selector", () => {
  // INTENTION: spec 7.3 Detailed lists all selectors, one per line, under Elements.
  const out = styleSections([spacingChange], "detailed").join("\n");
  assert.equal(out, [
    ...standardSpacing,
    "  - `main > section.card > div.card-body`",
    "  - `main > section.card:nth-of-type(2) > div.card-body`",
    "  - `main > section.card:nth-of-type(3) > div.card-body`",
    "",
  ].join("\n"));
});

test("forensic tier: computed before/after per element and the winning rule origin", () => {
  // INTENTION: spec 7.3 Forensic adds computed styles before/after and the origin
  // (stylesheet href or inline, layer, selector) of the winning declaration.
  const out = styleSections([spacingChange], "forensic").join("\n");
  assert.equal(out, [
    ...standardSpacing,
    "  - `main > section.card > div.card-body`: padding-top 8px → 24px",
    "  - `main > section.card:nth-of-type(2) > div.card-body`: padding-top 8px → 24px",
    "  - `main > section.card:nth-of-type(3) > div.card-body`: padding-top 8px → 24px",
    "- Origin: padding-top from `.pt-2` in https://localhost/_next/app.css (layer utilities)",
    "",
  ].join("\n"));
});

test("TODO phrasing: checkbox lines, spec 7.1 wording, at every tier", () => {
  // INTENTION: styleChangeStyle "todo" renders `- [ ] Change …` lines; compact is the bare
  // lines, standard adds source/measure/notes, detailed adds selector and elements.
  const list = [spacingChange, typeSize];
  const compact = generateOutput(list, "/x", "compact", { styleChangeStyle: "todo" });
  assert.equal(compact, [
    "## Page Feedback: /x",
    "",
    "### Style changes",
    "- [ ] Change padding-top of `.card-body` (3 elements) from `var(--spacing-2)` 8px to `var(--spacing-3)` 24px",
    "- [ ] Change font-size of `text-sm` (12 elements) from `var(--text-sm)` 14px to `var(--text-base)` 16px",
  ].join("\n"));
  const standard = styleSections(list, "standard", "todo").join("\n");
  assert.equal(standard, [
    "### Style changes",
    "- [ ] Change padding-top of `.card-body` (3 elements) from `var(--spacing-2)` 8px to `var(--spacing-3)` 24px",
    "  - Source: apps/host/src/app/components/card/page.tsx:42",
    "  - Measure: Distance between `.card-header` and `.card-body`: 24px",
    "- [ ] Change font-size of `text-sm` (12 elements) from `var(--text-sm)` 14px to `var(--text-base)` 16px",
    "",
  ].join("\n"));
  const detailed = styleSections([offGrid], "detailed", "todo").join("\n");
  assert.equal(detailed, [
    "### Style changes",
    "- [ ] Change margin-bottom of `.box` (1 element) from 14px to `calc(var(--spacing) * 4)` (mb-4) 16px",
    "  - Selector: `main > div.box`",
    "  - Elements: `.box` ×1",
    "    - `main > div.box`",
    "  - Note: was off-grid (14px) | token unknown (guess: --spacing-a, --spacing-b)",
    "",
  ].join("\n"));
  const forensic = styleSections([spacingChange], "forensic", "todo").join("\n");
  assert.ok(forensic.includes("  - Origin: padding-top from `.pt-2` in https://localhost/_next/app.css (layer utilities)"));
  assert.ok(forensic.includes("    - `main > section.card > div.card-body`: padding-top 8px → 24px"));
});

test("notes: off-grid and guesses read as the spec's Note line; multiplier tokens never become var()", () => {
  // INTENTION: spec 7.1 `- Note: was off-grid (14px) | token unknown` and the Tailwind
  // multiplier written as calc(var(--spacing) * N) with its utility.
  const out = styleSections([offGrid], "standard").join("\n");
  assert.equal(out, [
    "### Style changes",
    "**1. Margin · .box** (1 element)",
    "- Selector: `main > div.box`",
    "- margin-bottom: 14px → `calc(var(--spacing) * 4)` (mb-4) 16px",
    "- Elements: `.box` ×1",
    "- Note: was off-grid (14px) | token unknown (guess: --spacing-a, --spacing-b)",
    "",
  ].join("\n"));
});

test("style-only lists still produce a header; metadata copy formats ignore style items", () => {
  // INTENTION: a list with only style changes copies (the empty check counts them), and
  // copyFormat source/classes/attribute stay feedback-only (spacingChange has sourceFile).
  assert.ok(generateOutput([spacingChange], "/p", "standard", { environment }).startsWith("## Page Feedback: /p\n**Viewport:** 1440×900\n\n### Style changes"));
  assert.equal(formatMetadata([spacingChange], "source"), null);
  assert.equal(formatMetadata([spacingChange, save], "source"), save.sourceFile);
  assert.equal(buildCopyText([spacingChange], "markdown", () => "MD"), "MD");
});

test("element summaries cap at five labels then +N more; short selectors drop nth-*", () => {
  // INTENTION: spec 7.1 Elements line, "up to 5 listed, then +N more".
  assert.equal(elementSummary([".a", ".b", ".c", ".d", ".e", ".f", ".f", ".g"]), "`.a` ×1, `.b` ×1, `.c` ×1, `.d` ×1, `.e` ×1, +3 more");
  assert.equal(shortSelector("main > section:nth-of-type(2) > div"), "div");
  assert.equal(shortSelector('form > button[data-testid="save"]'), 'button[data-testid="save"]');
});

test("Box edit notes (spec 14.2): shorthand split, 0 side, shared gap and viewport print on the Note line once", () => {
  // INTENTION: Box records carry `styleDetail.notes`; per-side records of one edit share
  // them, so the Note line prints each note once, after any drift flags, unprefixed.
  // Records without notes (every golden above) are unchanged.
  const card = "main > div.card";
  const base = (id, property, from, to, notes, extra = {}) => ({
    id, kind: "style-change", x: 0, y: 0, comment: "", element: ".card", elementPath: card, timestamp: 1,
    styleChange: { category: "spacing", property, from, to, group: { count: 1, selectors: [card] } },
    styleDetail: { name: ".card", labels: [".card"], notes, ...extra },
  });
  const p4 = { value: "16px", token: "--spacing × 4" };
  const p6 = { value: "24px", token: "--spacing × 6" };
  const split = "authored as `p-4`; split it, keep the other sides unchanged";
  const vp = "At viewport 1280px";
  const block = base("b1", "padding-block", p4, p6, [split, vp], { fromUtility: "p-4", toUtility: "py-6" });
  assert.equal(styleSections([block], "standard").join("\n"), [
    "### Style changes",
    "**1. Padding · .card** (1 element)",
    `- Selector: \`${card}\``,
    "- padding-block: `calc(var(--spacing) * 4)` (p-4) 16px → `calc(var(--spacing) * 6)` (py-6) 24px",
    "- Elements: `.card` ×1",
    `- Note: ${split} | ${vp}`,
    "",
  ].join("\n"));
  // Arbitrary combination: one record per side, notes printed once.
  const sides = ["padding-top", "padding-right", "padding-left"].map((p, i) => base(`s${i}`, p, p4, p6, [split, vp]));
  const out = styleSections(sides, "standard");
  assert.deepEqual(out.filter((l) => l.startsWith("- padding-")).map((l) => l.split(":")[0]), ["- padding-top", "- padding-right", "- padding-left"]);
  assert.deepEqual(out.filter((l) => l.startsWith("- Note")), [`- Note: ${split} | ${vp}`]);
  // 0 side with a drift flag, and gap; the TODO phrasing carries the same Note line.
  const zero = base("z", "padding-top", { value: "0px" }, { value: "8px", token: "--spacing × 2" }, ["padding-top was 0, so no existing utility to edit", vp], { flags: ["no token"] });
  assert.ok(styleSections([zero], "standard").includes(`- Note: no token | padding-top was 0, so no existing utility to edit | ${vp}`));
  const gap = base("g", "gap", { value: "16px" }, { value: "24px" }, ["one value shared by 2 bands", vp]);
  assert.ok(styleSections([gap], "standard", "todo").includes(`  - Note: one value shared by 2 bands | ${vp}`));
  assert.ok(styleSections([gap], "standard")[1].startsWith("**1. Gap · .card**"));
  // Compact stays one line per change, without notes.
  assert.deepEqual(styleSections([block], "compact"), ["### Style changes", "1. padding-block .card ×1: 16px → 24px", ""]);
});
