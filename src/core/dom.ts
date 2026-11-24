/** Shadow-root aware DOM traversal. No globals; works in any window or jsdom. */

function isShadowRoot(node: Node | null | undefined): node is ShadowRoot {
  return Boolean(node && node.nodeType === 11 && "host" in node && (node as ShadowRoot).host);
}

export function isInShadowDOM(node: Node): boolean {
  return isShadowRoot(node.getRootNode());
}

export function getShadowHost(node: Node): Element | null {
  const root = node.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

/** Parent element, continuing from a shadow root to its host. */
export function parentCrossingShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const parent = el.parentNode;
  return isShadowRoot(parent) ? parent.host : null;
}

/** `Element.closest` that continues through shadow host boundaries. */
export function closestCrossingShadow(el: Element | null, selector: string): Element | null {
  let current: Element | null = el;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const host = getShadowHost(current);
    current = host;
  }
  return null;
}

/** The innermost focused element, following open shadow roots. */
export function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

/** Splits a selector path on ` > ` combinators that are outside attribute brackets. */
export function splitSelectorPath(path: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < path.length; i += 1) {
    const char = path[i];
    if (quote) {
      if (char === "\\") {
        current += char + (path[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (depth === 0 && path.startsWith(" > ", i)) {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    current += char;
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Elements matching a selector path that may cross open shadow roots: each split point
 * is tried as a host boundary. `elementPath` from `getElementPath` round-trips here.
 */
export function querySelectorAllDeep(root: Document | ShadowRoot | Element, path: string): Element[] {
  const segments = splitSelectorPath(path);
  const found = new Set<Element>();
  const visit = (scope: Document | ShadowRoot | Element, rest: string[], depth: number) => {
    if (depth > 8 || rest.length === 0) return;
    try {
      for (const el of Array.from(scope.querySelectorAll(rest.join(" > ")))) found.add(el);
    } catch {
      return;
    }
    for (let k = 1; k < rest.length; k += 1) {
      let hosts: Element[] = [];
      try {
        hosts = Array.from(scope.querySelectorAll(rest.slice(0, k).join(" > ")));
      } catch {
        continue;
      }
      for (const host of hosts) {
        if (host.shadowRoot) visit(host.shadowRoot, rest.slice(k), depth + 1);
      }
    }
  };
  visit(root, segments, 0);
  return Array.from(found);
}
