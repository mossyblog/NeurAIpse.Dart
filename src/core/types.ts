import type { InspectorSubMode } from "./spacing-modes.ts";
import type { StyleChange, StyleChangeDetail } from "./style-change.ts";
import type { RearrangeDetail } from "./rearrange-output.ts";

export type Rect = { x: number; y: number; width: number; height: number };

export type OutputDetail = "compact" | "standard" | "detailed" | "forensic";

export type MarkerClickBehavior = "edit" | "delete";

export type DockSide = "right" | "left";

export type GooeyNavPreset = "classic" | "accent" | "splash" | "calm" | "custom";
export type GooeyNavSize = "sm" | "md" | "lg";

export type GooeyNavSettings = {
  /** Enable the WebGL2 gooey metaball selection effect on the notch mode bar. */
  enabled: boolean;
  /** Active React Bits preset or custom override. */
  preset: GooeyNavPreset;
  /** Pill color hex override (empty string uses the theme default). */
  color: string;
  /** Optional droplet tint palette hex strings. */
  colors: string[];
  /** Notch mode button size preset. */
  size: GooeyNavSize;
  /** Shows the frosted/solid notch frame around the toolbar. */
  frame: boolean;
  /** Shows the smooth WebGL2 hover pill behind hovered mode items. */
  hoverEffect: boolean;
  /** Transition duration in milliseconds (default 600). */
  animationTime: number;
  /** Number of liquid droplets emitted on mode switch (default 15). */
  particleCount: number;
  /** Droplet scatter spread in pixels (default 56). */
  spread: number;
  /** Random timing variance in milliseconds (default 300). */
  timeVariance: number;
  /** Metaball smooth-union blend factor in [0, 1] (default 0.5). */
  gooeyness: number;
  /** Spring wobble amount in [0, 1] (default 0.5). */
  wobble: number;
};

export type CopyFormat = "markdown" | "source" | "classes" | { attribute: string };

export type Annotation = {
  id: string;
  /** Percent of viewport width. */
  x: number;
  /** Px from document top, or from viewport top when `isFixed`. */
  y: number;
  comment: string;
  element: string;
  elementPath: string;
  timestamp: number;
  selectedText?: string;
  boundingBox?: Rect;
  nearbyText?: string;
  cssClasses?: string;
  nearbyElements?: string;
  computedStyles?: string;
  fullPath?: string;
  accessibility?: string;
  isMultiSelect?: boolean;
  isFixed?: boolean;
  reactComponents?: string;
  sourceFile?: string;
  attributes?: Record<string, string>;
  frame?: {
    path: { index: number; id?: string; url: string }[];
    x: number;
    y: number;
    fixed: boolean;
    boundingBox: Rect;
  };
  drawingIndex?: number;
  elementBoundingBoxes?: Rect[];
  kind?: "feedback" | "placement" | "rearrange" | "style-change" | "measure";
  /** Inspector spec 7.4: set when `kind` is "style-change". */
  styleChange?: StyleChange;
  /** Inspector spec 7.4: set when `kind` is "measure". */
  measure?: StyleChange["measure"];
  /** Extension data for `styleChange` / `measure`: flags, labels, forensic origin. */
  styleDetail?: StyleChangeDetail;
  placement?: {
    componentType: string;
    width: number;
    height: number;
    scrollY: number;
    text?: string;
  };
  rearrange?: {
    selector: string;
    label: string;
    tagName: string;
    originalRect: Rect;
    currentRect: Rect;
  };
  /** Extension data for `rearrange` (parity spec 10.2): removed flag, sibling relation, forensic computed values. */
  rearrangeDetail?: RearrangeDetail;
  sessionId?: string;
  url?: string;
  intent?: "fix" | "change" | "question" | "approve";
  severity?: "blocking" | "important" | "suggestion";
  status?: "pending" | "acknowledged" | "resolved" | "dismissed";
  thread?: { id: string; role: "human" | "agent"; content: string; timestamp: number }[];
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedBy?: "human" | "agent";
  authorId?: string;
  _syncedTo?: string;
};

export type Settings = {
  outputDetail: OutputDetail;
  autoClearAfterCopy: boolean;
  annotationColorId: string;
  blockInteractions: boolean;
  reactEnabled: boolean;
  markerClickBehavior: MarkerClickBehavior;
  webhookUrl: string;
  webhooksEnabled: boolean;
  /** Spacing inspector sub-mode (inspector spec 14): Box (regions) or Lines (guides and measure). */
  inspectorSubMode: InspectorSubMode;
  /** I9 drag handles on the selected Box sides (inspector spec 13.1). */
  inspectorHandles: boolean;
  /** I9 token guides: spacing Box sides and the type ladder (inspector spec 13.3, I9b). */
  inspectorGuides: boolean;
  /** Viewport edge the side-notch annotation bar docks to. */
  dockSide: DockSide;
  /** Gooey selection animation settings for the side-notch mode bar. */
  gooeyNav: GooeyNavSettings;
};

export type Theme = "dark" | "light";

export type Point = { x: number; y: number };
