import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  compareCandidates,
  compareLayers,
  createLayerRegistry,
  cssUnescape,
  listSpecificity,
  pickWinner,
  resolveNestedSelector,
  rightmostKey,
  specificity,
  splitSelectorList,
  UNLAYERED,
  utilityClass,
} from "../dist/core/index.js";

test("specificity: ids, classes, attributes, pseudo-classes, types, pseudo-elements", () => {
  // INTENTION: cascade rank 3 (spec 5.1) depends on an exact specificity calculation.
  // These are the Selectors 4 reference cases; a regression here mis-picks winners.
  assert.deepEqual(specificity("*"), [0, 0, 0]);
  assert.deepEqual(specificity("li"), [0, 0, 1]);
  assert.deepEqual(specificity("ul li"), [0, 0, 2]);
  assert.deepEqual(specificity("ul ol+li"), [0, 0, 3]);
  assert.deepEqual(specificity("h1 + *[rel=up]"), [0, 1, 1]);
  assert.deepEqual(specificity("ul ol li.red"), [0, 1, 3]);
  assert.deepEqual(specificity("li.red.level"), [0, 2, 1]);
  assert.deepEqual(specificity("#x34y"), [1, 0, 0]);
  assert.deepEqual(specificity("#s12:not(FOO)"), [1, 0, 1]);
  assert.deepEqual(specificity("a:hover::before"), [0, 1, 2]);
  assert.deepEqual(specificity("a:before"), [0, 0, 2]);
  assert.deepEqual(specificity("svg|rect"), [0, 0, 1]);
});

test("specificity: :is/:not/:has take the max argument, :where is zero, nth-child of S", () => {
  // INTENTION: modern selectors (Tailwind v4 emits :where and :is) must not be counted
  // as plain pseudo-classes, or utilities would wrongly beat or lose to base styles.
  assert.deepEqual(specificity(":is(#a, .b, c)"), [1, 0, 0]);
  assert.deepEqual(specificity(".x:not(.y, #z)"), [1, 1, 0]);
  assert.deepEqual(specificity("a:has(> img)"), [0, 0, 2]);
  assert.deepEqual(specificity(":where(#a .b) .c"), [0, 1, 0]);
  assert.deepEqual(specificity("li:nth-child(2n+1 of .important)"), [0, 2, 1]);
  assert.deepEqual(specificity("li:nth-child(2n+1)"), [0, 1, 1]);
  assert.deepEqual(specificity("::slotted(span.x)"), [0, 1, 2]);
});

test("specificity: escaped Tailwind class names count as one class", () => {
  // INTENTION: Tailwind arbitrary-value classes contain escaped `[ ] : ( ) . =`; each
  // escape belongs to the identifier, never starts a new simple selector.
  assert.deepEqual(specificity(".data-\\[size\\=sm\\]\\:\\[--card-padding\\:--spacing\\(2\\)\\][data-size=\"sm\"]"), [0, 2, 0]);
  assert.deepEqual(specificity(".gap-y-0\\.5"), [0, 1, 0]);
  assert.deepEqual(specificity(".\\31 0"), [0, 1, 0]);
  assert.equal(cssUnescape("gap-y-0\\.5"), "gap-y-0.5");
  assert.equal(cssUnescape("\\31 0"), "10");
});

test("selector lists split at top-level commas only; list specificity is the max", () => {
  // INTENTION: specificity is computed per selector of a list that actually matches
  // (spec 5.1 rank 3), so the list must split correctly around :is() and strings.
  assert.deepEqual(splitSelectorList("*, ::before, ::after"), ["*", "::before", "::after"]);
  assert.deepEqual(splitSelectorList(':is(a, b) > c, [data-x="1,2"], .p\\,q'), [":is(a, b) > c", '[data-x="1,2"]', ".p\\,q"]);
  assert.deepEqual(listSpecificity("a, #b, .c"), [1, 0, 0]);
});

test("nested selectors resolve against the parent with & as :is()", () => {
  // INTENTION: CSS Nesting rules expose relative selectors; matching and specificity need
  // the composed selector (& = :is(parent), no & = descendant).
  assert.equal(resolveNestedSelector(".card", "&:hover"), ".card:hover");
  assert.equal(resolveNestedSelector(".card", ".title"), ".card .title");
  assert.equal(resolveNestedSelector(".a, .b", "& > .c"), ":is(.a, .b) > .c");
  assert.deepEqual(specificity(resolveNestedSelector("#a, .b", "&.c")), [1, 1, 0]);
});

test("rightmost key buckets: id, then first class, then tag, else any", () => {
  // INTENTION: risk 4. Only rules bucketed under an element's id, classes or tag (plus
  // `any`) are tested with matches(); a wrong key silently drops a matching rule.
  assert.deepEqual(rightmostKey("main > section.card #x.y"), { kind: "id", name: "x" });
  assert.deepEqual(rightmostKey(".card > .p-4:hover"), { kind: "class", name: "p-4" });
  assert.deepEqual(rightmostKey(".gap-y-0\\.5"), { kind: "class", name: "gap-y-0.5" });
  assert.deepEqual(rightmostKey("ul li"), { kind: "tag", name: "li" });
  assert.deepEqual(rightmostKey("*, ::before"), { kind: "any", name: "" });
  assert.deepEqual(rightmostKey(":is(.a, .b)"), { kind: "any", name: "" });
  assert.deepEqual(rightmostKey('[data-slot="card"]'), { kind: "any", name: "" });
  assert.deepEqual(rightmostKey('.x:has(> [data-slot="card-body"])'), { kind: "class", name: "x" });
});

test("utility class names come only from single-class selectors", () => {
  // INTENTION: `p-4 · 16` labels need the utility name; compound selectors are not utilities.
  assert.equal(utilityClass(".p-4"), "p-4");
  assert.equal(utilityClass(".md\\:p-4"), "md:p-4");
  assert.equal(utilityClass(".hover\\:p-4:hover"), "hover:p-4");
  assert.equal(utilityClass(".a .b"), undefined);
  assert.equal(utilityClass("#x"), undefined);
});

const c = (over) => ({ important: false, layer: [UNLAYERED], specificity: [0, 1, 0], order: 1, ...over });

test("cascade: importance beats layers, specificity and order", () => {
  // INTENTION: rank 1. An !important utility wins over an id selector declared later.
  const winner = pickWinner([c({ specificity: [1, 0, 0], order: 9, id: "id" }), c({ important: true, id: "imp" })]);
  assert.equal(winner.id, "imp");
});

test("cascade: inline style beats rules of the same importance only", () => {
  // INTENTION: spec 5.1 note: inline style sits above rules of the same importance; an
  // !important rule still beats a normal inline declaration.
  assert.equal(pickWinner([c({ specificity: [1, 0, 0], id: "rule" }), c({ inline: true, layer: [], specificity: [0, 0, 0], id: "inline" })]).id, "inline");
  assert.equal(pickWinner([c({ important: true, id: "rule" }), c({ inline: true, id: "inline" })]).id, "rule");
  assert.equal(pickWinner([c({ important: true, id: "rule" }), c({ inline: true, important: true, id: "inline" })]).id, "inline");
});

test("cascade: later layer wins, unlayered beats layered; important reverses", () => {
  // INTENTION: rank 2. Layer order decides before specificity, and flips for !important.
  const reg = createLayerRegistry();
  const low = reg.key(reg.enter(reg.root, "low"));
  const high = reg.key(reg.enter(reg.root, "high"));
  const unlayered = reg.key(reg.root);
  assert.equal(pickWinner([c({ layer: low, specificity: [1, 0, 0], id: "low-id" }), c({ layer: high, id: "high-class" })]).id, "high-class");
  assert.equal(pickWinner([c({ layer: high, specificity: [1, 0, 0], id: "high" }), c({ layer: unlayered, id: "unlayered" })]).id, "unlayered");
  assert.equal(pickWinner([c({ layer: low, important: true, id: "low" }), c({ layer: high, important: true, id: "high" })]).id, "low");
  assert.equal(pickWinner([c({ layer: high, important: true, id: "layered" }), c({ layer: unlayered, important: true, id: "unlayered" })]).id, "layered");
});

test("cascade: nested and anonymous layers keep first-declaration order", () => {
  // INTENTION: `@layer a { @layer x {} }` styles lose to styles directly in `a`; a
  // statement `@layer b, a;` fixes the order before the blocks appear; each anonymous
  // layer is a distinct, later layer.
  const reg = createLayerRegistry();
  const b = reg.enter(reg.root, "b");
  const a = reg.enter(reg.root, "a");
  const ax = reg.enter(a, "x");
  assert.ok(compareLayers(reg.key(a), reg.key(b)) > 0, "a declared after b wins");
  assert.ok(compareLayers(reg.key(a), reg.key(ax)) > 0, "direct styles in a beat a.x");
  assert.deepEqual(reg.key(reg.enter(reg.root, "a.x")), reg.key(ax), "dotted name is the same layer");
  const anon1 = reg.enter(reg.root, null);
  const anon2 = reg.enter(reg.root, null);
  assert.ok(compareLayers(reg.key(anon2), reg.key(anon1)) > 0);
  assert.equal(ax.name, "a.x");
});

test("cascade: equal importance and layer fall to specificity, then source order", () => {
  // INTENTION: ranks 3 and 4.
  assert.equal(pickWinner([c({ specificity: [0, 2, 0], order: 1, id: "spec" }), c({ order: 5, id: "later" })]).id, "spec");
  assert.equal(pickWinner([c({ order: 1, id: "first" }), c({ order: 5, id: "later" })]).id, "later");
  assert.ok(compareCandidates(c({ order: 2 }), c({ order: 1 })) > 0);
  assert.equal(pickWinner([]), undefined);
});
