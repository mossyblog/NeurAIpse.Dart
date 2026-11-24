import { strict as assert } from "node:assert";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Annotate } from "../dist/index.js";
import { HOST_ATTRIBUTE } from "../dist/ui/shadow-surface.js";
import {
  ANNOTATIONS_KEY_PREFIX,
  GROUP_ATTRIBUTE,
  PREVIEW_ATTRIBUTE,
  REARRANGE_ID_ATTRIBUTE,
  REARRANGE_STYLE_ATTRIBUTE,
} from "../dist/core/index.js";

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
        if (value !== undefined) entries[key] = value;
      } catch {
        // Ignore restricted getters.
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

function setupPage(t, seededAnnotations = []) {
  const dom = new JSDOM(
    '<!doctype html><html><body><main><div id="card" class="card">Hello</div><button id="cta" class="cta">Save</button></main><div id="root"></div></body></html>',
    { url: "https://example.test/" },
  );
  const restoreGlobals = installDomGlobals(dom);
  if (seededAnnotations.length > 0) {
    dom.window.localStorage.setItem(`${ANNOTATIONS_KEY_PREFIX}/`, JSON.stringify(seededAnnotations));
  }

  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  let unmounted = false;

  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => {
      root.unmount();
    });
    await new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
  };

  t.after(async () => {
    await unmount();
    dom.window.close();
    restoreGlobals();
  });

  return { dom, root, unmount };
}

const sampleStyleAnnotation = {
  id: "style-1",
  kind: "style-change",
  x: 0,
  y: 0,
  comment: "",
  element: ".card",
  elementPath: "#card",
  timestamp: 1000,
  styleChange: {
    category: "spacing",
    property: "padding-top",
    from: { value: "8px" },
    to: { value: "24px" },
    group: { count: 1, selectors: ["#card"] },
  },
  styleDetail: {
    groupId: "sp-1",
    labels: [".card"],
    computed: [{ before: "8px", after: "" }],
  },
};

const sampleRearrangeAnnotation = {
  id: "rearrange-1",
  kind: "rearrange",
  x: 20,
  y: 120,
  comment: "",
  element: 'button "Save"',
  elementPath: "#cta",
  timestamp: 2000,
  rearrange: {
    selector: "#cta",
    label: 'button "Save"',
    tagName: "button",
    originalRect: { x: 10, y: 20, width: 100, height: 40 },
    currentRect: { x: 50, y: 40, width: 140, height: 40 },
  },
  rearrangeDetail: {
    relation: null,
    parent: "main",
  },
};

const samplePlacementAnnotation = {
  id: "placement-1",
  kind: "placement",
  x: 15,
  y: 200,
  comment: "Add badge here",
  element: "Badge placement",
  elementPath: "main",
  timestamp: 3000,
  placement: {
    componentType: "Badge",
    text: "New",
    width: 96,
    height: 32,
    near: { name: "main", path: "main", rect: { x: 0, y: 0, width: 800, height: 600 } },
  },
};

test("style previews persist across mode switches and overlay hide/reopen, and revert on Clear", async (t) => {
  const { dom, root } = setupPage(t, [sampleStyleAnnotation]);
  const doc = dom.window.document;
  const card = doc.getElementById("card");

  await act(async () => {
    root.render(createElement(Annotate, { appName: "PersistenceTest" }));
  });

  const host = doc.body.querySelector(`[${HOST_ATTRIBUTE}]`);
  const shadow = host.shadowRoot;

  // Even while collapsed (active = false), stored style preview is live on the page.
  const styleEl = () => doc.head.querySelector(`style[${PREVIEW_ATTRIBUTE}]`);
  assert.ok(styleEl(), "style preview sheet is injected while overlay is collapsed");
  assert.match(styleEl().textContent, /padding-top:\s*24px !important/);
  assert.ok(card.getAttribute(GROUP_ATTRIBUTE), "target element has data-annotate-group attribute");

  // Open overlay -> switch across Design, Measure, and Select modes.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  for (const label of ["Design", "Measure", "Select"]) {
    await act(async () => {
      shadow.querySelector(`button[aria-label="${label}"]`).click();
    });
    assert.ok(styleEl(), `style preview persists in ${label} mode`);
    assert.ok(card.getAttribute(GROUP_ATTRIBUTE), `group attribute persists in ${label} mode`);
  }

  // Exit overlay (active = false): style preview must remain live on the page.
  await act(async () => {
    shadow.querySelector('button[aria-label="Exit"]').click();
  });
  assert.ok(shadow.querySelector('[data-annotate-notch="launcher"]'), "overlay collapsed to launcher");
  assert.ok(styleEl(), "style preview persists after exiting overlay");
  assert.ok(card.getAttribute(GROUP_ATTRIBUTE), "group attribute persists after exiting overlay");

  // Reopen overlay and click Clear all: preview reverts cleanly.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  const clearBtn = shadow.querySelector('button[aria-label="Clear all"]');
  assert.ok(clearBtn, "Clear all button is available when pending style changes exist");
  await act(async () => {
    clearBtn.click();
  });
  assert.equal(styleEl(), null, "style preview sheet is removed on Clear all");
  assert.equal(card.getAttribute(GROUP_ATTRIBUTE), null, "group attribute is removed on Clear all");
});

test("rearrange previews persist across mode switches and overlay hide/reopen, and revert on Reset and Clear", async (t) => {
  const { dom, root } = setupPage(t, [sampleRearrangeAnnotation]);
  const doc = dom.window.document;
  const cta = doc.getElementById("cta");

  await act(async () => {
    root.render(createElement(Annotate, { appName: "PersistenceTest" }));
  });

  const host = doc.body.querySelector(`[${HOST_ATTRIBUTE}]`);
  const shadow = host.shadowRoot;
  const rearrangeStyle = () => doc.head.querySelector(`style[${REARRANGE_STYLE_ATTRIBUTE}]`);

  // Live immediately on mount even when overlay is collapsed.
  assert.ok(rearrangeStyle(), "rearrange preview style is applied on mount");
  assert.match(rearrangeStyle().textContent, /translate:\s*40px 20px !important/);
  assert.match(rearrangeStyle().textContent, /width:\s*140px !important/);
  assert.ok(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), "target element carries data-annotate-rearrange-id");

  // Open overlay, enter Design -> Move (Rearrange) mode, then switch to Select and Measure modes.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  await act(async () => {
    shadow.querySelector('button[aria-label="Design"]').click();
  });
  await act(async () => {
    shadow.querySelector('[data-design-sub-mode="rearrange"]').click();
  });
  assert.ok(rearrangeStyle(), "rearrange preview persists in Move mode");
  assert.ok(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), "rearrange attribute persists in Move mode");
  for (const label of ["Select", "Measure"]) {
    await act(async () => {
      shadow.querySelector(`button[aria-label="${label}"]`).click();
    });
    assert.ok(rearrangeStyle(), `rearrange preview persists in ${label} mode`);
    assert.ok(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), `rearrange attribute persists in ${label} mode`);
  }

  // Exit overlay (active = false): rearrange preview must stay live.
  await act(async () => {
    shadow.querySelector('button[aria-label="Exit"]').click();
  });
  assert.ok(rearrangeStyle(), "rearrange preview persists after exiting overlay");
  assert.ok(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), "rearrange attribute persists after exiting overlay");

  // Reopen overlay -> Design -> Move mode -> Reset individual item reverts cleanly.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  await act(async () => {
    shadow.querySelector('button[aria-label="Design"]').click();
  });
  await act(async () => {
    shadow.querySelector('[data-design-sub-mode="rearrange"]').click();
  });
  const resetBtn = shadow.querySelector('button[aria-label^="Reset"]');
  assert.ok(resetBtn, "Reset button renders in RearrangePanel for persisted item");
  await act(async () => {
    resetBtn.click();
  });
  assert.equal(rearrangeStyle(), null, "rearrange preview style is removed on Reset");
  assert.equal(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), null, "rearrange attribute is removed on Reset");
});

test("layout placements persist as clean wireframe previews when overlay is hidden and clear on Clear all", async (t) => {
  const { dom, root } = setupPage(t, [samplePlacementAnnotation]);
  const doc = dom.window.document;

  await act(async () => {
    root.render(createElement(Annotate, { appName: "PersistenceTest" }));
  });

  const host = doc.body.querySelector(`[${HOST_ATTRIBUTE}]`);
  const shadow = host.shadowRoot;

  // Collapsed (active = false): wireframe preview stays visible without numbered marker chrome.
  const placementEl = () => shadow.querySelector(`[data-annotate-placement="${samplePlacementAnnotation.id}"]`);
  assert.ok(placementEl(), "placement wireframe remains rendered while overlay is hidden");
  assert.equal(shadow.querySelector("[data-annotate-placement-marker]"), null, "marker chrome is hidden while overlay is collapsed");

  // Open overlay -> switch to Annotate mode -> marker chrome appears alongside placement.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  assert.ok(placementEl(), "placement stays rendered when overlay is open in Annotate mode");
  assert.ok(shadow.querySelector("[data-annotate-placement-marker]"), "marker chrome is shown while overlay is active");

  // Exit overlay again: wireframe stays visible, marker chrome hides.
  await act(async () => {
    shadow.querySelector('button[aria-label="Exit"]').click();
  });
  assert.ok(placementEl(), "placement stays rendered after exiting overlay");
  assert.equal(shadow.querySelector("[data-annotate-placement-marker]"), null, "marker chrome hides again on exit");

  // Reopen and Clear all: placement is removed.
  await act(async () => {
    shadow.querySelector('button[aria-label="Start feedback mode"]').click();
  });
  await act(async () => {
    shadow.querySelector('button[aria-label="Clear all"]').click();
  });
  assert.equal(placementEl(), null, "placement is removed on Clear all");
});

test("unmounting <Annotate /> cleanly reverts both style and rearrange DOM previews", async (t) => {
  const { dom, root, unmount } = setupPage(t, [sampleStyleAnnotation, sampleRearrangeAnnotation]);
  const doc = dom.window.document;
  const card = doc.getElementById("card");
  const cta = doc.getElementById("cta");

  await act(async () => {
    root.render(createElement(Annotate, { appName: "PersistenceTest" }));
  });

  assert.ok(doc.head.querySelector(`style[${PREVIEW_ATTRIBUTE}]`), "style preview active before unmount");
  assert.ok(card.getAttribute(GROUP_ATTRIBUTE), "style group attribute active before unmount");
  assert.ok(doc.head.querySelector(`style[${REARRANGE_STYLE_ATTRIBUTE}]`), "rearrange preview active before unmount");
  assert.ok(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), "rearrange id attribute active before unmount");

  await unmount();

  assert.equal(doc.head.querySelector(`style[${PREVIEW_ATTRIBUTE}]`), null, "style preview removed on unmount");
  assert.equal(card.getAttribute(GROUP_ATTRIBUTE), null, "style group attribute removed on unmount");
  assert.equal(doc.head.querySelector(`style[${REARRANGE_STYLE_ATTRIBUTE}]`), null, "rearrange preview removed on unmount");
  assert.equal(cta.getAttribute(REARRANGE_ID_ATTRIBUTE), null, "rearrange id attribute removed on unmount");
});
