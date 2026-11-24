import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  POSITION_KEY,
  SETTINGS_KEY,
  THEME_KEY,
  buildCopyText,
  formatMetadata,
  getRouteKey,
  getStorageKey,
  isToggleShortcut,
  loadAnnotations,
  loadPosition,
  loadSettings,
  loadTheme,
  nextOutputDetail,
  normalizeSettings,
  reactModeForDetail,
  resolveShortcut,
  saveAnnotations,
  savePosition,
  saveSettings,
} from "../dist/core/index.js";
import { billing, save } from "./fixtures.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const brokenStorage = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("quota");
  },
  removeItem() {
    throw new Error("denied");
  },
};

test("settings defaults match spec section 4", () => {
  assert.deepEqual({ ...DEFAULT_SETTINGS }, {
    outputDetail: "standard",
    autoClearAfterCopy: false,
    annotationColorId: "blue",
    blockInteractions: true,
    reactEnabled: true,
    markerClickBehavior: "edit",
    webhookUrl: "",
    webhooksEnabled: true,
    inspectorSubMode: "box",
    inspectorHandles: false,
    inspectorGuides: false,
    dockSide: "right",
    gooeyNav: {
      enabled: true,
      preset: "classic",
      color: "",
      colors: [],
      size: "md",
      frame: true,
      hoverEffect: true,
      animationTime: 600,
      particleCount: 15,
      spread: 56,
      timeVariance: 300,
      gooeyness: 0.5,
      wobble: 0.5,
    },
  });
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

test("output detail cycles Compact -> Standard -> Detailed -> Forensic", () => {
  assert.equal(nextOutputDetail("compact"), "standard");
  assert.equal(nextOutputDetail("standard"), "detailed");
  assert.equal(nextOutputDetail("detailed"), "forensic");
  assert.equal(nextOutputDetail("forensic"), "compact");
  assert.deepEqual(
    ["compact", "standard", "detailed", "forensic"].map(reactModeForDetail),
    ["off", "filtered", "smart", "all"],
  );
});

test("normalizeSettings keeps valid fields and drops invalid ones", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const settings = normalizeSettings({ outputDetail: "forensic", blockInteractions: "no", markerClickBehavior: "delete", extra: 1 });
  assert.equal(settings.outputDetail, "forensic");
  assert.equal(settings.blockInteractions, true);
  assert.equal(settings.markerClickBehavior, "delete");
  assert.ok(!("extra" in settings));
});

test("storage keys follow spec section 5", () => {
  assert.equal(getStorageKey("/settings"), "feedback-annotations-/settings");
  assert.equal(getStorageKey("/app", "#/inbox"), "feedback-annotations-/app#/inbox");
  assert.equal(getRouteKey({ pathname: "/app", hash: "#/x" }), "feedback-annotations-/app");
  assert.equal(getRouteKey({ pathname: "/app", hash: "#/x" }, true), "feedback-annotations-/app#/x");
  assert.equal(POSITION_KEY, "feedback-toolbar-position");
  assert.equal(SETTINGS_KEY, "feedback-toolbar-settings");
  assert.equal(THEME_KEY, "feedback-toolbar-theme");
});

test("annotations, position, settings and theme round-trip through storage", () => {
  const storage = memoryStorage();
  const key = getStorageKey("/settings");
  assert.deepEqual(loadAnnotations(key, storage), []);
  saveAnnotations(key, [save], storage);
  assert.deepEqual(loadAnnotations(key, storage), [save]);
  storage.setItem(key, "{not json");
  assert.deepEqual(loadAnnotations(key, storage), []);
  storage.setItem(key, '{"not":"an array"}');
  assert.deepEqual(loadAnnotations(key, storage), []);

  assert.equal(loadPosition(storage), null);
  savePosition({ x: 10.6, y: 20.2 }, storage);
  assert.deepEqual(loadPosition(storage), { x: 11, y: 20 });

  saveSettings({ ...DEFAULT_SETTINGS, outputDetail: "compact" }, storage);
  assert.equal(loadSettings(storage).outputDetail, "compact");

  assert.equal(loadTheme(storage), "dark");
  storage.setItem(THEME_KEY, "light");
  assert.equal(loadTheme(storage), "light");
});

test("storage failures are swallowed", () => {
  assert.deepEqual(loadAnnotations("k", brokenStorage), []);
  assert.doesNotThrow(() => saveAnnotations("k", [save], brokenStorage));
  assert.equal(loadPosition(brokenStorage), null);
  assert.doesNotThrow(() => savePosition({ x: 1, y: 1 }, brokenStorage));
  assert.deepEqual(loadSettings(brokenStorage), DEFAULT_SETTINGS);
  assert.equal(loadTheme(brokenStorage), "dark");
  assert.deepEqual(loadAnnotations("k", null), []);
});

test("copyFormat source, classes and attribute dedupe in first-seen order", () => {
  const list = [save, billing, { ...billing, id: "a3", sourceFile: save.sourceFile }];
  assert.equal(formatMetadata(list, "source"), "src/app/settings/form.tsx:42:9");
  assert.equal(formatMetadata(list, "classes"), "btn\nprimary\nnav-link");
  assert.equal(formatMetadata(list, { attribute: "data-testid" }), "save\nbilling");
});

test("copyFormat returns null when no metadata matches", () => {
  assert.equal(formatMetadata([billing], "source"), null);
  assert.equal(formatMetadata([billing], { attribute: "data-qa" }), null);
  assert.equal(buildCopyText([billing], "source", () => "md"), null);
  assert.equal(buildCopyText([billing], "markdown", () => "md"), "md");
});

const key = (k, extra = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, ...extra });
const state = (extra = {}) => ({ active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 1, ...extra });

test("single-key shortcuts are gated per spec section 2", () => {
  assert.equal(resolveShortcut(key("h"), state()), "hide");
  assert.equal(resolveShortcut(key("C"), state()), "copy");
  assert.equal(resolveShortcut(key("x"), state()), "clear");
  assert.equal(resolveShortcut(key("p"), state({ annotationCount: 0 })), "freeze");
  assert.equal(resolveShortcut(key("l"), state({ annotationCount: 0 })), "layout");
  assert.equal(resolveShortcut(key("h"), state({ annotationCount: 0 })), "hide");
  assert.equal(resolveShortcut(key("c"), state({ annotationCount: 0 })), null);
  assert.equal(resolveShortcut(key("x"), state({ annotationCount: 0, placementCount: 1 })), "clear");
  assert.equal(resolveShortcut(key("s"), state()), null);
  assert.equal(resolveShortcut(key("s"), state({ canSend: true })), "send");
  assert.equal(resolveShortcut(key("s"), state({ canSend: true, sendState: "sending" })), null);
  assert.equal(resolveShortcut(key("h"), state({ active: false })), null);
  assert.equal(resolveShortcut(key("h"), state({ editableTarget: true })), null);
  assert.equal(resolveShortcut(key("h"), state({ enableKeyboardShortcuts: false })), null);
  assert.equal(resolveShortcut(key("h", { metaKey: true }), state()), null);
  assert.equal(resolveShortcut(key("h", { ctrlKey: true }), state()), null);
  assert.equal(resolveShortcut(key("h", { repeat: true }), state()), null);
  assert.equal(resolveShortcut(key("q"), state()), null);
});

test("Cmd/Ctrl+Shift+F toggles unless shortcuts are disabled", () => {
  assert.equal(isToggleShortcut(key("F", { metaKey: true, shiftKey: true })), true);
  assert.equal(isToggleShortcut(key("f", { ctrlKey: true, shiftKey: true })), true);
  assert.equal(isToggleShortcut(key("f", { ctrlKey: true })), false);
  assert.equal(isToggleShortcut(key("F", { shiftKey: true })), false);
  assert.equal(isToggleShortcut(key("F", { metaKey: true, shiftKey: true }), false), false);
});

test("inspectorSubMode persists in settings, default box, invalid values dropped (inspector spec 14.1)", () => {
  assert.equal(normalizeSettings({}).inspectorSubMode, "box");
  assert.equal(normalizeSettings({ inspectorSubMode: "lines" }).inspectorSubMode, "lines");
  assert.equal(normalizeSettings({ inspectorSubMode: "grid" }).inspectorSubMode, "box");
  assert.equal(normalizeSettings({ inspectorSubMode: 1 }).inspectorSubMode, "box");
});

test("V toggles the spacing sub-mode only while the spacing inspector is on", () => {
  const ev = (k) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false });
  const base = { active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 0 };
  assert.equal(resolveShortcut(ev("v"), { ...base, spacingActive: true }), "subMode");
  assert.equal(resolveShortcut(ev("V"), { ...base, spacingActive: true }), "subMode");
  assert.equal(resolveShortcut(ev("v"), base), null);
  assert.equal(resolveShortcut(ev("v"), { ...base, spacingActive: false }), null);
  assert.equal(resolveShortcut(ev("v"), { ...base, spacingActive: true, editableTarget: true }), null);
  // Existing keys and new Design/Measure shortcuts keep their actions.
  for (const [k, action] of [
    ["d", "design"],
    ["D", "design"],
    ["m", "spacing"],
    ["1", "measureV"],
    ["2", "measureH"],
    ["t", "type"],
    ["k", "color"],
    ["p", "freeze"],
    ["l", "layout"],
    ["r", "rearrange"],
  ]) {
    assert.equal(resolveShortcut(ev(k), { ...base, spacingActive: true }), action);
  }
});
