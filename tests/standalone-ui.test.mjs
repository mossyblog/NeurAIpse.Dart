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

  // Side notch defaults to the right edge and switches sides via Settings and the notch button.
  const notch = shadow.querySelector('[data-annotate-notch="toolbar"]');
  assert.ok(notch, "expanded annotation bar renders as a side notch");
  assert.equal(notch.getAttribute("data-dock-side"), "right");

  const leftOption = shadow.querySelector('[data-dock-side-option="left"]');
  assert.ok(leftOption, "settings panel exposes Left/Right notch side choice");

  await act(async () => {
    leftOption.click();
  });
  assert.equal(notch.getAttribute("data-dock-side"), "left");
  assert.equal(themedRoot.getAttribute("data-dock-side"), "left");

  const flipButton = toolbar.querySelector('button[aria-label="Move notch to right side"]');
  assert.ok(flipButton, "notch includes a quick button to switch sides");

  await act(async () => {
    flipButton.click();
  });
  assert.equal(notch.getAttribute("data-dock-side"), "right");

  // macOS Dock hover magnification: icons start small and enlarge around the hovered icon.
  const annotateBtn = toolbar.querySelector('button[aria-label="Annotate"]');
  const spacingBtn = toolbar.querySelector('button[aria-label="Spacing inspector"]');
  const exitBtn = toolbar.querySelector('button[aria-label="Exit"]');
  assert.ok(annotateBtn && spacingBtn && exitBtn);
  assert.equal(annotateBtn.getAttribute("data-dock-factor"), "0.00");
  assert.equal(spacingBtn.getAttribute("data-dock-factor"), "0.00");

  await act(async () => {
    spacingBtn.parentElement.dispatchEvent(new dom.window.MouseEvent("pointerover", { bubbles: true }));
  });

  const hoveredFactor = Number(spacingBtn.getAttribute("data-dock-factor"));
  const neighborFactor = Number(annotateBtn.getAttribute("data-dock-factor"));
  const distantFactor = Number(exitBtn.getAttribute("data-dock-factor"));
  assert.equal(hoveredFactor, 1, "hovered icon magnifies to peak factor");
  assert.ok(neighborFactor > 0 && neighborFactor < 1, `neighbor magnifies partially (got ${neighborFactor})`);
  assert.equal(distantFactor, 0, "distant icon stays compact");
  const parseScale = (el) => {
    const match = el.style.transform.match(/scale\(([^)]+)\)/);
    return match ? Number(match[1]) : 0;
  };
  assert.ok(
    parseScale(spacingBtn) > parseScale(annotateBtn) &&
      parseScale(annotateBtn) > parseScale(exitBtn),
    "GPU transform scales follow the dock magnification wave",
  );
  assert.ok(notch.querySelector("[data-dock-tooltip]"), "dock tooltip pill renders next to hovered icon");

  await act(async () => {
    notch.dispatchEvent(new dom.window.MouseEvent("pointerout", { bubbles: true, relatedTarget: dom.window.document.body }));
  });
  assert.equal(spacingBtn.getAttribute("data-dock-factor"), "0.00");
  assert.equal(notch.querySelector("[data-dock-tooltip]"), null, "tooltip hides when leaving notch");

  // Dragging the grip handle across the viewport midpoint switches dock side and persists it.
  const grip = toolbar.querySelector("[data-annotate-toolbar-grip]");
  assert.ok(grip, "notch has a drag grip handle");
  await act(async () => {
    grip.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 980, clientY: 380 }));
    grip.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 120, clientY: 320 }));
    grip.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 120, clientY: 320 }));
  });
  assert.equal(notch.getAttribute("data-dock-side"), "left", "dragging across viewport snaps notch to left side");

  // Switching modes updates the ported WebGL2 GooeyNav canvas & active mode indicator.
  const gooeyNav = notch.querySelector("[data-gooey-nav]");
  const gooeyCanvas = notch.querySelector("[data-gooey-canvas]");
  assert.ok(gooeyNav && gooeyCanvas, "mode group renders WebGL2 GooeyNav canvas");
  assert.equal(gooeyNav.getAttribute("data-gooey-enabled"), "true");
  assert.equal(gooeyNav.getAttribute("data-gooey-active"), "annotate");
  await act(async () => {
    spacingBtn.click();
  });
  assert.equal(gooeyNav.getAttribute("data-gooey-active"), "spacing");

  // Opening Settings -> Gooey selection opens the React Bits Customize sheet with all 12 controls.
  const settingsBtn = toolbar.querySelector('button[aria-label="Settings"]');
  assert.ok(settingsBtn, "settings button exists on notch");
  if (!shadow.querySelector("[data-open-notch-sheet]")) {
    await act(async () => {
      settingsBtn.click();
    });
  }
  const openSheetBtn = shadow.querySelector("[data-open-notch-sheet]");
  assert.ok(openSheetBtn, "settings panel includes trigger to open Notch & Gooey Nav sheet");
  await act(async () => {
    openSheetBtn.click();
  });
  const sheet = shadow.querySelector("[data-annotate-notch-sheet]");
  assert.ok(sheet, "Notch & Gooey Nav Customize sheet opens");
  for (const key of [
    "preset",
    "color",
    "size",
    "particleCount",
    "spread",
    "animationTime",
    "timeVariance",
    "gooeyness",
    "wobble",
    "frame",
    "hoverEffect",
    "enabled",
  ]) {
    assert.ok(sheet.querySelector(`[data-gooey-control="${key}"]`), `sheet exposes "${key}" control`);
  }

  // Selecting Accent preset updates pill color to #ff5a1f.
  const presetBtn = sheet.querySelector('[data-gooey-control="preset"]');
  await act(async () => {
    presetBtn.click();
  });
  const accentOpt = sheet.querySelector('[data-option-value="accent"]');
  assert.ok(accentOpt, "preset dropdown exposes Accent option");
  await act(async () => {
    accentOpt.click();
  });
  const colorInput = sheet.querySelector('input[data-gooey-control="color"]');
  assert.equal(colorInput.value, "#ff5a1f");

  // Reset restores defaults, ArrowRight increments Particle Count, Frame switch updates notch attribute.
  const resetBtn = sheet.querySelector("[data-gooey-reset]");
  await act(async () => {
    resetBtn.click();
  });
  const particleSlider = sheet.querySelector('[data-gooey-control="particleCount"]');
  assert.equal(particleSlider.getAttribute("aria-valuenow"), "15");
  await act(async () => {
    particleSlider.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(particleSlider.getAttribute("aria-valuenow"), "16");

  const frameSwitch = sheet.querySelector('[data-gooey-control="frame"]');
  await act(async () => {
    frameSwitch.click();
  });
  assert.equal(notch.getAttribute("data-gooey-frame"), "false");

  await act(async () => {
    resetBtn.click();
  });
  assert.equal(particleSlider.getAttribute("aria-valuenow"), "15");
  assert.equal(notch.getAttribute("data-gooey-frame"), "true");

  const closeSheetBtn = sheet.querySelector('button[aria-label="Close notch settings"]');
  assert.ok(closeSheetBtn);
  await act(async () => {
    closeSheetBtn.click();
  });
  assert.equal(shadow.querySelector("[data-annotate-notch-sheet]"), null, "sheet closes cleanly");

  // Exiting returns to the collapsed Apple side notch launcher on the chosen side.
  await act(async () => {
    exitBtn.click();
  });
  const collapsedLauncher = shadow.querySelector('[data-annotate-notch="launcher"]');
  assert.ok(collapsedLauncher, "exiting collapses back to the side notch launcher");
  assert.equal(collapsedLauncher.getAttribute("data-dock-side"), "left");
  assert.equal(errors.length, 0, `expected zero console.error calls, got ${errors.length}`);
});
