import { strict as assert } from "node:assert";
import { test } from "node:test";
import { guideFor, guideOrientation, measureBetween, primaryDistance } from "../dist/core/index.js";

const rect = (x, y, width, height) => ({ x, y, width, height });
const viewport = { width: 1000, height: 800 };

test("guide orientation follows the region side", () => {
  // INTENTION: spec 3.1. Left/right/column regions are measured horizontally, so their
  // guides are vertical lines; top/bottom/row get horizontal guides.
  for (const side of ["left", "right", "column"]) assert.equal(guideOrientation(side), "vertical");
  for (const side of ["top", "bottom", "row"]) assert.equal(guideOrientation(side), "horizontal");
});

test("guides run across the viewport at both region edges with the value label", () => {
  // INTENTION: the pinned region is shown by two full-length guides bounding the strip,
  // and a zero-thickness strip collapses to one guide.
  const g = guideFor({ side: "left", rect: rect(100, 50, 16, 40), value: 16 }, viewport);
  assert.deepEqual(g.lines, [{ x1: 100, y1: 0, x2: 100, y2: 800 }, { x1: 116, y1: 0, x2: 116, y2: 800 }]);
  assert.equal(g.label, "16");
  const h = guideFor({ side: "row", rect: rect(0, 200, 300, 0), value: -8 }, viewport);
  assert.deepEqual(h.lines, [{ x1: 0, y1: 200, x2: 1000, y2: 200 }]);
  assert.equal(h.label, "-8");
});

test("disjoint, aligned: solid line between nearest edges", () => {
  // INTENTION: spec 3.4 Disjoint. Side-by-side boxes 24px apart sharing their vertical
  // range: one horizontal line, no dashed extensions, distance 24.
  const m = measureBetween(rect(0, 0, 100, 50), rect(124, 10, 50, 30));
  assert.equal(m.case, "disjoint");
  assert.equal(m.lines.length, 1);
  assert.deepEqual(m.lines[0].line, { x1: 100, y1: 25, x2: 124, y2: 25 });
  assert.equal(m.lines[0].distance, 24);
  assert.deepEqual(m.lines[0].extensions, []);
  assert.equal(primaryDistance(m), 24);
});

test("offset: line through the smaller box with a dashed extension to the other", () => {
  // INTENTION: spec 3.4 Offset (the diagram). Boxes apart on both axes: a line per axis,
  // each with a dashed support line because the boxes do not line up.
  const a = rect(0, 0, 100, 40);
  const b = rect(124, 80, 60, 20);
  const m = measureBetween(a, b);
  assert.equal(m.case, "offset");
  const x = m.lines.find((l) => l.axis === "x");
  const y = m.lines.find((l) => l.axis === "y");
  assert.equal(x.distance, 24);
  assert.equal(y.distance, 40);
  // x line at the centre of B (smaller cross range: 20 < 40): y = 90; dashed from A's
  // bottom (40) down to 90 at A's right edge.
  assert.deepEqual(x.line, { x1: 100, y1: 90, x2: 124, y2: 90 });
  assert.deepEqual(x.extensions, [{ x1: 100, y1: 40, x2: 100, y2: 90 }]);
  // y line at the centre of B's x range (60 < 100): x = 154; dashed from A's right (100).
  assert.deepEqual(y.line, { x1: 154, y1: 40, x2: 154, y2: 80 });
  assert.deepEqual(y.extensions, [{ x1: 100, y1: 40, x2: 154, y2: 40 }]);
});

test("inside: inset per side", () => {
  // INTENTION: spec 3.4 Inside. A child inside its parent reports the four insets; the
  // order of the arguments does not matter.
  const outer = rect(0, 0, 200, 100);
  const inner = rect(16, 8, 160, 60);
  for (const m of [measureBetween(outer, inner), measureBetween(inner, outer)]) {
    assert.equal(m.case, "inside");
    assert.deepEqual(m.lines.map((l) => [l.axis, l.distance]), [["x", 16], ["x", 24], ["y", 8], ["y", 32]]);
  }
});

test("overlap: negative distance across the overlap", () => {
  // INTENTION: spec 3.4 Overlap. Partially overlapping boxes report the overlap size
  // prefixed with `-` on each axis where they partially overlap.
  const m = measureBetween(rect(0, 0, 100, 100), rect(80, 70, 100, 100));
  assert.equal(m.case, "overlap");
  assert.deepEqual(m.lines.map((l) => [l.axis, l.distance, l.label]), [["x", -20, "-20"], ["y", -30, "-30"]]);
});

test("same edge: label 0 and no line", () => {
  // INTENTION: spec 3.4 Same edge. Touching boxes report 0 with a zero-length segment.
  const m = measureBetween(rect(0, 0, 100, 50), rect(100, 0, 40, 50));
  assert.equal(m.case, "same-edge");
  assert.equal(m.lines.length, 1);
  assert.equal(m.lines[0].label, "0");
  const { x1, x2, y1, y2 } = m.lines[0].line;
  assert.equal(Math.hypot(x2 - x1, y2 - y1), 0);
});
