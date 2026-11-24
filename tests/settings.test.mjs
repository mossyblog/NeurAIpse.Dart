import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_GOOEY_NAV_SETTINGS,
  DEFAULT_SETTINGS,
  MARKER_COLOR_IDS,
  SETTINGS_KEY,
  THEME_KEY,
  activeWebhookUrl,
  applyGooeyNavPreset,
  buildCopyText,
  generateOutput,
  isValidWebhookUrl,
  loadSettings,
  loadTheme,
  nextTheme,
  normalizeGooeyNavSettings,
  normalizeSettings,
  outputDetailLevel,
  saveSettings,
  saveTheme,
  settingsReactMode,
  webhookUrlError,
} from "../dist/core/index.js";
import { billing, environment, save } from "./fixtures.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("output detail dots show levels 1 to 4", () => {
  // INTENTION: the Output Detail cycle button fills one dot per tier.
  assert.deepEqual(
    ["compact", "standard", "detailed", "forensic"].map(outputDetailLevel),
    [1, 2, 3, 4],
  );
});

test("React mode follows output detail and is off when React Components is disabled", () => {
  // INTENTION: spec section 4 maps detail to React mode; the toggle overrides it to off.
  assert.equal(settingsReactMode({ outputDetail: "detailed", reactEnabled: true }), "smart");
  assert.equal(settingsReactMode({ outputDetail: "forensic", reactEnabled: false }), "off");
  assert.equal(settingsReactMode({ outputDetail: "compact", reactEnabled: true }), "off");
  assert.equal(settingsReactMode({ outputDetail: "standard", reactEnabled: true }), "filtered");
  assert.equal(settingsReactMode({ outputDetail: "forensic", reactEnabled: true }), "all");
});

test("marker colour palette starts with the blue default and rejects unknown ids", () => {
  // INTENTION: stored colour ids outside the swatch palette fall back to blue.
  assert.equal(MARKER_COLOR_IDS[0], "blue");
  assert.equal(new Set(MARKER_COLOR_IDS).size, MARKER_COLOR_IDS.length);
  assert.equal(normalizeSettings({ annotationColorId: "purple" }).annotationColorId, "purple");
  assert.equal(normalizeSettings({ annotationColorId: "chartreuse" }).annotationColorId, "blue");
});

test("webhook URLs must be absolute http or https", () => {
  // INTENTION: spec section 11: other schemes are ignored and flagged in settings.
  for (const url of ["https://example.com/hook", "http://localhost:4747/x", "  https://a.b  "]) {
    assert.equal(isValidWebhookUrl(url), true, url);
  }
  for (const url of ["", "ftp://example.com", "javascript:alert(1)", "example.com", "file:///etc/hosts", "https://"]) {
    assert.equal(isValidWebhookUrl(url), false, url);
  }
  assert.equal(webhookUrlError(""), null);
  assert.equal(webhookUrlError("https://ok.test"), null);
  assert.equal(webhookUrlError("ftp://x"), "Use an http:// or https:// URL");
});

test("active webhook needs the enable toggle and a valid URL", () => {
  // INTENTION: a flagged or disabled webhook is never used for sending.
  assert.equal(activeWebhookUrl({ webhookUrl: " https://h.test/x ", webhooksEnabled: true }), "https://h.test/x");
  assert.equal(activeWebhookUrl({ webhookUrl: "https://h.test/x", webhooksEnabled: false }), null);
  assert.equal(activeWebhookUrl({ webhookUrl: "ftp://h.test", webhooksEnabled: true }), null);
});

test("every settings field round-trips through feedback-toolbar-settings", () => {
  // INTENTION: each panel control persists under the spec section 5 key and reloads intact.
  const storage = memoryStorage();
  const settings = {
    outputDetail: "forensic",
    autoClearAfterCopy: true,
    annotationColorId: "green",
    blockInteractions: false,
    reactEnabled: false,
    markerClickBehavior: "delete",
    webhookUrl: "https://hooks.test/a",
    webhooksEnabled: false,
    inspectorSubMode: "lines",
    inspectorHandles: true,
    inspectorGuides: true,
    dockSide: "left",
    gooeyNav: {
      enabled: false,
      preset: "custom",
      color: "#ff5a1f",
      colors: ["#ff5a1f", "#ffb020"],
      size: "lg",
      frame: false,
      hoverEffect: false,
      animationTime: 850,
      particleCount: 22,
      spread: 72,
      timeVariance: 400,
      gooeyness: 0.75,
      wobble: 0.35,
    },
  };
  saveSettings(settings, storage);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), settings);
  assert.deepEqual(loadSettings(storage), settings);
  assert.deepEqual(loadSettings(memoryStorage()), DEFAULT_SETTINGS);
});

test("GooeyNav presets and normalization enforce React Bits bounds and hex colors", () => {
  const accent = applyGooeyNavPreset(DEFAULT_GOOEY_NAV_SETTINGS, "accent");
  assert.equal(accent.preset, "accent");
  assert.equal(accent.color, "#ff5a1f");
  assert.deepEqual(accent.colors, ["#ff5a1f", "#ff8a3a", "#ffb020"]);

  const splash = applyGooeyNavPreset(accent, "splash");
  assert.equal(splash.preset, "splash");
  assert.equal(splash.particleCount, 24);
  assert.equal(splash.spread, 84);
  assert.equal(splash.gooeyness, 0.65);

  const calm = applyGooeyNavPreset(splash, "calm");
  assert.equal(calm.particleCount, 8);
  assert.equal(calm.spread, 28);
  assert.equal(calm.wobble, 0.2);

  const clamped = normalizeGooeyNavSettings({
    preset: "bogus",
    size: "xl",
    color: "not-hex",
    colors: ["#abc", "bad", "#112233"],
    particleCount: 99,
    spread: -5,
    animationTime: 5000,
    timeVariance: 2000,
    gooeyness: 2,
    wobble: -1,
  });
  assert.equal(clamped.preset, "classic");
  assert.equal(clamped.size, "md");
  assert.equal(clamped.color, "");
  assert.deepEqual(clamped.colors, ["#abc", "#112233"]);
  assert.equal(clamped.particleCount, 32);
  assert.equal(clamped.spread, 0);
  assert.equal(clamped.animationTime, 1500);
  assert.equal(clamped.timeVariance, 1000);
  assert.equal(clamped.gooeyness, 1);
  assert.equal(clamped.wobble, 0);
});

test("theme toggles and persists at feedback-toolbar-theme", () => {
  // INTENTION: the theme button flips dark/light and the choice survives reload.
  const storage = memoryStorage();
  assert.equal(loadTheme(storage), "dark");
  saveTheme(nextTheme("dark"), storage);
  assert.equal(storage.data.get(THEME_KEY), "light");
  assert.equal(loadTheme(storage), "light");
  assert.equal(nextTheme("light"), "dark");
});

test("copyFormat selection: markdown uses the serializer, others list metadata or null", () => {
  // INTENTION: Copy picks the serializer by copyFormat; non-markdown formats return null
  // ("No matching metadata") so the caller leaves clipboard and feedback untouched.
  const list = [save, billing];
  const markdown = () => generateOutput(list, "/settings", "compact", { appName: "Demo", environment });
  assert.equal(buildCopyText(list, "markdown", markdown), markdown());
  assert.match(buildCopyText(list, "markdown", markdown), /^## Page Feedback: \/settings\n\*\*App:\*\* Demo\n\n1\. /);
  assert.equal(buildCopyText(list, "source", markdown), "src/app/settings/form.tsx:42:9");
  assert.equal(buildCopyText(list, "classes", markdown), "btn\nprimary\nnav-link");
  assert.equal(buildCopyText(list, { attribute: "data-testid" }, markdown), "save\nbilling");
  assert.equal(buildCopyText([billing], "source", markdown), null);
  assert.equal(buildCopyText(list, { attribute: "data-missing" }, markdown), null);
  assert.equal(buildCopyText([{ ...billing, cssClasses: "" }], "classes", markdown), null);
});
