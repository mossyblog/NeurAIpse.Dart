import { strict as assert } from "node:assert";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Annotate } from "../dist/index.js";
import { HOST_ATTRIBUTE } from "../dist/ui/shadow-surface.js";
import { SURFACE_CSS } from "../dist/ui/surface-css.generated.js";

function installDomGlobals(dom) {
  const { window } = dom;

  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }

  if (typeof window.ResizeObserver !== "function") {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  const explicitDomKeys = new Set([
    "Element",
    "Node",
    "ShadowRoot",
    "DocumentFragment",
    "Document",
    "CharacterData",
    "Text",
    "Comment",
    "NodeFilter",
    "NodeList",
    "HTMLCollection",
    "NamedNodeMap",
    "Range",
    "Selection",
    "CSS",
    "CSSStyleSheet",
    "CSSRule",
    "MutationObserver",
    "MutationRecord",
    "IntersectionObserver",
  ]);

  const entries = {
    IS_REACT_ACT_ENVIRONMENT: true,
    window,
    document: window.document,
    navigator: window.navigator,
    ResizeObserver: window.ResizeObserver,
    localStorage: window.localStorage,
    getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: window.matchMedia.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };

  for (let proto = window; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (Object.prototype.hasOwnProperty.call(entries, key)) continue;
      const isDomGlobal =
        explicitDomKeys.has(key) ||
        /^HTML.*Element$/.test(key) ||
        /^SVG.*Element$/.test(key) ||
        (/^DOM/.test(key) && key !== "DOMException") ||
        /Event$/.test(key);
      if (!isDomGlobal) continue;
      try {
        const value = window[key];
        if (value !== undefined) {
          entries[key] = value;
        }
      } catch {
        // Ignore restricted window getters.
      }
    }
  }

  entries.PointerEvent = window.PointerEvent ?? window.MouseEvent;

  const previous = new Map();
  for (const [key, value] of Object.entries(entries)) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, key);
    if (desc && desc.configurable === false) continue;
    previous.set(key, desc);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return () => {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor === undefined) {
        delete globalThis[key];
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  };
}

test("standalone Annotate mounts self-contained Shadow DOM UI, opens toolbar, and toggles theme without errors", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.test/",
  });
  const restoreGlobals = installDomGlobals(dom);

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    errors.push(args);
    originalConsoleError(...args);
  };

  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);

  t.after(async () => {
    await act(async () => {
      root.unmount();
    });
    await new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
    console.error = originalConsoleError;
    dom.window.close();
    restoreGlobals();
  });

  await act(async () => {
    root.render(createElement(Annotate, { appName: "Standalone" }));
  });

  const host = dom.window.document.body.querySelector(`[${HOST_ATTRIBUTE}]`);
  assert.ok(host, "shadow host is attached to document.body");
  const shadow = host.shadowRoot;
  assert.ok(shadow, "open shadowRoot exists");

  const styleTexts = Array.from(shadow.querySelectorAll("style"), (el) => el.textContent ?? "");
  assert.ok(
    SURFACE_CSS.includes("--tw-ring-offset-width:0px"),
    "SURFACE_CSS normalizes <length> initial-value 0 to 0px for calc()",
  );
  assert.ok(
    styleTexts.some((css) => css === SURFACE_CSS && css.includes("@layer properties")),
    "compiled SURFACE_CSS with @layer properties shadow initialization is injected",
  );
  assert.ok(
    styleTexts.some((css) => css.includes("--background") && css.includes(".annotate-root")),
    "package-owned semantic tokens and .annotate-root CSS are injected",
  );

  const launcher = shadow.querySelector('button[aria-label="Start feedback mode"]');
  assert.ok(launcher, "launcher button is rendered");

  await act(async () => {
    launcher.click();
  });

  const toolbar = shadow.querySelector('[aria-label="Feedback controls"]');
  assert.ok(toolbar, "toolbar opens after clicking launcher");
  for (const label of [
    "Annotate",
    "Spacing inspector",
    "Type inspector",
    "Colour inspector",
    "Layout",
    "Rearrange",
  ]) {
    assert.ok(toolbar.querySelector(`button[aria-label="${label}"]`), `toolbar includes mode button "${label}"`);
  }

  const settingsButton = toolbar.querySelector('button[aria-label="Settings"]');
  assert.ok(settingsButton, "settings button exists on toolbar");

  await act(async () => {
    settingsButton.click();
  });

  const themeButton = shadow.querySelector('button[data-theme-value]');
  assert.ok(themeButton, "theme toggle button renders inside settings panel");
  const themedRoot = shadow.querySelector("[data-theme]");
  assert.ok(themedRoot, "themed wrapper renders inside shadow root");

  assert.equal(themedRoot.getAttribute("data-theme"), "dark");
  assert.equal(themeButton.getAttribute("data-theme-value"), "dark");

  await act(async () => {
    themeButton.click();
  });

  assert.equal(themedRoot.getAttribute("data-theme"), "light");
  assert.equal(themeButton.getAttribute("data-theme-value"), "light");
  assert.equal(errors.length, 0, `expected zero console.error calls, got ${errors.length}`);
});
