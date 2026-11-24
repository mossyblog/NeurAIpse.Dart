import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPreviewCss,
  createPreview,
  isSafeCssValue,
  rawValue,
  resolveLength,
  spacingStyleChange,
  spacingTokens,
  stepSpacing,
  tokenId,
} from "../dist/core/index.js";

test("spacing tokens come from the runtime --spacing base, grid steps first", () => {
  // INTENTION: the dropdown is derived from the custom properties read off :root, not a
  // hardcoded list. The Tailwind base 0.25rem gives multiples; on-grid (0, 8, 16, ...)
  // come first, then the rare 4px step; off-grid multiples (12px) are not offered.
  const tokens = spacingTokens({ "--spacing": ".25rem" }, 16, 32);
  assert.deepEqual(tokens.map((t) => [t.name, t.px]), [
    ["--spacing × 0", 0],
    ["--spacing × 2", 8],
    ["--spacing × 4", 16],
    ["--spacing × 6", 24],
    ["--spacing × 8", 32],
    ["--spacing × 1", 4],
  ]);
  assert.equal(tokens[2].value, "calc(var(--spacing) * 4)");
  assert.equal(tokens[2].utility, "4");
  assert.equal(tokenId(tokens[2]), "--spacing*4");
  // A different base changes the scale: proves the values are read, not assumed.
  assert.deepEqual(spacingTokens({ "--spacing": "8px" }, 16, 24).map((t) => t.px), [0, 8, 16, 24]);
  assert.deepEqual(spacingTokens({}, 16), []);
});

test("named --spacing-* tokens are listed with their resolved px", () => {
  // INTENTION: a design system with named steps gets them in the dropdown too.
  const tokens = spacingTokens({ "--spacing-lg": "1.5rem", "--spacing-odd": "14px", "--color-x": "red" }, 16);
  assert.deepEqual(tokens.map((t) => [t.token, t.px, t.onGrid]), [["--spacing-lg", 24, true], ["--spacing-odd", 14, false]]);
  assert.equal(tokens[0].value, "var(--spacing-lg)");
});

test("length resolution", () => {
  // INTENTION: live px readouts resolve rem/em against the root font size.
  assert.equal(resolveLength(".25rem", 16), 4);
  assert.equal(resolveLength("1.5em", 20), 30);
  assert.equal(resolveLength("12px"), 12);
  assert.equal(resolveLength("0"), 0);
  assert.equal(resolveLength("calc(1px + 2px)"), undefined);
});

test("stepper: ±8 on grid, snaps off-grid values first, ±1 fine", () => {
  // INTENTION: spec 6 stepper. 14 steps up to 16 and down to 8 (snap), then moves by 8;
  // Shift moves by 1 without snapping; padding/gap never go below 0, margins may.
  assert.equal(stepSpacing(16, 1), 24);
  assert.equal(stepSpacing(16, -1), 8);
  assert.equal(stepSpacing(14, 1), 16);
  assert.equal(stepSpacing(14, -1), 8);
  assert.equal(stepSpacing(14, 1, true), 15);
  assert.equal(stepSpacing(0, -1, false, 0), 0);
  assert.equal(stepSpacing(0, -1), -8);
});

test("raw input validation", () => {
  // INTENTION: typed values become CSS lengths in the chosen unit; negatives only for margins.
  assert.equal(rawValue("24", "px", "padding-top"), "24px");
  assert.equal(rawValue("1.5", "rem", "margin-left"), "1.5rem");
  assert.equal(rawValue("-8", "px", "margin-left"), "-8px");
  assert.equal(rawValue("-8", "px", "padding-left"), null);
  assert.equal(rawValue("abc", "px", "padding-left"), null);
  assert.equal(rawValue("", "px", "padding-left"), null);
});

test("preview CSS: one layered, important rule per group", () => {
  // INTENTION: spec 6 + risk 7. Rules are keyed by data-annotate-group only, sit in the
  // annotate-preview layer, carry !important, and unsafe values are dropped so the
  // generated sheet cannot be broken out of.
  const css = buildPreviewCss([
    { group: "g1", property: "padding-top", value: "24px" },
    { group: "g1", property: "padding-left", value: "calc(var(--spacing) * 4)" },
    { group: "g2", property: "row-gap", value: "8px" },
    { group: "g2", property: "column-gap", value: "1px} body{display:none" },
  ]);
  assert.equal(css, [
    "@layer annotate-preview {",
    '  [data-annotate-group="g1"] { padding-top: 24px !important; padding-left: calc(var(--spacing) * 4) !important; }',
    '  [data-annotate-group="g2"] { row-gap: 8px !important; }',
    "}",
    "",
  ].join("\n"));
  assert.equal(buildPreviewCss([]), "");
  assert.equal(isSafeCssValue("8px !important"), false);
});

/** Minimal DOM: elements with attributes, a head that holds style nodes. */
function fakeDocument() {
  const head = { children: [], get firstChild() { return this.children[0] ?? null; }, insertBefore(node, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(node); else this.children.splice(i, 0, node); node.parent = this; } };
  const elements = [];
  const makeEl = () => {
    const el = { attrs: new Map(), setAttribute(n, v) { this.attrs.set(n, String(v)); }, removeAttribute(n) { this.attrs.delete(n); }, getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; } };
    elements.push(el);
    return el;
  };
  const doc = {
    head,
    createElement() {
      const el = makeEl();
      el.textContent = "";
      el.remove = function () { const i = head.children.indexOf(this); if (i >= 0) head.children.splice(i, 1); this.parent = null; };
      Object.defineProperty(el, "isConnected", { get() { return Boolean(this.parent); } });
      return el;
    },
    querySelectorAll(sel) {
      const name = /\[([\w-]+)\]/.exec(sel)[1];
      return elements.filter((el) => el.attrs.has(name));
    },
  };
  return { doc, makeEl, head };
}

test("preview manager: one style first in head, group attributes, idempotent revert", () => {
  // INTENTION: spec 6 revert + I4 acceptance. Applying writes exactly one style element
  // and one attribute per element; re-applying reuses them; revert removes every trace
  // and is safe to repeat (Esc, Clear, mode switch and exit may all fire).
  const { doc, makeEl, head } = fakeDocument();
  const pageStyle = { existing: true };
  head.children.push(pageStyle);
  const a = makeEl();
  const b = makeEl();
  const preview = createPreview(doc);
  preview.apply([{ element: a, property: "padding-top", value: "24px" }, { element: b, property: "margin-left", value: "8px" }]);
  assert.equal(head.children.length, 2);
  assert.equal(head.children[0].getAttribute("data-annotate-preview"), "");
  assert.equal(a.getAttribute("data-annotate-group"), "g1");
  assert.equal(b.getAttribute("data-annotate-group"), "g2");
  assert.match(head.children[0].textContent, /\[data-annotate-group="g1"\] \{ padding-top: 24px !important; \}/);
  // Re-apply with b dropped: same style node, b's attribute removed.
  const style = head.children[0];
  preview.apply([{ element: a, property: "padding-top", value: "32px" }]);
  assert.equal(head.children[0], style);
  assert.equal(b.getAttribute("data-annotate-group"), null);
  assert.match(style.textContent, /32px/);
  preview.revert();
  preview.revert();
  assert.deepEqual(head.children, [pageStyle]);
  assert.equal(a.getAttribute("data-annotate-group"), null);
  // Empty apply is a revert too.
  preview.apply([{ element: a, property: "padding-top", value: "8px" }]);
  preview.apply([]);
  assert.deepEqual(head.children, [pageStyle]);
  assert.equal(a.getAttribute("data-annotate-group"), null);
});

test("style change records match the spec 7.4 shape", () => {
  // INTENTION: records are what the I7 serializer will read; the live element is replaced
  // by its selector so a record is plain data (storable, comparable).
  const region = { kind: "padding", side: "top", rect: { x: 1, y: 2, width: 3, height: 4 }, value: 8, element: { live: true } };
  const change = spacingStyleChange({ region, selector: "main > div.card", from: { value: "8px", token: "--spacing × 2" }, to: { value: "24px", token: "--spacing × 6" } });
  assert.deepEqual(change, {
    category: "spacing",
    property: "padding-top",
    from: { value: "8px", token: "--spacing × 2" },
    to: { value: "24px", token: "--spacing × 6" },
    region: { kind: "padding", side: "top", rect: { x: 1, y: 2, width: 3, height: 4 }, value: 8, element: "main > div.card" },
    group: { count: 1, selectors: ["main > div.card"] },
  });
  assert.doesNotThrow(() => JSON.stringify(change));
});

test("M toggles the spacing inspector; X clears pending style changes", async () => {
  // INTENTION: inspector spec 2. M is free (existing keys P L H C X S) and follows the same
  // gating as every single key; X must reach style changes even with no annotations, so
  // the preview can always be reverted from the keyboard. Since I7 style changes are in
  // the Copy output, so C works with style changes alone (was null before I7).
  const { resolveShortcut } = await import("../dist/core/index.js");
  const key = (k, extra = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, ...extra });
  const state = (extra = {}) => ({ active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 0, ...extra });
  assert.equal(resolveShortcut(key("m"), state()), "spacing");
  assert.equal(resolveShortcut(key("M"), state()), "spacing");
  assert.equal(resolveShortcut(key("m"), state({ editableTarget: true })), null);
  assert.equal(resolveShortcut(key("m", { metaKey: true }), state()), null);
  assert.equal(resolveShortcut(key("m", { repeat: true }), state()), null);
  assert.equal(resolveShortcut(key("m"), state({ enableKeyboardShortcuts: false })), null);
  assert.equal(resolveShortcut(key("x"), state()), null);
  assert.equal(resolveShortcut(key("x"), state({ styleChangeCount: 1 })), "clear");
  assert.equal(resolveShortcut(key("c"), state({ styleChangeCount: 1 })), "copy");
  assert.equal(resolveShortcut(key("c"), state()), null);
});

test("T toggles the type inspector and K the colour inspector (C stays Copy)", async () => {
  // INTENTION: inspector spec 2 + I8. T and K are free keys with the standard gating;
  // H (hide markers) still needs feedback annotations, style changes alone do not count.
  const { resolveShortcut } = await import("../dist/core/index.js");
  const key = (k, extra = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, ...extra });
  const state = (extra = {}) => ({ active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 0, ...extra });
  assert.equal(resolveShortcut(key("t"), state()), "type");
  assert.equal(resolveShortcut(key("K"), state()), "color");
  assert.equal(resolveShortcut(key("k"), state({ editableTarget: true })), null);
  assert.equal(resolveShortcut(key("t", { ctrlKey: true }), state()), null);
  assert.equal(resolveShortcut(key("h"), state({ styleChangeCount: 2 })), "hide");
  assert.equal(resolveShortcut(key("s"), state({ styleChangeCount: 1, canSend: true })), "send");
});

test("preview groups: members share one attribute value; overlap gets its own; removal reverts", () => {
  // INTENTION: I6 spec 6 keying. A type group's members carry one data-annotate-group
  // value and one rule; a member that is also in a spacing change gets a combined value
  // whose rule holds both declarations; dropping the type group leaves only the spacing
  // change, and an empty apply removes every attribute.
  const { doc, makeEl, head } = fakeDocument();
  const [a, b, c] = [makeEl(), makeEl(), makeEl()];
  const preview = createPreview(doc);
  preview.apply([
    { element: a, property: "font-size", value: "var(--text-base)", key: "t1" },
    { element: b, property: "font-size", value: "var(--text-base)", key: "t1" },
    { element: c, property: "font-size", value: "var(--text-base)", key: "t1" },
    { element: c, property: "padding-top", value: "24px" },
  ]);
  const ga = a.getAttribute("data-annotate-group");
  assert.equal(b.getAttribute("data-annotate-group"), ga);
  assert.notEqual(c.getAttribute("data-annotate-group"), ga);
  const css = head.children[0].textContent;
  assert.match(css, new RegExp(`\\[data-annotate-group="${ga}"\\] \\{ font-size: var\\(--text-base\\) !important; \\}`));
  assert.match(css, new RegExp(`\\[data-annotate-group="${c.getAttribute("data-annotate-group")}"\\] \\{ font-size: var\\(--text-base\\) !important; padding-top: 24px !important; \\}`));
  preview.apply([{ element: c, property: "padding-top", value: "24px" }]);
  assert.equal(a.getAttribute("data-annotate-group"), null);
  assert.equal(b.getAttribute("data-annotate-group"), null);
  assert.doesNotMatch(head.children[0].textContent, /font-size/);
  preview.apply([]);
  assert.equal(c.getAttribute("data-annotate-group"), null);
  assert.equal(head.children.length, 0);
});
