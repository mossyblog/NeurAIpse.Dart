"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { clampNotchCenterY } from "../core/dock.ts";
import { nextDockSide, settingsReactMode } from "../core/settings.ts";
import { captureInFrames, isFixedElement, markerPosition, toPageRect, type ElementCapture } from "../core/capture.ts";
import { copyToClipboard as writeClipboard } from "../core/copy.ts";
import { buildCopyText, copyFormatAttribute, NO_MATCHING_METADATA } from "../core/copy-format.ts";
import { topRect } from "../core/frames.ts";
import { freezePage } from "../core/freeze.ts";
import { identifyElement, normalizeAttributeNames } from "../core/identify.ts";
import {
  areaLabel,
  buildGroupCapture,
  nextDrawingIndex,
  pickAreaTargets,
  rectCenter,
  toggleItem,
  unionRect,
} from "../core/select.ts";
import { generateOutput, readEnvironment } from "../core/serialize.ts";
import { feedbackOnly, type StyleChangeStyle } from "../core/style-output.ts";
import { placementsOf, withoutPlacements } from "../core/layout-placement.ts";
import { createTokenResolver, type TokenResolverApi } from "../core/tokens-dom.ts";
import { colorTokens, guessColorTokens } from "../core/token-catalog.ts";
import { parseColor } from "../core/color.ts";
import { resolveColorValue } from "../core/inspect-dom.ts";
import {
  canSend as canSendNow,
  hasSendTarget,
  nextSendState,
  publicAnnotation,
  sameFeedback,
  SEND_RESULT_MS,
  type SendState,
} from "../core/send.ts";
import { nextSubMode, type InspectorSubMode } from "../core/spacing-modes.ts";
import type { ShortcutAction } from "../core/shortcuts.ts";
import { getRouteKey, loadSettings, loadTheme, saveSettings, saveTheme } from "../core/storage.ts";
import type { Annotation, CopyFormat, Point, Rect, Settings, Theme } from "../core/types.ts";
import { buildWebhookPayload, deliverWebhook, effectiveWebhookUrl, type WebhookEvent } from "../core/webhook.ts";
import { getReactInfo, resolveReactInfo, type ReactInfo } from "../react/index.ts";
import { markerColor } from "./colors.ts";
import { Highlight, type HoverTarget } from "./highlight.tsx";
import { Launcher } from "./launcher.tsx";
import { LayoutMode } from "./layout-mode.tsx";
import { RearrangeMode, useRearrangePreview } from "./rearrange-mode.tsx";
import { rearrangeItems } from "../core/rearrange-output.ts";
import { Markers } from "./markers.tsx";
import { Popup } from "./popup.tsx";
import { AreaOverlay, MultiSelectOverlay } from "./selection-overlay.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import { ColorInspector } from "./color-inspector.tsx";
import { pendingItems, type InspectorContext } from "./inspector-context.ts";
import { SpacingInspector } from "./spacing-inspector.tsx";
import { TypeInspector } from "./type-inspector.tsx";
import { useStyleChanges } from "./use-style-changes.ts";
import { isFromSurface, useShadowSurface, type Surface } from "./shadow-surface.ts";
import { Toolbar } from "./toolbar.tsx";
import { useAnnotations } from "./use-annotations.ts";
import { useDragPosition } from "./use-drag-position.ts";
import { useMarkerTracking } from "./use-marker-tracking.ts";
import { useFrameWindows, usePicker } from "./use-picker.ts";
import { useLocationParts } from "./use-route.ts";
import { useShortcuts } from "./use-shortcuts.ts";
import { useSync } from "./use-sync.ts";

export type AnnotateProps = {
  onAnnotationAdd?: (annotation: Annotation) => void;
  onAnnotationDelete?: (annotation: Annotation) => void;
  onAnnotationUpdate?: (annotation: Annotation) => void;
  onAnnotationsClear?: (annotations: Annotation[]) => void;
  /** Fires even when the clipboard write fails. */
  onCopy?: (output: string) => void;
  copyToClipboard?: boolean;
  /** Applied to the toolbar root. */
  className?: string;
  useHashLocation?: boolean;
  appName?: string;
  enableKeyboardShortcuts?: boolean;
  identifyingAttributes?: string[];
  copyFormat?: CopyFormat;
  /** Where the overlay host is attached (default `document.body`); shown in the top layer. */
  portalContainer?: HTMLElement | ShadowRoot | null;
  /** Awaited on Send. Rejection shows the failed state and keeps the feedback. */
  onSubmit?: (output: string, annotations: Annotation[]) => void | Promise<void>;
  /** Sync server base URL (Agentation-compatible MCP HTTP API). */
  endpoint?: string;
  /** Join this existing session instead of one per route. */
  sessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
  /** http(s) URL for annotation events; the settings value wins when set. */
  webhookUrl?: string;
  /** Shows "Open in editor" in the popup when the annotation has a trustworthy `path:line:column`. */
  onOpenSource?: (sourceFile: string) => void;
  /** Inspector spec 7.1: Style changes as blocks (default) or `- [ ] Change …` TODO lines. */
  styleChangeStyle?: StyleChangeStyle;
};

/** Toolbar tool modes (inspector spec 2): mutually exclusive. */
export type ToolMode = "annotate" | "spacing" | "type" | "color" | "layout" | "rearrange";

type PopupState = {
  route: string;
  point: Point;
  element: string;
  selectedText?: string;
  allowEmpty: boolean;
  closing: boolean;
  shake: number;
} & (
  | { mode: "new"; capture: ElementCapture; target?: Element }
  | { mode: "edit"; annotation: Annotation }
);

type PendingMulti = { route: string; elements: Element[] };

const STATUS_MS = 2000;
const EXIT_MS = 150;
/** Smallest drawn region (px per side) treated as an area. */
const MIN_AREA_SIDE = 8;
const SKIPPED_TAGS = new Set(["script", "style", "link", "meta", "noscript", "template", "br", "head", "title"]);

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Wall clock, outside the component so render purity checks stay meaningful. */
function nowMs(): number {
  return Date.now();
}

function markerPoint(annotation: Annotation): Point {
  return {
    x: (annotation.x / 100) * window.innerWidth,
    y: annotation.isFixed ? annotation.y : annotation.y - window.scrollY,
  };
}

/** Viewport rect in top-viewport px, through same-origin frames. */
const clientRect = (el: Element): Rect => topRect(el);

function isOverlayNode(target: Element | null | undefined, surface: Surface): boolean {
  if (!target) return false;
  return target === surface.host || target.getRootNode() === surface.shadow;
}

/** Page elements that intersect a viewport region, in document order, with their rects. */
function areaCandidates(region: Rect, surface: Surface): { elements: Element[]; rects: Rect[] } {
  const elements: Element[] = [];
  const rects: Rect[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el === surface.host || SKIPPED_TAGS.has(el.localName)) continue;
    const rect = clientRect(el);
    if (rect.width === 0 || rect.height === 0) continue;
    const overlaps =
      rect.x < region.x + region.width &&
      rect.x + rect.width > region.x &&
      rect.y < region.y + region.height &&
      rect.y + rect.height > region.y;
    if (!overlaps) continue;
    elements.push(el);
    rects.push(rect);
  }
  return { elements, rects };
}

/** True when the element (or a descendant) is what the user sees at its centre. */
function isVisibleAt(el: Element, rect: Rect, surface: Surface): boolean {
  const center = rectCenter(rect);
  const top = document
    .elementsFromPoint(center.x, center.y)
    .find((node) => !isOverlayNode(node, surface));
  return Boolean(top && (top === el || el.contains(top)));
}

/** Innermost page element that fully contains the region, for context on an empty area. */
function containerFor(region: Rect, surface: Surface): Element {
  const center = rectCenter(region);
  let el =
    document.elementsFromPoint(center.x, center.y).find((node) => !isOverlayNode(node, surface)) ??
    document.body;
  while (el.parentElement && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.x <= region.x && r.y <= region.y && r.right >= region.x + region.width && r.bottom >= region.y + region.height) break;
    el = el.parentElement;
  }
  return el;
}

/** Dev-only page-feedback toolbar. */
export function Annotate({
  copyToClipboard = true,
  enableKeyboardShortcuts = true,
  useHashLocation = false,
  copyFormat = "markdown",
  ...props
}: AnnotateProps) {
  const surface = useShadowSurface(props.portalContainer);
  const location = useLocationParts();
  const route = getRouteKey(location, useHashLocation);
  const pathname = useHashLocation ? `${location.pathname}${location.hash}` : location.pathname;
  const { annotations, commit, updateRoute } = useAnnotations(route);

  const [active, setActive] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [markersHidden, setMarkersHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [rawPopup, setPopup] = useState<PopupState | null>(null);
  const [rawMulti, setMulti] = useState<PendingMulti | null>(null);
  const [area, setArea] = useState<Rect | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [, setScrollTick] = useState(0);
  const [status, setStatus] = useState<{ text: string; copied: boolean } | null>(null);
  const [sendState, setSendState] = useState<SendState>("idle");
  /** Inspector spec 2: Annotate, Spacing, Type and Colour are mutually exclusive tool modes. */
  const [mode, setMode] = useState<ToolMode>("annotate");
  /** Edit request from an inspector's pending list (re-targets that change). */
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  /** Spacing inspector escape hook: true when it consumed Esc (Lines clears pins first, spec 14.4). */
  const inspectorEscape = useRef<(() => boolean) | null>(null);
  const [setEscape] = useState(() => (handler: (() => boolean) | null) => {
    inspectorEscape.current = handler;
  });
  /** Innermost-first Escape hook for Settings subviews & open scrubber dropdowns. */
  const settingsEscape = useRef<(() => boolean) | null>(null);
  const [setSettingsEscape] = useState(() => (handler: (() => boolean) | null) => {
    settingsEscape.current = handler;
  });
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const [settingsPopoverEl, setSettingsPopoverEl] = useState<HTMLDivElement | null>(null);
  const [settingsHeight, setSettingsHeight] = useState(440);
  const timers = useRef<number[]>([]);
  /** Latest list and route, read after the clipboard await. */
  const latest = useRef({ route, annotations });
  const unfreezeRef = useRef<(() => void) | null>(null);
  /** Live elements for single-element markers, by annotation id. */
  const elements = useRef(new Map<string, Element>());
  /** Captures already saved as annotations, so late React info lands on the right one. */
  const savedFrom = useRef(new WeakMap<ElementCapture, { id: string; route: string }>());
  /** Latest `updateRoute`, for async callbacks (React info, sync). */
  const routeUpdater = useRef(updateRoute);
  const frameWindows = useFrameWindows(active);
  const webhookUrl = effectiveWebhookUrl(settings, props.webhookUrl);
  const sendTargets = { onSubmit: props.onSubmit, endpoint: props.endpoint, webhookUrl };
  const sync = useSync({
    endpoint: props.endpoint,
    sessionId: props.sessionId,
    routeKey: route,
    url: typeof window === "undefined" ? "" : window.location.href,
    annotations,
    useHashLocation,
    apply: (routeKey, update) => routeUpdater.current(routeKey, update),
    onSessionCreated: props.onSessionCreated,
  });

  // Navigation cancels a pending popup or multi-select and drops unsaved text.
  const popup = rawPopup && rawPopup.route === route ? rawPopup : null;
  if (rawPopup && !popup) setPopup(null);
  const multi = rawMulti && rawMulti.route === route ? rawMulti : null;
  if (rawMulti && !multi) setMulti(null);

  const accent = markerColor(settings.annotationColorId);
  const attributeNames = normalizeAttributeNames(props.identifyingAttributes, [
    copyFormatAttribute(copyFormat),
  ]);
  const attribute = copyFormatAttribute(copyFormat);
  /** Numbered feedback only: style changes and measurements have no markers (spec 7.4). */
  const feedback = useMemo(() => withoutPlacements(feedbackOnly(annotations)), [annotations]);
  /** Layout placements (parity spec 10): own numbered outlines, own output section. */
  const placements = useMemo(() => placementsOf(annotations), [annotations]);
  /** Rearrangements (parity spec 10.2): own panel list and output section, no markers. */
  const rearrangeCount = useMemo(() => rearrangeItems(annotations).length, [annotations]);
  const positions = useMarkerTracking(feedback, elements, attributeNames, active && !markersHidden);
  /** Token resolution (inspector spec 5): stylesheet scan with Typed OM, colour guesses from :root. */
  const [resolver] = useState<TokenResolverApi>(() => {
    const created: TokenResolverApi = createTokenResolver(document, {
      isOverlay: (el) => isOverlayNode(el, surface),
      colorGuess: (el, _property, computed): string[] => {
        const color = parseColor(computed) ?? resolveColorValue(computed, el);
        if (!color || color.a === 0) return [];
        return guessColorTokens(color, colorTokens(created.rootVars(), (value) => resolveColorValue(value, el)));
      },
    });
    return created;
  });
  const styles = useStyleChanges({
    annotations,
    commit,
    attributeNames,
    previewEnabled: true,
    sourceFor: (el) => (settings.reactEnabled ? getReactInfo(el, settingsReactMode(settings)).sourceFile : undefined),
    enrich: (el, apply) => {
      if (!settings.reactEnabled) return;
      void resolveReactInfo(el, settingsReactMode(settings)).then((info) => {
        if (info.sourceFile) apply(info.sourceFile);
      });
    },
    onAdd: (annotation) => {
      props.onAnnotationAdd?.(annotation);
      void notifyWebhook("annotation.add", { annotation });
    },
    onUpdate: (annotation) => {
      props.onAnnotationUpdate?.(annotation);
      void notifyWebhook("annotation.update", { annotation });
    },
    onDelete: (annotation) => {
      props.onAnnotationDelete?.(annotation);
      void notifyWebhook("annotation.delete", { annotation });
    },
  });
  const rearrangePreview = useRearrangePreview(annotations);

  useEffect(() => {
    latest.current = { route, annotations };
    routeUpdater.current = updateRoute;
  });
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  useEffect(() => () => unfreezeRef.current?.(), []);

  // Measure actual Settings popover height so viewport clamping stays accurate across views.
  useEffect(() => {
    if (!settingsPopoverEl) return;
    const measure = () => {
      const h = settingsPopoverEl.getBoundingClientRect().height;
      if (h > 0) setSettingsHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? settingsPopoverEl.getBoundingClientRect().height;
      if (h > 0) setSettingsHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
    });
    observer.observe(settingsPopoverEl);
    return () => observer.disconnect();
  }, [settingsPopoverEl]);

  // Dismiss Settings on outside page click without triggering element picking or page actions.
  useEffect(() => {
    if (!active) return;
    let swallowClick = false;
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsOpenRef.current) return;
      if (isFromSurface(event, surface)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      swallowClick = true;
      setSettingsOpen(false);
    };
    const onFollowUp = (event: Event) => {
      if (!swallowClick || isFromSurface(event, surface)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click") swallowClick = false;
    };
    const windows = [window, ...frameWindows];
    for (const win of windows) {
      try {
        win.addEventListener("pointerdown", onPointerDown, true);
        win.addEventListener("pointerup", onFollowUp, true);
        win.addEventListener("mouseup", onFollowUp, true);
        win.addEventListener("click", onFollowUp, true);
      } catch {
        // Frame gone.
      }
    }
    return () => {
      for (const win of windows) {
        try {
          win.removeEventListener("pointerdown", onPointerDown, true);
          win.removeEventListener("pointerup", onFollowUp, true);
          win.removeEventListener("mouseup", onFollowUp, true);
          win.removeEventListener("click", onFollowUp, true);
        } catch {
          // Frame gone.
        }
      }
    };
  }, [active, frameWindows, surface]);

  // Pending multi-select outlines follow the page while it scrolls.
  useEffect(() => {
    if (!multi) return;
    const onScroll = () => setScrollTick((tick) => tick + 1);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [multi]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const flash = (text: string, copied = false) => {
    setStatus({ text, copied });
    later(() => setStatus((current) => (current?.text === text ? null : current)), STATUS_MS);
  };

  const closePopup = () => {
    setPopup((current) => (current ? { ...current, closing: true } : current));
    later(() => setPopup((current) => (current?.closing ? null : current)), EXIT_MS);
  };

  const setFreeze = (next: boolean) => {
    if (next && !unfreezeRef.current) {
      unfreezeRef.current = freezePage(document, {
        exclude: (target) => isOverlayNode(target, surface),
      }).unfreeze;
    } else if (!next && unfreezeRef.current) {
      unfreezeRef.current();
      unfreezeRef.current = null;
    }
    setFrozen(next);
  };

  const deactivate = () => {
    setActive(false);
    setMode("annotate");
    setHover(null);
    setSettingsOpen(false);
    setPopup(null);
    setMulti(null);
    setArea(null);
    setFreeze(false);
  };

  const toggle = () => (active ? deactivate() : setActive(true));

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
  };

  /** Spacing sub-mode (spec 14.1): persisted; switching remounts the inspector, dropping hover and pins, never style changes. */
  const subMode = settings.inspectorSubMode;
  const selectSubMode = (next: InspectorSubMode) => {
    if (next === subMode) return;
    setFocus(null);
    updateSettings({ ...settings, inspectorSubMode: next });
  };

  const updateTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  /**
   * Capture for one element (top page or a same-origin frame), with synchronous React
   * info when React Components is on. Source capture follows the toggle, not the detail
   * level: compact (mode "off") drops the component chain but keeps `sourceFile`.
   */
  const capture = (el: Element, point: Point): ElementCapture => {
    const result = captureInFrames(el, point, { attributeNames });
    if (settings.reactEnabled) {
      const info = getReactInfo(el, settingsReactMode(settings));
      Object.assign(result, info);
    }
    return result;
  };

  /** Resolves source maps in the background, then patches the open popup or the saved annotation. */
  const enrich = (target: ElementCapture, el: Element) => {
    if (!settings.reactEnabled) return;
    const mode = settingsReactMode(settings);
    void resolveReactInfo(el, mode).then((info: ReactInfo) => {
      const patch: ReactInfo = {};
      if (info.sourceFile && info.sourceFile !== target.sourceFile) patch.sourceFile = info.sourceFile;
      if (info.reactComponents && info.reactComponents !== target.reactComponents) patch.reactComponents = info.reactComponents;
      if (Object.keys(patch).length === 0) return;
      Object.assign(target, patch);
      setPopup((current) => (current?.mode === "new" && current.capture === target ? { ...current } : current));
      const saved = savedFrom.current.get(target);
      if (saved) {
        routeUpdater.current(saved.route, (list) =>
          list.map((item) => (item.id === saved.id ? { ...item, ...patch } : item)),
        );
      }
    });
  };

  const notifyWebhook = (
    event: WebhookEvent,
    data: { annotation?: Annotation; annotations?: Annotation[]; output?: string },
  ) => {
    if (!webhookUrl) return Promise.resolve(true);
    const payload = buildWebhookPayload(event, data, { url: window.location.href, timestamp: nowMs() });
    return deliverWebhook(webhookUrl, payload, {
      fetch: (url, init) => window.fetch(url, init),
      attempts: event === "submit" ? 2 : 3,
    });
  };

  const openNew = (result: ElementCapture, point: Point, target?: Element) => {
    setHover(null);
    setSettingsOpen(false);
    setPopup({
      mode: "new",
      route,
      point,
      capture: result,
      target,
      element: result.element,
      selectedText: result.selectedText,
      allowEmpty: attribute != null && result.attributes?.[attribute] != null,
      closing: false,
      shake: 0,
    });
  };

  /** One annotation for several elements; geometry is a snapshot (spec section 9). */
  const openGroup = (els: readonly Element[], extra: Partial<ElementCapture> = {}, anchor?: Rect) => {
    const rects = els.map(clientRect);
    const union = anchor ?? unionRect(rects);
    if (!union) return;
    const center = rectCenter(union);
    const fixed = els.every((el) => isFixedElement(el));
    const marker = markerPosition(center, window.innerWidth, window.scrollY, fixed);
    const captures = els.map((el, index) => capture(el, rectCenter(rects[index])));
    const group = buildGroupCapture(captures, marker, extra);
    enrich(group, els[0]);
    openNew(group, center);
  };

  const addAnnotation = (result: ElementCapture, comment: string, target?: Element) => {
    const annotation: Annotation = { ...result, id: createId(), comment, timestamp: nowMs() };
    if (target) elements.current.set(annotation.id, target);
    savedFrom.current.set(result, { id: annotation.id, route });
    commit([...annotations, annotation]);
    props.onAnnotationAdd?.(annotation);
    void notifyWebhook("annotation.add", { annotation });
  };

  const updateAnnotation = (annotation: Annotation, comment: string) => {
    const updated = { ...annotation, comment, updatedAt: new Date().toISOString() };
    commit(annotations.map((item) => (item.id === annotation.id ? updated : item)));
    props.onAnnotationUpdate?.(updated);
    void notifyWebhook("annotation.update", { annotation: updated });
  };

  const deleteAnnotation = (annotation: Annotation) => {
    elements.current.delete(annotation.id);
    commit(annotations.filter((item) => item.id !== annotation.id));
    props.onAnnotationDelete?.(annotation);
    void notifyWebhook("annotation.delete", { annotation });
  };

  const clearAll = () => {
    setMulti(null);
    if (annotations.length === 0) return;
    const cleared = annotations;
    elements.current.clear();
    commit([]);
    setPopup(null);
    props.onAnnotationsClear?.(cleared);
    void notifyWebhook("annotations.clear", { annotations: cleared });
  };

  /**
   * The user's Clear all (X or button). Style changes and measurements are annotations
   * since I7, so they clear (and their preview reverts) with the feedback, here and on
   * Clear on copy/send.
   */
  const clearEverything = clearAll;

  const copy = async () => {
    if (annotations.length === 0) return;
    const list = annotations;
    const text = buildCopyText(list, copyFormat, () =>
      generateOutput(styles.withComputed(list), pathname, settings.outputDetail, {
        appName: props.appName,
        environment: readEnvironment(window),
        styleChangeStyle: props.styleChangeStyle,
      }),
    );
    if (text == null) {
      // No clipboard write and no auto-clear: the feedback stays put.
      flash(NO_MATCHING_METADATA);
      return;
    }
    const ok = copyToClipboard ? await writeClipboard(text, document) : true;
    props.onCopy?.(text);
    if (!ok) {
      flash("Copy failed");
      return;
    }
    flash("Copied", true);
    // Auto-clear only what was copied: skip if the list or route changed during the await.
    const unchanged = sameFeedback(latest.current.annotations, list) && latest.current.route === route;
    if (settings.autoClearAfterCopy && unchanged) clearAll();
  };

  const sendAllowed = canSendNow(annotations.length, sendTargets, sendState);

  /** Pending list Edit: switch to the change's inspector and re-target it. */
  const editStyle = (id: string) => {
    const target = annotations.find((a) => a.id === id);
    const category = target?.styleChange?.category;
    if (!category) return;
    const next: ToolMode = category === "spacing" ? "spacing" : category === "typography" ? "type" : "color";
    if (next !== mode) selectMode(next);
    // Editing a spacing change needs the region panel, which lives in Box.
    if (next === "spacing") selectSubMode("box");
    setFocus((current) => ({ id, n: (current?.n ?? 0) + 1 }));
  };

  const inspectorCtx: InspectorContext = {
    surface,
    attributeNames,
    resolver,
    styles,
    pending: pendingItems(styles.items),
    onEdit: editStyle,
    onCopy: () => void copy(),
    focus,
    notify: (text) => flash(text),
    subMode,
    handles: settings.inspectorHandles,
    guides: settings.inspectorGuides,
    setEscape,
  };

  /** Send (spec section 11): structured markdown regardless of copyFormat, to every target. */
  const send = async () => {
    if (!sendAllowed) return;
    const list = annotations;
    setSendState((state) => nextSendState(state, "start"));
    const output = generateOutput(styles.withComputed(list), pathname, settings.outputDetail, {
      appName: props.appName,
      environment: readEnvironment(window),
      styleChangeStyle: props.styleChangeStyle,
    });
    let ok = true;
    try {
      if (props.onSubmit) await props.onSubmit(output, list.map(publicAnnotation));
      if (webhookUrl) ok = (await notifyWebhook("submit", { annotations: list, output })) && ok;
      if (props.endpoint) ok = (await sync.flush()) && ok;
    } catch {
      ok = false;
    }
    setSendState((state) => nextSendState(state, ok ? "success" : "failure"));
    flash(ok ? "Sent" : "Send failed");
    later(() => setSendState((state) => nextSendState(state, "reset")), SEND_RESULT_MS);
    // Failure keeps everything. Success clears only what was sent, and only if asked to.
    const unchanged = sameFeedback(latest.current.annotations, list) && latest.current.route === route;
    if (ok && settings.autoClearAfterCopy && unchanged) {
      sync.retainOnServer(list.map((item) => item.id));
      clearAll();
    }
  };

  const onAction = (action: ShortcutAction) => {
    if (action === "freeze") setFreeze(!frozen);
    else if (action === "hide") setMarkersHidden((hidden) => !hidden);
    else if (action === "copy") void copy();
    else if (action === "clear") clearEverything();
    else if (action === "send") void send();
    else if (action === "spacing" || action === "type" || action === "color") selectMode(mode === action ? "annotate" : action);
    else if (action === "subMode") selectSubMode(nextSubMode(subMode));
    else if (action === "layout") selectMode(mode === "layout" ? "annotate" : "layout");
    else if (action === "rearrange") selectMode(mode === "rearrange" ? "annotate" : "rearrange");
  };

  const onEscape = () => {
    // Innermost-first: open scrubber dropdowns / Settings subviews -> Settings -> Popup ->
    // active inspector selection/pins -> tool mode -> multi-select -> deactivate.
    if (settingsOpen) {
      if (settingsEscape.current?.()) return;
      setSettingsOpen(false);
      return;
    }
    if (popup) {
      closePopup();
      return;
    }
    if (inspectorEscape.current?.()) return;
    if (mode !== "annotate") {
      selectMode("annotate");
      return;
    }
    if (multi) {
      setMulti(null);
      return;
    }
    deactivate();
  };

  useShortcuts({
    active,
    enableKeyboardShortcuts,
    annotationCount: feedback.length + placements.length,
    styleChangeCount: styles.items.length,
    rearrangeCount,
    canSend: hasSendTarget(sendTargets),
    sendState,
    spacingActive: active && mode === "spacing",
    frameWindows,
    onToggle: toggle,
    onEscape,
    onAction,
  });

  usePicker({
    surface,
    frameWindows,
    active: active && mode === "annotate" && !settingsOpen,
    popupOpen: Boolean(popup),
    blockInteractions: settings.blockInteractions,
    multiPending: Boolean(multi && multi.elements.length > 0),
    onHover: (element) => {
      if (!element) return setHover(null);
      setHover({ rect: clientRect(element), name: identifyElement(element, attributeNames).name });
    },
    onPick: (element, point, selectedText) => {
      setMulti(null);
      const result = capture(element, point);
      if (selectedText) result.selectedText = selectedText;
      enrich(result, element);
      openNew(result, point, element);
    },
    onMultiToggle: (element) =>
      setMulti((current) => ({
        route,
        elements: toggleItem(current && current.route === route ? current.elements : [], element),
      })),
    onMultiRelease: () => {
      if (!multi || multi.elements.length === 0) return;
      const els = multi.elements.filter((el) => el.isConnected);
      setMulti(null);
      if (els.length === 1) {
        const center = rectCenter(clientRect(els[0]));
        const result = capture(els[0], center);
        enrich(result, els[0]);
        openNew(result, center, els[0]);
      } else if (els.length > 1) {
        openGroup(els);
      }
    },
    onAreaChange: setArea,
    onAreaDone: (region, start) => {
      setArea(null);
      if (region.width < MIN_AREA_SIDE || region.height < MIN_AREA_SIDE) return;
      setMulti(null);
      const drawingIndex = nextDrawingIndex(annotations);
      const { elements: els, rects } = areaCandidates(region, surface);
      const picked = pickAreaTargets(
        region,
        rects,
        (child, ancestor) => els[ancestor].contains(els[child]),
        { start, exclude: (index) => !isVisibleAt(els[index], rects[index], surface) },
      );
      if (picked.length > 0) {
        openGroup(picked.map((index) => els[index]), { drawingIndex });
        return;
      }
      // Empty region: annotate the region itself, with its container for context.
      const center = rectCenter(region);
      const container = containerFor(region, surface);
      const fixed = isFixedElement(container);
      const base = capture(container, center);
      delete base.cssClasses;
      delete base.attributes;
      delete base.isMultiSelect;
      openNew(
        {
          ...base,
          element: areaLabel(region),
          boundingBox: toPageRect(region, { x: window.scrollX, y: window.scrollY }, fixed),
          drawingIndex,
        },
        center,
      );
    },
    onOutsideClick: () =>
      setPopup((current) => (current ? { ...current, shake: current.shake + 1 } : current)),
  });

  function selectMode(next: ToolMode) {
    if (next === mode) return;
    setHover(null);
    setPopup(null);
    setMulti(null);
    setArea(null);
    setMode(next);
  }

  const onMarkerSelect = (annotation: Annotation) => {
    if (settings.markerClickBehavior === "delete") {
      deleteAnnotation(annotation);
      return;
    }
    const tracked = positions.get(annotation.id) ?? undefined;
    setSettingsOpen(false);
    setPopup({
      mode: "edit",
      route,
      point: tracked
        ? { x: tracked.x - (annotation.isFixed ? 0 : window.scrollX), y: tracked.y - (annotation.isFixed ? 0 : window.scrollY) }
        : markerPoint(annotation),
      annotation,
      element: annotation.element,
      selectedText: annotation.selectedText,
      allowEmpty: false,
      closing: false,
      shake: 0,
    });
  };

  const {
    side: dockSide,
    centerY: notchCenterY,
    dragging: notchDragging,
    viewport,
    dockRef,
    handlers,
    dragHandlers,
  } = useDragPosition(toggle, {
    side: settings.dockSide,
    onSideChange: (nextSide) => updateSettings({ ...settings, dockSide: nextSide }),
    expanded: active,
  });

  const toggleDockSide = () =>
    updateSettings({ ...settings, dockSide: nextDockSide(settings.dockSide) });

  const settingsCenterY = clampNotchCenterY(notchCenterY, settingsHeight, viewport.height, 16);
  const rootInsets = {
    "--annotate-inset-right": active && dockSide === "right" ? "64px" : "16px",
    "--annotate-inset-left": active && dockSide === "left" ? "64px" : "16px",
  } as CSSProperties;

  const settingsPanel = active && settingsOpen && (
    <div
      ref={setSettingsPopoverEl}
      data-annotate-settings-popover=""
      style={{ top: settingsCenterY, transform: "translateY(-50%)" }}
      className={cn(
        "pointer-events-auto fixed z-30",
        dockSide === "right" ? "right-[64px]" : "left-[64px]",
      )}
    >
      <SettingsPanel
        settings={settings}
        theme={theme}
        dockSide={dockSide}
        endpoint={props.endpoint}
        syncStatus={sync.status}
        sessionId={sync.sessionId}
        webhookUrlProp={props.webhookUrl}
        onChange={updateSettings}
        onThemeChange={updateTheme}
        onClose={() => setSettingsOpen(false)}
        setEscape={setSettingsEscape}
      />
    </div>
  );

  return createPortal(
    <div
      data-agent-hidden
      data-theme={theme}
      data-agentation-theme={theme}
      data-style="clean"
      data-dock-side={dockSide}
      data-frozen={frozen || undefined}
      style={rootInsets}
      className="text-foreground"
    >
      {active && !markersHidden && (
        <Markers
          annotations={feedback}
          color={accent}
          positions={positions}
          activeId={popup?.mode === "edit" ? popup.annotation.id : undefined}
          onSelect={onMarkerSelect}
        />
      )}
      {active && mode === "spacing" && <SpacingInspector key={subMode} ctx={inspectorCtx} />}
      {active && mode === "type" && <TypeInspector ctx={inspectorCtx} />}
      {active && mode === "color" && <ColorInspector ctx={inspectorCtx} />}
      {active && mode === "rearrange" && (
        <RearrangeMode
          ctx={{
            surface,
            attributeNames,
            annotations,
            commit,
            rearrangePreview,
            color: accent,
            sourceFor: (el) => (settings.reactEnabled ? getReactInfo(el, settingsReactMode(settings)).sourceFile : undefined),
            onAdd: (annotation) => {
              props.onAnnotationAdd?.(annotation);
              void notifyWebhook("annotation.add", { annotation });
            },
            onUpdate: (annotation) => {
              props.onAnnotationUpdate?.(annotation);
              void notifyWebhook("annotation.update", { annotation });
            },
            onDelete: (annotation) => {
              props.onAnnotationDelete?.(annotation);
              void notifyWebhook("annotation.delete", { annotation });
            },
            notify: (text) => flash(text),
            setEscape,
            onCopy: () => void copy(),
          }}
        />
      )}
      {((active && mode === "layout") || ((!active || !markersHidden) && placements.length > 0)) && (
        <LayoutMode
          key={active && mode === "layout" ? "edit" : "view"}
          placements={placements}
          interactive={active && mode === "layout"}
          showChrome={active}
          accent={accent}
          surface={surface}
          attributeNames={attributeNames}
          setEscape={setEscape}
          apply={(update) => updateRoute(route, update)}
          onAdd={(annotation) => {
            props.onAnnotationAdd?.(annotation);
            void notifyWebhook("annotation.add", { annotation });
          }}
          onUpdate={(annotation) => {
            props.onAnnotationUpdate?.(annotation);
            void notifyWebhook("annotation.update", { annotation });
          }}
          onDelete={(annotation) => {
            props.onAnnotationDelete?.(annotation);
            void notifyWebhook("annotation.delete", { annotation });
          }}
        />
      )}
      {active && mode === "annotate" && hover && !popup && !area && <Highlight target={hover} color={accent} />}
      {active && multi && multi.elements.length > 0 && (
        <MultiSelectOverlay rects={multi.elements.map(clientRect)} color={accent} />
      )}
      {active && area && <AreaOverlay region={area} color={accent} />}
      {popup && (
        <Popup
          key={popup.mode === "edit" ? popup.annotation.id : `${popup.point.x},${popup.point.y}`}
          element={popup.element}
          selectedText={popup.selectedText}
          initialComment={popup.mode === "edit" ? popup.annotation.comment : ""}
          editing={popup.mode === "edit"}
          allowEmpty={popup.allowEmpty}
          accent={accent}
          sourceFile={popup.mode === "edit" ? popup.annotation.sourceFile : popup.capture.sourceFile}
          onOpenSource={props.onOpenSource}
          point={popup.point}
          dockSide={dockSide}
          closing={popup.closing}
          shake={popup.shake}
          onCancel={closePopup}
          onDelete={() => {
            if (popup.mode === "edit") deleteAnnotation(popup.annotation);
            closePopup();
          }}
          onSubmit={(comment) => {
            if (popup.mode === "edit") updateAnnotation(popup.annotation, comment);
            else addAnnotation(popup.capture, comment, popup.target);
            closePopup();
          }}
        />
      )}
      <div data-annotate-dock="" data-dock-side={dockSide} className="pointer-events-none">
        {settingsPanel}
        {active ? (
          <Toolbar
            className={props.className}
            annotationCount={feedback.length}
            styleChangeCount={styles.items.length}
            placementCount={placements.length}
            rearrangeCount={rearrangeCount}
            mode={mode}
            onSelectMode={selectMode}
            subMode={subMode}
            onSelectSubMode={selectSubMode}
            handles={settings.inspectorHandles}
            guides={settings.inspectorGuides}
            onToggleHandles={() => updateSettings({ ...settings, inspectorHandles: !settings.inspectorHandles })}
            onToggleGuides={() => updateSettings({ ...settings, inspectorGuides: !settings.inspectorGuides })}
            markersHidden={markersHidden}
            frozen={frozen}
            settingsOpen={settingsOpen}
            copied={Boolean(status?.copied)}
            status={status?.text}
            sendState={sendState}
            sendAvailable={hasSendTarget(sendTargets)}
            syncStatus={sync.status}
            onSend={() => void send()}
            onToggleMarkers={() => setMarkersHidden((hidden) => !hidden)}
            onToggleFreeze={() => setFreeze(!frozen)}
            onCopy={() => void copy()}
            onClear={clearEverything}
            onToggleSettings={() =>
              setSettingsOpen((open) => {
                if (!open) setPopup(null);
                return !open;
              })
            }
            onExit={deactivate}
            dragHandlers={dragHandlers}
            theme={theme}
            dockSide={dockSide}
            gooeyNav={settings.gooeyNav}
            onToggleDockSide={toggleDockSide}
            centerY={notchCenterY}
            dragging={notchDragging}
            notchRef={dockRef}
          />
        ) : (
          <Launcher
            annotationCount={annotations.length}
            side={dockSide}
            centerY={notchCenterY}
            dragging={notchDragging}
            notchRef={dockRef}
            handlers={handlers}
          />
        )}
      </div>
    </div>,
    surface.mount,
  );
}
