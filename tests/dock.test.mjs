import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DOCK_BASE_ICON,
  DOCK_BASE_SIZE,
  DOCK_INFLUENCE_RADIUS,
  DOCK_MAX_ICON,
  DOCK_MAX_PROTRUSION,
  DOCK_MAX_SIZE,
  DOCK_RENDER_SIZE,
  clampNotchCenterY,
  computeDockOffsets,
  dockItemMetrics,
  dockMagnification,
  isDockSide,
  nextDockSide,
  normalizeSettings,
  resolveDraggedSide,
} from "../dist/core/index.js";

test("dockSide normalizes valid values and flips cleanly", () => {
  assert.equal(isDockSide("left"), true);
  assert.equal(isDockSide("right"), true);
  assert.equal(isDockSide("top"), false);
  assert.equal(nextDockSide("right"), "left");
  assert.equal(nextDockSide("left"), "right");
  assert.equal(normalizeSettings({}).dockSide, "right");
  assert.equal(normalizeSettings({ dockSide: "left" }).dockSide, "left");
  assert.equal(normalizeSettings({ dockSide: "bottom" }).dockSide, "right");
});

test("dockMagnification follows a smooth raised-cosine bell curve", () => {
  assert.equal(dockMagnification(0), 1);
  assert.equal(dockMagnification(DOCK_INFLUENCE_RADIUS), 0);
  assert.equal(dockMagnification(-DOCK_INFLUENCE_RADIUS - 20), 0);
  const half = dockMagnification(DOCK_INFLUENCE_RADIUS / 2);
  assert.ok(Math.abs(half - 0.5) < 1e-6, `expected 0.5 at half radius, got ${half}`);
  const near = dockMagnification(16);
  const far = dockMagnification(48);
  assert.ok(near > far && far > 0, "closer icons magnify more than farther neighbors");
  assert.equal(dockMagnification(Number.NaN), 0);
});

test("dockItemMetrics returns compact resting sizes and enlarged hovered sizes", () => {
  const rest = dockItemMetrics(null, 100);
  assert.deepEqual(rest, {
    factor: 0,
    buttonSize: DOCK_BASE_SIZE,
    iconSize: DOCK_BASE_ICON,
    scale: Number((DOCK_BASE_SIZE / DOCK_RENDER_SIZE).toFixed(4)),
    protrusion: 0,
  });

  const peak = dockItemMetrics(100, 100);
  assert.deepEqual(peak, {
    factor: 1,
    buttonSize: DOCK_MAX_SIZE,
    iconSize: DOCK_MAX_ICON,
    scale: Number((DOCK_MAX_SIZE / DOCK_RENDER_SIZE).toFixed(4)),
    protrusion: DOCK_MAX_PROTRUSION,
  });

  const neighbor = dockItemMetrics(100, 128);
  assert.ok(neighbor.factor > 0 && neighbor.factor < 1);
  assert.ok(neighbor.buttonSize > DOCK_BASE_SIZE && neighbor.buttonSize < DOCK_MAX_SIZE);
  assert.ok(neighbor.iconSize > DOCK_BASE_ICON && neighbor.iconSize < DOCK_MAX_ICON);
  assert.ok(neighbor.scale > rest.scale && neighbor.scale < peak.scale);
  assert.ok(neighbor.protrusion > 0 && neighbor.protrusion < DOCK_MAX_PROTRUSION);
});

test("computeDockOffsets spreads neighbors smoothly around the hovered icon without overlap", () => {
  const factors = [0, 0.65, 1, 0.65, 0];
  const offsets = computeDockOffsets(factors, 2);
  assert.equal(offsets[2], 0, "hovered pivot icon stays anchored under the cursor");
  assert.ok(offsets[1] < 0 && offsets[0] <= offsets[1], "icons above glide upward");
  assert.ok(offsets[3] > 0 && offsets[4] >= offsets[3], "icons below glide downward");
  assert.deepEqual(computeDockOffsets([0, 0, 0], 1), [0, 0, 0]);
});

test("clampNotchCenterY keeps the side notch inside viewport bounds", () => {
  assert.equal(clampNotchCenterY(450, 400, 900, 20), 450);
  assert.equal(clampNotchCenterY(10, 400, 900, 20), 220);
  assert.equal(clampNotchCenterY(890, 400, 900, 20), 680);
  // Taller than viewport falls back to vertical center.
  assert.equal(clampNotchCenterY(100, 800, 600, 20), 300);
});

test("resolveDraggedSide flips across viewport midpoint with hysteresis", () => {
  assert.equal(resolveDraggedSide(600, 1000, "right"), "right");
  assert.equal(resolveDraggedSide(480, 1000, "right"), "right");
  assert.equal(resolveDraggedSide(400, 1000, "right"), "left");
  assert.equal(resolveDraggedSide(520, 1000, "left"), "left");
  assert.equal(resolveDraggedSide(600, 1000, "left"), "right");
});
