import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  dragDeltaToValue,
  dragLabel,
  edgePosition,
  growDirection,
  guideLines,
  guideOffsets,
  normalizeScale,
  oppositeProperty,
  snapToToken,
  stepLabel,
  utilityPrefix,
} from "../dist/core/index.js";

// The Tailwind v4 scale as spacingTokens() lists it: grid multiples, then the rare 4, then
// a named token that duplicates 16px. Deliberately not sorted.
const SCALE = [
  { px: 0, token: "--spacing × 0" },
  { px: 8, token: "--spacing × 2" },
  { px: 16, token: "--spacing × 4" },
  { px: 24, token: "--spacing × 6" },
  { px: 32, token: "--spacing × 8" },
  { px: 40, token: "--spacing × 10" },
  { px: 48, token: "--spacing × 12" },
  { px: 4, token: "--spacing × 1" },
  { px: 16, token: "--spacing-md" },
];

test("normalizeScale sorts ascending and keeps the first token per px", () => {
  // INTENTION: handles and guides read one sorted, deduplicated scale; the token picker
  // order (grid first) decides which token names a shared px value.
  const steps = normalizeScale(SCALE);
  assert.deepEqual(steps.map((s) => s.px), [0, 4, 8, 16, 24, 32, 40, 48]);
  assert.equal(steps.find((s) => s.px === 16).token, "--spacing × 4");
});

test("snapToToken: token mode (spec 13.4 cases)", () => {
  // INTENTION: a handle drag lands on the nearest real token. Exact values stay put,
  // midpoints round up, negatives clamp to 0 and values past the scale return the max.
  assert.deepEqual(snapToToken(24, SCALE, "token"), { px: 24, token: "--spacing × 6" });
  assert.deepEqual(snapToToken(19, SCALE, "token"), { px: 16, token: "--spacing × 4" });
  assert.deepEqual(snapToToken(20, SCALE, "token"), { px: 24, token: "--spacing × 6" }, "midpoint 16|24 rounds up");
  assert.deepEqual(snapToToken(6, SCALE, "token"), { px: 8, token: "--spacing × 2" }, "midpoint 4|8 rounds up");
  assert.deepEqual(snapToToken(-12, SCALE, "token"), { px: 0, token: "--spacing × 0" });
  assert.deepEqual(snapToToken(500, SCALE, "token"), { px: 48, token: "--spacing × 12" });
  assert.equal(snapToToken(13, [...SCALE].reverse(), "token").px, 16, "unsorted input");
});

test("snapToToken: grid8, free and the empty-scale fallback", () => {
  // INTENTION: Shift snaps to the 8px grid with no token; Alt is free px (rounded, sign
  // kept so a margin can go negative); without a scale token mode degrades to grid8.
  assert.deepEqual(snapToToken(13, SCALE, "grid8"), { px: 16 });
  assert.deepEqual(snapToToken(12, SCALE, "grid8"), { px: 16 }, "midpoint rounds up");
  assert.deepEqual(snapToToken(4, SCALE, "grid8"), { px: 8 }, "grid8 ignores the 4px token");
  assert.deepEqual(snapToToken(-9, SCALE, "grid8"), { px: 0 });
  assert.deepEqual(snapToToken(21.4, SCALE, "free"), { px: 21 });
  assert.deepEqual(snapToToken(-7.6, SCALE, "free"), { px: -8 });
  assert.deepEqual(snapToToken(13, [], "token"), { px: 16 });
});

test("guideOffsets: steps around the current value", () => {
  // INTENTION: guides show `up` tokens above and `down` below the current value, always
  // with the current value itself (solid), in ascending px.
  const on = guideOffsets(16, SCALE, 4, 2);
  assert.deepEqual(on.map((g) => g.px), [4, 8, 16, 24, 32, 40, 48]);
  assert.deepEqual(on.filter((g) => g.current), [{ px: 16, token: "--spacing × 4", current: true }]);
  const off = guideOffsets(13, SCALE, 4, 2);
  assert.deepEqual(off.map((g) => g.px), [4, 8, 13, 16, 24, 32, 40]);
  assert.deepEqual(off.find((g) => g.current), { px: 13, token: "", current: true }, "off a token: current has no token");
});

test("guideOffsets: fewer steps than asked, value 0, unsorted scale", () => {
  // INTENTION: the ladder never invents steps; at 0 nothing is drawn below; input order
  // does not matter.
  assert.deepEqual(guideOffsets(40, SCALE, 4, 2).map((g) => g.px), [24, 32, 40, 48]);
  assert.deepEqual(guideOffsets(0, SCALE, 4, 2).map((g) => g.px), [0, 4, 8, 16, 24]);
  assert.equal(guideOffsets(0, SCALE, 4, 2).filter((g) => g.px < 0 || (g.px === 0 && !g.current)).length, 0);
  assert.deepEqual(guideOffsets(16, [...SCALE].reverse(), 1, 1).map((g) => g.px), [8, 16, 24]);
  assert.deepEqual(guideOffsets(16, SCALE, 0, 0).map((g) => g.px), [16]);
});

test("dragDeltaToValue: sign per side, padding vs margin", () => {
  // INTENTION: dragging a handle away from the fixed edge grows the value. Padding handles
  // sit on the inner edge (top/left grow with +delta, bottom/right with -delta); margin
  // handles sit on the outer edge (the opposite signs); gaps grow along the visual order.
  const v = (side, kind, delta) => dragDeltaToValue(delta, SCALE, side, 1, false, { kind, start: 16 });
  assert.equal(v("top", "padding", 8), 24);
  assert.equal(v("bottom", "padding", 8), 8);
  assert.equal(v("left", "padding", 8), 24);
  assert.equal(v("right", "padding", 8), 8);
  assert.equal(v("top", "margin", 8), 8);
  assert.equal(v("bottom", "margin", 8), 24);
  assert.equal(v("left", "margin", -8), 24);
  assert.equal(v("right", "margin", 8), 24);
  assert.equal(v("row", "gap", 8), 24);
  assert.equal(v("column", "gap", 8), 24);
  assert.equal(dragDeltaToValue(8, SCALE, "row", 1, false, { start: 16 }), 24, "gap is the default kind for row/column");
});

test("dragDeltaToValue: element scale, RTL, zero delta, bound", () => {
  // INTENTION: viewport px convert to CSS px by the rendered scale (scale(0.5): 8px of
  // pointer = 16px of value). RTL reverses the column gap only; physical left/right keep
  // their sign. Zero delta returns the start value exactly. A runaway drag is bounded.
  assert.equal(dragDeltaToValue(8, SCALE, "top", 0.5, false, { kind: "padding", start: 16 }), 32);
  assert.equal(dragDeltaToValue(16, SCALE, "top", 2, false, { kind: "padding", start: 16 }), 24);
  assert.equal(dragDeltaToValue(8, SCALE, "column", 1, true, { kind: "gap", start: 16 }), 8);
  assert.equal(dragDeltaToValue(8, SCALE, "row", 1, true, { kind: "gap", start: 16 }), 24, "row gap is on Y: RTL does not flip it");
  assert.equal(dragDeltaToValue(8, SCALE, "left", 1, true, { kind: "padding", start: 16 }), 24);
  assert.equal(dragDeltaToValue(0, SCALE, "top", 0.5, true, { kind: "margin", start: 13 }), 13);
  assert.equal(dragDeltaToValue(5000, SCALE, "top", 1, false, { kind: "padding", start: 0 }), 96);
  assert.equal(dragDeltaToValue(5000, [], "top", 1, false, { kind: "padding", start: 0 }), 5000);
});

test("edge positions and guide lines share one geometry", () => {
  // INTENTION: a guide for token t sits where the handle edge would be at value t, so the
  // handle snaps exactly onto guides. The current value maps onto the drawn band edge, at
  // scale 1 and at scale 0.5; lines far outside the viewport are dropped.
  const padTop = { x: 10, y: 100, width: 200, height: 16 };
  assert.equal(edgePosition(padTop, "padding", "top", 16, 1), 116);
  assert.equal(edgePosition(padTop, "padding", "top", 24, 1), 124);
  const marginTop = { x: 10, y: 84, width: 200, height: 16 };
  assert.equal(edgePosition(marginTop, "margin", "top", 16, 1), 84);
  assert.equal(edgePosition(marginTop, "margin", "top", 24, 1), 76);
  const padRightHalf = { x: 300, y: 0, width: 8, height: 50 };
  assert.equal(edgePosition(padRightHalf, "padding", "right", 16, 0.5), 300);
  assert.equal(edgePosition(padRightHalf, "padding", "right", 32, 0.5), 292);
  const rtlGap = { x: 100, y: 0, width: 16, height: 40 };
  assert.equal(edgePosition(rtlGap, "gap", "column", 24, 1, true), 92);
  const lines = guideLines({ rect: padTop, kind: "padding", side: "top", value: 16, scale: SCALE, elementScale: 1, viewport: { width: 800, height: 130 }, threshold: 0 });
  assert.deepEqual(lines.map((l) => [l.px, l.pos]), [[4, 104], [8, 108], [16, 116], [24, 124]]);
  assert.equal(growDirection("margin", "left"), -1);
});

test("labels: utility prefixes, token labels, drag label, opposite side", () => {
  // INTENTION: the floating drag label reads `old → new · token · mode` (spec 13.1, mock)
  // with the utility name (never a bare --spacing); `no token` for free px (Alt) and the
  // 8px grid (Shift); Cmd/Ctrl names both sides and says `both sides`. A gap is one shared
  // value, so it has no opposite side.
  assert.equal(utilityPrefix("padding-top"), "pt");
  assert.equal(utilityPrefix("margin-left"), "ml");
  assert.equal(utilityPrefix("row-gap"), "gap-y");
  assert.equal(stepLabel("padding-top", "--spacing × 6"), "pt-6");
  assert.equal(stepLabel("column-gap", "--spacing × 2"), "gap-x-2");
  assert.equal(stepLabel("padding-top", "--spacing-md"), "--spacing-md");
  assert.equal(stepLabel("padding-top", undefined), undefined);
  assert.equal(dragLabel({ from: 8, to: 24, mode: "token", labels: ["pt-6"] }), "8 → 24 · pt-6 · token");
  assert.equal(dragLabel({ from: 8, to: 21, mode: "free", labels: [] }), "8 → 21 · no token · free px");
  assert.equal(dragLabel({ from: 8, to: 24, mode: "grid8", labels: [] }), "8 → 24 · no token · 8px grid");
  assert.equal(dragLabel({ from: 8, to: 13, mode: "token", labels: [undefined] }), "8 → 13 · no token · token", "token mode past an unnamed value");
  assert.equal(dragLabel({ from: 8, to: 24, mode: "token", labels: ["pt-6", "pb-6"], otherFrom: 16, symmetric: true }), "8/16 → 24 · pt-6 + pb-6 · token + both sides");
  assert.equal(oppositeProperty("padding-top"), "padding-bottom");
  assert.equal(oppositeProperty("margin-left"), "margin-right");
  assert.equal(oppositeProperty("row-gap"), "row-gap");
  assert.equal(oppositeProperty("column-gap"), "column-gap");
});
