/**
 * React component chain and source-file resolution. Best effort, development builds only.
 *
 * React 19 removed `fiber._debugSource`. Techniques, tried in this order:
 *  1. Owner stacks: every dev fiber has `_debugStack` (an Error captured at JSX creation).
 *     The call-site frame below `jsx`/`jsxDEV` is inside the owner's render. Its bundle
 *     position is mapped through the bundle's source map (`<chunk>.js.map`, sectioned in
 *     Turbopack) to `path:line:column`. Verified working in the Next 16 / React 19.3 host.
 *  2. A `data-*` source stamp written by a compiler plugin (`data-source-file`,
 *     `data-source`, `data-inspector-relative-path` + line + column). None is present in
 *     the host app; supported for apps that add one.
 *  3. None: `sourceFile` is omitted.
 * Component names come from fiber types (function/class/forwardRef/memo). Their origin
 * (app, design-system, library, framework) comes from the bundle file of a frame inside
 * their own render, refined through the source map when it resolves.
 */
import { isTrustworthySourceFile, formatSourceFile, createSourceResolver, type SourceResolver } from "../core/source-map.ts";
import { classifyOrigin, filterComponents, formatComponentChain, type ComponentEntry } from "../core/react-filter.ts";
import type { ReactMode } from "../core/settings.ts";
import { callSiteFrames, componentCallSite, frameForFunction, parseStack, type StackFrame } from "../core/stack.ts";

export type ReactInfo = { reactComponents?: string; sourceFile?: string };

type FiberType = {
  displayName?: string;
  name?: string;
  render?: FiberType;
  type?: FiberType;
};

export type Fiber = {
  tag: number;
  type: FiberType | string | null;
  return: Fiber | null;
  _debugOwner?: Fiber | null;
  _debugStack?: { stack?: string } | null;
};

/** Function, class, forwardRef, memo and simple-memo fibers. */
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
const MAX_FIBERS = 200;

/** The fiber React attached to a DOM node (`__reactFiber$<random>`). */
export function getFiber(node: Element): Fiber | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$")) return (node as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
}

/** Nearest element (crossing shadow hosts) that React manages. */
function nearestFiber(element: Element): Fiber | null {
  let current: Node | null = element;
  while (current) {
    if (current.nodeType === 1) {
      const fiber = getFiber(current as Element);
      if (fiber) return fiber;
    }
    const parent: Node | null = current.parentNode;
    current = parent && parent.nodeType === 11 && "host" in parent ? (parent as ShadowRoot).host : parent;
  }
  return null;
}

export function componentName(fiber: Pick<Fiber, "type">): string {
  const type = fiber.type;
  if (!type || typeof type === "string") return "";
  return (
    type.displayName ||
    type.name ||
    type.render?.displayName ||
    type.render?.name ||
    type.type?.displayName ||
    type.type?.name ||
    ""
  );
}

function stackOf(fiber: Fiber): StackFrame[] {
  const stack = fiber._debugStack?.stack;
  return typeof stack === "string" ? parseStack(stack) : [];
}

type ChainEntry = { fiber: Fiber; name: string; frame: StackFrame | null };

/** Component fibers (outermost first) plus, for each, a frame inside its own render. */
export function readChain(element: Element): { chain: ChainEntry[]; callSites: StackFrame[] } {
  const start = nearestFiber(element);
  const fibers: Fiber[] = [];
  for (let fiber = start, n = 0; fiber && n < MAX_FIBERS; fiber = fiber.return, n += 1) fibers.push(fiber);
  const ownFrame = new Map<Fiber, StackFrame>();
  const callSites: StackFrame[] = [];
  for (const fiber of fibers) {
    const frames = stackOf(fiber);
    if (frames.length === 0) continue;
    const site = componentCallSite(frames);
    if (site) callSites.push(site);
    const owner = fiber._debugOwner;
    if (owner && !ownFrame.has(owner)) {
      // Class components render from a `render` method, so fall back to the first call site.
      const frame = frameForFunction(frames, componentName(owner)) ?? callSiteFrames(frames)[0] ?? null;
      if (frame) ownFrame.set(owner, frame);
    }
  }
  const chain: ChainEntry[] = [];
  for (const fiber of fibers) {
    if (!COMPONENT_TAGS.has(fiber.tag)) continue;
    chain.unshift({ fiber, name: componentName(fiber), frame: ownFrame.get(fiber) ?? null });
  }
  return { chain, callSites };
}

const STAMP_ATTRIBUTES = ["data-source-file", "data-source", "data-inspector-source"];

/** A compiler-written source stamp on the element or its nearest stamped ancestor. */
export function readSourceStamp(element: Element): string | undefined {
  for (let el: Element | null = element; el; el = el.parentElement) {
    for (const name of STAMP_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (isTrustworthySourceFile(value)) return value;
    }
    const path = el.getAttribute("data-inspector-relative-path");
    const line = el.getAttribute("data-inspector-line");
    const column = el.getAttribute("data-inspector-column") ?? "1";
    if (path && line) {
      const value = `${path}:${line}:${column}`;
      if (isTrustworthySourceFile(value)) return value;
    }
  }
  return undefined;
}

function chainEntries(chain: readonly ChainEntry[], paths?: Map<ChainEntry, string | null>): ComponentEntry[] {
  return chain.map((entry) => ({
    name: entry.name,
    origin: classifyOrigin({ path: paths?.get(entry) ?? null, url: entry.frame?.url ?? null }, entry.name),
  }));
}

/**
 * Synchronous best effort: component names classified by bundle URL, and a stamped
 * source file if one exists. `resolveReactInfo` refines both through source maps.
 */
export function getReactInfo(element: Element, mode: ReactMode = "filtered"): ReactInfo {
  const info: ReactInfo = {};
  try {
    const { chain } = readChain(element);
    const components = formatComponentChain(filterComponents(chainEntries(chain), mode));
    if (components) info.reactComponents = components;
    const stamp = readSourceStamp(element);
    if (stamp) info.sourceFile = stamp;
  } catch {
    // Unexpected fiber shapes: no React info.
  }
  return info;
}

let defaultResolver: SourceResolver | null = null;

function resolverFor(win: Window): SourceResolver {
  if (!defaultResolver) {
    defaultResolver = createSourceResolver(async (url) => {
      try {
        const response = await win.fetch(url, { credentials: "same-origin" });
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    }, win.location.origin);
  }
  return defaultResolver;
}

/**
 * Full resolution: source file from the nearest owner-stack call site that maps to a
 * project file (outside node_modules), falling back to a `data-*` stamp; component origins
 * refined by their mapped paths.
 */
export async function resolveReactInfo(
  element: Element,
  mode: ReactMode,
  resolver: SourceResolver = resolverFor(window),
): Promise<ReactInfo> {
  const info: ReactInfo = {};
  try {
    const { chain, callSites } = readChain(element);
    for (const site of callSites) {
      const position = await resolver.resolve(site);
      if (!position) continue;
      const value = formatSourceFile(position.path, position.line, position.column);
      if (isTrustworthySourceFile(value)) {
        info.sourceFile = value;
        break;
      }
    }
    info.sourceFile ??= readSourceStamp(element);
    if (mode !== "off") {
      const paths = new Map<ChainEntry, string | null>();
      await Promise.all(
        chain.map(async (entry) => {
          if (!entry.frame) return;
          const position = await resolver.resolve(entry.frame);
          paths.set(entry, position?.path ?? null);
        }),
      );
      const components = formatComponentChain(filterComponents(chainEntries(chain, paths), mode));
      if (components) info.reactComponents = components;
    }
  } catch {
    // Best effort only.
  }
  if (!info.sourceFile) delete info.sourceFile;
  return info;
}
