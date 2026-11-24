/** Shared annotation fixtures for serializer and copyFormat tests. */
export const save = {
  id: "a1",
  x: 50,
  y: 312.4,
  comment: "Make this primary and disable while saving.",
  element: 'button "Save"',
  elementPath: 'main > form > button[data-testid="save"]',
  timestamp: 0,
  sourceFile: "src/app/settings/form.tsx:42:9",
  reactComponents: "SettingsForm > SaveButton",
  selectedText: "Save changes",
  cssClasses: "btn primary",
  boundingBox: { x: 100.4, y: 200.6, width: 80.2, height: 32 },
  nearbyText: "ignored because selectedText is present",
  fullPath: "body > main > form.settings > button.btn.primary",
  computedStyles: "display: flex; color: rgb(0, 0, 0)",
  accessibility: "role=button, focusable",
  nearbyElements: 'button "Cancel"',
  attributes: { "data-testid": "save" },
};

export const billing = {
  id: "a2",
  x: 12.345,
  y: 48,
  comment: "Wrong label.",
  element: 'nav link "Billing"',
  elementPath: "nav > a:nth-of-type(2)",
  timestamp: 1,
  cssClasses: "nav-link btn",
  nearbyText: "x".repeat(150),
  attributes: { "data-testid": "billing" },
};

export const environment = {
  viewport: { width: 1440, height: 900 },
  url: "https://localhost/settings",
  userAgent: "TestAgent/1.0",
  timestamp: "2026-01-01T00:00:00.000Z",
  devicePixelRatio: 2,
};
