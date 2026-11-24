/**
 * Spacing inspector sub-modes (inspector spec 14, phase I3b). Box and Lines are mutually
 * exclusive; every overlay layer declares the one sub-mode that mounts it (spec 14.5).
 */

export type InspectorSubMode = "box" | "lines";

export const INSPECTOR_SUB_MODES: readonly InspectorSubMode[] = ["box", "lines"];

export const DEFAULT_INSPECTOR_SUB_MODE: InspectorSubMode = "box";

/** Overlay layers, exposed on each node as `data-annotate-layer`. */
export type OverlayLayer =
  /** Tinted margin/padding strips of the hovered or selected ring (every side). */
  | "ring"
  /** Value pill per side of that ring (or per gap band). */
  | "region-pill"
  /** Tinted flex/grid gap bands of the hovered or selected container (every band). */
  | "gap"
  /** Dashed edge line for a ring side at 0 (still selectable, spec 14.2). */
  | "ghost"
  /** `click to narrow to <side>` hint inside the selected ring. */
  | "hint"
  /** Border box, untinted region outlines and the selected-region outline. */
  | "outline"
  /** Grid support note (`grid: subgrid unsupported`). */
  | "note"
  /** Hovered and pinned element edges as thin lines. */
  | "edge"
  /** Pinned guide lines and their labels. */
  | "guide"
  /** Measure line between two pins. */
  | "measure"
  /** Measure distance pill. */
  | "measure-pill"
  /** Dashed support (extension) lines. */
  | "dashed"
  /** I9 drag handle on the selected or hovered region (and its drag label). */
  | "handle"
  /** I9 token guide lines across the region. */
  | "token-guide";

/** Spec 14.5 layer ownership, as code: the sub-mode that mounts each layer. */
export const LAYER_OWNER: Readonly<Record<OverlayLayer, InspectorSubMode>> = Object.freeze({
  ring: "box",
  "region-pill": "box",
  gap: "box",
  ghost: "box",
  hint: "box",
  outline: "box",
  note: "box",
  edge: "lines",
  guide: "lines",
  measure: "lines",
  "measure-pill": "lines",
  dashed: "lines",
  handle: "box",
  "token-guide": "box",
});

export const OVERLAY_LAYERS = Object.keys(LAYER_OWNER) as OverlayLayer[];

/** Whether `layer` is mounted in `mode`. Layers of the other sub-mode are not mounted at all. */
export function ownsLayer(mode: InspectorSubMode, layer: OverlayLayer): boolean {
  return LAYER_OWNER[layer] === mode;
}

/** The layers a sub-mode mounts. */
export function layersFor(mode: InspectorSubMode): OverlayLayer[] {
  return OVERLAY_LAYERS.filter((layer) => ownsLayer(mode, layer));
}

export function isInspectorSubMode(value: unknown): value is InspectorSubMode {
  return value === "box" || value === "lines";
}

/** `V` toggles Box and Lines. */
export function nextSubMode(mode: InspectorSubMode): InspectorSubMode {
  return mode === "box" ? "lines" : "box";
}

/** Behaviour switches per sub-mode (spec 14.4 state table). */
export const SUB_MODE_BEHAVIOUR: Readonly<
  Record<InspectorSubMode, { cursor: "default" | "crosshair"; secondClickMeasures: boolean; altQuickMeasure: boolean; escClearsPinsFirst: boolean }>
> = Object.freeze({
  box: { cursor: "default", secondClickMeasures: false, altQuickMeasure: false, escClearsPinsFirst: false },
  lines: { cursor: "crosshair", secondClickMeasures: true, altQuickMeasure: true, escClearsPinsFirst: true },
});
