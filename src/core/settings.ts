import { DEFAULT_INSPECTOR_SUB_MODE, isInspectorSubMode } from "./spacing-modes.ts";
import type {
  DockSide,
  GooeyNavPreset,
  GooeyNavSettings,
  GooeyNavSize,
  OutputDetail,
  Settings,
  Theme,
} from "./types.ts";

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const GOOEY_NAV_BOUNDS = Object.freeze({
  particleCount: { min: 1, max: 32, step: 1 },
  spread: { min: 0, max: 120, step: 2 },
  animationTime: { min: 200, max: 1500, step: 50 },
  timeVariance: { min: 0, max: 1000, step: 50 },
  gooeyness: { min: 0, max: 1, step: 0.05 },
  wobble: { min: 0, max: 1, step: 0.05 },
});

type GooeyNavPresetFeel = Pick<
  GooeyNavSettings,
  "color" | "colors" | "particleCount" | "spread" | "animationTime" | "timeVariance" | "gooeyness" | "wobble"
>;

export const GOOEY_NAV_PRESETS: Record<Exclude<GooeyNavPreset, "custom">, GooeyNavPresetFeel> = Object.freeze({
  classic: {
    color: "",
    colors: [],
    particleCount: 15,
    spread: 56,
    animationTime: 600,
    timeVariance: 300,
    gooeyness: 0.5,
    wobble: 0.5,
  },
  accent: {
    color: "#ff5a1f",
    colors: ["#ff5a1f", "#ff8a3a", "#ffb020"],
    particleCount: 15,
    spread: 56,
    animationTime: 600,
    timeVariance: 300,
    gooeyness: 0.5,
    wobble: 0.5,
  },
  splash: {
    color: "",
    colors: [],
    particleCount: 24,
    spread: 84,
    animationTime: 600,
    timeVariance: 450,
    gooeyness: 0.65,
    wobble: 0.5,
  },
  calm: {
    color: "",
    colors: [],
    particleCount: 8,
    spread: 28,
    animationTime: 520,
    timeVariance: 300,
    gooeyness: 0.5,
    wobble: 0.2,
  },
});

export const DEFAULT_GOOEY_NAV_SETTINGS: Readonly<GooeyNavSettings> = Object.freeze({
  enabled: true,
  preset: "classic",
  color: "",
  colors: Object.freeze([]) as unknown as string[],
  size: "md",
  frame: true,
  hoverEffect: true,
  animationTime: 600,
  particleCount: 15,
  spread: 56,
  timeVariance: 300,
  gooeyness: 0.5,
  wobble: 0.5,
});

function isGooeyNavPreset(value: unknown): value is GooeyNavPreset {
  return value === "classic" || value === "accent" || value === "splash" || value === "calm" || value === "custom";
}

function isGooeyNavSize(value: unknown): value is GooeyNavSize {
  return value === "sm" || value === "md" || value === "lg";
}

function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

export function applyGooeyNavPreset(
  current: GooeyNavSettings,
  preset: Exclude<GooeyNavPreset, "custom">,
): GooeyNavSettings {
  const target = GOOEY_NAV_PRESETS[preset];
  return {
    ...current,
    preset,
    color: target.color,
    colors: [...target.colors],
    particleCount: target.particleCount,
    spread: target.spread,
    animationTime: target.animationTime,
    timeVariance: target.timeVariance,
    gooeyness: target.gooeyness,
    wobble: target.wobble,
  };
}

export function isGooeyNavModified(settings: GooeyNavSettings): boolean {
  return (
    settings.enabled !== DEFAULT_GOOEY_NAV_SETTINGS.enabled ||
    settings.preset !== DEFAULT_GOOEY_NAV_SETTINGS.preset ||
    settings.color !== DEFAULT_GOOEY_NAV_SETTINGS.color ||
    settings.colors.length !== DEFAULT_GOOEY_NAV_SETTINGS.colors.length ||
    settings.colors.some((c, i) => c !== DEFAULT_GOOEY_NAV_SETTINGS.colors[i]) ||
    settings.size !== DEFAULT_GOOEY_NAV_SETTINGS.size ||
    settings.frame !== DEFAULT_GOOEY_NAV_SETTINGS.frame ||
    settings.hoverEffect !== DEFAULT_GOOEY_NAV_SETTINGS.hoverEffect ||
    settings.animationTime !== DEFAULT_GOOEY_NAV_SETTINGS.animationTime ||
    settings.particleCount !== DEFAULT_GOOEY_NAV_SETTINGS.particleCount ||
    settings.spread !== DEFAULT_GOOEY_NAV_SETTINGS.spread ||
    settings.timeVariance !== DEFAULT_GOOEY_NAV_SETTINGS.timeVariance ||
    settings.gooeyness !== DEFAULT_GOOEY_NAV_SETTINGS.gooeyness ||
    settings.wobble !== DEFAULT_GOOEY_NAV_SETTINGS.wobble
  );
}

export function normalizeGooeyNavSettings(value: unknown): GooeyNavSettings {
  const base: GooeyNavSettings = {
    ...DEFAULT_GOOEY_NAV_SETTINGS,
    colors: [],
  };
  if (!value || typeof value !== "object") return base;
  const input = value as Record<string, unknown>;
  if (typeof input.enabled === "boolean") base.enabled = input.enabled;
  if (isGooeyNavPreset(input.preset)) base.preset = input.preset;
  if (input.color === "") base.color = "";
  else if (isValidHexColor(input.color)) base.color = input.color.trim().toLowerCase();
  if (Array.isArray(input.colors)) {
    base.colors = input.colors.filter(isValidHexColor).map((c) => c.trim().toLowerCase());
  }
  if (isGooeyNavSize(input.size)) base.size = input.size;
  if (typeof input.frame === "boolean") base.frame = input.frame;
  if (typeof input.hoverEffect === "boolean") base.hoverEffect = input.hoverEffect;
  base.animationTime = clampInt(
    input.animationTime,
    base.animationTime,
    GOOEY_NAV_BOUNDS.animationTime.min,
    GOOEY_NAV_BOUNDS.animationTime.max,
  );
  base.particleCount = clampInt(
    input.particleCount,
    base.particleCount,
    GOOEY_NAV_BOUNDS.particleCount.min,
    GOOEY_NAV_BOUNDS.particleCount.max,
  );
  base.timeVariance = clampInt(
    input.timeVariance,
    base.timeVariance,
    GOOEY_NAV_BOUNDS.timeVariance.min,
    GOOEY_NAV_BOUNDS.timeVariance.max,
  );
  base.spread = clampInt(
    input.spread,
    base.spread,
    GOOEY_NAV_BOUNDS.spread.min,
    GOOEY_NAV_BOUNDS.spread.max,
  );
  base.gooeyness = clampFloat(
    input.gooeyness,
    base.gooeyness,
    GOOEY_NAV_BOUNDS.gooeyness.min,
    GOOEY_NAV_BOUNDS.gooeyness.max,
  );
  base.wobble = clampFloat(
    input.wobble,
    base.wobble,
    GOOEY_NAV_BOUNDS.wobble.min,
    GOOEY_NAV_BOUNDS.wobble.max,
  );
  return base;
}

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
  gooeyNav: DEFAULT_GOOEY_NAV_SETTINGS,
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
  settings.gooeyNav = normalizeGooeyNavSettings(input.gooeyNav);
  return settings;
}
