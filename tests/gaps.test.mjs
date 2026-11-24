import { strict as assert } from "node:assert";
import { test } from "node:test";
import { flexGapRegions, gridGapRegions, groupLines, parseGridTracks } from "../dist/core/index.js";

const rect = (x, y, width, height) => ({ x, y, width, height });
const rects = (regions) => regions.map((r) => [r.side, r.rect.x, r.rect.y, r.rect.width, r.rect.height]);

test("flex row: one column band between each adjacent pair", () => {
  // INTENTION: spec 3.3 single line. Four 40px boxes with gap 16 give three vertical bands
  // exactly 16 wide, spanning the line's cross extent, labelled with the computed gap.
  const children = [0, 1, 2, 3].map((i) => rect(10 + i * 56, 20, 40, 30));
  const regions = flexGapRegions({ content: rect(10, 20, 300, 30), flexDirection: "row", rowGap: 0, columnGap: 16, children }, "c");
  assert.deepEqual(rects(regions), [["column", 50, 20, 16, 30], ["column", 106, 20, 16, 30], ["column", 162, 20, 16, 30]]);
  assert.ok(regions.every((r) => r.kind === "gap" && r.value === 16 && r.measured === undefined && r.element === "c"));
  assert.deepEqual(regions.map((r) => r.index), [0, 1, 2]);
});

test("flex bands use visual order, so reverse, order and rtl need no special case", () => {
  // INTENTION: spec 3.3 direction. Children passed in DOM order but laid out right to left
  // still produce bands between visual neighbours.
  const ltr = [0, 1, 2].map((i) => rect(i * 50, 0, 40, 10));
  const reversed = [...ltr].reverse();
  const a = flexGapRegions({ content: rect(0, 0, 140, 10), flexDirection: "row-reverse", rowGap: 0, columnGap: 10, children: reversed }, "c");
  assert.deepEqual(rects(a), [["column", 40, 0, 10, 10], ["column", 90, 0, 10, 10]]);
});

test("flex column: row bands along the vertical main axis", () => {
  // INTENTION: column direction swaps the main axis: bands are horizontal `row` gaps.
  const children = [0, 1, 2].map((i) => rect(0, i * 48, 100, 32));
  const regions = flexGapRegions({ content: rect(0, 0, 100, 128), flexDirection: "column", rowGap: 16, columnGap: 0, children }, "c");
  assert.deepEqual(rects(regions), [["row", 0, 32, 100, 16], ["row", 0, 80, 100, 16]]);
});

test("wrapped flex: main gaps per line and cross gaps between lines", () => {
  // INTENTION: spec 3.3 wrapped. 7 boxes (3 per line, gap 8px row / 24px column) give
  // 2+2+0 column bands inside lines and 2 row bands spanning the content width.
  const children = [];
  for (let i = 0; i < 7; i++) children.push(rect((i % 3) * 64, Math.floor(i / 3) * 40, 40, 32));
  const regions = flexGapRegions({ content: rect(0, 0, 200, 112), flexDirection: "row", rowGap: 8, columnGap: 24, children }, "c");
  const columns = regions.filter((r) => r.side === "column");
  const rows = regions.filter((r) => r.side === "row");
  assert.equal(columns.length, 4);
  assert.ok(columns.every((r) => r.rect.width === 24 && r.value === 24));
  assert.deepEqual(rects(rows), [["row", 0, 32, 200, 8], ["row", 0, 72, 200, 8]]);
  assert.ok(rows.every((r) => r.value === 8));
});

test("justify-content spacing: label carries measured space and the gap", () => {
  // INTENTION: spec 3.3 gap value. space-between widens the band beyond the gap; both
  // numbers are reported so the user sees the gap is not the whole distance.
  const children = [rect(0, 0, 40, 10), rect(160, 0, 40, 10)];
  const [band] = flexGapRegions({ content: rect(0, 0, 200, 10), flexDirection: "row", rowGap: 0, columnGap: 8, children }, "c");
  assert.equal(band.rect.width, 120);
  assert.equal(band.value, 8);
  assert.equal(band.measured, 120);
});

test("flex skips overlapping neighbours and single children", () => {
  // INTENTION: negative margins can make neighbours overlap; no band is drawn for them.
  const one = flexGapRegions({ content: rect(0, 0, 10, 10), flexDirection: "row", rowGap: 0, columnGap: 8, children: [rect(0, 0, 10, 10)] }, "c");
  assert.equal(one.length, 0);
  const overlap = flexGapRegions({ content: rect(0, 0, 100, 10), flexDirection: "row", rowGap: 0, columnGap: 8, children: [rect(0, 0, 50, 10), rect(40, 0, 50, 10)] }, "c");
  assert.equal(overlap.length, 0);
});

test("line grouping by cross-axis overlap", () => {
  // INTENTION: rects of different heights on one line stay in one line.
  const lines = groupLines([rect(0, 0, 10, 30), rect(20, 10, 10, 10), rect(0, 40, 10, 10)], "y");
  assert.deepEqual(lines.map((l) => l.length), [2, 1]);
});

test("grid tracks parse resolved px, drop line names, reject subgrid", () => {
  // INTENTION: the grid spike relies on Chromium resolving tracks to px (probed: implicit
  // tracks and auto-fill come back expanded). Anything else is reported unsupported.
  assert.deepEqual(parseGridTracks("128px 128px 128px"), { sizes: [128, 128, 128], supported: true });
  assert.deepEqual(parseGridTracks("[s] 50px [m] 100px").sizes, [50, 100]);
  assert.equal(parseGridTracks("subgrid [] [] []").supported, false);
  assert.equal(parseGridTracks("none").supported, false);
  assert.equal(parseGridTracks("1fr 2fr").supported, false);
});

test("grid gap bands span the full track block", () => {
  // INTENTION: spec 3.3 grid spike. 3 columns of 128 with column gap 8 and rows 30/0/18
  // with row gap 24: bands run across all tracks, so a spanning item cannot split them.
  const { regions, supported, approximate } = gridGapRegions({
    content: rect(0, 0, 400, 96),
    gridTemplateColumns: "128px 128px 128px",
    gridTemplateRows: "30px 0px 18px",
    rowGap: 24,
    columnGap: 8,
  }, "g");
  assert.ok(supported && !approximate);
  assert.deepEqual(rects(regions), [
    ["column", 128, 0, 8, 96],
    ["column", 264, 0, 8, 96],
    ["row", 0, 30, 400, 24],
    ["row", 0, 54, 400, 24],
  ]);
});

test("grid alignment offsets, rtl and approximate distribution", () => {
  // INTENTION: justify-content center shifts the track block; rtl mirrors columns from
  // the right edge; space-between cannot be modelled from tracks and is flagged.
  const base = { content: rect(0, 0, 300, 20), gridTemplateColumns: "50px 100px", gridTemplateRows: "20px", rowGap: 0, columnGap: 16 };
  assert.deepEqual(rects(gridGapRegions({ ...base, justifyContent: "center" }, "g").regions), [["column", 117, 0, 16, 20]]);
  assert.deepEqual(rects(gridGapRegions({ ...base, rtl: true }, "g").regions), [["column", 234, 0, 16, 20]]);
  const spaced = gridGapRegions({ ...base, justifyContent: "space-between" }, "g");
  assert.equal(spaced.approximate, true);
  assert.deepEqual(spaced.regions[0].flags, ["approximate"]);
  assert.equal(gridGapRegions({ ...base, gridTemplateColumns: "subgrid" }, "g").supported, false);
});
