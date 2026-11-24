import { DEFAULT_INSPECTOR_SUB_MODE, isInspectorSubMode } from "./spacing-modes.ts";
import type { DockSide, OutputDetail, Settings, Theme } from "./types.ts";

export const DOCK_SIDES: readonly DockSide[] = ["left", "right"];

export function isDockSide(value: unknown): value is DockSide {
  return value === "left" || value === "right";
}

export function nextDockSide(side: DockSide): DockSide {
  return side === "right" ? "left" : "right";
}

export const OUTPUT_DETAILS: readonly OutputDetail[] = [
  "compact",
  "standard",
  "detailed",
  "forensic",
];

export const OUTPUT_DETAIL_LABELS: Record<OutputDetail, string> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  forensic: "Forensic",
};

export type ReactMode = "off" | "filtered" | "smart" | "all";

/** Marker colour ids in swatch order. */
export const MARKER_COLOR_IDS: readonly string[] = [
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
];

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  outputDetail: "standard",
  autoClearAfterCopy: false,
  annotationColorId: "blue",
  blockInteractions: true,
  reactEnabled: true,
  markerClickBehavior: "edit",
  webhookUrl: "",
  webhooksEnabled: true,
  inspectorSubMode: DEFAULT_INSPECTOR_SUB_MODE,
  inspectorHandles: false,
  inspectorGuides: false,
  dockSide: "right",
});

/** Compact -> Standard -> Detailed -> Forensic -> Compact. */
export function nextOutputDetail(current: OutputDetail): OutputDetail {
  const index = OUTPUT_DETAILS.indexOf(current);
  return OUTPUT_DETAILS[(index + 1) % OUTPUT_DETAILS.length];
}

export function reactModeForDetail(detail: OutputDetail): ReactMode {
  switch (detail) {
    case "compact":
      return "off";
    case "standard":
      return "filtered";
    case "detailed":
      return "smart";
    case "forensic":
      return "all";
  }
}

/** 1-based level for the Output Detail dots: compact 1 ... forensic 4. */
export function outputDetailLevel(detail: OutputDetail): number {
  return OUTPUT_DETAILS.indexOf(detail) + 1;
}

/** React capture mode for the current settings: off when React Components is disabled. */
export function settingsReactMode(settings: Pick<Settings, "outputDetail" | "reactEnabled">): ReactMode {
  return settings.reactEnabled ? reactModeForDetail(settings.outputDetail) : "off";
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** True only for absolute http: or https: URLs. */
export function isValidWebhookUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.host);
  } catch {
    return false;
  }
}

/** Settings-panel message for a webhook URL; null when empty or valid. */
export function webhookUrlError(url: string): string | null {
  if (!url.trim() || isValidWebhookUrl(url)) return null;
  return "Use an http:// or https:// URL";
}

/** The webhook to send to, or null when disabled, empty or not http(s). */
export function activeWebhookUrl(settings: Pick<Settings, "webhookUrl" | "webhooksEnabled">): string | null {
  return settings.webhooksEnabled && isValidWebhookUrl(settings.webhookUrl)
    ? settings.webhookUrl.trim()
    : null;
}

function isOutputDetail(value: unknown): value is OutputDetail {
  return typeof value === "string" && (OUTPUT_DETAILS as readonly string[]).includes(value);
}

/** Merges a stored value over the defaults, dropping fields with the wrong type. */
export function normalizeSettings(value: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== "object") return settings;
  const input = value as Record<string, unknown>;
  if (isOutputDetail(input.outputDetail)) settings.outputDetail = input.outputDetail;
  if (input.markerClickBehavior === "edit" || input.markerClickBehavior === "delete") {
    settings.markerClickBehavior = input.markerClickBehavior;
  }
  for (const key of ["autoClearAfterCopy", "blockInteractions", "reactEnabled", "webhooksEnabled", "inspectorHandles", "inspectorGuides"] as const) {
    if (typeof input[key] === "boolean") settings[key] = input[key];
  }
  if (typeof input.annotationColorId === "string" && MARKER_COLOR_IDS.includes(input.annotationColorId)) {
    settings.annotationColorId = input.annotationColorId;
  }
  if (typeof input.webhookUrl === "string") settings.webhookUrl = input.webhookUrl;
  if (isInspectorSubMode(input.inspectorSubMode)) settings.inspectorSubMode = input.inspectorSubMode;
  if (isDockSide(input.dockSide)) settings.dockSide = input.dockSide;
  return settings;
}
