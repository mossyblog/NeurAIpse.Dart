import { strict as assert } from "node:assert";
import { test } from "node:test";
import { groupByKey, isTextCandidate, primaryFamily, rawTypeValue, sameTokenKey, signatureLabel, stepTypeValue, typeGroupName, typeSignature } from "../dist/core/index.js";

const style = (over = {}) => ({
  "font-family": '"Geist", "Geist Fallback"',
  "font-size": "14px",
  "line-height": "20px",
  "font-weight": "500",
  "letter-spacing": "normal",
  ...over,
});

test("signature key: exact computed strings, normal kept as normal", () => {
  // INTENTION: spec 4 group key = family | size | line-height | weight | letter-spacing,
  // compared exactly; token names are never part of the default key.
  assert.equal(typeSignature(style()), '"Geist", "Geist Fallback"|14px|20px|500|normal');
  assert.notEqual(typeSignature(style()), typeSignature(style({ "line-height": "normal" })));
  assert.notEqual(typeSignature(style()), typeSignature(style({ "font-family": '"Geist"' })), "the full family list is compared");
});

test("same-token key groups by token names; unknown font-size tokens are excluded", () => {
  // INTENTION: spec 4 "Same token only": elements without a font-size token are counted
  // separately as unknown, and a property without a token falls back to its value.
  const tokens = { "font-size": "--text-sm", "line-height": "--text-sm--line-height", "font-weight": "--font-weight-medium" };
  assert.equal(sameTokenKey(style(), tokens), '="Geist", "Geist Fallback"|--text-sm|--text-sm--line-height|--font-weight-medium|=normal');
  assert.equal(sameTokenKey(style(), { "line-height": "--x" }), null);
  const { groups, unknown } = groupByKey(["a", "b", "c", "d"], (x) => (x === "d" ? null : x === "c" ? "k2" : "k1"));
  assert.deepEqual([...groups], [["k1", ["a", "b"]], ["k2", ["c"]]]);
  assert.deepEqual(unknown, ["d"]);
});

test("candidate filter: direct text, visible, never the overlay or script/style", () => {
  // INTENTION: spec 4 candidates and skip list.
  const base = { tag: "span", hasDirectText: true, display: "inline", visibility: "visible", width: 10, height: 10, overlay: false };
  assert.equal(isTextCandidate(base), true);
  assert.equal(isTextCandidate({ ...base, hasDirectText: false }), false, "parents of text-only descendants are not candidates");
  assert.equal(isTextCandidate({ ...base, overlay: true }), false);
  assert.equal(isTextCandidate({ ...base, tag: "SCRIPT" }), false);
  assert.equal(isTextCandidate({ ...base, tag: "style" }), false);
  assert.equal(isTextCandidate({ ...base, display: "none" }), false);
  assert.equal(isTextCandidate({ ...base, visibility: "hidden" }), false);
  assert.equal(isTextCandidate({ ...base, width: 0 }), false);
});

test("labels: signature line, group name from the size token", () => {
  // INTENTION: spec 7.2 `- Signature: Inter, 14px / 20px, 500, 0` and `Type · text-sm`.
  assert.equal(signatureLabel(style()), "Geist, 14px / 20px, 500, 0");
  assert.equal(signatureLabel(style({ "letter-spacing": "-0.35px" })), "Geist, 14px / 20px, 500, -0.35px");
  assert.equal(primaryFamily("Inter, sans-serif"), "Inter");
  assert.equal(typeGroupName(style(), "--text-sm"), "text-sm");
  assert.equal(typeGroupName(style()), "14px / 20px");
});

test("type steppers and raw input", () => {
  // INTENTION: size ±2 (Shift ±1), line-height ±4 (Shift ±1), weight ±100 snapped to
  // hundreds and clamped 1-1000, tracking ±0.5px; invalid raw input is rejected.
  assert.equal(stepTypeValue("font-size", 14, 1), 16);
  assert.equal(stepTypeValue("font-size", 14, -1, true), 13);
  assert.equal(stepTypeValue("font-size", 1, -1), 1);
  assert.equal(stepTypeValue("line-height", 20, 1), 24);
  assert.equal(stepTypeValue("font-weight", 450, 1), 600);
  assert.equal(stepTypeValue("font-weight", 950, 1), 1000);
  assert.equal(stepTypeValue("font-weight", 500, 1, true), 510);
  assert.equal(stepTypeValue("letter-spacing", 0, -1), -0.5);
  assert.equal(rawTypeValue("font-size", "16"), "16px");
  assert.equal(rawTypeValue("font-size", "0"), null);
  assert.equal(rawTypeValue("font-weight", "550"), "550");
  assert.equal(rawTypeValue("font-weight", "1200"), null);
  assert.equal(rawTypeValue("line-height", "1.5", ""), "1.5");
  assert.equal(rawTypeValue("letter-spacing", "0.02", "em"), "0.02em");
  assert.equal(rawTypeValue("font-size", "abc"), null);
});
