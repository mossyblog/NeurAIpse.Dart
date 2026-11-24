"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  CornerDownRight,
  LayoutGrid,
  RotateCcw,
  Square,
} from "lucide-react";
import { parseColor, toHex } from "../core/color.ts";
import { computedColor, hasDirectText, resolveColorValue } from "../core/inspect-dom.ts";
import {
  spacingTokens,
  stepSpacing,
  type StyleChange,
  type StyleValue,
} from "../core/style-change.ts";
import {
  borderWidthTokens,
  colorTokens,
  fontSizeTokens,
  fontWeightTokens,
  lineHeightTokens,
  radiusTokens,
  trackingTokens,
} from "../core/token-catalog.ts";
import { readRootVars } from "../core/tokens-dom.ts";
import { primaryFamily, stepTypeValue } from "../core/type-signature.ts";
import { SegmentedControl } from "./chrome.tsx";
import { ColorPickerPopover } from "./color-picker-popover.tsx";
import {
  AlignmentGrid3x3,
  ColorPillField,
  CompactField,
  DesignSection,
  LayerBreadcrumb,
  type AlignAxis,
  type LayerBreadcrumbItem,
} from "./design-controls.tsx";
import { elementSerial, type InspectorContext } from "./inspector-context.ts";
import { PanelFrame } from "./inspector-panel.tsx";
import { TokenDiamondButton, TokenPopover, type TokenOption } from "./token-popover.tsx";
import { memberLabel } from "./use-style-changes.ts";

export type SizingMode = "fill" | "hug" | "fixed";

export type DesignPanelProps = {
  ctx: InspectorContext;
  selected: Element | null;
  ancestors: readonly LayerBreadcrumbItem[];
  directChildren: readonly LayerBreadcrumbItem[];
  onSelectElement: (el: Element) => void;
  onClose: () => void;
};

type ActiveTokenPopover = {
  key: string;
  anchorEl: HTMLElement;
  tokens: readonly TokenOption[];
  selectedId?: string;
  placeholder?: string;
  onSelect: (token: TokenOption | null) => void;
};

type ActiveColorPopover = {
  key: string;
  anchorEl: HTMLElement;
  color: string;
  onChange: (value: string) => void;
};

const WEIGHT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "100", label: "Thin (100)" },
  { value: "200", label: "Extra Light (200)" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Regular (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
];

const BORDER_STYLES = ["solid", "dashed", "dotted", "none"] as const;
const TEXT_ALIGNS = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify text", icon: AlignJustify },
] as const;

const PADDING_SIDES = [
  { key: "left", label: "L", prop: "padding-left", aria: "Padding left" },
  { key: "right", label: "R", prop: "padding-right", aria: "Padding right" },
  { key: "top", label: "T", prop: "padding-top", aria: "Padding top" },
  { key: "bottom", label: "B", prop: "padding-bottom", aria: "Padding bottom" },
] as const;

const RADIUS_CORNERS = [
  { key: "tl", label: "TL", prop: "border-top-left-radius", aria: "Top left corner radius" },
  { key: "tr", label: "TR", prop: "border-top-right-radius", aria: "Top right corner radius" },
  { key: "bl", label: "BL", prop: "border-bottom-left-radius", aria: "Bottom left corner radius" },
  { key: "br", label: "BR", prop: "border-bottom-right-radius", aria: "Bottom right corner radius" },
] as const;

const BORDER_WIDTH_SIDES = [
  { key: "top", label: "T", prop: "border-top-width", aria: "Top border width" },
  { key: "right", label: "R", prop: "border-right-width", aria: "Right border width" },
  { key: "bottom", label: "B", prop: "border-bottom-width", aria: "Bottom border width" },
  { key: "left", label: "L", prop: "border-left-width", aria: "Left border width" },
] as const;

const rootFontPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function computedValue(el: Element, property: string): string {
  return getComputedStyle(el).getPropertyValue(property).trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parsePxNum(val: string, fallback = 0): number {
  if (!val || val === "normal" || val === "auto" || val === "none") return fallback;
  const n = Number.parseFloat(val);
  return Number.isFinite(n) ? round2(n) : fallback;
}

function normalizeAlign(raw: string): AlignAxis {
  const v = raw.trim().toLowerCase();
  if (v === "center") return "center";
  if (v === "flex-end" || v === "end" || v === "right" || v === "self-end") return "end";
  return "start";
}

function toFlexAlign(axis: AlignAxis): string {
  if (axis === "center") return "center";
  if (axis === "end") return "flex-end";
  return "flex-start";
}

function parseCssLengthInput(raw: string, allowNegative = false): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const numOnly = /^-?\d*\.?\d+$/.exec(trimmed);
  if (numOnly) {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || (!allowNegative && n < 0)) return null;
    return `${round2(n)}px`;
  }
  const withUnit = /^(-?\d*\.?\d+)(px|rem|em|%|vw|vh)$/.exec(trimmed);
  if (withUnit) {
    const n = Number(withUnit[1]);
    if (!Number.isFinite(n) || (!allowNegative && n < 0)) return null;
    return `${round2(n)}${withUnit[2]}`;
  }
  return null;
}

function hexOf(value: string, context?: Element): string | undefined {
  const c = resolveColorValue(value, context);
  return c ? toHex(c) : undefined;
}

/** Controlled numeric/length CompactField wrapper with smooth local typing draft. */
function DraftField({
  resetKey,
  prefix,
  value,
  placeholder,
  onCommit,
  onStep,
  tokenActive,
  onTokenClick,
  ariaLabel,
}: {
  resetKey: string;
  prefix?: ReactNode;
  value: string;
  placeholder?: string;
  onCommit: (raw: string) => void;
  onStep?: (dir: 1 | -1, fine: boolean) => void;
  tokenActive?: boolean;
  onTokenClick?: (el: HTMLButtonElement) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const display = draft && draft.key === resetKey ? draft.text : value;

  return (
    <div className="min-w-0" onBlur={() => setDraft(null)}>
      <CompactField
        prefix={prefix}
        value={display}
        placeholder={placeholder}
        tokenActive={tokenActive}
        ariaLabel={ariaLabel}
        onChange={(raw) => {
          setDraft({ key: resetKey, text: raw });
          onCommit(raw);
        }}
        onStep={
          onStep
            ? (dir, fine) => {
                setDraft(null);
                onStep(dir, fine);
              }
            : undefined
        }
        onTokenClick={
          onTokenClick
            ? (el) => {
                setDraft(null);
                onTokenClick(el);
              }
            : undefined
        }
      />
    </div>
  );
}

function IndividualToggle({
  active,
  onClick,
  ariaLabel,
  title,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        active
          ? "border-ring/40 bg-ring/15 text-foreground dark:bg-ring/25"
          : "border-transparent bg-muted/45 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.1]",
      )}
    >
      <Square className="size-3" />
    </button>
  );
}

function SectionResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/[0.1]"
    >
      <RotateCcw className="size-3" />
    </button>
  );
}

function SubLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium text-muted-foreground/85">{children}</span>
      {right}
    </div>
  );
}

/** Unified Figma/Pencil-grade per-layer Design inspector panel. */
export function DesignPanel({
  ctx,
  selected,
  ancestors,
  directChildren,
  onSelectElement,
  onClose,
}: DesignPanelProps) {
  const { styles, resolver, surface } = ctx;
  const [paddingIndividual, setPaddingIndividual] = useState(false);
  const [radiusIndividual, setRadiusIndividual] = useState(false);
  const [strokeIndividual, setStrokeIndividual] = useState(false);
  const [fillTarget, setFillTarget] = useState<"background-color" | "color">("background-color");
  const [tokenPopover, setTokenPopover] = useState<ActiveTokenPopover | null>(null);
  const [colorPopover, setColorPopover] = useState<ActiveColorPopover | null>(null);

  // Close floating popovers and reset smart fill target when switching layers.
  useEffect(() => {
    setTokenPopover(null);
    setColorPopover(null);
    if (!selected || !selected.isConnected) return;
    const bg = parseColor(computedColor(selected, "background-color"));
    const isText = hasDirectText(selected);
    setFillTarget(isText && (!bg || bg.a === 0) ? "color" : "background-color");
  }, [selected]);

  const sel = selected && selected.isConnected ? selected : null;
  const elSerial = sel ? elementSerial(sel) : 0;

  if (!sel) {
    return (
      <PanelFrame
        kind="design"
        label="Design inspector"
        elementName="Design"
        regionLabel="Select any layer to inspect"
        pending={ctx.pending}
        onRemove={styles.remove}
        onEdit={ctx.onEdit}
        onCopy={ctx.onCopy}
        onClose={onClose}
      >
        <p className="py-3 text-center text-xs leading-relaxed text-muted-foreground">
          Click any element on the page to inspect and edit its layout, appearance, fill, stroke, and typography.
        </p>
      </PanelFrame>
    );
  }

  const cs = getComputedStyle(sel);
  const rect = sel.getBoundingClientRect();
  const rootPx = rootFontPx();
  const vars = readRootVars(document);
  const elName = memberLabel(sel);
  const display = cs.display;
  const isFlex = display.includes("flex");
  const isGrid = display.includes("grid");
  const isFlexCol = isFlex && cs.flexDirection.startsWith("column");
  const isContainer = isFlex || isGrid || sel.children.length > 0;
  const isTextNode = hasDirectText(sel);
  const containerKind = isFlex
    ? isFlexCol
      ? "Flex Col"
      : "Flex Row"
    : isGrid
      ? "Grid"
      : sel.children.length > 0
        ? "Container"
        : isTextNode
          ? "Text"
          : "Element";

  const baseGroupId = `design-${elSerial}`;

  const upsertStyle = (
    category: StyleChange["category"],
    property: string,
    to: StyleValue,
    groupSuffix?: string,
  ) => {
    const existing = styles.findFor(sel, property);
    const groupId = existing?.styleDetail?.groupId ?? (groupSuffix ? `${baseGroupId}:${groupSuffix}` : `${baseGroupId}:${category}`);
    const resolveProp = property === "border-color" ? "border-top-color" : property === "border-radius" ? "border-top-left-radius" : property;
    const res = resolver.resolve(sel, resolveProp);
    const currentComputed =
      category === "color"
        ? (hexOf(computedColor(sel, property), sel) ?? computedColor(sel, property))
        : computedValue(sel, resolveProp);
    const from: StyleValue = existing?.styleChange?.from ?? {
      value: currentComputed,
      ...(res.status === "token" && res.token ? { token: res.token } : {}),
    };
    styles.upsert({
      category,
      property,
      groupId,
      elements: [sel],
      from,
      to,
      detail: {
        name: elName,
        ...(existing?.styleDetail?.flags ? { flags: existing.styleDetail.flags } : res.flags.length ? { flags: res.flags } : {}),
        ...(res.origin ? { origin: res.origin } : {}),
      },
    });
  };

  const removeProps = (props: readonly string[]) => {
    for (const prop of props) {
      const rec = styles.findFor(sel, prop);
      if (rec) styles.remove(rec.id);
    }
  };

  const openTokenMenu = (
    key: string,
    anchorEl: HTMLElement,
    tokens: readonly TokenOption[],
    selectedId: string | undefined,
    onSelect: (token: TokenOption | null) => void,
    placeholder?: string,
  ) => {
    setColorPopover(null);
    setTokenPopover((cur) =>
      cur?.key === key ? null : { key, anchorEl, tokens, selectedId, onSelect, placeholder },
    );
  };

  const openColorMenu = (
    key: string,
    anchorEl: HTMLElement,
    color: string,
    onChange: (value: string) => void,
  ) => {
    setTokenPopover(null);
    setColorPopover((cur) =>
      cur?.key === key ? null : { key, anchorEl, color, onChange },
    );
  };

  /* ---------------- Token Catalogs ---------------- */
  const spacingOpts: TokenOption[] = spacingTokens(vars, rootPx).map((t) => ({
    id: t.name,
    label: t.name,
    value: `${t.px}px`,
    meta: `${t.px}px`,
  }));

  const radiusOpts: TokenOption[] = radiusTokens(vars, rootPx).map((t) => ({
    id: t.token,
    label: t.token,
    value: `${t.px ?? 0}px`,
    meta: `${t.px ?? 0}px`,
  }));

  const borderWidthOpts: TokenOption[] = borderWidthTokens(vars, rootPx).map((t) => ({
    id: t.token,
    label: t.token,
    value: `${t.px ?? 0}px`,
    meta: `${t.px ?? 0}px`,
  }));

  const colorList = colorTokens(vars, (v) => resolveColorValue(v, sel));
  const colorOpts: TokenOption[] = colorList.map((t) => ({
    id: t.token,
    label: t.token,
    value: t.hex ?? t.css,
    swatch: t.hex,
    meta: t.hex,
  }));

  const fontPx = parsePxNum(cs.fontSize, 16);
  const fontSizeOpts: TokenOption[] = fontSizeTokens(vars, rootPx).map((t) => ({
    id: t.token,
    label: t.token,
    value: `${t.px ?? 16}px`,
    meta: `${t.px ?? 16}px`,
  }));
  const lineHeightOpts: TokenOption[] = lineHeightTokens(vars, fontPx, rootPx).map((t) => ({
    id: t.token,
    label: t.token,
    value: `${t.px ?? fontPx}px`,
    meta: `${t.px ?? fontPx}px`,
  }));
  const fontWeightOpts: TokenOption[] = fontWeightTokens(vars).map((t) => ({
    id: t.token,
    label: t.token,
    value: String(t.number ?? 400),
    meta: String(t.number ?? 400),
  }));
  const trackingOpts: TokenOption[] = trackingTokens(vars, fontPx, rootPx).map((t) => ({
    id: t.token,
    label: t.token,
    value: `${t.px ?? 0}px`,
    meta: `${t.px ?? 0}px`,
  }));

  /* ---------------- 1. Layout: Direction, Alignment, Gap, Padding, Dimensions ---------------- */
  const currentDirection: "grid" | "col" | "row" | null = isGrid
    ? "grid"
    : isFlex
      ? isFlexCol
        ? "col"
        : "row"
      : null;

  const setDirection = (dir: "grid" | "col" | "row") => {
    if (dir === "grid") {
      upsertStyle("spacing", "display", { value: "grid" }, "layout");
      removeProps(["flex-direction"]);
    } else {
      upsertStyle("spacing", "display", { value: "flex" }, "layout");
      upsertStyle("spacing", "flex-direction", { value: dir === "col" ? "column" : "row" }, "layout");
    }
  };

  const alignRow: AlignAxis = isFlexCol ? normalizeAlign(cs.justifyContent) : normalizeAlign(cs.alignItems);
  const alignCol: AlignAxis = isFlexCol ? normalizeAlign(cs.alignItems) : normalizeAlign(cs.justifyContent);

  const setAlignment = (r: AlignAxis, c: AlignAxis) => {
    if (!isFlex && !isGrid) {
      upsertStyle("spacing", "display", { value: "flex" }, "layout");
      upsertStyle("spacing", "flex-direction", { value: "column" }, "layout");
      upsertStyle("spacing", "justify-content", { value: toFlexAlign(r) }, "layout");
      upsertStyle("spacing", "align-items", { value: toFlexAlign(c) }, "layout");
      return;
    }
    if (isFlexCol) {
      upsertStyle("spacing", "justify-content", { value: toFlexAlign(r) }, "layout");
      upsertStyle("spacing", "align-items", { value: toFlexAlign(c) }, "layout");
    } else {
      upsertStyle("spacing", "align-items", { value: toFlexAlign(r) }, "layout");
      upsertStyle("spacing", "justify-content", { value: toFlexAlign(c) }, "layout");
    }
  };

  // Gap
  const gapRec = styles.findFor(sel, "gap");
  const gapPx = parsePxNum(cs.rowGap !== "normal" ? cs.rowGap : cs.columnGap, 0);
  const gapToken = gapRec?.styleChange?.to.token;
  const applyGap = (next: StyleValue) => upsertStyle("spacing", "gap", next, "layout");

  // Padding
  const padVals = {
    left: parsePxNum(cs.paddingLeft, 0),
    right: parsePxNum(cs.paddingRight, 0),
    top: parsePxNum(cs.paddingTop, 0),
    bottom: parsePxNum(cs.paddingBottom, 0),
  };
  const padModified = PADDING_SIDES.some((s) => Boolean(styles.findFor(sel, s.prop))) || Boolean(styles.findFor(sel, "padding"));
  const padHToken = styles.findFor(sel, "padding-left")?.styleChange?.to.token;
  const padVToken = styles.findFor(sel, "padding-top")?.styleChange?.to.token;
  const padHDisplay = padHToken ?? (padVals.left === padVals.right ? String(padVals.left) : "mixed");
  const padVDisplay = padVToken ?? (padVals.top === padVals.bottom ? String(padVals.top) : "mixed");

  const applyPaddingPair = (props: readonly [string, string], next: StyleValue) => {
    removeProps(["padding"]);
    for (const p of props) upsertStyle("spacing", p, next, "padding");
  };

  // Chaos-verified Fill / Hug / Fixed Sizing Engine (reused from spacing-inspector.tsx)
  const parent = sel.parentElement;
  const parentCs = parent ? getComputedStyle(parent) : null;
  const parentDisplay = parentCs?.display ?? "";
  const isFlexParent = parentDisplay.includes("flex");
  const isGridParent = parentDisplay.includes("grid");
  const isParentFlexCol = isFlexParent && (parentCs?.flexDirection ?? "row").startsWith("column");
  const isParentFlexRow = isFlexParent && !isParentFlexCol;

  const buildSizingAxis = (axis: "width" | "height") => {
    const livePx = Math.round(axis === "width" ? rect.width : rect.height);
    const isMainAxis = (axis === "width" && isParentFlexRow) || (axis === "height" && isParentFlexCol);
    const isCrossAxis = (axis === "height" && isParentFlexRow) || (axis === "width" && isParentFlexCol);
    const companionProp = isMainAxis
      ? "flex"
      : isCrossAxis
        ? "align-self"
        : isGridParent
          ? axis === "width"
            ? "justify-self"
            : "align-self"
          : null;

    const maxProp = axis === "width" ? "max-width" : "max-height";
    const rec = styles.findFor(sel, axis);
    const companionRec = companionProp ? styles.findFor(sel, companionProp) : undefined;
    const maxRec = styles.findFor(sel, maxProp);
    const pendingVal = rec?.styleChange?.to.value;

    let mode: SizingMode;
    if (pendingVal === "100%" || pendingVal === "100vh") {
      mode = "fill";
    } else if (pendingVal === "fit-content" || pendingVal === "min-content") {
      mode = "hug";
    } else if (pendingVal) {
      mode = "fixed";
    } else if (isMainAxis && Number.parseFloat(cs.flexGrow) > 0) {
      mode = "fill";
    } else if ((sel as HTMLElement).style?.[axis]?.endsWith("px")) {
      mode = "fixed";
    } else if (
      axis === "width" &&
      parent &&
      !display.startsWith("inline") &&
      Math.abs(
        parent.clientWidth -
          Number.parseFloat(parentCs?.paddingLeft ?? "0") -
          Number.parseFloat(parentCs?.paddingRight ?? "0") -
          rect.width,
      ) <= 2
    ) {
      mode = "fill";
    } else {
      mode = "hug";
    }

    const upsertSizeProp = (prop: string, fromValue: string, toValue: string) => {
      const existing = styles.findFor(sel, prop);
      styles.upsert({
        category: "spacing",
        property: prop,
        groupId: existing?.styleDetail?.groupId ?? `size:${elSerial}:${axis}`,
        elements: [sel],
        from: existing?.styleChange?.from ?? { value: fromValue },
        to: { value: toValue },
        detail: { name: elName },
      });
    };

    const syncGridTracks = (anchorMode: SizingMode | null, fixedPx?: number) => {
      if (!isGridParent || !parent) return;
      const trackProp = axis === "width" ? "grid-template-columns" : "grid-template-rows";
      const rawTracks = (axis === "width" ? parentCs?.gridTemplateColumns : parentCs?.gridTemplateRows) ?? "";
      const trackCount = rawTracks.trim().split(/\s+/).filter(Boolean).length;
      const siblings = Array.from(parent.children).filter(
        (c) => !["script", "style", "template"].includes(c.localName) && c !== surface.host,
      );
      if (siblings.length <= 1 || siblings.length !== trackCount) return;

      const specs = siblings.map((sib) => {
        if (sib === sel) {
          if (anchorMode === null || anchorMode === "fill") return { kind: "fill" as const };
          if (anchorMode === "hug") return { kind: "hug" as const };
          return { kind: "fixed" as const, px: Math.max(0, Math.round(fixedPx ?? livePx)) };
        }
        const sibRec = styles.findFor(sib, axis)?.styleChange?.to.value;
        if (sibRec === "fit-content" || sibRec === "min-content") return { kind: "hug" as const };
        if (sibRec && sibRec !== "100%" && sibRec !== "100vh" && sibRec.endsWith("px")) {
          return { kind: "fixed" as const, px: Math.round(Number.parseFloat(sibRec) || 0) };
        }
        return { kind: "fill" as const };
      });

      const anyNonFill = specs.some((s) => s.kind !== "fill");
      const tracks = specs.map((spec) => {
        if (spec.kind === "fill") return "minmax(0, 1fr)";
        if (spec.kind === "hug") return "min-content";
        return `${spec.px}px`;
      });

      const parentRec = styles.findFor(parent, trackProp);
      if (!anyNonFill) {
        if (parentRec) styles.remove(parentRec.id);
        return;
      }
      styles.upsert({
        category: "spacing",
        property: trackProp,
        groupId: `size-grid:${elementSerial(parent)}:${axis}`,
        elements: [parent],
        from: parentRec?.styleChange?.from ?? { value: rawTracks },
        to: { value: tracks.join(" ") },
        detail: { name: memberLabel(parent) },
      });
    };

    const applyMode = (next: SizingMode, fixedPx?: number) => {
      const useViewportHeight =
        axis === "height" &&
        next === "fill" &&
        !isMainAxis &&
        !isCrossAxis &&
        !isGridParent &&
        (sel === document.body || parent === document.body || parent === document.documentElement);
      const hugVal = isGridParent && axis === "width" ? "min-content" : "fit-content";
      const sizeVal =
        next === "fill"
          ? useViewportHeight
            ? "100vh"
            : "100%"
          : next === "hug"
            ? hugVal
            : `${Math.max(0, Math.round(fixedPx ?? livePx))}px`;
      upsertSizeProp(axis, `${livePx}px`, sizeVal);

      const currentMax = axis === "width" ? cs.maxWidth : cs.maxHeight;
      if ((next === "fill" || next === "fixed") && currentMax && currentMax !== "none") {
        upsertSizeProp(maxProp, currentMax, "none");
      } else if (next === "hug" && maxRec) {
        styles.remove(maxRec.id);
      }

      if (isMainAxis) {
        const fromFlex = `${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis}`;
        upsertSizeProp("flex", fromFlex, next === "fill" ? "1 1 0%" : "0 0 auto");
      } else if (isCrossAxis) {
        upsertSizeProp("align-self", cs.alignSelf || "auto", next === "fill" ? "stretch" : "flex-start");
      } else if (isGridParent && companionProp) {
        const fromSelf = companionProp === "justify-self" ? cs.justifySelf || "auto" : cs.alignSelf || "auto";
        upsertSizeProp(companionProp, fromSelf, next === "fill" ? "stretch" : "start");
        syncGridTracks(next, fixedPx);
      }
    };

    const reset = () => {
      if (rec) styles.remove(rec.id);
      if (companionRec) styles.remove(companionRec.id);
      if (maxRec) styles.remove(maxRec.id);
      syncGridTracks(null);
    };

    return {
      mode,
      px: livePx,
      modified: Boolean(rec || companionRec || maxRec),
      applyMode,
      reset,
    };
  };

  const widthAxis = buildSizingAxis("width");
  const heightAxis = buildSizingAxis("height");
  const layoutModified =
    Boolean(
      styles.findFor(sel, "display") ||
        styles.findFor(sel, "flex-direction") ||
        styles.findFor(sel, "justify-content") ||
        styles.findFor(sel, "align-items") ||
        gapRec,
    ) ||
    padModified ||
    widthAxis.modified ||
    heightAxis.modified;

  const resetLayout = () => {
    removeProps(["display", "flex-direction", "justify-content", "align-items", "gap", "padding", ...PADDING_SIDES.map((s) => s.prop)]);
    widthAxis.reset();
    heightAxis.reset();
  };

  /* ---------------- 2. Appearance: Opacity, Corner Radius, Clip Content ---------------- */
  const opacityPct = Math.round(Math.min(1, Math.max(0, Number.parseFloat(cs.opacity) || 0)) * 100);
  const opacityRec = styles.findFor(sel, "opacity");

  const radiusVals = {
    tl: parsePxNum(cs.borderTopLeftRadius, 0),
    tr: parsePxNum(cs.borderTopRightRadius, 0),
    bl: parsePxNum(cs.borderBottomLeftRadius, 0),
    br: parsePxNum(cs.borderBottomRightRadius, 0),
  };
  const uniformRadiusRec = styles.findFor(sel, "border-radius");
  const uniformRadiusToken = uniformRadiusRec?.styleChange?.to.token;
  const allCornersEqual =
    radiusVals.tl === radiusVals.tr && radiusVals.tr === radiusVals.bl && radiusVals.bl === radiusVals.br;
  const uniformRadiusDisplay = uniformRadiusToken ?? (allCornersEqual ? String(radiusVals.tl) : "mixed");

  const applyUniformRadius = (next: StyleValue) => {
    removeProps(RADIUS_CORNERS.map((c) => c.prop));
    upsertStyle("spacing", "border-radius", next, "appearance");
  };

  const applyCornerRadius = (prop: string, next: StyleValue) => {
    if (uniformRadiusRec) styles.remove(uniformRadiusRec.id);
    upsertStyle("spacing", prop, next, "appearance");
  };

  const overflowRec = styles.findFor(sel, "overflow");
  const isClipped = cs.overflow === "hidden" || cs.overflow === "clip" || overflowRec?.styleChange?.to.value === "hidden";
  const toggleClipContent = (checked: boolean) => {
    if (checked) {
      upsertStyle("spacing", "overflow", { value: "hidden" }, "appearance");
    } else if (overflowRec) {
      styles.remove(overflowRec.id);
    } else {
      upsertStyle("spacing", "overflow", { value: "visible" }, "appearance");
    }
  };

  const appearanceModified = Boolean(
    opacityRec ||
      uniformRadiusRec ||
      overflowRec ||
      RADIUS_CORNERS.some((c) => Boolean(styles.findFor(sel, c.prop))),
  );
  const resetAppearance = () => {
    removeProps(["opacity", "border-radius", "overflow", ...RADIUS_CORNERS.map((c) => c.prop)]);
  };

  /* ---------------- 3. Fill: Background / Text Color ---------------- */
  const hasBgAndText = isTextNode || Boolean(sel.textContent?.trim());
  const activeFillProp = hasBgAndText ? fillTarget : "background-color";
  const fillRec = styles.findFor(sel, activeFillProp);
  const fillRes = resolver.resolve(sel, activeFillProp);
  const fillComputed = computedColor(sel, activeFillProp);
  const fillParsed = parseColor(fillComputed) ?? resolveColorValue(fillComputed, sel);
  const fillHex = fillParsed ? toHex(fillParsed) : undefined;
  const fillToken = fillRec?.styleChange?.to.token ?? (fillRes.status === "token" ? fillRes.token : undefined);
  const fillSwatch = fillRec?.styleChange?.to.token
    ? (hexOf(`var(${fillRec.styleChange.to.token})`, sel) ?? fillComputed)
    : (fillRec?.styleChange?.to.value ?? fillComputed);
  const fillLabel =
    fillToken ??
    (fillParsed && fillParsed.a === 0 ? "Transparent" : (fillHex?.toUpperCase() ?? fillComputed));

  /* ---------------- 4. Stroke: Border Color, Style, Weight ---------------- */
  const borderWidthVals = {
    top: parsePxNum(cs.borderTopWidth, 0),
    right: parsePxNum(cs.borderRightWidth, 0),
    bottom: parsePxNum(cs.borderBottomWidth, 0),
    left: parsePxNum(cs.borderLeftWidth, 0),
  };
  const maxBorderWidth = Math.max(borderWidthVals.top, borderWidthVals.right, borderWidthVals.bottom, borderWidthVals.left);
  const currentBorderStyle = (cs.borderTopStyle || "none").toLowerCase();
  const hasVisibleBorder = maxBorderWidth > 0 && currentBorderStyle !== "none";

  const borderColorRec = styles.findFor(sel, "border-color");
  const borderColorRes = resolver.resolve(sel, "border-top-color");
  const borderColorComputed = computedColor(sel, "border-color");
  const borderColorParsed = parseColor(borderColorComputed) ?? resolveColorValue(borderColorComputed, sel);
  const borderColorHex = borderColorParsed ? toHex(borderColorParsed) : undefined;
  const borderColorToken =
    borderColorRec?.styleChange?.to.token ?? (borderColorRes.status === "token" ? borderColorRes.token : undefined);
  const borderColorSwatch = borderColorRec?.styleChange?.to.token
    ? (hexOf(`var(${borderColorRec.styleChange.to.token})`, sel) ?? borderColorComputed)
    : (borderColorRec?.styleChange?.to.value ?? borderColorComputed);
  const borderColorLabel = borderColorToken ?? borderColorHex?.toUpperCase() ?? borderColorComputed;

  const uniformBorderWRec = styles.findFor(sel, "border-width");
  const uniformBorderWToken = uniformBorderWRec?.styleChange?.to.token;
  const allBordersEqual =
    borderWidthVals.top === borderWidthVals.right &&
    borderWidthVals.right === borderWidthVals.bottom &&
    borderWidthVals.bottom === borderWidthVals.left;
  const uniformBorderWDisplay = uniformBorderWToken ?? (allBordersEqual ? String(borderWidthVals.top) : "mixed");

  const ensureBorderStyle = () => {
    if (currentBorderStyle === "none") {
      upsertStyle("spacing", "border-style", { value: "solid" }, "stroke");
    }
  };

  const applyBorderColor = (to: StyleValue) => {
    ensureBorderStyle();
    if (maxBorderWidth === 0 && !uniformBorderWRec) {
      upsertStyle("spacing", "border-width", { value: "1px" }, "stroke");
    }
    upsertStyle("color", "border-color", to, "stroke-color");
  };

  const applyUniformBorderWidth = (to: StyleValue) => {
    removeProps(BORDER_WIDTH_SIDES.map((s) => s.prop));
    ensureBorderStyle();
    upsertStyle("spacing", "border-width", to, "stroke");
  };

  const applySideBorderWidth = (prop: string, to: StyleValue) => {
    if (uniformBorderWRec) styles.remove(uniformBorderWRec.id);
    ensureBorderStyle();
    upsertStyle("spacing", prop, to, "stroke");
  };

  const strokeModified = Boolean(
    borderColorRec ||
      styles.findFor(sel, "border-style") ||
      uniformBorderWRec ||
      BORDER_WIDTH_SIDES.some((s) => Boolean(styles.findFor(sel, s.prop))),
  );
  const resetStroke = () => {
    removeProps(["border-color", "border-style", "border-width", ...BORDER_WIDTH_SIDES.map((s) => s.prop)]);
  };

  /* ---------------- 5. Typography (auto-shown for text layers) ---------------- */
  const familyName = primaryFamily(cs.fontFamily) || "System";
  const weightRec = styles.findFor(sel, "font-weight");
  const weightToken = weightRec?.styleChange?.to.token;
  const currentWeight = String(Math.round(Number.parseFloat(cs.fontWeight) || 400));

  const sizeRec = styles.findFor(sel, "font-size");
  const sizeToken = sizeRec?.styleChange?.to.token;
  const sizePx = parsePxNum(cs.fontSize, 16);

  const lhRec = styles.findFor(sel, "line-height");
  const lhToken = lhRec?.styleChange?.to.token;
  const lhPx = cs.lineHeight === "normal" ? round2(sizePx * 1.4) : parsePxNum(cs.lineHeight, sizePx);

  const lsRec = styles.findFor(sel, "letter-spacing");
  const lsToken = lsRec?.styleChange?.to.token;
  const lsPx = cs.letterSpacing === "normal" ? 0 : parsePxNum(cs.letterSpacing, 0);

  const alignRec = styles.findFor(sel, "text-align");
  const rawTextAlign = cs.textAlign.toLowerCase();
  const currentTextAlign =
    rawTextAlign === "start" ? "left" : rawTextAlign === "end" ? "right" : rawTextAlign;

  const typeModified = Boolean(weightRec || sizeRec || lhRec || lsRec || alignRec);
  const resetType = () => {
    removeProps(["font-weight", "font-size", "line-height", "letter-spacing", "text-align"]);
  };

  return (
    <>
      <PanelFrame
        kind="design"
        label="Design inspector"
        elementName={elName}
        regionLabel={`${Math.round(rect.width)} × ${Math.round(rect.height)} · ${containerKind}`}
        pending={ctx.pending}
        onRemove={styles.remove}
        onEdit={ctx.onEdit}
        onCopy={ctx.onCopy}
        onClose={onClose}
      >
        <div className="-mx-3 -mt-2.5 flex flex-col">
          {/* Layer Breadcrumb */}
          <LayerBreadcrumb ancestors={ancestors} active={sel} onSelect={onSelectElement} />

          {/* Optional direct children quick-step chips */}
          {directChildren.length > 0 && (
            <div
              aria-label="Direct child layers"
              className="flex items-center gap-1 overflow-x-auto border-b border-border/50 bg-muted/20 px-2.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-white/[0.06] dark:bg-white/[0.02]"
            >
              <CornerDownRight aria-hidden className="size-3 shrink-0 text-muted-foreground/55" />
              {directChildren.map((child, idx) => (
                <button
                  key={`${child.label}-${idx}`}
                  type="button"
                  title={`Select child ${child.label}`}
                  onClick={() => onSelectElement(child.el)}
                  className="inline-flex h-5 shrink-0 cursor-pointer items-center rounded-md border border-border/50 bg-background/60 px-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.04]"
                >
                  {child.label}
                </button>
              ))}
            </div>
          )}

          {/* 1. Layout */}
          <DesignSection
            title="Layout"
            defaultOpen
            action={layoutModified ? <SectionResetButton onClick={resetLayout} label="Reset layout" /> : undefined}
          >
            {isContainer && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground/85">Flow</span>
                  <SegmentedControl role="group" aria-label="Layout direction">
                    {(
                      [
                        { id: "grid", label: "Grid", icon: LayoutGrid },
                        { id: "col", label: "Col", icon: ArrowDown },
                        { id: "row", label: "Row", icon: ArrowRight },
                      ] as const
                    ).map(({ id, label, icon: Icon }) => {
                      const active = currentDirection === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-label={`Layout ${label}`}
                          aria-pressed={active}
                          onClick={() => setDirection(id)}
                          className={cn(
                            "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors outline-none",
                            active
                              ? "bg-background text-foreground shadow-xs dark:bg-white/[0.12]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-3" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </SegmentedControl>
                </div>

                <div className="flex items-center gap-2.5">
                  <AlignmentGrid3x3 row={alignRow} col={alignCol} onChange={setAlignment} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <SubLabel>Gap</SubLabel>
                    <DraftField
                      resetKey={`${elSerial}:gap:${gapToken ?? ""}`}
                      prefix="G"
                      value={gapToken ?? String(gapPx)}
                      ariaLabel="Gap"
                      tokenActive={Boolean(gapToken)}
                      onCommit={(raw) => {
                        const parsed = parseCssLengthInput(raw, false);
                        if (parsed) applyGap({ value: parsed });
                      }}
                      onStep={(dir, fine) => {
                        const next = stepSpacing(gapPx, dir, fine, 0);
                        applyGap({ value: `${next}px` });
                      }}
                      onTokenClick={(anchorEl) =>
                        openTokenMenu(
                          "gap",
                          anchorEl,
                          spacingOpts,
                          gapToken,
                          (tok) => {
                            if (tok) applyGap({ value: tok.value, token: tok.id });
                            else applyGap({ value: `${gapPx}px` });
                          },
                          "Search spacing...",
                        )
                      }
                    />
                  </div>
                </div>
              </>
            )}

            {/* Padding */}
            <div className="flex flex-col gap-1.5">
              <SubLabel
                right={
                  <IndividualToggle
                    active={paddingIndividual}
                    onClick={() => setPaddingIndividual((v) => !v)}
                    ariaLabel="Individual padding"
                    title={paddingIndividual ? "Switch to H / V padding" : "Edit individual padding sides"}
                  />
                }
              >
                Padding
              </SubLabel>

              {!paddingIndividual ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <DraftField
                    resetKey={`${elSerial}:pad-h:${padHToken ?? ""}`}
                    prefix="H"
                    value={padHDisplay}
                    ariaLabel="Horizontal padding"
                    tokenActive={Boolean(padHToken)}
                    onCommit={(raw) => {
                      const parsed = parseCssLengthInput(raw, false);
                      if (parsed) applyPaddingPair(["padding-left", "padding-right"], { value: parsed });
                    }}
                    onStep={(dir, fine) => {
                      const next = stepSpacing(padVals.left, dir, fine, 0);
                      applyPaddingPair(["padding-left", "padding-right"], { value: `${next}px` });
                    }}
                    onTokenClick={(anchorEl) =>
                      openTokenMenu(
                        "pad-h",
                        anchorEl,
                        spacingOpts,
                        padHToken,
                        (tok) => {
                          if (tok) applyPaddingPair(["padding-left", "padding-right"], { value: tok.value, token: tok.id });
                          else applyPaddingPair(["padding-left", "padding-right"], { value: `${padVals.left}px` });
                        },
                        "Search spacing...",
                      )
                    }
                  />
                  <DraftField
                    resetKey={`${elSerial}:pad-v:${padVToken ?? ""}`}
                    prefix="V"
                    value={padVDisplay}
                    ariaLabel="Vertical padding"
                    tokenActive={Boolean(padVToken)}
                    onCommit={(raw) => {
                      const parsed = parseCssLengthInput(raw, false);
                      if (parsed) applyPaddingPair(["padding-top", "padding-bottom"], { value: parsed });
                    }}
                    onStep={(dir, fine) => {
                      const next = stepSpacing(padVals.top, dir, fine, 0);
                      applyPaddingPair(["padding-top", "padding-bottom"], { value: `${next}px` });
                    }}
                    onTokenClick={(anchorEl) =>
                      openTokenMenu(
                        "pad-v",
                        anchorEl,
                        spacingOpts,
                        padVToken,
                        (tok) => {
                          if (tok) applyPaddingPair(["padding-top", "padding-bottom"], { value: tok.value, token: tok.id });
                          else applyPaddingPair(["padding-top", "padding-bottom"], { value: `${padVals.top}px` });
                        },
                        "Search spacing...",
                      )
                    }
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {PADDING_SIDES.map((side) => {
                    const rec = styles.findFor(sel, side.prop);
                    const tok = rec?.styleChange?.to.token;
                    const val = padVals[side.key];
                    return (
                      <DraftField
                        key={side.key}
                        resetKey={`${elSerial}:${side.prop}:${tok ?? ""}`}
                        prefix={side.label}
                        value={tok ?? String(val)}
                        ariaLabel={side.aria}
                        tokenActive={Boolean(tok)}
                        onCommit={(raw) => {
                          const parsed = parseCssLengthInput(raw, false);
                          if (parsed) {
                            removeProps(["padding"]);
                            upsertStyle("spacing", side.prop, { value: parsed }, "padding");
                          }
                        }}
                        onStep={(dir, fine) => {
                          const next = stepSpacing(val, dir, fine, 0);
                          removeProps(["padding"]);
                          upsertStyle("spacing", side.prop, { value: `${next}px` }, "padding");
                        }}
                        onTokenClick={(anchorEl) =>
                          openTokenMenu(
                            side.prop,
                            anchorEl,
                            spacingOpts,
                            tok,
                            (picked) => {
                              removeProps(["padding"]);
                              if (picked) upsertStyle("spacing", side.prop, { value: picked.value, token: picked.id }, "padding");
                              else upsertStyle("spacing", side.prop, { value: `${val}px` }, "padding");
                            },
                            "Search spacing...",
                          )
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dimensions + Fill / Hug checkboxes */}
            <div className="flex flex-col gap-1.5">
              <SubLabel
                right={
                  widthAxis.modified || heightAxis.modified ? (
                    <SectionResetButton
                      onClick={() => {
                        widthAxis.reset();
                        heightAxis.reset();
                      }}
                      label="Reset dimensions"
                    />
                  ) : undefined
                }
              >
                Dimensions
              </SubLabel>

              <div className="grid grid-cols-2 gap-1.5">
                <DraftField
                  resetKey={`${elSerial}:w:${widthAxis.mode}`}
                  prefix="W"
                  value={String(widthAxis.px)}
                  ariaLabel="Width"
                  onCommit={(raw) => {
                    const n = Number(raw.trim());
                    if (raw.trim() !== "" && Number.isFinite(n) && n >= 0) {
                      widthAxis.applyMode("fixed", n);
                    }
                  }}
                  onStep={(dir, fine) => {
                    const next = Math.max(0, widthAxis.px + dir * (fine ? 1 : 8));
                    widthAxis.applyMode("fixed", next);
                  }}
                />
                <DraftField
                  resetKey={`${elSerial}:h:${heightAxis.mode}`}
                  prefix="H"
                  value={String(heightAxis.px)}
                  ariaLabel="Height"
                  onCommit={(raw) => {
                    const n = Number(raw.trim());
                    if (raw.trim() !== "" && Number.isFinite(n) && n >= 0) {
                      heightAxis.applyMode("fixed", n);
                    }
                  }}
                  onStep={(dir, fine) => {
                    const next = Math.max(0, heightAxis.px + dir * (fine ? 1 : 8));
                    heightAxis.applyMode("fixed", next);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-0.5">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground select-none">
                  <input
                    type="checkbox"
                    aria-label="Fill Width"
                    checked={widthAxis.mode === "fill"}
                    onChange={(e) =>
                      widthAxis.applyMode(e.target.checked ? "fill" : "fixed", widthAxis.px)
                    }
                    className="size-3.5 cursor-pointer rounded accent-purple-500"
                  />
                  <span>Fill Width</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground select-none">
                  <input
                    type="checkbox"
                    aria-label="Hug Width"
                    checked={widthAxis.mode === "hug"}
                    onChange={(e) =>
                      widthAxis.applyMode(e.target.checked ? "hug" : "fixed", widthAxis.px)
                    }
                    className="size-3.5 cursor-pointer rounded accent-purple-500"
                  />
                  <span>Hug Width</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground select-none">
                  <input
                    type="checkbox"
                    aria-label="Fill Height"
                    checked={heightAxis.mode === "fill"}
                    onChange={(e) =>
                      heightAxis.applyMode(e.target.checked ? "fill" : "fixed", heightAxis.px)
                    }
                    className="size-3.5 cursor-pointer rounded accent-purple-500"
                  />
                  <span>Fill Height</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground select-none">
                  <input
                    type="checkbox"
                    aria-label="Hug Height"
                    checked={heightAxis.mode === "hug"}
                    onChange={(e) =>
                      heightAxis.applyMode(e.target.checked ? "hug" : "fixed", heightAxis.px)
                    }
                    className="size-3.5 cursor-pointer rounded accent-purple-500"
                  />
                  <span>Hug Height</span>
                </label>
              </div>
            </div>
          </DesignSection>

          {/* 2. Appearance */}
          <DesignSection
            title="Appearance"
            defaultOpen
            action={
              appearanceModified ? (
                <SectionResetButton onClick={resetAppearance} label="Reset appearance" />
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              <DraftField
                resetKey={`${elSerial}:opacity`}
                prefix="%"
                value={String(opacityPct)}
                ariaLabel="Opacity"
                onCommit={(raw) => {
                  const n = Number(raw.trim());
                  if (raw.trim() !== "" && Number.isFinite(n)) {
                    const clamped = Math.max(0, Math.min(100, Math.round(n)));
                    upsertStyle("spacing", "opacity", { value: String(round2(clamped / 100)) }, "appearance");
                  }
                }}
                onStep={(dir, fine) => {
                  const clamped = Math.max(0, Math.min(100, opacityPct + dir * (fine ? 1 : 10)));
                  upsertStyle("spacing", "opacity", { value: String(round2(clamped / 100)) }, "appearance");
                }}
              />

              <div className="flex min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">
                  <DraftField
                    resetKey={`${elSerial}:radius:${uniformRadiusToken ?? ""}`}
                    prefix="R"
                    value={uniformRadiusDisplay}
                    ariaLabel="Corner radius"
                    tokenActive={Boolean(uniformRadiusToken)}
                    onCommit={(raw) => {
                      const parsed = parseCssLengthInput(raw, false);
                      if (parsed) applyUniformRadius({ value: parsed });
                    }}
                    onStep={(dir, fine) => {
                      const next = Math.max(0, round2(radiusVals.tl + dir * (fine ? 1 : 2)));
                      applyUniformRadius({ value: `${next}px` });
                    }}
                    onTokenClick={(anchorEl) =>
                      openTokenMenu(
                        "radius",
                        anchorEl,
                        radiusOpts,
                        uniformRadiusToken,
                        (tok) => {
                          if (tok) applyUniformRadius({ value: tok.value, token: tok.id });
                          else applyUniformRadius({ value: `${radiusVals.tl}px` });
                        },
                        "Search radius...",
                      )
                    }
                  />
                </div>
                <IndividualToggle
                  active={radiusIndividual}
                  onClick={() => setRadiusIndividual((v) => !v)}
                  ariaLabel="Individual corner radius"
                  title={radiusIndividual ? "Collapse corner radius" : "Edit individual corners"}
                />
              </div>
            </div>

            {radiusIndividual && (
              <div className="grid grid-cols-2 gap-1.5">
                {RADIUS_CORNERS.map((corner) => {
                  const rec = styles.findFor(sel, corner.prop);
                  const tok = rec?.styleChange?.to.token;
                  const val = radiusVals[corner.key];
                  return (
                    <DraftField
                      key={corner.key}
                      resetKey={`${elSerial}:${corner.prop}:${tok ?? ""}`}
                      prefix={corner.label}
                      value={tok ?? String(val)}
                      ariaLabel={corner.aria}
                      tokenActive={Boolean(tok)}
                      onCommit={(raw) => {
                        const parsed = parseCssLengthInput(raw, false);
                        if (parsed) applyCornerRadius(corner.prop, { value: parsed });
                      }}
                      onStep={(dir, fine) => {
                        const next = Math.max(0, round2(val + dir * (fine ? 1 : 2)));
                        applyCornerRadius(corner.prop, { value: `${next}px` });
                      }}
                      onTokenClick={(anchorEl) =>
                        openTokenMenu(
                          corner.prop,
                          anchorEl,
                          radiusOpts,
                          tok,
                          (picked) => {
                            if (picked) applyCornerRadius(corner.prop, { value: picked.value, token: picked.id });
                            else applyCornerRadius(corner.prop, { value: `${val}px` });
                          },
                          "Search radius...",
                        )
                      }
                    />
                  );
                })}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground select-none">
              <input
                type="checkbox"
                aria-label="Clip content"
                checked={isClipped}
                onChange={(e) => toggleClipContent(e.target.checked)}
                className="size-3.5 cursor-pointer rounded accent-purple-500"
              />
              <span>Clip content</span>
            </label>
          </DesignSection>

          {/* 3. Fill */}
          <DesignSection
            title="Fill"
            defaultOpen
            action={
              hasBgAndText ? (
                <SegmentedControl role="group" aria-label="Fill target">
                  {(
                    [
                      { id: "background-color", label: "Bg" },
                      { id: "color", label: "Text" },
                    ] as const
                  ).map((tab) => {
                    const active = activeFillProp === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        aria-label={`Fill ${tab.label}`}
                        aria-pressed={active}
                        onClick={() => setFillTarget(tab.id)}
                        className={cn(
                          "h-5 cursor-pointer rounded-[5px] px-1.5 text-[10px] font-medium transition-colors outline-none",
                          active
                            ? "bg-background text-foreground shadow-xs dark:bg-white/[0.12]"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </SegmentedControl>
              ) : undefined
            }
          >
            <ColorPillField
              color={fillSwatch}
              label={fillLabel}
              tokenActive={Boolean(fillToken)}
              modified={Boolean(fillRec)}
              onSwatchClick={(anchorEl) =>
                openColorMenu(`fill:${activeFillProp}`, anchorEl, fillSwatch, (val) =>
                  upsertStyle("color", activeFillProp, { value: val }, `fill-${activeFillProp}`),
                )
              }
              onTokenClick={(anchorEl) =>
                openTokenMenu(
                  `fill-token:${activeFillProp}`,
                  anchorEl,
                  colorOpts,
                  fillToken,
                  (tok) => {
                    if (tok) upsertStyle("color", activeFillProp, { value: tok.value, token: tok.id }, `fill-${activeFillProp}`);
                    else if (fillHex) upsertStyle("color", activeFillProp, { value: fillHex }, `fill-${activeFillProp}`);
                  },
                  "Search colors...",
                )
              }
              onReset={fillRec ? () => styles.remove(fillRec.id) : undefined}
            />
          </DesignSection>

          {/* 4. Stroke */}
          <DesignSection
            key={`stroke-${elSerial}-${hasVisibleBorder ? 1 : 0}`}
            title="Stroke"
            defaultOpen={hasVisibleBorder}
            action={
              strokeModified ? (
                <SectionResetButton onClick={resetStroke} label="Reset stroke" />
              ) : undefined
            }
          >
            <ColorPillField
              color={borderColorSwatch}
              label={borderColorLabel}
              tokenActive={Boolean(borderColorToken)}
              modified={Boolean(borderColorRec)}
              onSwatchClick={(anchorEl) =>
                openColorMenu("stroke-color", anchorEl, borderColorSwatch, (val) =>
                  applyBorderColor({ value: val }),
                )
              }
              onTokenClick={(anchorEl) =>
                openTokenMenu(
                  "stroke-color-token",
                  anchorEl,
                  colorOpts,
                  borderColorToken,
                  (tok) => {
                    if (tok) applyBorderColor({ value: tok.value, token: tok.id });
                    else if (borderColorHex) applyBorderColor({ value: borderColorHex });
                  },
                  "Search colors...",
                )
              }
              onReset={borderColorRec ? () => styles.remove(borderColorRec.id) : undefined}
            />

            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label="Border style"
                value={BORDER_STYLES.includes(currentBorderStyle as (typeof BORDER_STYLES)[number]) ? currentBorderStyle : "solid"}
                onChange={(e) => {
                  const val = e.target.value;
                  upsertStyle("spacing", "border-style", { value: val }, "stroke");
                  if (val !== "none" && maxBorderWidth === 0 && !uniformBorderWRec) {
                    upsertStyle("spacing", "border-width", { value: "1px" }, "stroke");
                  }
                }}
                className="h-7 w-full cursor-pointer rounded-lg border border-transparent bg-muted/45 px-2 text-xs text-foreground capitalize transition-colors outline-none hover:border-border/60 hover:bg-muted/65 focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-white/[0.05] dark:hover:border-white/[0.1]"
              >
                {BORDER_STYLES.map((st) => (
                  <option key={st} value={st}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </option>
                ))}
              </select>

              <div className="flex min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">
                  <DraftField
                    resetKey={`${elSerial}:bw:${uniformBorderWToken ?? ""}`}
                    prefix="W"
                    value={uniformBorderWDisplay}
                    ariaLabel="Border width"
                    tokenActive={Boolean(uniformBorderWToken)}
                    onCommit={(raw) => {
                      const parsed = parseCssLengthInput(raw, false);
                      if (parsed) applyUniformBorderWidth({ value: parsed });
                    }}
                    onStep={(dir, fine) => {
                      const next = Math.max(0, round2(borderWidthVals.top + dir * (fine ? 0.5 : 1)));
                      applyUniformBorderWidth({ value: `${next}px` });
                    }}
                    onTokenClick={(anchorEl) =>
                      openTokenMenu(
                        "border-width",
                        anchorEl,
                        borderWidthOpts,
                        uniformBorderWToken,
                        (tok) => {
                          if (tok) applyUniformBorderWidth({ value: tok.value, token: tok.id });
                          else applyUniformBorderWidth({ value: `${borderWidthVals.top}px` });
                        },
                        "Search stroke width...",
                      )
                    }
                  />
                </div>
                <IndividualToggle
                  active={strokeIndividual}
                  onClick={() => setStrokeIndividual((v) => !v)}
                  ariaLabel="Individual border width"
                  title={strokeIndividual ? "Collapse border widths" : "Edit individual border sides"}
                />
              </div>
            </div>

            {strokeIndividual && (
              <div className="grid grid-cols-2 gap-1.5">
                {BORDER_WIDTH_SIDES.map((side) => {
                  const rec = styles.findFor(sel, side.prop);
                  const tok = rec?.styleChange?.to.token;
                  const val = borderWidthVals[side.key];
                  return (
                    <DraftField
                      key={side.key}
                      resetKey={`${elSerial}:${side.prop}:${tok ?? ""}`}
                      prefix={side.label}
                      value={tok ?? String(val)}
                      ariaLabel={side.aria}
                      tokenActive={Boolean(tok)}
                      onCommit={(raw) => {
                        const parsed = parseCssLengthInput(raw, false);
                        if (parsed) applySideBorderWidth(side.prop, { value: parsed });
                      }}
                      onStep={(dir, fine) => {
                        const next = Math.max(0, round2(val + dir * (fine ? 0.5 : 1)));
                        applySideBorderWidth(side.prop, { value: `${next}px` });
                      }}
                      onTokenClick={(anchorEl) =>
                        openTokenMenu(
                          side.prop,
                          anchorEl,
                          borderWidthOpts,
                          tok,
                          (picked) => {
                            if (picked) applySideBorderWidth(side.prop, { value: picked.value, token: picked.id });
                            else applySideBorderWidth(side.prop, { value: `${val}px` });
                          },
                          "Search stroke width...",
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </DesignSection>

          {/* 5. Typography (auto-shown for text layers) */}
          {isTextNode && (
            <DesignSection
              title="Typography"
              defaultOpen
              action={
                typeModified ? (
                  <SectionResetButton onClick={resetType} label="Reset typography" />
                ) : undefined
              }
            >
              {/* Font family readout */}
              <div
                aria-label="Font family"
                title={cs.fontFamily}
                className="flex h-7 items-center justify-between gap-2 rounded-lg bg-muted/35 px-2 text-xs text-foreground/90 dark:bg-white/[0.04]"
              >
                <span className="truncate font-medium">{familyName}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">Font</span>
              </div>

              {/* Weight + Size */}
              <div className="grid grid-cols-2 gap-1.5">
                <div
                  className={cn(
                    "flex h-7 min-w-0 items-center gap-0.5 rounded-lg border px-1.5 transition-colors",
                    weightToken
                      ? "border-purple-500/35 bg-purple-500/[0.07] dark:border-purple-400/30 dark:bg-purple-500/[0.11]"
                      : "border-transparent bg-muted/45 hover:border-border/60 dark:bg-white/[0.05]",
                  )}
                >
                  <select
                    aria-label="Font weight"
                    value={WEIGHT_OPTIONS.some((w) => w.value === currentWeight) ? currentWeight : "400"}
                    onChange={(e) => upsertStyle("typography", "font-weight", { value: e.target.value }, "type")}
                    className={cn(
                      "h-full min-w-0 flex-1 cursor-pointer bg-transparent text-xs outline-none",
                      weightToken ? "font-medium text-purple-600 dark:text-purple-300" : "text-foreground",
                    )}
                  >
                    {WEIGHT_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <TokenDiamondButton
                    active={Boolean(weightToken)}
                    title={weightToken ? `Variable bound (${weightToken})` : "Bind font weight variable"}
                    onClick={(anchorEl) =>
                      openTokenMenu(
                        "font-weight",
                        anchorEl,
                        fontWeightOpts,
                        weightToken,
                        (tok) => {
                          if (tok) upsertStyle("typography", "font-weight", { value: tok.value, token: tok.id }, "type");
                          else upsertStyle("typography", "font-weight", { value: currentWeight }, "type");
                        },
                        "Search weights...",
                      )
                    }
                  />
                </div>

                <DraftField
                  resetKey={`${elSerial}:fs:${sizeToken ?? ""}`}
                  prefix="AA"
                  value={sizeToken ?? String(sizePx)}
                  ariaLabel="Font size"
                  tokenActive={Boolean(sizeToken)}
                  onCommit={(raw) => {
                    const parsed = parseCssLengthInput(raw, false);
                    if (parsed && Number.parseFloat(parsed) > 0) {
                      upsertStyle("typography", "font-size", { value: parsed }, "type");
                    }
                  }}
                  onStep={(dir, fine) => {
                    const next = stepTypeValue("font-size", sizePx, dir, fine);
                    upsertStyle("typography", "font-size", { value: `${next}px` }, "type");
                  }}
                  onTokenClick={(anchorEl) =>
                    openTokenMenu(
                      "font-size",
                      anchorEl,
                      fontSizeOpts,
                      sizeToken,
                      (tok) => {
                        if (tok) upsertStyle("typography", "font-size", { value: tok.value, token: tok.id }, "type");
                        else upsertStyle("typography", "font-size", { value: `${sizePx}px` }, "type");
                      },
                      "Search font sizes...",
                    )
                  }
                />
              </div>

              {/* Line height + Letter spacing */}
              <div className="grid grid-cols-2 gap-1.5">
                <DraftField
                  resetKey={`${elSerial}:lh:${lhToken ?? ""}`}
                  prefix="LH"
                  value={lhToken ?? String(lhPx)}
                  ariaLabel="Line height"
                  tokenActive={Boolean(lhToken)}
                  onCommit={(raw) => {
                    const trimmed = raw.trim();
                    if (!trimmed) return;
                    const parsed = parseCssLengthInput(trimmed, false);
                    if (parsed) upsertStyle("typography", "line-height", { value: parsed }, "type");
                  }}
                  onStep={(dir, fine) => {
                    const next = stepTypeValue("line-height", lhPx, dir, fine);
                    upsertStyle("typography", "line-height", { value: `${next}px` }, "type");
                  }}
                  onTokenClick={(anchorEl) =>
                    openTokenMenu(
                      "line-height",
                      anchorEl,
                      lineHeightOpts,
                      lhToken,
                      (tok) => {
                        if (tok) upsertStyle("typography", "line-height", { value: tok.value, token: tok.id }, "type");
                        else upsertStyle("typography", "line-height", { value: `${lhPx}px` }, "type");
                      },
                      "Search line heights...",
                    )
                  }
                />

                <DraftField
                  resetKey={`${elSerial}:ls:${lsToken ?? ""}`}
                  prefix="LS"
                  value={lsToken ?? String(lsPx)}
                  ariaLabel="Letter spacing"
                  tokenActive={Boolean(lsToken)}
                  onCommit={(raw) => {
                    const parsed = parseCssLengthInput(raw, true);
                    if (parsed) upsertStyle("typography", "letter-spacing", { value: parsed }, "type");
                  }}
                  onStep={(dir, fine) => {
                    const next = stepTypeValue("letter-spacing", lsPx, dir, fine);
                    upsertStyle("typography", "letter-spacing", { value: `${next}px` }, "type");
                  }}
                  onTokenClick={(anchorEl) =>
                    openTokenMenu(
                      "letter-spacing",
                      anchorEl,
                      trackingOpts,
                      lsToken,
                      (tok) => {
                        if (tok) upsertStyle("typography", "letter-spacing", { value: tok.value, token: tok.id }, "type");
                        else upsertStyle("typography", "letter-spacing", { value: `${lsPx}px` }, "type");
                      },
                      "Search letter spacing...",
                    )
                  }
                />
              </div>

              {/* Text align */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] font-medium text-muted-foreground/85">Align</span>
                <SegmentedControl role="group" aria-label="Text alignment">
                  {TEXT_ALIGNS.map(({ value, label, icon: Icon }) => {
                    const active = currentTextAlign === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={label}
                        aria-pressed={active}
                        title={label}
                        onClick={() => upsertStyle("typography", "text-align", { value }, "type")}
                        className={cn(
                          "inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors outline-none",
                          active
                            ? "bg-background text-foreground shadow-xs dark:bg-white/[0.12]"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </SegmentedControl>
              </div>
            </DesignSection>
          )}
        </div>
      </PanelFrame>

      {/* Floating Token Variable Popover */}
      <TokenPopover
        open={Boolean(tokenPopover)}
        onOpenChange={(open) => {
          if (!open) setTokenPopover(null);
        }}
        tokens={tokenPopover?.tokens ?? []}
        selectedId={tokenPopover?.selectedId}
        onSelect={(tok) => tokenPopover?.onSelect(tok)}
        anchorEl={tokenPopover?.anchorEl ?? null}
        placeholder={tokenPopover?.placeholder}
      />

      {/* Floating HSV Color Picker Popover */}
      <ColorPickerPopover
        open={Boolean(colorPopover)}
        onOpenChange={(open) => {
          if (!open) setColorPopover(null);
        }}
        color={colorPopover?.color ?? "#000000"}
        onChange={(val) => colorPopover?.onChange(val)}
        anchorEl={colorPopover?.anchorEl ?? null}
      />
    </>
  );
}
