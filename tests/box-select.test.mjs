import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  boxHitTest,
  boxRegions,
  clickSelect,
  escapeSelection,
  grownStrip,
  longhandsOf,
  presetSelection,
  propertySides,
  selectionNotes,
  selectionProperties,
  stepSelectionValue,
  tokenSteps,
  toggleSide,
  selectionUtilityPrefix,
  utilitySides,
  valueReadout,
} from "../dist/core/index.js";

const rect = (x, y, width, height) => ({ x, y, width, height });
const sides = (top, right = top, bottom = top, left = right) => ({ top, right, bottom, left });
const ALL = ["top", "right", "bottom", "left"];

/** A card: border box 100,100 200x100, no border, padding 16/24, margin 16 all round. */
function card(padding = sides(16, 24), margin = sides(16), extra = []) {
  const border = rect(100, 100, 200, 100);
  const regions = [...boxRegions(border, { margin, padding, border: sides(0) }, "card"), ...extra];
  return { element: "card", regions, frame: { border, paddingBox: border } };
}
const gapBand = (x, i) => ({ kind: "gap", side: "column", rect: rect(x, 120, 8, 40), value: 8, element: "card", index: i });

test("hit-test: padding, margin and content zones of one card", () => {
  // INTENTION: the area under the cursor decides the group (spec 14.2). Inside the padding
  // band -> padding; outside the border box in the margin -> margin; the content -> just
  // the element box. Each side is reported so a click inside a selected ring can narrow.
  const c = [card()];
  assert.deepEqual(pick(boxHitTest(c, { x: 200, y: 104 })), ["padding", "top"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 104, y: 150 })), ["padding", "left"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 296, y: 150 })), ["padding", "right"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 200, y: 196 })), ["padding", "bottom"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 200, y: 90 })), ["margin", "top"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 90, y: 150 })), ["margin", "left"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 200, y: 150 })), ["content", null]);
  assert.equal(boxHitTest(c, { x: 10, y: 10 }), null);
});

test("hit-test: corners select all sides (cell `corner`) for padding and margin", () => {
  const c = [card()];
  assert.deepEqual(pick(boxHitTest(c, { x: 104, y: 104 })), ["padding", "corner"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 296, y: 196 })), ["padding", "corner"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 90, y: 90 })), ["margin", "corner"]);
  assert.deepEqual(pick(boxHitTest(c, { x: 310, y: 210 })), ["margin", "corner"]);
});

test("hit-test: a 0 side keeps an 8px grab zone; a ring with every side 0 has no zone", () => {
  // INTENTION: spec 14.2 rule 4. padding-top 0 still selects inside the top 8px (hit
  // area uses max(value, 8)); margin-top 0 grabs 8px above the border box. A ring whose
  // four sides are all 0 has nothing to select, so plain elements stay `content`.
  const zero = [card(sides(0, 24, 16, 24), sides(0, 16, 16, 16))];
  assert.deepEqual(pick(boxHitTest(zero, { x: 200, y: 103 })), ["padding", "top"]);
  assert.deepEqual(pick(boxHitTest(zero, { x: 200, y: 109 })), ["content", null]);
  assert.deepEqual(pick(boxHitTest(zero, { x: 200, y: 95 })), ["margin", "top"]);
  assert.equal(boxHitTest(zero, { x: 200, y: 91 }), null);
  const bare = [card(sides(0), sides(0))];
  assert.deepEqual(pick(boxHitTest(bare, { x: 200, y: 102 })), ["content", null]);
  assert.equal(boxHitTest(bare, { x: 200, y: 96 }), null);
  // Small values also grab 8px: padding 4 is selectable 7px in.
  const thin = [card(sides(4), sides(16))];
  assert.deepEqual(pick(boxHitTest(thin, { x: 200, y: 107 })), ["padding", "top"]);
  // Inline strips (no frame) grow to 8px too.
  const strip = { kind: "padding", side: "top", rect: rect(0, 0, 50, 0), value: 0, element: "x" };
  assert.deepEqual(grownStrip(strip), rect(0, 0, 50, 8));
  assert.deepEqual(grownStrip({ ...strip, kind: "margin", side: "left", rect: rect(10, 0, 2, 20) }), rect(4, 0, 8, 20));
});

test("hit-test: gap bands report their index; the smallest band wins; priority answers first", () => {
  const c = card(sides(16), sides(16), [gapBand(150, 0), gapBand(180, 1)]);
  assert.deepEqual(pick(boxHitTest([c], { x: 184, y: 130 })), ["gap", 1]);
  // A child's margin (smaller) beats the parent's padding at the same point.
  const child = { element: "child", groups: ["margin"], regions: boxRegions(rect(120, 120, 40, 40), { margin: sides(4), padding: sides(0), border: sides(0) }, "child"), frame: { border: rect(120, 120, 40, 40), paddingBox: rect(120, 120, 40, 40) } };
  const parent = card(sides(24), sides(0));
  assert.deepEqual(pickEl(boxHitTest([parent, child], { x: 118, y: 140 })), ["child", "margin", "left"]);
  // With the parent selected (priority), the same point stays in the parent's ring.
  assert.deepEqual(pickEl(boxHitTest([parent, child], { x: 118, y: 140 }, { priority: "card" })), ["card", "padding", "left"]);
});

test("selection: click whole ring, narrow, widen, Shift toggles, corner and Esc", () => {
  // INTENTION: the approved mock's state machine (spec 14.2). Every transition here is a
  // user-visible rule, so each one is pinned.
  let s = clickSelect(null, false, { group: "padding", cell: "top" }, false);
  assert.deepEqual(s, { group: "padding", sides: ALL });
  s = clickSelect(s, true, { group: "padding", cell: "left" }, false);
  assert.deepEqual(s.sides, ["left"]);
  s = clickSelect(s, true, { group: "padding", cell: "left" }, false);
  assert.deepEqual(s.sides, ALL, "clicking the lone selected side widens back");
  s = clickSelect(s, true, { group: "padding", cell: "top" }, false);
  s = clickSelect(s, true, { group: "padding", cell: "bottom" }, true);
  assert.deepEqual(s.sides, ["top", "bottom"], "Shift adds a side");
  s = clickSelect(s, true, { group: "padding", cell: "top" }, true);
  assert.deepEqual(s.sides, ["bottom"], "Shift removes a side");
  s = clickSelect(s, true, { group: "padding", cell: "bottom" }, true);
  assert.deepEqual(s.sides, ["bottom"], "at least one side stays");
  s = clickSelect(s, true, { group: "padding", cell: "corner" }, false);
  assert.deepEqual(s.sides, ALL, "corner selects all sides");
  // Another group or element starts over with its whole ring; Shift on a new ring picks one side.
  assert.deepEqual(clickSelect(s, true, { group: "margin", cell: "left" }, false), { group: "margin", sides: ALL });
  assert.deepEqual(clickSelect(s, false, { group: "padding", cell: "left" }, false), { group: "padding", sides: ALL });
  assert.deepEqual(clickSelect(null, false, { group: "margin", cell: "left" }, true), { group: "margin", sides: ["left"] });
  // Gap: every band, always.
  const g = clickSelect(null, false, { group: "gap", cell: 1 }, false);
  assert.deepEqual(g, { group: "gap", sides: [] });
  assert.deepEqual(clickSelect(g, true, { group: "gap", cell: 0 }, true), g);
  // Esc: narrowed -> ring -> nothing.
  assert.deepEqual(escapeSelection({ group: "padding", sides: ["top"] }), { group: "padding", sides: ALL });
  assert.equal(escapeSelection({ group: "padding", sides: ALL }), null);
  assert.equal(escapeSelection(g), null);
  assert.equal(escapeSelection(null), null);
  // Panel cells use the same rules; presets.
  assert.deepEqual(toggleSide({ group: "margin", sides: ALL }, "right", false).sides, ["right"]);
  assert.deepEqual(presetSelection("padding", "vertical").sides, ["top", "bottom"]);
  assert.deepEqual(presetSelection("padding", "horizontal").sides, ["left", "right"]);
  assert.deepEqual(presetSelection("gap", "vertical"), { group: "gap", sides: [] });
});

test("selection -> properties: shorthand, block, inline, single, per-side; gap; inverse", () => {
  const p = (sides) => selectionProperties({ group: "padding", sides });
  assert.deepEqual(p(ALL), ["padding"]);
  assert.deepEqual(p(["bottom", "top"]), ["padding-block"]);
  assert.deepEqual(p(["right", "left"]), ["padding-inline"]);
  assert.deepEqual(p(["left"]), ["padding-left"]);
  assert.deepEqual(p(["left", "top", "right"]), ["padding-top", "padding-right", "padding-left"]);
  assert.deepEqual(selectionProperties({ group: "margin", sides: ["top", "bottom"] }), ["margin-block"]);
  assert.deepEqual(selectionProperties({ group: "gap", sides: [] }, { axes: ["column"], rowGap: 0, columnGap: 8 }), ["column-gap"]);
  assert.deepEqual(selectionProperties({ group: "gap", sides: [] }, { axes: ["column"], rowGap: 8, columnGap: 8 }), ["gap"]);
  assert.deepEqual(selectionProperties({ group: "gap", sides: [] }, { axes: ["row", "column"], rowGap: 8, columnGap: 24 }), ["gap"]);
  assert.deepEqual(propertySides("padding-inline"), { group: "padding", sides: ["left", "right"] });
  assert.deepEqual(propertySides("margin"), { group: "margin", sides: ALL });
  assert.deepEqual(propertySides("padding-top"), { group: "padding", sides: ["top"] });
  assert.deepEqual(propertySides("row-gap"), { group: "gap", sides: [] });
  assert.equal(propertySides("font-size"), null);
  assert.deepEqual(longhandsOf("padding-block"), ["padding-top", "padding-bottom"]);
  assert.deepEqual(longhandsOf("gap", ["column"]), ["column-gap"]);
  assert.equal(selectionUtilityPrefix({ group: "padding", sides: ALL }), "p");
  assert.equal(selectionUtilityPrefix({ group: "padding", sides: ["top", "bottom"] }), "py");
  assert.equal(selectionUtilityPrefix({ group: "margin", sides: ["left"] }), "ml");
  assert.equal(selectionUtilityPrefix({ group: "gap", sides: [] }), "gap");
});

test("notes: shorthand split, 0 side, shared gap, viewport", () => {
  // INTENTION: the agent receiving the Copy output must know when a partial edit has to
  // split an authored shorthand, when there is no utility to edit, and the viewport.
  assert.deepEqual(utilitySides("p-4"), ALL);
  assert.deepEqual(utilitySides("md:px-6"), ["left", "right"]);
  assert.deepEqual(utilitySides("-mt-2"), ["top"]);
  assert.equal(utilitySides("gap-2"), null);
  const u = { top: "p-4", right: "p-4", bottom: "p-4", left: "p-4" };
  assert.deepEqual(selectionNotes({ group: "padding", sides: ["top"], utilities: u, viewport: 1280 }), [
    "authored as `p-4`; split it, keep the other sides unchanged",
    "At viewport 1280px",
  ]);
  assert.deepEqual(selectionNotes({ group: "padding", sides: ALL, utilities: u }), [], "whole ring: no split");
  const pxpy = { top: "py-2", bottom: "py-2", left: "px-6", right: "px-6" };
  assert.deepEqual(selectionNotes({ group: "padding", sides: ["top", "bottom"], utilities: pxpy }), [], "py-2 fully covered");
  assert.deepEqual(selectionNotes({ group: "padding", sides: ["top"], utilities: pxpy }), ["authored as `py-2`; split it, keep the other sides unchanged"]);
  assert.deepEqual(selectionNotes({ group: "padding", sides: ["top"], values: { top: 0 } }), ["padding-top was 0, so no existing utility to edit"]);
  assert.deepEqual(selectionNotes({ group: "padding", sides: ["top"], values: { top: 0 }, utilities: { top: "pt-0" } }), [], "an authored pt-0 can be edited");
  assert.deepEqual(selectionNotes({ group: "gap", sides: [], bands: 3, viewport: 1024.4 }), ["one value shared by 3 bands", "At viewport 1024px"]);
});

test("readout shows mixed; keyboard steps follow the token scale", () => {
  assert.equal(valueReadout([]), "–");
  assert.equal(valueReadout([16, 16]), "16px");
  assert.equal(valueReadout([16, 24]), "mixed");
  const steps = tokenSteps([{ px: 0, onGrid: true }, { px: 8, onGrid: true }, { px: 4, onGrid: false }, { px: 16, onGrid: true }, { px: 16, onGrid: true }, { px: 24, onGrid: true }]);
  assert.deepEqual(steps, [0, 8, 16, 24]);
  assert.equal(stepSelectionValue([16], steps, 1), 24);
  assert.equal(stepSelectionValue([16], steps, -1), 8);
  assert.equal(stepSelectionValue([16, 24], steps, 1), 24, "mixed steps from the max; at the top it stays");
  assert.equal(stepSelectionValue([14], steps, 1), 16, "off-scale value snaps to the next token");
  assert.equal(stepSelectionValue([14], steps, -1), 8);
  assert.equal(stepSelectionValue([0], steps, -1, false, 0), 0);
  assert.equal(stepSelectionValue([16], steps, 1, true), 17);
  assert.equal(stepSelectionValue([0], steps, -1, true, 0), 0);
});

function pick(hit) {
  return hit ? [hit.group, hit.cell] : null;
}
function pickEl(hit) {
  return hit ? [hit.element, hit.group, hit.cell] : null;
}
