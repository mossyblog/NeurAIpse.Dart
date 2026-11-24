import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AREA_LIMIT,
  SELECTED_TEXT_LIMIT,
  areaLabel,
  buildGroupCapture,
  classifyGesture,
  coverage,
  generateOutput,
  groupLabel,
  isDrag,
  markerAnchor,
  nextDrawingIndex,
  normalizeRect,
  normalizeSelectedText,
  pickAreaTargets,
  placeOnRect,
  rectCenter,
  toggleItem,
  unionRect,
} from "../dist/core/index.js";

const at = (x, y) => ({ x, y });
const rect = (x, y, width, height) => ({ x, y, width, height });

test("gesture classification separates click, text, area and multi", () => {
  // INTENTION: one press-and-release maps to exactly one Annotate mode. Cmd/Ctrl always
  // means multi-select; presses over text belong to native selection; drags elsewhere draw.
  const base = { start: at(0, 0), end: at(0, 0), modifier: false, startedOnText: false, hasSelection: false };
  assert.equal(classifyGesture(base), "click");
  assert.equal(classifyGesture({ ...base, end: at(40, 40) }), "area");
  assert.equal(classifyGesture({ ...base, end: at(40, 40), modifier: true }), "multi");
  assert.equal(classifyGesture({ ...base, startedOnText: true, end: at(40, 0), hasSelection: true }), "text");
  // A drag over text that selected nothing must not fall through to a click annotation.
  assert.equal(classifyGesture({ ...base, startedOnText: true, end: at(40, 0) }), "none");
  assert.equal(classifyGesture({ ...base, startedOnText: true }), "click");
});

test("drag threshold is 8px of travel", () => {
  // INTENTION: tiny pointer jitter during a click must not start an area drag.
  assert.equal(isDrag(at(0, 0), at(5, 5)), false);
  assert.equal(isDrag(at(0, 0), at(8, 0)), true);
});

test("normalizeRect spans two corners in any drag direction", () => {
  // INTENTION: dragging up-left yields the same region as dragging down-right.
  assert.deepEqual(normalizeRect(at(100, 80), at(20, 10)), rect(20, 10, 80, 70));
  assert.deepEqual(normalizeRect(at(20, 10), at(100, 80)), rect(20, 10, 80, 70));
});

test("coverage is the share of an element inside the region", () => {
  // INTENTION: area hit-testing scores elements by how much of them the region covers.
  const region = rect(0, 0, 100, 100);
  assert.equal(coverage(region, rect(10, 10, 20, 20)), 1);
  assert.equal(coverage(region, rect(50, 0, 100, 100)), 0.5);
  assert.equal(coverage(region, rect(200, 200, 10, 10)), 0);
  assert.equal(coverage(region, rect(10, 10, 0, 0)), 0);
});

test("area hit-test keeps mostly-inside elements and drops their descendants", () => {
  // INTENTION: a drawn region selects whole elements that are fully or mostly inside it,
  // reported once at the outermost level, so a card is not listed with all its children.
  const region = rect(0, 0, 200, 200);
  const rects = [
    rect(-100, -100, 1000, 1000), // 0: page container, barely covered
    rect(10, 10, 100, 100), // 1: card, fully inside
    rect(20, 20, 20, 20), // 2: child of card
    rect(150, 150, 100, 100), // 3: 25% inside, rejected
    rect(120, 10, 60, 60), // 4: sibling, fully inside
  ];
  const parents = new Map([[2, 1], [1, 0], [3, 0], [4, 0]]);
  const isInside = (child, ancestor) => {
    for (let p = parents.get(child); p != null; p = parents.get(p)) if (p === ancestor) return true;
    return false;
  };
  assert.deepEqual(pickAreaTargets(region, rects, isInside), [1, 4]);
  assert.deepEqual(pickAreaTargets(rect(500, 500, 10, 10), rects, isInside), []);
});

test("area hit-test stops at the selection limit", () => {
  // INTENTION: a huge drag over a dense page cannot produce an unbounded group.
  const rects = Array.from({ length: AREA_LIMIT + 10 }, (_, i) => rect(i, 0, 1, 1));
  assert.equal(pickAreaTargets(rect(0, 0, 1000, 10), rects, () => false).length, AREA_LIMIT);
  assert.equal(pickAreaTargets(rect(0, 0, 1000, 10), rects, () => false, { limit: 3 }).length, 3);
});

test("area hit-test skips the container the drag started on, and excluded elements", () => {
  // INTENTION: drawing inside a container (starting on its padding) selects its children,
  // not the container itself, even when the region covers most of it. The exclude hook
  // (used for occluded elements) only rejects, it never adds.
  const region = rect(8, 8, 544, 104); // 84% of the container below
  const rects = [
    rect(0, 0, 560, 120), // 0: container under the drag start
    rect(32, 32, 120, 56), // 1: child
    rect(184, 32, 120, 56), // 2: child
    rect(336, 32, 120, 56), // 3: child, occluded
  ];
  const isInside = (child, ancestor) => ancestor === 0 && child > 0;
  assert.deepEqual(pickAreaTargets(region, rects, isInside), [0]);
  assert.deepEqual(pickAreaTargets(region, rects, isInside, { start: at(10, 10) }), [1, 2, 3]);
  assert.deepEqual(
    pickAreaTargets(region, rects, isInside, { start: at(10, 10), exclude: (i) => i === 3 }),
    [1, 2],
  );
});

test("unionRect and rectCenter give multi-select group geometry", () => {
  // INTENTION: the group bounding box is the smallest rect around every selected element.
  assert.equal(unionRect([]), null);
  const union = unionRect([rect(10, 20, 30, 40), rect(100, 0, 10, 10)]);
  assert.deepEqual(union, rect(10, 0, 100, 60));
  assert.deepEqual(rectCenter(union), at(60, 30));
});

test("Cmd/Ctrl+click toggles membership in the pending group", () => {
  // INTENTION: clicking an already-selected element again removes it, keeping order.
  assert.deepEqual(toggleItem(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleItem(["a", "b", "c"], "b"), ["a", "c"]);
});

test("group, area and drawing labels", () => {
  // INTENTION: popup header for groups is "N elements" (spec 3.1); empty areas get a
  // size label; drawing indices are 1-based and continue after the highest on the route.
  assert.equal(groupLabel(3), "3 elements");
  assert.equal(areaLabel(rect(0, 0, 320.4, 199.6)), "area 320×200");
  assert.equal(nextDrawingIndex([]), 1);
  assert.equal(nextDrawingIndex([{ drawingIndex: 2 }, {}, { drawingIndex: 5 }]), 6);
});

test("selected text is whitespace-collapsed and capped", () => {
  // INTENTION: selectedText is stable single-line text and cannot bloat the output.
  assert.equal(normalizeSelectedText("  Save\n\t changes "), "Save changes");
  const long = normalizeSelectedText("x".repeat(SELECTED_TEXT_LIMIT + 50));
  assert.equal(long.length, SELECTED_TEXT_LIMIT + 3);
  assert.ok(long.endsWith("..."));
});

const captureA = {
  x: 10, y: 100, element: 'button "Save"', elementPath: "form > button:nth-of-type(1)",
  boundingBox: rect(0, 80, 80, 40), fullPath: "body > form > button", cssClasses: "btn",
  attributes: { "data-testid": "save" }, isFixed: true,
};
const captureB = {
  x: 20, y: 100, element: 'button "Cancel"', elementPath: "form > button:nth-of-type(2)",
  boundingBox: rect(100, 80, 80, 40), fullPath: "body > form > button:nth-of-type(2)",
  attributes: { "data-testid": "cancel", "data-qa": "cancel" },
};

test("group capture sets isMultiSelect, elementBoundingBoxes and union geometry", () => {
  // INTENTION: a multi-select annotation records every element's box as a snapshot, a
  // union bounding box, "N elements", joined paths, and forensic data from the first.
  const group = buildGroupCapture([captureA, captureB], at(25, 120));
  assert.equal(group.isMultiSelect, true);
  assert.equal(group.element, "2 elements");
  assert.equal(group.elementPath, "form > button:nth-of-type(1), form > button:nth-of-type(2)");
  assert.deepEqual(group.elementBoundingBoxes, [captureA.boundingBox, captureB.boundingBox]);
  assert.deepEqual(group.boundingBox, rect(0, 80, 180, 40));
  assert.equal(group.fullPath, captureA.fullPath);
  assert.deepEqual([group.x, group.y], [25, 120]);
  // First element wins per attribute; others fill gaps.
  assert.deepEqual(group.attributes, { "data-testid": "save", "data-qa": "cancel" });
  // Fixed only when every element is fixed.
  assert.equal(group.isFixed, undefined);
});

test("group capture of one element (area with a single hit) stays a single target", () => {
  // INTENTION: an area around one element keeps that element's name, is not marked
  // multi-select, but still records drawingIndex and its snapshot box.
  const single = buildGroupCapture([captureA], at(5, 5), { drawingIndex: 1 });
  assert.equal(single.element, 'button "Save"');
  assert.equal(single.isMultiSelect, undefined);
  assert.equal(single.drawingIndex, 1);
  assert.deepEqual(single.elementBoundingBoxes, [captureA.boundingBox]);
  assert.equal(single.isFixed, true);
  assert.throws(() => buildGroupCapture([], at(0, 0)));
});

test("forensic output of a group shows the first-element note", () => {
  // INTENTION: group captures feed the existing serializer's multi-select branch.
  const group = { ...buildGroupCapture([captureA, captureB], at(25, 120)), id: "g", comment: "Align", timestamp: 0 };
  const out = generateOutput([group], "/p", "forensic", { environment: { viewport: { width: 100, height: 100 } } });
  assert.match(out, /### 1\. 2 elements\n\*Forensic data shown for first element of selection\*/);
});

test("marker anchors follow an element that moves or resizes", () => {
  // INTENTION: a marker keeps its relative spot on its element when the element moves,
  // so tracking re-places it on the new box; snapshots (groups, areas) never track.
  const annotation = { x: 25, y: 150, boundingBox: rect(100, 100, 200, 100) };
  const anchor = markerAnchor(annotation, 800); // marker at 200px, 150px
  assert.deepEqual(anchor, { fx: 0.5, fy: 0.5 });
  assert.deepEqual(placeOnRect(rect(300, 400, 100, 50), anchor), at(350, 425));
  assert.equal(markerAnchor({ ...annotation, isMultiSelect: true }, 800), null);
  assert.equal(markerAnchor({ ...annotation, drawingIndex: 1 }, 800), null);
  assert.equal(markerAnchor({ x: 1, y: 1 }, 800), null);
  // Anchors are clamped to the element box.
  assert.deepEqual(markerAnchor({ x: 0, y: 0, boundingBox: rect(100, 100, 10, 10) }, 800), { fx: 0, fy: 0 });
});
