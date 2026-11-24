import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyResizeSnap,
  buildRearrangeCss,
  constrainAxis,
  distanceLines,
  nearestRelation,
  pastThreshold,
  rearrangeNudge,
  resizeFromHandle,
  resizeSnapLines,
  REARRANGE_HANDLES,
  REARRANGE_ID_ATTRIBUTE,
  resolveShortcut,
  sameRect,
  snapRect,
  translateRect,
} from "../dist/core/index.js";

const box = { x: 100, y: 100, width: 120, height: 40 };

test("eight resize handles; the opposite edge stays put", () => {
  assert.equal(REARRANGE_HANDLES.length, 8);
  assert.deepEqual(resizeFromHandle(box, "e", 40, 99), { x: 100, y: 100, width: 160, height: 40 });
  assert.deepEqual(resizeFromHandle(box, "w", -24, 0), { x: 76, y: 100, width: 144, height: 40 });
  assert.deepEqual(resizeFromHandle(box, "n", 0, 8), { x: 100, y: 108, width: 120, height: 32 });
  assert.deepEqual(resizeFromHandle(box, "se", 8, 16), { x: 100, y: 100, width: 128, height: 56 });
  assert.deepEqual(resizeFromHandle(box, "nw", 8, 8), { x: 108, y: 108, width: 112, height: 32 });
});

test("a resize never goes below 8px and never flips", () => {
  const r = resizeFromHandle(box, "e", -500, 0);
  assert.equal(r.width, 8);
  assert.equal(r.x, 100);
  const l = resizeFromHandle(box, "w", 500, 0);
  assert.equal(l.width, 8);
  assert.equal(l.x + l.width, 220);
});

test("Shift on a corner keeps the aspect ratio", () => {
  const r = resizeFromHandle(box, "se", 120, 0, { keepAspect: true });
  assert.equal(r.width / r.height, 3);
  assert.deepEqual([r.x, r.y], [100, 100]);
  const nw = resizeFromHandle(box, "nw", -120, 0, { keepAspect: true });
  assert.equal(nw.x + nw.width, 220);
  assert.equal(nw.y + nw.height, 140);
});

test("Shift-move keeps the dominant axis; the press threshold separates click from drag", () => {
  assert.deepEqual(constrainAxis(30, -8), { x: 30, y: 0 });
  assert.deepEqual(constrainAxis(3, -8), { x: 0, y: -8 });
  assert.equal(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 4 }), false);
  assert.equal(pastThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }), true);
});

test("arrow nudge is 8px, Shift 1px; other keys are not nudges", () => {
  assert.deepEqual(rearrangeNudge("ArrowRight", false), { x: 8, y: 0 });
  assert.deepEqual(rearrangeNudge("ArrowUp", true), { x: 0, y: -1 });
  assert.equal(rearrangeNudge("a", false), null);
  assert.deepEqual(translateRect(box, 8, -1), { x: 108, y: 99, width: 120, height: 40 });
});

test("snap aligns to the nearest sibling edge or centre within 4px and reports guides", () => {
  const sibling = { x: 300, y: 100, width: 80, height: 40 };
  // Left edge 297 is 3px from the sibling's left edge (300).
  const snap = snapRect({ x: 297, y: 200, width: 80, height: 40 }, [sibling]);
  assert.equal(snap.dx, 3);
  assert.equal(snap.dy, 0);
  assert.ok(snap.guides.some((g) => g.axis === "x" && g.pos === 300 && g.from === 100 && g.to === 240));
  // Centres: 6px away, out of range.
  const far = snapRect({ x: 200, y: 200, width: 80, height: 40 }, [{ x: 400, y: 600, width: 10, height: 10 }]);
  assert.deepEqual([far.dx, far.dy, far.guides.length], [0, 0, 0]);
});

test("resize snapping moves only the dragged edge", () => {
  const lines = resizeSnapLines("e");
  assert.deepEqual(lines, { x: ["end"], y: [] });
  const r = { x: 100, y: 100, width: 197, height: 40 };
  const snap = snapRect(r, [{ x: 300, y: 0, width: 10, height: 10 }], { lines });
  assert.equal(snap.dx, 3);
  assert.deepEqual(applyResizeSnap(r, "e", snap.dx, snap.dy), { x: 100, y: 100, width: 200, height: 40 });
  assert.deepEqual(applyResizeSnap(r, "w", 3, 0), { x: 103, y: 100, width: 194, height: 40 });
});

test("nearest sibling relation: below, right of, overlapping; parent fallback", () => {
  const title = { label: ".title", rect: { x: 0, y: 0, width: 200, height: 40 } };
  const aside = { label: ".aside", rect: { x: 400, y: 200, width: 100, height: 100 } };
  assert.deepEqual(nearestRelation({ x: 0, y: 56, width: 200, height: 40 }, [title, aside]), { label: ".title", relation: "below", distance: 16 });
  assert.deepEqual(nearestRelation({ x: 520, y: 200, width: 40, height: 40 }, [title, aside]), { label: ".aside", relation: "right of", distance: 20 });
  assert.equal(nearestRelation({ x: 10, y: 10, width: 20, height: 20 }, [title]).relation, "overlapping");
  assert.deepEqual(nearestRelation({ x: 32, y: 40, width: 20, height: 20 }, [], { label: ".cards", rect: { x: 0, y: 8, width: 500, height: 500 } }), {
    label: ".cards",
    relation: "inside",
    distance: 0,
    offset: { left: 32, top: 32 },
  });
  assert.equal(nearestRelation(box, []), null);
});

test("distance pills use the measure geometry: closest gap per axis", () => {
  const lines = distanceLines({ x: 0, y: 100, width: 100, height: 40 }, [
    { x: 0, y: 0, width: 100, height: 60 },
    { x: 0, y: 0, width: 100, height: 90 },
    { x: 140, y: 100, width: 40, height: 40 },
  ]);
  assert.deepEqual(lines.map((l) => [l.axis, l.distance]).sort(), [["x", 40], ["y", 10]]);
});

test("sameRect compares rounded px", () => {
  assert.equal(sameRect(box, { ...box, x: 100.4 }), true);
  assert.equal(sameRect(box, { ...box, width: 121 }), false);
});

test("preview CSS: translate, size overrides, hidden removal, inline-block, layer and !important", () => {
  const css = buildRearrangeCss([
    { id: "r1", translate: { x: 24, y: -8 } },
    { id: "r2", translate: { x: 0, y: 0 }, width: 160, height: 56, inline: true },
    { id: "r3", translate: { x: 0, y: 0 }, removed: true },
    { id: "r4", translate: { x: 0, y: 0 } },
    { id: "bad id", translate: { x: 8, y: 0 } },
  ]);
  assert.match(css, /^@layer annotate-rearrange \{/);
  assert.ok(css.includes(`[${REARRANGE_ID_ATTRIBUTE}="r1"] { translate: 24px -8px !important; }`));
  assert.ok(css.includes("width: 160px !important; min-width: 160px !important; max-width: 160px !important; flex-shrink: 0 !important;"));
  assert.ok(css.includes("height: 56px !important;"));
  assert.ok(css.includes("display: inline-block !important;"));
  assert.ok(css.includes(`[${REARRANGE_ID_ATTRIBUTE}="r3"] { visibility: hidden !important; }`));
  assert.ok(!css.includes('"r4"'), "no-op rule dropped");
  assert.ok(!css.includes("bad id"), "unsafe id dropped");
  assert.equal(buildRearrangeCss([{ id: "r1", translate: { x: 0, y: 0 } }]), "");
});

test("R toggles Rearrange; C and X count rearrangements; S sends them", () => {
  const key = (k) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false });
  const state = { active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 0, canSend: true, sendState: "idle" };
  assert.equal(resolveShortcut(key("r"), state), "rearrange");
  assert.equal(resolveShortcut(key("c"), state), null);
  assert.equal(resolveShortcut(key("c"), { ...state, rearrangeCount: 1 }), "copy");
  assert.equal(resolveShortcut(key("x"), { ...state, rearrangeCount: 1 }), "clear");
  assert.equal(resolveShortcut(key("s"), { ...state, rearrangeCount: 1 }), "send");
  assert.equal(resolveShortcut(key("h"), { ...state, rearrangeCount: 1 }), null, "no markers to hide");
});
