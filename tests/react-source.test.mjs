// Phase 4: React component chain and source-file resolution (owner stacks + source maps).
import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  callSiteFrames,
  classifyOrigin,
  cleanFunctionName,
  componentCallSite,
  createSourceResolver,
  decodeMappings,
  decodeVlq,
  filterComponents,
  formatComponentChain,
  formatSourceFile,
  frameForFunction,
  isComponentName,
  isFetchableBundle,
  isTrustworthySourceFile,
  isWrapperNoise,
  originalPositionFor,
  parseStack,
  reactModeForDetail,
  toProjectPath,
} from "../dist/core/index.js";
import { componentName, getReactInfo, readChain, readSourceStamp, resolveReactInfo } from "../dist/react/index.js";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Test-side VLQ encoder, independent of the decoder under test. */
function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v) digit |= 32;
    out += B64[digit];
  } while (v);
  return out;
}
const seg = (...fields) => fields.map(vlq).join("");

const ORIGIN = "https://app.test";
const CHUNK = `${ORIGIN}/_next/static/chunks/app.js`;
const REACT_CHUNK = `${ORIGIN}/_next/static/chunks/node_modules_next_dist_compiled_react.js`;

const stack = (...frames) => ["Error: react-stack-top-frame", ...frames.map((f) => `    at ${f}`)].join("\n");

test("parseStack reads V8 and Firefox frames and cleans receiver prefixes", () => {
  // Intent: both engine formats yield fn/url/line/column, with "Object."/"exports." stripped.
  const frames = parseStack(
    stack(`exports.jsxDEV (${REACT_CHUNK}:10:33)`, `Button (${CHUNK}:1432:214)`, `${CHUNK}:5:6`) +
      `\nCard@${CHUNK}:7:8`,
  );
  assert.deepEqual(frames.map((f) => [f.fn, f.line, f.column]), [
    ["jsxDEV", 10, 33],
    ["Button", 1432, 214],
    ["", 5, 6],
    ["Card", 7, 8],
  ]);
  assert.equal(frames[1].url, CHUNK);
  assert.equal(cleanFunctionName("Object.react_stack_bottom_frame"), "react_stack_bottom_frame");
  assert.equal(cleanFunctionName("async Page"), "Page");
  assert.equal(cleanFunctionName("Foo [as render]"), "Foo");
});

test("callSiteFrames skips JSX factories and stops at React's bottom frame", () => {
  // Intent: only frames inside user render code remain, so the first one is the JSX call site.
  const frames = parseStack(
    stack(
      `exports.createElement (${REACT_CHUNK}:1:1)`,
      `slotRender (${CHUNK}:2:2)`,
      `Button (${CHUNK}:3:3)`,
      `Object.react_stack_bottom_frame (${REACT_CHUNK}:4:4)`,
      `renderWithHooks (${REACT_CHUNK}:5:5)`,
    ),
  );
  assert.deepEqual(callSiteFrames(frames).map((f) => f.fn), ["slotRender", "Button"]);
  // Intent: lowercase helpers are not component renders; the component frame is chosen.
  assert.equal(componentCallSite(frames)?.fn, "Button");
  assert.equal(frameForFunction(frames, "Button")?.line, 3);
  assert.equal(frameForFunction(frames, "Missing"), null);
  assert.equal(isComponentName("Button"), true);
  assert.equal(isComponentName("usePart"), false);
});

test("decodeVlq round-trips signed values and rejects bad input", () => {
  // Intent: the decoder matches an independent encoder, including negatives and multi-digit values.
  for (const n of [0, 1, -1, 15, 16, -16, 1000, -123456]) assert.deepEqual(decodeVlq(vlq(n)), [n]);
  assert.deepEqual(decodeVlq(seg(4, 0, -3, 12)), [4, 0, -3, 12]);
  assert.equal(decodeVlq("!"), null);
  assert.equal(decodeVlq("g"), null, "dangling continuation digit");
});

test("decodeMappings accumulates relative fields across segments and lines", () => {
  // Intent: generated column resets per line; source/line/column deltas carry across lines.
  const lines = decodeMappings(`${seg(2, 0, 3, 4)},${seg(5, 0, 1, -2)};;${seg(1, 0, 2, 0)}`);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], [
    { generatedColumn: 2, source: 0, originalLine: 3, originalColumn: 4 },
    { generatedColumn: 7, source: 0, originalLine: 4, originalColumn: 2 },
  ]);
  assert.deepEqual(lines[1], []);
  assert.deepEqual(lines[2], [{ generatedColumn: 1, source: 0, originalLine: 6, originalColumn: 2 }]);
});

test("originalPositionFor resolves basic and sectioned (Turbopack) maps without crossing lines", () => {
  // Intent: section offsets shift the generated line (and column on the offset line); a column
  // before the first mapping on a line gives null rather than borrowing another line.
  const card = { version: 3, sources: ["file:///Users/me/repo/apps/web/src/card.tsx"], mappings: `;;${seg(9, 0, 11, 6)}` };
  const page = { version: 3, sources: ["file:///Users/me/repo/apps/web/src/page.tsx"], mappings: seg(2, 0, 4, 4) };
  const map = { version: 3, sections: [{ offset: { line: 0, column: 0 }, map: card }, { offset: { line: 4, column: 0 }, map: page }] };
  assert.deepEqual(originalPositionFor(card, 2, 20), { source: card.sources[0], line: 11, column: 6 });
  assert.equal(originalPositionFor(card, 2, 3), null);
  assert.equal(originalPositionFor(card, 3, 50), null);
  assert.deepEqual(originalPositionFor(map, 4, 2), { source: page.sources[0], line: 4, column: 4 });
  assert.deepEqual(originalPositionFor(map, 2, 9), { source: card.sources[0], line: 11, column: 6 });
  const offsetColumn = { version: 3, sections: [{ offset: { line: 1, column: 10 }, map: page }] };
  assert.deepEqual(originalPositionFor(offsetColumn, 1, 12)?.line, 4);
  assert.equal(originalPositionFor(offsetColumn, 1, 5), null);
});

test("toProjectPath makes project-relative paths and rejects non-files", () => {
  // Intent: absolute file URLs, Turbopack [project] ids and webpack URLs all become repo-relative.
  assert.equal(toProjectPath("file:///Users/me/repo/apps/host/src/app/page.tsx"), "apps/host/src/app/page.tsx");
  assert.equal(toProjectPath("file:///Users/me/repo/packages/design-system/src/button.tsx"), "packages/design-system/src/button.tsx");
  assert.equal(toProjectPath("file:///Users/me/site/src/app/x.tsx"), "src/app/x.tsx");
  assert.equal(toProjectPath("turbopack:///[project]/apps/host/src/a.tsx"), "apps/host/src/a.tsx");
  assert.equal(toProjectPath("webpack://_N_E/./src/a.tsx?abc"), "src/a.tsx");
  assert.equal(toProjectPath("file:///Users/me/repo/node_modules/next/dist/x.js"), "node_modules/next/dist/x.js");
  assert.equal(toProjectPath("about://React/Prerender/x.js"), null);
});

test("isTrustworthySourceFile accepts only project path:line:column", () => {
  // Intent: the Open-in-editor action appears only for editor-openable project locations.
  assert.equal(isTrustworthySourceFile("apps/host/src/app/page.tsx:19:7"), true);
  assert.equal(isTrustworthySourceFile("src/a.ts:1:1"), true);
  assert.equal(isTrustworthySourceFile(formatSourceFile("src/a.tsx", 0, 0)), true);
  assert.equal(formatSourceFile("src/a.tsx", 41, 8), "src/a.tsx:42:9");
  for (const bad of [
    undefined,
    "",
    "src/a.tsx:42",
    "src/a.tsx:0:1",
    "https://app.test/_next/static/chunks/app.js:1:2",
    "node_modules/react/index.js:1:1",
    "src/a.css:1:1",
    "src/my file.tsx:1:1",
  ]) {
    assert.equal(isTrustworthySourceFile(bad), false, String(bad));
  }
});

test("isFetchableBundle allows only same-origin http(s)", () => {
  // Intent: server-component frames (about://) and other origins are never fetched.
  assert.equal(isFetchableBundle(CHUNK, ORIGIN), true);
  assert.equal(isFetchableBundle("https://cdn.test/a.js", ORIGIN), false);
  assert.equal(isFetchableBundle("about://React/Prerender/file:///x.js", ORIGIN), false);
});

test("createSourceResolver fetches <bundle>.map once, falls back to sourceMappingURL", async () => {
  // Intent: maps are cached per bundle and the sourceMappingURL comment is honoured.
  const map = { version: 3, sources: ["file:///Users/me/repo/apps/web/src/card.tsx"], mappings: `;;${seg(9, 0, 11, 6)}` };
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (url === `${CHUNK}.map`) return JSON.stringify(map);
    if (url === `${ORIGIN}/other.js.map`) return null;
    if (url === `${ORIGIN}/other.js`) return "code();\n//# sourceMappingURL=maps/other.map";
    if (url === `${ORIGIN}/maps/other.map`) return JSON.stringify(map);
    return null;
  };
  const resolver = createSourceResolver(fetchText, ORIGIN);
  const first = await resolver.resolve({ fn: "Card", url: CHUNK, line: 3, column: 10 });
  assert.deepEqual(first, { source: map.sources[0], line: 11, column: 6, path: "apps/web/src/card.tsx" });
  await resolver.resolve({ fn: "Card", url: CHUNK, line: 3, column: 12 });
  assert.equal(calls.filter((u) => u === `${CHUNK}.map`).length, 1);
  const viaComment = await resolver.resolve({ fn: "X", url: `${ORIGIN}/other.js`, line: 3, column: 10 });
  assert.equal(viaComment?.path, "apps/web/src/card.tsx");
  assert.equal(await resolver.resolve({ fn: "X", url: "https://cdn.test/a.js", line: 1, column: 1 }), null);
});

test("classifyOrigin uses mapped paths first, then bundle URLs and known framework names", () => {
  // Intent: the four origins drive the detail-level filters.
  assert.equal(classifyOrigin({ path: "apps/host/src/page.tsx" }), "app");
  assert.equal(classifyOrigin({ path: "packages/design-system/src/components/button/button.tsx" }), "design-system");
  assert.equal(classifyOrigin({ path: "node_modules/@ui-sdk/react/button.js" }), "library");
  assert.equal(classifyOrigin({ path: "node_modules/next/dist/client/router.js" }), "framework");
  assert.equal(classifyOrigin({ url: REACT_CHUNK }), "framework");
  assert.equal(classifyOrigin({ url: `${ORIGIN}/_next/static/chunks/node_modules_0k89kyzlt._.js` }), "library");
  assert.equal(classifyOrigin({ url: "about://React/x?id=%5Bproject%5D/apps/host/src/app/layout.tsx+x" }), "app");
  assert.equal(classifyOrigin({ url: CHUNK }), "unknown");
  assert.equal(classifyOrigin({ path: "apps/host/x.tsx" }, "InnerLayoutRouter"), "framework");
});

test("filterComponents implements off / filtered / smart / all", () => {
  // Intent: compact shows nothing; standard hides framework, library and wrapper noise;
  // detailed keeps app + design-system (wrappers too); forensic keeps everything.
  const chain = [
    { name: "AppRouter", origin: "framework" },
    { name: "ThemeProvider", origin: "app" },
    { name: "SettingsPage", origin: "app" },
    { name: "SettingsForm", origin: "app" },
    { name: "Primitive.button", origin: "library" },
    { name: "Button", origin: "design-system" },
    { name: "Button", origin: "design-system" },
    { name: "ButtonRoot", origin: "design-system" },
    { name: "a", origin: "unknown" },
  ];
  assert.deepEqual(filterComponents(chain, "off"), []);
  assert.deepEqual(filterComponents(chain, "filtered"), ["SettingsPage", "SettingsForm", "Button"]);
  assert.deepEqual(filterComponents(chain, "smart"), ["ThemeProvider", "SettingsPage", "SettingsForm", "Button", "Button", "ButtonRoot"]);
  assert.deepEqual(filterComponents(chain, "all"), chain.map((e) => e.name));
  assert.equal(formatComponentChain(["A", "B"]), "A > B");
  assert.equal(formatComponentChain([]), undefined);
  assert.equal(isWrapperNoise("FooProvider"), true);
  assert.equal(isWrapperNoise("SaveButton"), false);
  assert.equal(reactModeForDetail("detailed"), "smart");
});

test("filterComponents keeps only the nearest components in filtered and smart", () => {
  // Intent: long chains keep the 5 (standard) or 10 (detailed) closest to the element.
  const chain = Array.from({ length: 14 }, (_, i) => ({ name: `Comp${i}`, origin: "app" }));
  assert.deepEqual(filterComponents(chain, "filtered"), ["Comp9", "Comp10", "Comp11", "Comp12", "Comp13"]);
  assert.equal(filterComponents(chain, "smart").length, 10);
  assert.equal(filterComponents(chain, "all").length, 14);
});

// ---- Fiber reading (jsdom with hand-built fibers) ----

let dom;
let document;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: `${ORIGIN}/settings` });
  document = dom.window.document;
});
afterEach(() => dom.window.close());

/** Page > ThemeProvider > Card > <span>, plus a framework router at the top. */
function fiberTree() {
  const fn = (name) => Object.defineProperty(function () {}, "name", { value: name });
  const router = { tag: 1, type: fn("InnerLayoutRouter"), return: null, _debugStack: null };
  const page = { tag: 0, type: fn("Page"), return: router, _debugOwner: router, _debugStack: { stack: stack(`exports.jsx (${REACT_CHUNK}:1:1)`, `render (${REACT_CHUNK}:9:9)`) } };
  const provider = { tag: 0, type: fn("ThemeProvider"), return: page, _debugOwner: page, _debugStack: { stack: stack(`exports.jsxDEV (${REACT_CHUNK}:1:1)`, `Page (${CHUNK}:5:3)`) } };
  const card = { tag: 11, type: { render: fn("Card") }, return: provider, _debugOwner: page, _debugStack: { stack: stack(`exports.jsxDEV (${REACT_CHUNK}:1:1)`, `Page (${CHUNK}:5:9)`) } };
  const span = { tag: 5, type: "span", return: card, _debugOwner: card, _debugStack: { stack: stack(`exports.jsxDEV (${REACT_CHUNK}:1:1)`, `Card (${CHUNK}:3:10)`, `Object.react_stack_bottom_frame (${REACT_CHUNK}:2:2)`) } };
  return { router, page, provider, card, span };
}

function mount(fiber) {
  const el = document.createElement("span");
  el.textContent = "Hi";
  el.__reactFiber$test = fiber;
  document.body.append(el);
  return el;
}

test("readChain lists component fibers outermost first with a frame from their own render", () => {
  // Intent: names come from function/class/forwardRef fibers; each gets a call-site frame in its file.
  const { span } = fiberTree();
  const { chain, callSites } = readChain(mount(span));
  assert.deepEqual(chain.map((e) => e.name), ["InnerLayoutRouter", "Page", "ThemeProvider", "Card"]);
  assert.equal(chain.find((e) => e.name === "Card").frame.line, 3);
  assert.equal(chain.find((e) => e.name === "Page").frame.line, 5);
  assert.equal(chain.find((e) => e.name === "InnerLayoutRouter").frame.fn, "render");
  assert.deepEqual(callSites.map((f) => f.fn), ["Card", "Page", "Page"]);
  assert.equal(componentName({ type: { type: { displayName: "Memoed" } } }), "Memoed");
});

test("getReactInfo is synchronous and filters by mode; no fiber means no info", () => {
  // Intent: capture never blocks; framework names are dropped below forensic.
  const { span } = fiberTree();
  const el = mount(span);
  assert.equal(getReactInfo(el, "filtered").reactComponents, "Page > Card");
  assert.equal(getReactInfo(el, "smart").reactComponents, "Page > ThemeProvider > Card");
  assert.equal(getReactInfo(el, "all").reactComponents, "InnerLayoutRouter > Page > ThemeProvider > Card");
  assert.deepEqual(getReactInfo(el, "off"), {});
  const plain = document.createElement("div");
  document.body.append(plain);
  assert.deepEqual(getReactInfo(plain, "all"), {});
});

test("readSourceStamp reads compiler data-* stamps", () => {
  // Intent: fallback technique 2 accepts only trustworthy stamped locations.
  document.body.innerHTML = '<div data-source-file="src/a.tsx:4:2"><b id="b">x</b></div><i id="i" data-inspector-relative-path="src/c.tsx" data-inspector-line="9" data-inspector-column="3"></i><u id="u" data-source="nope"></u>';
  assert.equal(readSourceStamp(document.getElementById("b")), "src/a.tsx:4:2");
  assert.equal(readSourceStamp(document.getElementById("i")), "src/c.tsx:9:3");
  assert.equal(readSourceStamp(document.getElementById("u")), undefined);
});

test("resolveReactInfo maps the nearest call site to path:line:column and refines origins", async () => {
  // Intent: technique 1 end to end; the design-system origin comes from the mapped path.
  const card = { version: 3, sources: ["file:///Users/me/repo/packages/design-system/src/card.tsx"], mappings: `;;${seg(9, 0, 11, 6)}` };
  const page = { version: 3, sources: ["file:///Users/me/repo/apps/web/src/page.tsx"], mappings: seg(2, 0, 4, 4) };
  const map = { version: 3, sections: [{ offset: { line: 0, column: 0 }, map: card }, { offset: { line: 4, column: 0 }, map: page }] };
  const resolver = createSourceResolver(async (url) => (url === `${CHUNK}.map` ? JSON.stringify(map) : null), ORIGIN);
  const { span } = fiberTree();
  const el = mount(span);
  const info = await resolveReactInfo(el, "smart", resolver);
  assert.equal(info.sourceFile, "packages/design-system/src/card.tsx:12:7");
  assert.equal(info.reactComponents, "Page > ThemeProvider > Card");
  const off = await resolveReactInfo(el, "off", resolver);
  assert.deepEqual(off, { sourceFile: "packages/design-system/src/card.tsx:12:7" });
  // Intent: with no resolvable map, there is no sourceFile at all (technique 3: none).
  const empty = createSourceResolver(async () => null, ORIGIN);
  assert.equal((await resolveReactInfo(el, "filtered", empty)).sourceFile, undefined);
});
