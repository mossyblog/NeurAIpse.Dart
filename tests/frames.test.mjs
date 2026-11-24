// Phase 4: iframe geometry, shadow-root path crossing, and hash-route storage keys.
import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  IDENTITY,
  applyToPoint,
  applyToRect,
  closestCrossingShadow,
  collectFrameWindows,
  composeTransforms,
  frameContentTransform,
  frameElementsOf,
  framePathFor,
  getElementPath,
  getRouteKey,
  getStorageKey,
  identifyElement,
  intersectRects,
  invertPoint,
  pointInRect,
  querySelectorAllDeep,
  resolveFramePath,
  splitSelectorPath,
} from "../dist/core/index.js";

const metrics = (over = {}) => ({
  rect: { x: 100, y: 50, width: 640, height: 400 },
  offsetWidth: 640,
  offsetHeight: 400,
  borderLeft: 8,
  borderTop: 8,
  paddingLeft: 8,
  paddingTop: 8,
  ...over,
});

test("frameContentTransform adds border and padding to the frame origin", () => {
  // Intent: child (0,0) sits at rect origin + border + padding when unscaled.
  assert.deepEqual(frameContentTransform(metrics()), { x: 116, y: 66, scaleX: 1, scaleY: 1 });
});

test("frameContentTransform handles axis-aligned CSS scaling", () => {
  // Intent: scale = rendered size / layout size, and border/padding scale with it.
  const t = frameContentTransform(metrics({ rect: { x: 0, y: 0, width: 480, height: 200 } }));
  assert.deepEqual(t, { x: 12, y: 8, scaleX: 0.75, scaleY: 0.5 });
  assert.deepEqual(applyToPoint(t, { x: 100, y: 100 }), { x: 87, y: 58 });
  assert.deepEqual(invertPoint(t, { x: 87, y: 58 }), { x: 100, y: 100 });
  assert.deepEqual(applyToRect(t, { x: 0, y: 0, width: 40, height: 40 }), { x: 12, y: 8, width: 30, height: 20 });
});

test("composeTransforms maps nested frames straight to the top viewport", () => {
  // Intent: outer ∘ inner equals applying inner then outer.
  const outer = { x: 10, y: 20, scaleX: 0.5, scaleY: 0.5 };
  const inner = { x: 4, y: 6, scaleX: 2, scaleY: 1 };
  const both = composeTransforms(outer, inner);
  const p = { x: 3, y: 7 };
  assert.deepEqual(applyToPoint(both, p), applyToPoint(outer, applyToPoint(inner, p)));
  assert.deepEqual(composeTransforms(IDENTITY, inner), inner);
});

test("intersectRects and pointInRect drive the out-of-view marker check", () => {
  // Intent: no overlap gives null; the clip test is inclusive at edges.
  assert.deepEqual(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), { x: 5, y: 5, width: 5, height: 5 });
  assert.equal(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 }), null);
  assert.equal(pointInRect({ x: 10, y: 10 }, { x: 0, y: 0, width: 10, height: 10 }), true);
  assert.equal(pointInRect({ x: 11, y: 10 }, { x: 0, y: 0, width: 10, height: 10 }), false);
});

let dom;
let document;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "https://localhost/app" });
  document = dom.window.document;
});
afterEach(() => dom.window.close());

test("splitSelectorPath ignores ' > ' inside attribute values", () => {
  // Intent: a quoted data-* value containing the combinator stays one segment.
  assert.deepEqual(splitSelectorPath('main > button[data-testid="a > b"] > span'), ["main", 'button[data-testid="a > b"]', "span"]);
  assert.deepEqual(splitSelectorPath('a[data-qa="x\\" > y"]'), ['a[data-qa="x\\" > y"]']);
});

test("getElementPath crosses an open shadow root and querySelectorAllDeep finds it again", () => {
  // Intent: marker re-resolution works for elements inside shadow DOM.
  document.body.innerHTML = '<main><div id="host"></div></main>';
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<section class="panel"><p>Before</p><button data-testid="shadow-button">Shadow action</button></section>';
  const button = root.querySelector("button");
  const path = getElementPath(button);
  assert.equal(path, 'div#host > section > button[data-testid="shadow-button"]');
  assert.deepEqual(querySelectorAllDeep(document, path), [button]);
  assert.equal(identifyElement(button).name, 'button "Shadow action"');
  // Intent: closest continues from the shadow root to the host's ancestors.
  assert.equal(closestCrossingShadow(button, "main")?.localName, "main");
  assert.deepEqual(querySelectorAllDeep(document, "main > div#host"), [document.getElementById("host")]);
  assert.deepEqual(querySelectorAllDeep(document, "nope >"), []);
});

function frameDom() {
  document.body.innerHTML = '<iframe id="outer"></iframe><iframe></iframe>';
  const outer = document.getElementById("outer");
  const innerDoc = outer.contentDocument;
  innerDoc.body.innerHTML = '<iframe id="nested"></iframe><button data-testid="frame-button">In frame</button>';
  const nested = innerDoc.getElementById("nested");
  nested.contentDocument.body.innerHTML = "<button>Deep</button>";
  return { outer, innerDoc, nested };
}

test("frame path records index, id and url outermost first, and resolves back", () => {
  // Intent: `frame.path` identifies nested frames and resolveFramePath finds the same document.
  const { innerDoc, nested } = frameDom();
  const deep = nested.contentDocument.querySelector("button");
  assert.deepEqual(frameElementsOf(deep).map((f) => f.id), ["nested", "outer"]);
  const path = framePathFor(deep);
  assert.deepEqual(path.map((p) => [p.index, p.id]), [[0, "outer"], [0, "nested"]]);
  assert.equal(path[0].url, innerDoc.location.href);
  assert.equal(resolveFramePath(document, path), nested.contentDocument);
  assert.equal(collectFrameWindows(document).length, 3);
});

test("resolveFramePath returns null when the frame URL changed (navigation) or the frame is gone", () => {
  // Intent: a navigated or removed frame hides its markers instead of pointing at new content.
  const { outer, nested } = frameDom();
  const path = framePathFor(nested.contentDocument.body);
  assert.equal(resolveFramePath(document, [{ ...path[0], url: "https://localhost/other" }, path[1]]), null);
  outer.remove();
  assert.equal(resolveFramePath(document, path), null);
});

test("hash routing keeps separate buckets and leaves pathname-only data alone", () => {
  // Intent: with useHashLocation each hash is its own bucket; the pathname bucket is the same
  // key as before hash mode (data there is not migrated), and hash is ignored when the mode is off.
  assert.equal(getRouteKey({ pathname: "/app", hash: "#/a" }, true), "feedback-annotations-/app#/a");
  assert.equal(getRouteKey({ pathname: "/app", hash: "#/b" }, true), "feedback-annotations-/app#/b");
  assert.equal(getRouteKey({ pathname: "/app", hash: "" }, true), getStorageKey("/app"));
  assert.equal(getRouteKey({ pathname: "/app", hash: "#/a" }, false), "feedback-annotations-/app");
});
