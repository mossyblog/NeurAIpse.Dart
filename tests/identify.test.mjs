import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  captureElement,
  closestCrossingShadow,
  copyWithExecCommand,
  escapeAttributeValue,
  getElementClasses,
  getElementPath,
  getIdentifyingAttributes,
  getNearbyText,
  getShadowHost,
  identifyElement,
  isEditableElement,
  isInShadowDOM,
  normalizeAttributeNames,
  stripModuleHash,
} from "../dist/core/index.js";

let dom;
let document;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/settings" });
  document = dom.window.document;
});

afterEach(() => dom.window.close());

function html(markup) {
  document.body.innerHTML = markup;
  return document.body;
}

test("path prefers data-* attributes and matches the spec example", () => {
  html('<main><form><button data-testid="save">Save</button></form></main>');
  const button = document.querySelector("button");
  assert.equal(getElementPath(button), 'main > form > button[data-testid="save"]');
  assert.deepEqual(identifyElement(button), {
    name: 'button "Save"',
    path: 'main > form > button[data-testid="save"]',
  });
});

test("path uses at most two short data-* values and escapes quotes and backslashes", () => {
  html(`<div><span data-testid='a"b\\c' data-test="t" data-qa="q" data-cy="${"y".repeat(65)}">x</span></div>`);
  const span = document.querySelector("span");
  assert.equal(getElementPath(span, 1), 'span[data-testid="a\\"b\\\\c"][data-test="t"]');
  assert.equal(escapeAttributeValue('"\\'), '\\"\\\\');
  html(`<div><span data-cy="${"y".repeat(65)}" data-qa="q">x</span></div>`);
  assert.equal(getElementPath(document.querySelector("span"), 1), 'span[data-qa="q"]');
});

test("path falls back to id (ending the walk) then nth-of-type, capped by depth", () => {
  html('<section id="panel"><ul><li>a</li><li><a href="#">b</a></li></ul></section>');
  const link = document.querySelector("a");
  assert.equal(getElementPath(link), "section#panel > ul > li:nth-of-type(2) > a");
  assert.equal(getElementPath(link, 2), "li:nth-of-type(2) > a");
  html('<div id=":r1:"><p>x</p></div>');
  assert.equal(getElementPath(document.querySelector("p")), "div > p");
});

test("path crosses shadow roots and shadow helpers resolve the host", () => {
  html('<nav><x-card data-component="card"></x-card></nav>');
  const host = document.querySelector("x-card");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<div class="inner"><button>Go</button></div>';
  const button = shadow.querySelector("button");
  assert.equal(getElementPath(button), 'nav > x-card[data-component="card"] > div > button');
  assert.equal(isInShadowDOM(button), true);
  assert.equal(isInShadowDOM(host), false);
  assert.equal(getShadowHost(button), host);
  assert.equal(getShadowHost(host), null);
  assert.equal(closestCrossingShadow(button, "nav"), document.querySelector("nav"));
  assert.equal(closestCrossingShadow(button, "aside"), null);
});

test("custom identifying attributes are capped at 16 and long values ignored", () => {
  const names = normalizeAttributeNames(
    Array.from({ length: 20 }, (_, i) => `data-a${i}`),
    ["data-extra"],
  );
  assert.equal(names.length, 16);
  assert.equal(names.at(-1), "data-extra");
  assert.deepEqual(normalizeAttributeNames(undefined, ["data-track", "data-testid", null]), [
    "data-test", "data-qa", "data-cy", "data-component", "data-track", "data-testid",
  ]);
  html(`<b data-testid="ok" data-qa="${"q".repeat(501)}">x</b>`);
  assert.deepEqual(getIdentifyingAttributes(document.querySelector("b")), { "data-testid": "ok" });
  html("<b>x</b>");
  assert.equal(getIdentifyingAttributes(document.querySelector("b")), undefined);
});

test("css-module hashes are stripped from class names", () => {
  assert.equal(stripModuleHash("btn_a1b2c"), "btn");
  assert.equal(stripModuleHash("Card_root__x9Y2z"), "Card_root");
  assert.equal(stripModuleHash("page-module__H5fV9a__main"), "main");
  assert.equal(stripModuleHash("nav_items"), "nav_items");
  assert.equal(stripModuleHash("px-2"), "px-2");
  html('<div class="btn_a1b2c btn_z9y8x  primary">x</div>');
  assert.equal(getElementClasses(document.querySelector("div")), "btn primary");
});

test("element names describe common controls", () => {
  html(`
    <nav><a href="/billing">Billing</a></nav>
    <a href="/x">Plain</a>
    <input type="email" placeholder="Email">
    <img alt="Logo">
    <h2>Title</h2>
    <p>${"Long text ".repeat(10)}</p>
    <div class="card_a1b2c"><span>a</span></div>`);
  const names = ["nav a", "body > a", "input", "img", "h2", "p", "div"].map(
    (selector) => identifyElement(document.querySelector(selector)).name,
  );
  assert.deepEqual(names, [
    'nav link "Billing"',
    'link "Plain"',
    'email input "Email"',
    'image "Logo"',
    'h2 "Title"',
    `paragraph "${"Long text ".repeat(4)}..."`,
    "div.card",
  ]);
});

test("nearby text uses siblings, or the parent when alone", () => {
  html("<div><label>Name</label><input><small>Required</small></div>");
  assert.equal(getNearbyText(document.querySelector("input")), '[before: "Name"] [after: "Required"]');
  html("<p>Hello <b>world</b></p>");
  assert.equal(getNearbyText(document.querySelector("b")), 'world [parent: "Hello world"]');
});

test("captureElement records identity, page geometry and default attributes", () => {
  html('<main><button data-testid="save" data-other="x" class="btn_a1b2c">Save</button></main>');
  const capture = captureElement(document.querySelector("button"), { x: 512, y: 100 });
  assert.equal(capture.element, 'button "Save"');
  assert.equal(capture.elementPath, 'main > button[data-testid="save"]');
  assert.equal(capture.cssClasses, "btn");
  assert.equal(capture.fullPath, "body > main > button.btn");
  assert.deepEqual(capture.attributes, { "data-testid": "save" });
  assert.equal(capture.x, (512 / dom.window.innerWidth) * 100);
  assert.equal(capture.y, 100);
  assert.deepEqual(capture.boundingBox, { x: 0, y: 0, width: 0, height: 0 });
  assert.match(capture.accessibility, /role=button/);
  assert.equal(capture.isFixed, undefined);
  assert.equal(capture.url, "https://localhost/settings");
});

test("editable targets block single-key shortcuts", () => {
  html('<input><textarea></textarea><select></select><div contenteditable="true"><span>x</span></div><div contenteditable="false">n</div><button>b</button>');
  for (const selector of ["input", "textarea", "select", "span"]) {
    assert.equal(isEditableElement(document.querySelector(selector)), true, selector);
  }
  assert.equal(isEditableElement(document.querySelector('[contenteditable="false"]')), false);
  assert.equal(isEditableElement(document.querySelector("button")), false);
  assert.equal(isEditableElement(null), false);
});

test("execCommand fallback restores focus and field selection", () => {
  html('<input value="hello world">');
  const input = document.querySelector("input");
  input.focus();
  input.setSelectionRange(2, 5);
  let copied = null;
  document.execCommand = (command) => {
    copied = command === "copy" ? document.activeElement.value : null;
    return true;
  };
  assert.equal(copyWithExecCommand("payload", document), true);
  assert.equal(copied, "payload");
  assert.equal(document.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 5]);
  assert.equal(document.querySelectorAll("textarea").length, 0);
});
