/**
 * React component-chain classification and the four detail-level modes.
 *
 * | Mode     | Detail   | Keeps                                                              |
 * |----------|----------|--------------------------------------------------------------------|
 * | off      | compact  | nothing (no `reactComponents`)                                     |
 * | filtered | standard | app + design-system components, minus wrapper noise; nearest 5     |
 * | smart    | detailed | app + design-system components (wrappers kept); nearest 10         |
 * | all      | forensic | every named component, framework and libraries included            |
 *
 * Framework = React / Next.js internals. Library = any other node_modules package.
 * Wrapper noise = providers, contexts, boundaries, slots, portals, presence/primitive
 * helpers, anonymous or minified names, and repeats of the component just below.
 */
import type { ReactMode } from "./settings.ts";

export type ComponentOrigin = "app" | "design-system" | "library" | "framework" | "unknown";

export type ComponentEntry = { name: string; origin: ComponentOrigin };

const FRAMEWORK_PATH = /(^|\/)node_modules\/(next|react|react-dom|scheduler|react-server-dom-[\w-]+)\/|(^|\/)next\/dist\//;
const FRAMEWORK_CHUNK = /node_modules_next_|_next_dist_|next_dist_compiled|react-dom|react-server-dom|react_stack/;
const DESIGN_SYSTEM = /(^|\/)packages\/design-system\/|@neuraipse\/design-system|@neuraipse[_+]design-system|packages_design-system/;

/** Next.js / React component names that are framework plumbing, wherever they come from. */
const FRAMEWORK_NAMES = new Set([
  "AppRouter", "Router", "ServerRoot", "HotReload", "ReactDevOverlay", "DevRootHTTPAccessFallbackBoundary",
  "InnerLayoutRouter", "OuterLayoutRouter", "InnerScrollHandler", "LayoutRouter", "RenderFromTemplateContext", "ScrollAndFocusHandler",
  "InnerScrollAndFocusHandler", "RedirectBoundary", "RedirectErrorBoundary", "HTTPAccessFallbackBoundary",
  "HTTPAccessFallbackErrorBoundary", "LoadingBoundary", "ErrorBoundary", "ErrorBoundaryHandler", "GlobalError",
  "SegmentViewNode", "SegmentStateProvider", "SegmentBoundaryTriggerNode", "SegmentTrieNode", "ClientPageRoot",
  "ClientSegmentRoot", "MetadataBoundary", "ViewportBoundary", "OutletBoundary", "AppDevOverlay",
  "AppDevOverlayErrorBoundary", "RootErrorBoundary", "PathnameContextProviderAdapter", "HistoryUpdater",
  "RuntimeStyles", "DevToolsIndicator", "NextDevToolsRoot", "Head", "__next_root_layout_boundary__",
]);

const WRAPPER_NAME =
  /(Provider|Context|Consumer|Boundary|Portal|Presence|Slot|Slottable|Fragment|Suspense|StrictMode|Wrapper|Root)$|^(Primitive|Anonymous|Unknown|ForwardRef|Memo|Lazy)\b|^_|^\$/;

/** Classifies by resolved source path when known, else by bundle URL. */
export function classifyOrigin(location: { path?: string | null; url?: string | null }, name = ""): ComponentOrigin {
  if (FRAMEWORK_NAMES.has(name)) return "framework";
  const path = location.path ?? "";
  if (path) {
    if (FRAMEWORK_PATH.test(path)) return "framework";
    if (DESIGN_SYSTEM.test(path)) return "design-system";
    if (/(^|\/)node_modules\//.test(path)) return "library";
    return "app";
  }
  const url = location.url ?? "";
  if (!url) return "unknown";
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep raw
  }
  // Server component frames carry the module id: `?id=[project]/apps/host/src/app/layout.tsx`.
  const project = /\[project\]\/([^\s+?#]+)/.exec(decoded);
  if (project) return classifyOrigin({ path: project[1] }, name);
  if (FRAMEWORK_CHUNK.test(url)) return "framework";
  if (/node_modules_/.test(url)) return "library";
  return "unknown";
}

/** Names worth showing: not minified (1-2 chars), not lowercase helpers. */
export function isMeaningfulName(name: string): boolean {
  return /^[A-Z][\w$.]*$/.test(name) && name.length > 2;
}

export function isWrapperNoise(name: string): boolean {
  return !isMeaningfulName(name) || WRAPPER_NAME.test(name);
}

const LIMITS: Record<Exclude<ReactMode, "off">, number> = { filtered: 5, smart: 10, all: Infinity };

/**
 * Filters a component chain (outermost first) for a mode and keeps the nearest N.
 * Unknown origins count as app code, since unresolved app chunks look the same.
 */
export function filterComponents(chain: readonly ComponentEntry[], mode: ReactMode): string[] {
  if (mode === "off") return [];
  let kept = chain.filter((entry) => entry.name);
  if (mode !== "all") {
    kept = kept.filter(
      (entry) =>
        entry.origin !== "framework" && entry.origin !== "library" && isMeaningfulName(entry.name),
    );
  }
  if (mode === "filtered") {
    kept = kept.filter((entry) => !isWrapperNoise(entry.name));
    kept = kept.filter((entry, index) => index === kept.length - 1 || kept[index + 1].name !== entry.name);
  }
  const limit = LIMITS[mode];
  const names = kept.map((entry) => entry.name);
  return Number.isFinite(limit) ? names.slice(-limit) : names;
}

/** `Outer > Inner`, or undefined when empty. */
export function formatComponentChain(names: readonly string[]): string | undefined {
  return names.length > 0 ? names.join(" > ") : undefined;
}
