import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deltaText, feedbackOnly, formatMetadata, generateOutput, rearrangeSection, relationText } from "../dist/core/index.js";
import { billing, environment, save } from "./fixtures.mjs";
import * as s from "./style-fixtures.mjs";

const options = { appName: "Demo", environment };
const TIERS = ["compact", "standard", "detailed", "forensic"];
/** Generated from the dist before Rearrange mode existed (tests/rearrange-golden.json). */
const golden = JSON.parse(readFileSync(new URL("./rearrange-golden.json", import.meta.url), "utf8"));

const moved = {
  id: "r1",
  kind: "rearrange",
  x: 10,
  y: 340,
  comment: "",
  element: 'button "One"',
  elementPath: "#cards > button.card-btn",
  timestamp: 20,
  sourceFile: "apps/host/src/app/page.tsx:12",
  rearrange: {
    selector: "#cards > button.card-btn",
    label: 'button "One"',
    tagName: "button",
    originalRect: { x: 72, y: 112, width: 120, height: 56 },
    currentRect: { x: 96, y: 104, width: 160, height: 56 },
  },
  rearrangeDetail: {
    relation: { label: ".title", relation: "below", distance: 16 },
    parent: "#cards",
    computed: {
      before: { position: "static", display: "inline-block", width: "120px", height: "56px", margin: "0px", translate: "none", transform: "none" },
      after: { position: "static", display: "inline-block", width: "160px", height: "56px", margin: "0px", translate: "24px -8px", transform: "none" },
    },
  },
};

const removed = {
  id: "r2",
  kind: "rearrange",
  x: 20,
  y: 400,
  comment: "",
  element: "div.promo",
  elementPath: "main > div.promo",
  timestamp: 21,
  rearrange: {
    selector: "main > div.promo",
    label: "div.promo",
    tagName: "div",
    originalRect: { x: 40, y: 320, width: 160, height: 80 },
    currentRect: { x: 40, y: 320, width: 160, height: 80 },
  },
  rearrangeDetail: { removed: true, relation: null, parent: "main" },
};

const expected = {
  compact: [
    "### Rearrangements",
    '1. **button "One"** (apps/host/src/app/page.tsx:12): moved 24px right, 8px up; resized 120→160 wide; now 16px below .title',
    "2. **div.promo**: removed",
  ],
  standard: [
    "### Rearrangements",
    '**1. button "One"** · `#cards > button.card-btn`',
    "- From: 72,112 120×56 → To: 96,104 160×56",
    "- Change: moved 24px right, 8px up; resized 120→160 wide",
    "- Relation: now 16px below .title",
    "- Source: apps/host/src/app/page.tsx:12",
    "**2. div.promo** · `main > div.promo`",
    "- From: 40,320 160×80 → removed",
    "- Change: removed from the layout (hidden in the preview)",
  ],
};
expected.detailed = [
  ...expected.standard.slice(0, 6),
  "- Element: `button` in `#cards`",
  ...expected.standard.slice(6),
  "- Element: `div` in `main`",
];
expected.forensic = [
  ...expected.detailed.slice(0, 7),
  "- Delta: dx 24, dy -8, dw 40, dh 0",
  "- Computed before: position: static; display: inline-block; width: 120px; height: 56px; margin: 0px; translate: none; transform: none",
  "- Computed after: position: static; display: inline-block; width: 160px; height: 56px; margin: 0px; translate: 24px -8px; transform: none",
  ...expected.detailed.slice(7),
  "- Delta: dx 0, dy 0, dw 0, dh 0",
];

test("Rearrangements section golden at every tier", () => {
  for (const tier of TIERS) {
    assert.deepEqual(rearrangeSection([save, moved, removed], tier), [...expected[tier], ""], tier);
  }
});

test("the section follows feedback and style changes, and never renumbers them", () => {
  // INTENTION: rearrange records are not numbered feedback; the existing output is a
  // byte-identical prefix and the new section comes last.
  for (const tier of TIERS) {
    const out = generateOutput([moved, s.spacingChange, save, s.measureOnly, removed, billing, s.typeSize], "/settings", tier, options);
    const before = golden[tier].mixed;
    assert.ok(out.startsWith(`${before}\n\n### Rearrangements\n`), tier);
    assert.equal(out, `${before}\n\n${expected[tier].join("\n")}`, tier);
  }
});

test("output without rearrangements stays byte-identical (regression goldens)", () => {
  for (const tier of TIERS) {
    assert.equal(generateOutput([save, billing], "/settings", tier, options), golden[tier].feedback, `${tier} feedback`);
    assert.equal(generateOutput([s.spacingChange, s.typeSize, s.typeLine, s.measureOnly, s.offGrid], "/settings", tier, options), golden[tier].style, `${tier} style`);
    assert.equal(generateOutput([s.spacingChange, save, s.measureOnly, billing, s.typeSize], "/settings", tier, options), golden[tier].mixed, `${tier} mixed`);
    assert.equal(generateOutput([save, s.spacingChange, s.typeSize], "/settings", tier, { ...options, styleChangeStyle: "todo" }), golden[tier].todo, `${tier} todo`);
  }
});

test("rearrangement-only output has the header and the section", () => {
  const out = generateOutput([moved], "/settings", "standard", options);
  assert.equal(out, ["## Page Feedback: /settings", "**App:** Demo", "**Viewport:** 1440×900", "", ...expected.standard.slice(0, 6)].join("\n"));
});

test("rearrangements are not feedback: no markers, no metadata copy formats", () => {
  assert.deepEqual(feedbackOnly([moved, save, removed]).map((a) => a.id), [save.id]);
  assert.equal(formatMetadata([moved, removed], "source"), null);
});

test("delta and relation wording", () => {
  const a = { x: 0, y: 0, width: 100, height: 40 };
  assert.equal(deltaText(a, { x: -8, y: 16, width: 100, height: 48 }), "moved 8px left, 16px down; resized 40→48 tall");
  assert.equal(deltaText(a, a), "");
  assert.equal(relationText({ label: ".title", relation: "overlapping", distance: 0 }), "now overlaps .title");
  assert.equal(relationText({ label: ".cards", relation: "inside", distance: 0, offset: { left: 32, top: 0 } }), "inside .cards at +32px left, +0px top");
  assert.equal(relationText(null), "");
});

test("layout placements keep their output when rearrangements are added (they follow it)", async () => {
  // INTENTION: the placements section (job B1) is untouched; rearrangements only append.
  const { createPlacement } = await import("../dist/core/index.js");
  if (typeof createPlacement !== "function") return;
  const placement = createPlacement({
    id: "p1",
    componentType: "Badge",
    rect: { x: 40, y: 600, width: 96, height: 32 },
    viewportWidth: 1440,
    scrollY: 0,
    timestamp: 30,
    near: { name: "main", path: "main", rect: { x: 0, y: 0, width: 1440, height: 2000 } },
  });
  for (const tier of TIERS) {
    const without = generateOutput([save, placement, s.spacingChange], "/settings", tier, options);
    const withRearrange = generateOutput([moved, save, placement, s.spacingChange], "/settings", tier, options);
    assert.ok(without.includes("\n") && withRearrange.startsWith(`${without}\n\n### Rearrangements\n`), tier);
  }
});
