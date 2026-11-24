import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  boxRects,
  boxRegions,
  hitTestRegions,
  inlineRegions,
  mayCollapse,
  regionLabel,
  regionProperty,
  sameRegion,
  transformFlags,
  LAYER_OWNER,
  OVERLAY_LAYERS,
  SUB_MODE_BEHAVIOUR,
  layersFor,
  nextSubMode,
  ownsLayer,
  tokenDisplayLabel,
} from "../dist/core/index.js";

const rect = (x, y, width, height) => ({ x, y, width, height });
const sides = (top, right = top, bottom = top, left = right) => ({ top, right, bottom, left });
const metrics = (margin, padding, border = sides(0)) => ({ margin, padding, border });
const find = (regions, kind, side) => regions.find((r) => r.kind === kind && r.side === side);

test("box regions match the DevTools box model for a plain box", () => {
  // INTENTION: margin strips sit outside the border box, padding strips inside the
  // border (inset by border widths), each as thick as its computed value. These are the
  // golden rects the overlay draws, so a 1px drift here is a visible misalignment.
  const border = rect(100, 100, 200, 100);
  const m = metrics(sides(8, 16, 24, 32), sides(4, 8, 12, 16), sides(1, 2, 3, 4));
  const regions = boxRegions(border, m, "el");
  assert.equal(regions.length, 8);
  assert.deepEqual(find(regions, "margin", "top").rect, rect(68, 92, 248, 8));
  assert.deepEqual(find(regions, "margin", "bottom").rect, rect(68, 200, 248, 24));
  assert.deepEqual(find(regions, "margin", "left").rect, rect(68, 100, 32, 100));
  assert.deepEqual(find(regions, "margin", "right").rect, rect(300, 100, 16, 100));
  // Padding box = border box inset by borders: x 104..298, y 101..197.
  assert.deepEqual(find(regions, "padding", "top").rect, rect(104, 101, 194, 4));
  assert.deepEqual(find(regions, "padding", "bottom").rect, rect(104, 185, 194, 12));
  assert.deepEqual(find(regions, "padding", "left").rect, rect(104, 105, 16, 80));
  assert.deepEqual(find(regions, "padding", "right").rect, rect(290, 105, 8, 80));
  assert.equal(find(regions, "padding", "left").element, "el");
  const boxes = boxRects(border, m);
  assert.deepEqual(boxes.contentBox, rect(120, 105, 170, 80));
  assert.deepEqual(boxes.marginBox, rect(68, 92, 248, 132));
});

test("negative margins draw at zero thickness but keep the real value", () => {
  // INTENTION: spec 3.2. The overlay must not draw a ring inside the box for a negative
  // margin, yet the label and the panel must still report -16 and say it was clamped.
  const regions = boxRegions(rect(0, 0, 100, 50), metrics(sides(-16, 0, 0, 0), sides(0)), "el");
  const top = find(regions, "margin", "top");
  assert.equal(top.value, -16);
  assert.equal(top.rect.height, 0);
  assert.deepEqual(top.flags, ["clamped"]);
  assert.equal(regionLabel(top), "-16 ? · clamped");
});

test("scaled boxes draw thickness in rendered px and label computed px", () => {
  // INTENTION: spec 3.5 transforms. getBoundingClientRect is already scaled, so the
  // strips must be scaled too or they overshoot the box; labels keep the CSS value.
  const flags = transformFlags({ x: 0.5, y: 0.5 });
  assert.deepEqual(flags, ["scaled ×0.5"]);
  const regions = boxRegions(rect(0, 0, 50, 50), metrics(sides(16), sides(16)), "el", { scale: { x: 0.5, y: 0.5 }, flags });
  const pad = find(regions, "padding", "left");
  assert.deepEqual(pad.rect, rect(0, 8, 8, 34));
  assert.equal(pad.value, 16);
  assert.equal(regionLabel(pad), "16 ? · scaled ×0.5");
  assert.deepEqual(transformFlags({ x: 1, y: 1 }, true), ["approximate"]);
  assert.deepEqual(transformFlags({ x: 1, y: 1 }), []);
});

test("hit-test picks the smallest region containing the point", () => {
  // INTENTION: spec 3.1. Overlapping candidates (an outer gap band and an inner child
  // margin, for example) resolve to the most specific, smallest one.
  const big = { kind: "gap", side: "column", rect: rect(0, 0, 100, 100), value: 16, element: "a" };
  const small = { kind: "margin", side: "left", rect: rect(10, 10, 8, 20), value: 8, element: "b" };
  assert.equal(hitTestRegions([big, small], { x: 12, y: 12 }), small);
  assert.equal(hitTestRegions([big, small], { x: 50, y: 50 }), big);
  assert.equal(hitTestRegions([big, small], { x: 500, y: 500 }), null);
});

test("hit-test snaps to zero-area regions with a value within 8px", () => {
  // INTENTION: spec 3.5. A clamped negative margin has no area, so it is only pickable by
  // proximity; zero-value zero-area regions are never picked (nothing to inspect).
  const clamped = { kind: "margin", side: "top", rect: rect(0, 50, 100, 0), value: -16, element: "a" };
  const empty = { kind: "padding", side: "top", rect: rect(0, 60, 100, 0), value: 0, element: "a" };
  assert.equal(hitTestRegions([clamped, empty], { x: 10, y: 56 }), clamped);
  assert.equal(hitTestRegions([clamped, empty], { x: 10, y: 70 }), null);
});

test("inline elements get per-line padding and inline-axis margins only", () => {
  // INTENTION: spec 3.5 inline. Left margin/padding belong to the first fragment, right to
  // the last, vertical padding paints on every line box and vertical margins are skipped.
  const fragments = [rect(100, 0, 200, 24), rect(0, 24, 120, 24)];
  const regions = inlineRegions(fragments, metrics(sides(8, 16, 8, 16), sides(4, 8, 4, 8)), "span");
  assert.equal(regions.filter((r) => r.kind === "margin").length, 2);
  assert.deepEqual(find(regions, "margin", "left").rect, rect(84, 0, 16, 24));
  assert.deepEqual(find(regions, "margin", "right").rect, rect(120, 24, 16, 24));
  assert.deepEqual(find(regions, "padding", "left").rect, rect(100, 4, 8, 16));
  assert.deepEqual(find(regions, "padding", "right").rect, rect(112, 28, 8, 16));
  assert.equal(regions.filter((r) => r.kind === "padding" && r.side === "top").length, 2);
  // rtl: physical left lands on the last fragment.
  const rtl = inlineRegions(fragments, metrics(sides(0, 0, 0, 16), sides(0)), "span", { rtl: true });
  assert.deepEqual(find(rtl, "margin", "left").rect, rect(-16, 24, 16, 24));
});

test("properties, identity and labels", () => {
  // INTENTION: the panel and preview key on the CSS property; redraws keep a pin by
  // identity (element, kind, side, index), not by rect, so scrolling cannot drop it.
  assert.equal(regionProperty({ kind: "padding", side: "top" }), "padding-top");
  assert.equal(regionProperty({ kind: "gap", side: "row" }), "row-gap");
  assert.equal(regionProperty({ kind: "gap", side: "column" }), "column-gap");
  const a = { kind: "gap", side: "column", rect: rect(0, 0, 1, 1), value: 8, element: "x", index: 1 };
  assert.ok(sameRegion(a, { ...a, rect: rect(9, 9, 9, 9) }));
  assert.ok(!sameRegion(a, { ...a, index: 2 }));
  assert.equal(regionLabel({ ...a, value: 16 }, "p-4"), "p-4 · 16");
  assert.equal(regionLabel({ ...a, value: 16, measured: 40 }), "40 (gap 16) ?");
});

test("margin collapse hint", () => {
  // INTENTION: spec 3.5. Flag only; a sibling's opposing margin or an unseparated block
  // parent edge means the margin may collapse. Flex/grid/BFC parents never collapse.
  const base = { side: "top", value: 16, inBlockFlow: true, parentIsPlainBlock: true, isEdgeChild: false, parentSeparator: 0, siblingMargin: 24 };
  assert.equal(mayCollapse(base), true);
  assert.equal(mayCollapse({ ...base, siblingMargin: 0 }), false);
  assert.equal(mayCollapse({ ...base, siblingMargin: null, isEdgeChild: true }), true);
  assert.equal(mayCollapse({ ...base, siblingMargin: null, isEdgeChild: true, parentSeparator: 1 }), false);
  assert.equal(mayCollapse({ ...base, parentIsPlainBlock: false }), false);
  assert.equal(mayCollapse({ ...base, value: 0 }), false);
});

test("layer ownership (spec 14.5): Box and Lines layers are disjoint and cover every layer", () => {
  assert.deepEqual(layersFor("box").sort(), ["gap", "ghost", "handle", "hint", "note", "outline", "region-pill", "ring", "token-guide"]);
  assert.deepEqual(layersFor("lines").sort(), ["dashed", "edge", "guide", "measure", "measure-pill"]);
  assert.equal(layersFor("box").length + layersFor("lines").length, OVERLAY_LAYERS.length);
  for (const layer of OVERLAY_LAYERS) assert.notEqual(ownsLayer("box", layer), ownsLayer("lines", layer), layer);
  assert.ok(Object.isFrozen(LAYER_OWNER));
  for (const layer of ["guide", "measure", "measure-pill", "dashed", "edge"]) assert.equal(ownsLayer("box", layer), false, layer);
  // I9: handles and token guides are Box-only; Lines never mounts them.
  // Box selection: 0-side ghost lines and the narrow hint are Box-only too.
  for (const layer of ["ring", "region-pill", "gap", "ghost", "hint", "outline", "handle", "token-guide"]) assert.equal(ownsLayer("lines", layer), false, layer);
});

test("sub-mode toggle and behaviour table (spec 14.4)", () => {
  assert.equal(nextSubMode("box"), "lines");
  assert.equal(nextSubMode("lines"), "box");
  assert.deepEqual(SUB_MODE_BEHAVIOUR.box, { cursor: "default", secondClickMeasures: false, altQuickMeasure: false, escClearsPinsFirst: false });
  assert.deepEqual(SUB_MODE_BEHAVIOUR.lines, { cursor: "crosshair", secondClickMeasures: true, altQuickMeasure: true, escClearsPinsFirst: true });
});

test("region pill labels use human token names, never a bare --spacing variable (spec 14.6)", () => {
  const region = (kind, side, value) => ({ kind, side, value, rect: rect(0, 0, 10, 10), element: {} });
  assert.equal(regionLabel(region("padding", "top", 16), tokenDisplayLabel("--spacing × 4", "p-4")), "p-4 · 16");
  assert.equal(regionLabel(region("padding", "bottom", 8), tokenDisplayLabel("--spacing × 2", "pb-2")), "pb-2 · 8");
  assert.equal(regionLabel(region("gap", "row", 8), tokenDisplayLabel("--spacing × 2", "gap-2")), "gap-2 · 8");
  assert.equal(regionLabel(region("margin", "top", -8), tokenDisplayLabel("--spacing × 2", "-mt-2")), "-mt-2 · -8");
  for (const label of [regionLabel(region("padding", "top", 16), tokenDisplayLabel("--spacing × 4")), regionLabel(region("padding", "top", 4), tokenDisplayLabel("--spacing"))]) {
    assert.ok(!label.startsWith("--") && !/--spacing(?![\w-])/.test(label), label);
  }
  // Unknown token: the px value with a `?` hint (spec 14.6).
  assert.equal(regionLabel(region("padding", "top", 13)), "13 ?");
});
