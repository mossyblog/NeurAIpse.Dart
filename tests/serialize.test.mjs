import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateOutput, sanitizeAppName } from "../dist/core/index.js";
import { billing, environment, save } from "./fixtures.mjs";

const options = { appName: "Demo", environment };
const { reactComponents, sourceFile, selectedText, ...plain } = save;
void reactComponents;
void sourceFile;
void selectedText;

test("empty annotation list returns an empty string at every tier", () => {
  for (const tier of ["compact", "standard", "detailed", "forensic"]) {
    assert.equal(generateOutput([], "/settings", tier, options), "");
  }
});

test("standard matches the spec worked example byte for byte", () => {
  const expected = [
    "## Page Feedback: /settings",
    "**App:** Demo",
    "**Viewport:** 1440×900",
    "",
    '### 1. button "Save"',
    '**Location:** main > form > button[data-testid="save"]',
    "**Source:** src/app/settings/form.tsx:42:9",
    "**React:** SettingsForm > SaveButton",
    '**Selected text:** "Save changes"',
    "**Feedback:** Make this primary and disable while saving.",
  ].join("\n");
  assert.equal(generateOutput([save], "/settings", "standard", options), expected);
});

test("standard is the default tier and separates blocks with one blank line", () => {
  const expected = [
    "## Page Feedback: /settings",
    "**Viewport:** 1440×900",
    "",
    '### 1. button "Save"',
    '**Location:** main > form > button[data-testid="save"]',
    "**Feedback:** Make this primary and disable while saving.",
    "",
    '### 2. nav link "Billing"',
    "**Location:** nav > a:nth-of-type(2)",
    "**Feedback:** Wrong label.",
  ].join("\n");
  assert.equal(generateOutput([plain, billing], "/settings", undefined, { environment }), expected);
});

test("compact matches the spec worked example byte for byte", () => {
  const expected = [
    "## Page Feedback: /settings",
    "**App:** Demo",
    "",
    '1. **button "Save"** (src/app/settings/form.tsx:42:9): Make this primary and disable while saving. (re: "Save changes")',
    '2. **nav link "Billing"**: Wrong label.',
  ].join("\n");
  assert.equal(generateOutput([save, billing], "/settings", "compact", options), expected);
});

test("compact truncates selectedText after 30 characters only when longer", () => {
  const exact = { ...billing, selectedText: "a".repeat(30) };
  const long = { ...billing, selectedText: `${"b".repeat(30)}c` };
  const output = generateOutput([exact, long], "/p", "compact", {});
  assert.equal(
    output,
    [
      "## Page Feedback: /p",
      "",
      `1. **nav link "Billing"**: Wrong label. (re: "${"a".repeat(30)}")`,
      `2. **nav link "Billing"**: Wrong label. (re: "${"b".repeat(30)}...")`,
    ].join("\n"),
  );
});

test("detailed adds classes, rounded position and context without selected text", () => {
  const expected = [
    "## Page Feedback: /settings",
    "**App:** Demo",
    "**Viewport:** 1440×900",
    "",
    '### 1. button "Save"',
    '**Location:** main > form > button[data-testid="save"]',
    "**Source:** src/app/settings/form.tsx:42:9",
    "**React:** SettingsForm > SaveButton",
    "**Classes:** btn primary",
    "**Position:** 100px, 201px (80×32px)",
    '**Selected text:** "Save changes"',
    "**Feedback:** Make this primary and disable while saving.",
    "",
    '### 2. nav link "Billing"',
    "**Location:** nav > a:nth-of-type(2)",
    "**Classes:** nav-link btn",
    `**Context:** ${"x".repeat(100)}`,
    "**Feedback:** Wrong label.",
  ].join("\n");
  assert.equal(generateOutput([save, billing], "/settings", "detailed", options), expected);
});

test("forensic has the environment block, fixed field order and the multi-select note", () => {
  const multi = { ...save, isMultiSelect: true };
  const expected = [
    "## Page Feedback: /settings",
    "**App:** Demo",
    "",
    "**Environment:**",
    "- Viewport: 1440×900",
    "- URL: https://localhost/settings",
    "- User Agent: TestAgent/1.0",
    "- Timestamp: 2026-01-01T00:00:00.000Z",
    "- Device Pixel Ratio: 2",
    "",
    "---",
    "",
    '### 1. button "Save"',
    "*Forensic data shown for first element of selection*",
    "**Full DOM Path:** body > main > form.settings > button.btn.primary",
    "**CSS Classes:** btn primary",
    "**Position:** x:100, y:201 (80×32px)",
    "**Annotation at:** 50.0% from left, 312px from top",
    '**Selected text:** "Save changes"',
    "**Computed Styles:** display: flex; color: rgb(0, 0, 0)",
    "**Accessibility:** role=button, focusable",
    '**Nearby Elements:** button "Cancel"',
    "**Source:** src/app/settings/form.tsx:42:9",
    "**React:** SettingsForm > SaveButton",
    "**Feedback:** Make this primary and disable while saving.",
    "",
    '### 2. nav link "Billing"',
    "**CSS Classes:** nav-link btn",
    "**Annotation at:** 12.3% from left, 48px from top",
    `**Context:** ${"x".repeat(100)}`,
    "**Feedback:** Wrong label.",
  ].join("\n");
  assert.equal(generateOutput([multi, billing], "/settings", "forensic", options), expected);
});

test("forensic omits the multi-select note without fullPath", () => {
  const multi = { ...billing, isMultiSelect: true };
  const output = generateOutput([multi], "/p", "forensic", { environment });
  assert.ok(!output.includes("Forensic data shown"));
});

test("output is trimmed at the end with no trailing newline", () => {
  for (const tier of ["compact", "standard", "detailed", "forensic"]) {
    const output = generateOutput([{ ...billing, comment: "Trailing  \n\n" }], "/p", tier, options);
    assert.equal(output, output.trimEnd(), tier);
    assert.ok(output.endsWith("Trailing"), tier);
  }
});

test("app name collapses CR/LF/tab, trims and escapes markdown", () => {
  assert.equal(sanitizeAppName("  My\r\n\tApp  "), "My App");
  assert.equal(sanitizeAppName("a\\b`c*d_e[f]g<h>i"), "a\\\\b\\`c\\*d\\_e\\[f\\]g\\<h\\>i");
  const output = generateOutput([billing], "/p", "compact", { appName: " *Bold*\nApp " });
  assert.equal(output.split("\n")[1], "**App:** \\*Bold\\* App");
});

test("blank app name omits the App line", () => {
  const output = generateOutput([billing], "/p", "compact", { appName: " \n\t " });
  assert.ok(!output.includes("**App:**"));
});
