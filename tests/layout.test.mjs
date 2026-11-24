import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCopyText,
  componentLabel,
  createPlacement,
  duplicatePlacement,
  formatMetadata,
  generateOutput,
  isPlacement,
  layoutSection,
  moveRect,
  nudgeDelta,
  PALETTE,
  PALETTE_GROUPS,
  placementRect,
  placementsOf,
  rectAround,
  resizeRect,
  RESIZE_HANDLES,
  withoutPlacements,
  withPlacementRect,
  withPlacementText,
} from "../dist/core/index.js";
import { billing, environment, save } from "./fixtures.mjs";
import { spacingChange } from "./style-fixtures.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden-feedback.json", import.meta.url), "utf8"));
const options = { appName: "Demo", environment };
const TIERS = ["compact", "standard", "detailed", "forensic"];
const VW = 1440;

const tooltip = createPlacement({
  id: "p1",
  componentType: "tooltip",
  rect: { x: 360, y: 320, width: 180, height: 40 },
  viewportWidth: VW,
  scrollY: 120,
  timestamp: Date.UTC(2026, 0, 1),
  near: { name: 'button "Save"', path: 'main > form > button[data-testid="save"]' },
  text: "Saves with Cmd+S",
  comment: "Hint above the Save button",
});

const card = createPlacement({
  id: "p2",
  componentType: "card",
  rect: { x: 720, y: 960, width: 280, height: 200 },
  viewportWidth: VW,
  scrollY: 640,
  timestamp: 0,
  near: { name: "section", path: "main > section:nth-of-type(2)" },
});

test("palette lists every spec 10 label plus the basic blocks, each with a default size", () => {
  // INTENTION: spec 10 labels exactly, in their groups; basic blocks decided in this phase.
  const labels = (group) => PALETTE.filter((p) => p.group === group).map((p) => p.label);
  assert.deepEqual(PALETTE_GROUPS, ["Basic", "Controls", "Display", "Sections"]);
  assert.deepEqual(labels("Controls"), ["Dropdown", "Toggle", "Stepper", "Rating", "Checkbox", "Radio", "Slider"]);
  assert.deepEqual(labels("Display"), ["Avatar", "Badge", "Tag", "Breadcrumb", "Pagination", "Progress", "Alert", "Toast", "Notification", "Tooltip", "Stat", "Skeleton", "Chip", "Icon", "Spinner"]);
  assert.deepEqual(labels("Sections"), ["Pricing", "Testimonial", "CTA", "Profile", "Feature", "Team", "Login", "Contact"]);
  assert.deepEqual(labels("Basic"), ["Button", "Input", "Text", "Heading", "Image", "Card", "Navigation", "Table", "List", "Modal"]);
  assert.equal(new Set(PALETTE.map((p) => p.type)).size, PALETTE.length);
  for (const p of PALETTE) assert.ok(p.width >= 16 && p.height >= 16, p.label);
  const tip = PALETTE.find((p) => p.type === "tooltip");
  assert.deepEqual([tip.width, tip.height], [180, 40]);
  assert.equal(componentLabel("cta"), "CTA");
  assert.equal(componentLabel("unknown-x"), "unknown-x");
});

test("createPlacement builds the spec 7 shape: kind, placement payload, % x and document y", () => {
  // INTENTION: spec 7 `placement{componentType,width,height,scrollY,text?}`; x is % of
  // viewport width, y px from document top; element/elementPath name the element under it.
  assert.equal(tooltip.kind, "placement");
  assert.deepEqual(tooltip.placement, { componentType: "tooltip", width: 180, height: 40, scrollY: 120, text: "Saves with Cmd+S" });
  assert.equal(tooltip.x, 25);
  assert.equal(tooltip.y, 320);
  assert.deepEqual(tooltip.boundingBox, { x: 360, y: 320, width: 180, height: 40 });
  assert.equal(tooltip.element, 'button "Save"');
  assert.equal(tooltip.elementPath, 'main > form > button[data-testid="save"]');
  assert.equal("text" in card.placement, false);
  assert.equal(card.comment, "");
  assert.ok(isPlacement(tooltip) && !isPlacement(save));
  assert.deepEqual(placementsOf([save, tooltip, billing]).map((a) => a.id), ["p1"]);
  assert.deepEqual(withoutPlacements([save, tooltip, billing]).map((a) => a.id), ["a1", "a2"]);
});

test("geometry: rect round-trips through %, move clamps at 0, 8-handle resize keeps the opposite edge", () => {
  // INTENTION: positions survive a viewport-relative round-trip; resize obeys the 16px minimum.
  assert.deepEqual(placementRect(tooltip, VW), { x: 360, y: 320, width: 180, height: 40 });
  assert.deepEqual(placementRect(tooltip, 720), { x: 180, y: 320, width: 180, height: 40 });
  assert.deepEqual(moveRect({ x: 4, y: 4, width: 10, height: 10 }, -8, -8), { x: 0, y: 0, width: 10, height: 10 });
  const r = { x: 100, y: 100, width: 100, height: 50 };
  assert.deepEqual(resizeRect(r, "se", 20, 10), { x: 100, y: 100, width: 120, height: 60 });
  assert.deepEqual(resizeRect(r, "nw", 20, 10), { x: 120, y: 110, width: 80, height: 40 });
  assert.deepEqual(resizeRect(r, "e", -500, 0), { x: 100, y: 100, width: 16, height: 50 });
  assert.deepEqual(resizeRect(r, "w", 500, 0), { x: 184, y: 100, width: 16, height: 50 });
  assert.deepEqual(resizeRect(r, "n", 0, -20), { x: 100, y: 80, width: 100, height: 70 });
  assert.deepEqual(resizeRect(r, "s", 999, -999), { x: 100, y: 100, width: 100, height: 16 });
  assert.equal(RESIZE_HANDLES.length, 8);
  assert.deepEqual(rectAround({ x: 100, y: 10 }, { width: 180, height: 40 }), { x: 10, y: 0, width: 180, height: 40 });
  const moved = withPlacementRect(tooltip, { x: 720.4, y: 400.6, width: 200, height: 48 }, VW);
  assert.equal(moved.x, 50);
  assert.equal(moved.y, 401);
  assert.deepEqual([moved.placement.width, moved.placement.height, moved.placement.scrollY], [200, 48, 120]);
});

test("nudge is 8px, Shift 1px; duplicate offsets 16px with a new id; text is trimmed and blank removes it", () => {
  assert.deepEqual(nudgeDelta("ArrowLeft", false), { dx: -8, dy: 0 });
  assert.deepEqual(nudgeDelta("ArrowDown", true), { dx: 0, dy: 1 });
  assert.equal(nudgeDelta("a", false), null);
  const copy = duplicatePlacement({ ...tooltip, _syncedTo: "sig" }, "p9", 5, VW);
  assert.equal(copy.id, "p9");
  assert.equal(copy._syncedTo, undefined);
  assert.deepEqual(placementRect(copy, VW), { x: 376, y: 336, width: 180, height: 40 });
  assert.equal(copy.comment, tooltip.comment);
  assert.equal(withPlacementText(tooltip, "  Hi\nthere ").placement.text, "Hi there");
  assert.equal("text" in withPlacementText(tooltip, "   ").placement, false);
});

const SECTION = {
  compact: [
    "### Layout placements",
    '1. **Tooltip** "Saves with Cmd+S" 180×40px at 25.0% from left, 320px from top, near `main > form > button[data-testid="save"]`: Hint above the Save button',
    "2. **Card** 280×200px at 50.0% from left, 960px from top, near `main > section:nth-of-type(2)`",
  ],
  standard: [
    "### Layout placements",
    "**1. Tooltip** (180×40px)",
    "- Position: 25.0% from left, 320px from top",
    '- Near: `main > form > button[data-testid="save"]`',
    '- Text: "Saves with Cmd+S"',
    "- Comment: Hint above the Save button",
    "**2. Card** (280×200px)",
    "- Position: 50.0% from left, 960px from top",
    "- Near: `main > section:nth-of-type(2)`",
  ],
  detailed: [
    "### Layout placements",
    "**1. Tooltip** (180×40px)",
    "- Position: 25.0% from left, 320px from top",
    '- Near: `main > form > button[data-testid="save"]` (button "Save")',
    '- Text: "Saves with Cmd+S"',
    "- Page box: x:360, y:320 (180×40px)",
    "- Comment: Hint above the Save button",
    "**2. Card** (280×200px)",
    "- Position: 50.0% from left, 960px from top",
    "- Near: `main > section:nth-of-type(2)` (section)",
    "- Page box: x:720, y:960 (280×200px)",
  ],
  forensic: [
    "### Layout placements",
    "**1. Tooltip** (180×40px)",
    "- Position: 25.0% from left, 320px from top",
    '- Near: `main > form > button[data-testid="save"]` (button "Save")',
    '- Text: "Saves with Cmd+S"',
    "- Page box: x:360, y:320 (180×40px)",
    "- Viewport: 1440×900",
    "- Scroll Y at placement: 120px",
    "- Placed: 2026-01-01T00:00:00.000Z",
    "- Comment: Hint above the Save button",
    "**2. Card** (280×200px)",
    "- Position: 50.0% from left, 960px from top",
    "- Near: `main > section:nth-of-type(2)` (section)",
    "- Page box: x:720, y:960 (280×200px)",
    "- Viewport: 1440×900",
    "- Scroll Y at placement: 640px",
  ],
};

test("annotation-only output stays byte-identical to the goldens with placements absent", () => {
  // INTENTION: regression guard: the layout serializer must not touch feedback output.
  for (const tier of TIERS) assert.equal(generateOutput([save, billing], "/settings", tier, options), golden[tier], tier);
  assert.deepEqual(layoutSection([save, billing], "standard"), []);
});

test("placements follow the feedback in their own section, numbered 1..n, at every tier", () => {
  // INTENTION: placements interleaved with feedback leave the feedback text and numbering
  // unchanged; the `### Layout placements` section comes after it, one blank line apart.
  for (const tier of TIERS) {
    const out = generateOutput([tooltip, save, card, billing], "/settings", tier, options);
    assert.equal(out, `${golden[tier]}\n\n${SECTION[tier].join("\n")}`, tier);
  }
});

test("placements come after style changes; style output is unchanged", () => {
  for (const tier of TIERS) {
    const without = generateOutput([save, spacingChange], "/settings", tier, options);
    const withLayout = generateOutput([tooltip, save, spacingChange, card], "/settings", tier, options);
    assert.equal(withLayout, `${without}\n\n${SECTION[tier].join("\n")}`, tier);
  }
});

test("placement-only output is the header plus the layout section", () => {
  const out = generateOutput([card], "/", "standard", { environment });
  assert.equal(out, ["## Page Feedback: /", "**Viewport:** 1440×900", "", "### Layout placements", "**1. Card** (280×200px)", "- Position: 50.0% from left, 960px from top", "- Near: `main > section:nth-of-type(2)`"].join("\n"));
});

test("copyFormat metadata formats ignore placements", () => {
  // INTENTION: spec 6 copyFormat: placements are markdown-only; a list of only placements
  // yields "No matching metadata" (null) rather than writing the clipboard.
  const tagged = { ...tooltip, sourceFile: "x.tsx:1:1", cssClasses: "ghost", attributes: { "data-testid": "tip" } };
  assert.equal(formatMetadata([tagged], "source"), null);
  assert.equal(formatMetadata([tagged], "classes"), null);
  assert.equal(formatMetadata([tagged], { attribute: "data-testid" }), null);
  assert.equal(formatMetadata([tagged, save], "source"), "src/app/settings/form.tsx:42:9");
  assert.equal(buildCopyText([card], "classes", () => "md"), null);
  assert.equal(buildCopyText([card], "markdown", () => "md"), "md");
});
