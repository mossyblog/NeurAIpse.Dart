import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, Fragment, useInsertionEffect } from "react";
import { createRoot } from "react-dom/client";
import { useLocationParts } from "../dist/ui/use-route.js";

test("history changes from insertion effects update the route without React warnings", async (t) => {
  const { window } = new JSDOM('<div id="root"></div>', {
    url: "https://example.test/",
  });
  const navigation = new window.EventTarget();
  Object.defineProperty(window, "navigation", { value: navigation });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const consoleError = t.mock.method(console, "error");
  const container = window.document.getElementById("root");
  const root = createRoot(container);
  t.after(async () => {
    try {
      await act(() => root.unmount());
    } finally {
      window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  });

  function CurrentRoute() {
    const { pathname, hash } = useLocationParts();
    return pathname + hash;
  }

  function HistoryUpdater() {
    useInsertionEffect(() => {
      window.history.pushState(null, "", "/next#section");
      // jsdom does not emit the Navigation API event that follows a history write.
      navigation.dispatchEvent(new window.Event("currententrychange"));
      return () => {
        window.history.replaceState(null, "", "/after#cleanup");
        navigation.dispatchEvent(new window.Event("currententrychange"));
      };
    }, []);
    return null;
  }

  function render(showHistoryUpdater) {
    return act(() => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(CurrentRoute),
          showHistoryUpdater && createElement(HistoryUpdater),
        ),
      );
    });
  }

  await render(false);
  assert.equal(container.textContent, "/");
  await render(true);
  assert.equal(container.textContent, "/next#section");
  await render(false);
  assert.equal(container.textContent, "/after#cleanup");
  assert.deepEqual(consoleError.mock.calls, []);
});
