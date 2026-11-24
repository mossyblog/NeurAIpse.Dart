"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  escapeSelection,
  longhandsOf,
  presetSelection,
  propertySides,
  selectionNotes,
  selectionProperties,
  stepSelectionValue,
  tokenSteps,
  toggleSide,
  selectionUtilityPrefix,
  valueReadout,
  type BoxSelection,
} from "../core/box-select.ts";
import { normalizeScale, type ScaleStep } from "../core/drag-guides.ts";
import { getElementClasses, identifyElement } from "../core/identify.ts";
import { guideFor, measureBetween, primaryDistance, type Guide, type Measurement } from "../core/measure.ts";
import { BOX_SIDES, parsePx, regionProperty, type BoxSide, type SpacingRegion, type TokenResolver } from "../core/spacing.ts";
import { elementSpacing, type ElementSpacing } from "../core/spacing-dom.ts";
import { GROUP_ATTRIBUTE, spacingTokens, tokenId, type SpacingToken, type StyleValue } from "../core/style-change.ts";
import { resolutionLabel, readRootVars } from "../core/tokens-dom.ts";
import { parseMultiplierToken, shiftUtility, tokenDisplayLabel } from "../core/token-values.ts";
import type { Annotation, Rect } from "../core/types.ts";
import { GroupOverlay } from "./group-overlay.tsx";
import { EDIT_NOT_FOUND, elementSerial, type InspectorContext } from "./inspector-context.ts";
import { SpacingAids } from "./spacing-aids.tsx";
import { SpacingOverlay, type BoxRing } from "./spacing-overlay.tsx";
import { BoxPanel, SpacingPanel, type PanelRow, type SideRow, type TokenChip } from "./spacing-panel.tsx";
import { resolveTarget, targetRect, useSpacingInspector, type BoxSelected } from "./use-spacing-inspector.ts";
import { useHandleDrag, type HandleDrag, type HandleTarget } from "./use-handle-drag.ts";
import { measureRecord, memberLabel, previewValue, type StyleChangesApi } from "./use-style-changes.ts";
import { isEditableElement } from "../core/shortcuts.ts";

const PROPERTIES: Record<SpacingRegion["kind"], string[]> = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  gap: ["row-gap", "column-gap"],
};

function computedValue(el: Element, property: string): string {
  return getComputedStyle(el).getPropertyValue(property).trim();
}

const rootFontPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** Records keep resolved px for tokens; the preview writes the token's CSS. */
function recordValue(next: StyleValue, tokens: readonly SpacingToken[]): StyleValue {
  if (!next.token) return next;
  const token = tokens.find((t) => t.name === next.token);
  return { value: token ? `${token.px}px` : next.value, token: next.token };
}

/**
 * Spacing inspector (spec 3, 5, 6, 14): Box selects whole rings and edits them from the
 * panel or the keyboard; Lines pins guides and measures. Edits are style-change
 * annotations held by the toolbar; the preview is applied there.
 */
export function SpacingInspector({ ctx }: { ctx: InspectorContext }) {
  return ctx.subMode === "lines" ? <LinesInspector ctx={ctx} /> : <BoxInspector ctx={ctx} />;
}

/* =============================== Lines =============================== */

/** Lines (spec 14.3): crosshair, click-click guides and measure, Alt quick measure. */
function LinesInspector({ ctx }: { ctx: InspectorContext }) {
  const { surface, styles, resolver, attributeNames } = ctx;
  const inspector = useSpacingInspector({ surface, enabled: true, subMode: "lines" });
  const { redraw, clear, hasPins } = inspector;

  // The first Esc clears pins, guides and measure; the toolbar handles the next (spec 14.4).
  const onEscape = useEffectEvent(() => {
    if (!hasPins) return false;
    clear();
    return true;
  });
  const { setEscape } = ctx;
  useEffect(() => {
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [setEscape]);

  useEffect(() => redraw(), [styles.items, redraw]);
  useEffect(() => resolver.subscribe(redraw), [resolver, redraw]);

  const hover = resolveTarget(inspector.hover);
  const pinA = resolveTarget(inspector.pins.a);
  const pinB = resolveTarget(inspector.pins.b);
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  const guides: Guide[] = [pinA, pinB].flatMap((pin) => (pin?.region ? [guideFor(pin.region, viewport)] : []));
  let measurement: Measurement | null = null;
  if (pinA && pinB) measurement = measureBetween(targetRect(pinA), targetRect(pinB));
  else if (pinA && inspector.alt && hover && hover.spacing.element !== pinA.spacing.element) {
    measurement = measureBetween(targetRect(pinA), hover.spacing.border);
  }
  const pins: { rect: Rect; label: string }[] = [pinA, pinB].flatMap((pin) => (pin ? [{ rect: targetRect(pin), label: pin.region ? regionProperty(pin.region) : "edge" }] : []));

  const resolveToken: TokenResolver = (element, property) => {
    const pending = styles.findFor(element, property);
    if (pending?.styleChange) return tokenDisplayLabel(pending.styleChange.to.token, pending.styleDetail?.toUtility);
    return resolutionLabel(resolver.peek(element, property));
  };

  // The panel follows pin B, so a measure then an edit reads "Distance between A and B"
  // on B's change (spec 7.2). It shows only while a two-region measure can be committed.
  const active = pinB ?? pinA;
  const element = active?.spacing.element;
  const region = active?.region ?? null;
  const twoRegions = pinA?.region && pinB?.region ? { a: pinA.region, b: pinB.region } : null;
  const measureLabels: [string, string] | undefined = pinA && pinB ? [memberLabel(pinA.spacing.element), memberLabel(pinB.spacing.element)] : undefined;
  const measureFor = () => {
    if (!twoRegions || !measurement || !measureLabels) return undefined;
    const selectors: [string, string] = [identifyElement(twoRegions.a.element, attributeNames).path, identifyElement(twoRegions.b.element, attributeNames).path];
    return measureRecord(twoRegions.a, twoRegions.b, selectors, primaryDistance(measurement));
  };

  const setChange = (property: string, next: StyleValue) => {
    if (!element) return;
    const pending = styles.findFor(element, property);
    const resolution = resolver.resolve(element, property);
    const from: StyleValue = pending?.styleChange?.from ?? { value: computedValue(element, property), ...(resolution.token ? { token: resolution.token } : {}) };
    const to = recordValue(next, spacingTokens(resolver.rootVars(), rootFontPx()));
    const fromMultiplier = from.token ? parseMultiplierToken(from.token) : undefined;
    const toMultiplier = to.token ? parseMultiplierToken(to.token) : undefined;
    const fromUtility = pending?.styleDetail?.fromUtility ?? resolution.utility;
    const toUtility = fromMultiplier && toMultiplier ? shiftUtility(fromUtility, fromMultiplier.multiplier, toMultiplier.multiplier) : undefined;
    const editsPinB = Boolean(pinB && element === pinB.spacing.element);
    styles.upsert({
      category: "spacing",
      property,
      groupId: pending?.styleDetail?.groupId ?? `sp-${elementSerial(element)}`,
      elements: [element],
      from,
      to,
      region: active?.spacing.regions.find((r) => regionProperty(r) === property),
      measure: editsPinB ? measureFor() : undefined,
      detail: {
        name: memberLabel(element),
        flags: pending?.styleDetail?.flags ?? resolution.flags,
        ...(fromUtility ? { fromUtility } : {}),
        toUtility,
        ...(resolution.origin ? { origin: resolution.origin } : {}),
        ...(editsPinB && measureLabels ? { measureLabels } : {}),
      },
    });
  };
  const reset = (property: string) => {
    if (!element) return;
    const pending = styles.findFor(element, property);
    if (pending) styles.remove(pending.id);
  };

  const rows: PanelRow[] =
    element && region
      ? PROPERTIES[region.kind].map((property) => {
          const pending = styles.findFor(element, property)?.styleChange;
          const computed = computedValue(element, property);
          const resolution = resolver.resolve(element, property);
          const flags = pending ? (styles.findFor(element, property)?.styleDetail?.flags ?? []) : resolution.flags;
          return {
            property,
            current: pending?.from ?? { value: computed, ...(resolution.token ? { token: resolution.utility ? `${resolution.utility} · ${resolution.token}` : resolution.token } : {}) },
            next: pending?.to,
            computed,
            pinned: property === regionProperty(region),
            flags,
          };
        })
      : [];
  const elementKey = element ? identifyElement(element, attributeNames) : null;
  const measureText = measurement && measureLabels ? `Distance between ${measureLabels[0]} and ${measureLabels[1]}: ${primaryDistance(measurement)}px` : undefined;
  const linesSubtitle = pinA && !pinB ? "Click a second edge to measure, or hold Alt" : region ? regionProperty(region) : undefined;

  return (
    <>
      <SpacingOverlay subMode="lines" spacing={hover?.spacing ?? null} pins={pins} guides={guides} measurement={measurement} resolveToken={resolveToken} />
      {(twoRegions || pinA || ctx.pending.length > 0) && (
        <SpacingPanel
          key={elementKey ? `${elementKey.path}|${region ? regionProperty(region) : ""}` : "none"}
          elementName={elementKey?.name ?? "Spacing"}
          regionLabel={linesSubtitle}
          rows={rows}
          tokens={element ? spacingTokens(readRootVars(document), rootFontPx()) : []}
          pending={ctx.pending}
          onSet={setChange}
          onReset={reset}
          onRemove={(id) => styles.remove(id)}
          onEdit={ctx.onEdit}
          onCopy={ctx.onCopy}
          measure={
            measureText
              ? {
                  text: measureText,
                  onSave: () => {
                    const record = measureFor();
                    if (record && measureLabels) styles.addMeasure(record, measureLabels);
                  },
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/* ================================ Box ================================ */

const SIDE_NAME: Record<BoxSide, string> = { top: "top", right: "right", bottom: "bottom", left: "left" };

/** Reads values with the preview lifted from `els` (pre-preview, as authored). */
function withoutPreview<T>(els: readonly Element[], read: () => T): T {
  const saved = els.map((el) => [el, el.getAttribute(GROUP_ATTRIBUTE)] as const);
  for (const [el, value] of saved) if (value != null) el.removeAttribute(GROUP_ATTRIBUTE);
  try {
    return read();
  } finally {
    for (const [el, value] of saved) if (value != null) el.setAttribute(GROUP_ATTRIBUTE, value);
  }
}

/** Component/class signature for the scope toggle: the design-system slot, else tag + classes. */
function scopeSignature(el: Element): string | null {
  const slot = el.getAttribute("data-slot");
  if (slot) return `slot:${slot}`;
  const classes = getElementClasses(el).split(" ").filter(Boolean).sort().join(" ");
  return classes ? `${el.localName}.${classes}` : null;
}

/** Every page element with the anchor's signature, anchor first (spec 14.2 scope). */
function scopeMembers(anchor: Element, skip: (el: Element) => boolean): Element[] {
  const signature = scopeSignature(anchor);
  if (!signature) return [anchor];
  const others = Array.from(document.querySelectorAll(anchor.localName)).filter((el) => el !== anchor && !skip(el) && scopeSignature(el) === signature);
  return [anchor, ...others];
}

/** Pending spacing record that covers `el` on one longhand (latest edit wins). */
function coveringRecord(styles: StyleChangesApi, el: Element, longhand: string): Annotation | undefined {
  let best: Annotation | undefined;
  for (const a of styles.items) {
    const property = a.styleChange?.property;
    if (a.kind !== "style-change" || a.styleChange?.category !== "spacing" || !property) continue;
    if (!longhandsOf(property).includes(longhand) || !styles.elementsFor(a).includes(el)) continue;
    const at = (x: Annotation) => (x.updatedAt ? Date.parse(x.updatedAt) : x.timestamp) || 0;
    if (!best || at(a) >= at(best)) best = a;
  }
  return best;
}

/** Shorthand-ordered value text: `16px` when equal, else `16px 24px` (CSS order). */
function joinValues(values: readonly string[]): string {
  return values.every((v) => v === values[0]) ? values[0] ?? "" : values.join(" ");
}

/** Box (spec 14.2): hover a zone to preview its whole group, click to select, narrow, edit. */
function BoxInspector({ ctx }: { ctx: InspectorContext }) {
  const { surface, styles, resolver, attributeNames } = ctx;
  const inspector = useSpacingInspector({ surface, enabled: true, subMode: "box" });
  const { redraw, selectBox } = inspector;
  const selection: BoxSelected | null = inspector.selection?.element.isConnected ? inspector.selection : null;
  const anchor = selection?.element ?? null;
  // Scope belongs to the anchor: a new anchor starts in "This element".
  const [scopeState, setScopeState] = useState<{ anchor: Element | null; mode: "one" | "all"; preview: boolean }>({ anchor: null, mode: "one", preview: false });
  const scope = scopeState.anchor === anchor ? scopeState.mode : "one";
  const scopePreview = scopeState.anchor === anchor && scopeState.preview;
  const setScope = (mode: "one" | "all") => setScopeState({ anchor, mode, preview: false });
  const setScopePreview = (preview: boolean) => setScopeState((s) => ({ anchor, mode: s.anchor === anchor ? s.mode : "one", preview }));
  const members = useMemo(() => (anchor ? scopeMembers(anchor, (el) => el === surface.host) : []), [anchor, surface]);
  const elements = anchor ? (scope === "all" ? members : [anchor]) : [];

  useEffect(() => redraw(), [styles.items, redraw]);
  useEffect(() => resolver.subscribe(redraw), [resolver, redraw]);

  // Edit from the pending list: select that change's element and the sides it covers.
  const onFocus = useEffectEvent((id: string) => {
    const annotation = styles.items.find((a) => a.id === id);
    const property = annotation?.styleChange?.property;
    if (annotation?.styleChange?.category !== "spacing" || !property) return;
    const found = styles.reattach(annotation);
    const [element] = found;
    if (!element) return ctx.notify(EDIT_NOT_FOUND);
    const covered = propertySides(property);
    if (!covered) return;
    selectBox({ ...covered, element });
    setScopeState({ anchor: element, mode: found.length > 1 ? "all" : "one", preview: false });
  });
  useEffect(() => {
    const request = ctx.focus;
    if (!request) return;
    // Deferred: the target may need re-attaching (a state update in the toolbar) first.
    queueMicrotask(() => onFocus(request.id));
  }, [ctx.focus]);

  const tokens = spacingTokens(readRootVars(document), rootFontPx());
  const steps = tokenSteps(tokens);
  /** One runtime scale for the arrow keys, handle snapping and guides: the same on-grid set as `tokenSteps`. */
  const scale: ScaleStep[] = normalizeScale((tokens.some((t) => t.onGrid) ? tokens.filter((t) => t.onGrid) : tokens).map((t) => ({ px: t.px, token: t.name })));
  const selSpacing: ElementSpacing | null = anchor ? elementSpacing(anchor) : null;
  const hoverHit = inspector.boxHover?.element.isConnected ? inspector.boxHover : null;
  const hoverSpacing = hoverHit ? (hoverHit.element === anchor ? selSpacing : elementSpacing(hoverHit.element)) : null;

  /* ---------- geometry of the selection ---------- */
  const gapRegions = selSpacing?.regions.filter((r) => r.kind === "gap") ?? [];
  const gapAxes = [...new Set(gapRegions.map((r) => r.side as "row" | "column"))];
  const gapInfo = anchor ? { axes: gapAxes, rowGap: parsePx(computedValue(anchor, "row-gap")), columnGap: parsePx(computedValue(anchor, "column-gap")) } : undefined;
  const sel: BoxSelection | null = selection ? { group: selection.group, sides: selection.sides } : null;
  const properties = sel ? selectionProperties(sel, gapInfo) : [];
  /** Longhands the selection edits, e.g. padding-top..left; gap: the axes with bands. */
  const longhands = sel ? (sel.group === "gap" ? (properties[0] === "gap" ? ["row-gap", "column-gap"] : properties) : sel.sides.map((s) => `${sel.group}-${s}`)) : [];
  const liveValues = anchor ? longhands.map((p) => parsePx(computedValue(anchor, p))) : [];
  const readout = valueReadout(liveValues);
  const sideValues: Partial<Record<BoxSide, number>> = {};
  if (anchor && sel && sel.group !== "gap") for (const side of BOX_SIDES) sideValues[side] = parsePx(computedValue(anchor, `${sel.group}-${side}`));

  /* ---------- records ---------- */
  const groupIdFor = (property: string): string => {
    const kind = propertySides(property)?.group ?? "padding";
    // Re-use a pending record's group for the same members (after reload ids change).
    const same = styles.items.find((a) => {
      const p = a.styleChange?.property;
      if (!p || propertySides(p)?.group !== kind || !a.styleDetail?.groupId) return false;
      const els = styles.elementsFor(a);
      return els.length === elements.length && els.every((el) => elements.includes(el));
    });
    return same?.styleDetail?.groupId ?? `sp-${elementSerial(elements[0])}-${kind}${scope === "all" ? "-all" : ""}`;
  };

  /** Sets every selected side to `next` (spec 14.2): one record per mapped property. */
  const apply = (next: StyleValue) => {
    if (sel) applyTo(sel, next);
  };

  /** Sets the sides of `target` (the selection, or the side a handle drag released) to `next`. */
  const applyTo = (target: BoxSelection, next: StyleValue) => {
    if (!anchor) return;
    const sel = target;
    const properties = selectionProperties(sel, gapInfo);
    const to = recordValue(next, tokens);
    const toMultiplier = to.token ? parseMultiplierToken(to.token) : undefined;
    const viewport = window.innerWidth;
    // Pre-preview facts of the anchor, per side.
    const originals = withoutPreview(elements, () => ({
      anchor: Object.fromEntries([...PROPERTIES.padding, ...PROPERTIES.margin, ...PROPERTIES.gap].map((p) => [p, computedValue(anchor, p)])),
      members: elements.map((el) => properties.map((p) => longhandsOf(p).map((l) => computedValue(el, l)))),
    }));
    const resolutions = Object.fromEntries(longhandsOf(sel.group === "gap" ? "gap" : sel.group).map((l) => [l, resolver.resolve(anchor, l)]));
    const utilities: Partial<Record<BoxSide, string>> = {};
    const values: Partial<Record<BoxSide, number>> = {};
    if (sel.group !== "gap") {
      for (const side of BOX_SIDES) {
        const u = resolutions[`${sel.group}-${side}`]?.utility;
        if (u) utilities[side] = u;
        values[side] = parsePx(originals.anchor[`${sel.group}-${side}`]);
      }
    }
    const rtl = getComputedStyle(anchor).direction === "rtl";
    const notes = selectionNotes({ group: sel.group, sides: sel.sides, utilities, values, bands: gapRegions.length, viewport, rtl });
    properties.forEach((property, index) => {
      const groupId = groupIdFor(property);
      const covers = propertySides(property);
      const own = longhandsOf(property);
      // Invariant: a record whose elements and sides this one fully covers is replaced by
      // it (any scope group), so Copy never lists a value the preview no longer shows.
      for (const a of styles.items) {
        const p = a.styleChange?.property;
        if (!p || a.styleChange?.category !== "spacing" || (p === property && a.styleDetail?.groupId === groupId)) continue;
        const theirs = longhandsOf(p);
        const els = styles.elementsFor(a);
        if (propertySides(p)?.group === covers?.group && theirs.every((l) => own.includes(l)) && els.length > 0 && els.every((el) => elements.includes(el))) styles.remove(a.id);
      }
      const fromValues = own.map((l) => originals.anchor[l] ?? "");
      const fromTokens = own.map((l) => resolutions[l]?.token);
      const fromUtilities = own.map((l) => resolutions[l]?.utility);
      const from: StyleValue = { value: joinValues(fromValues), ...(fromTokens[0] && fromTokens.every((t) => t === fromTokens[0]) ? { token: fromTokens[0] } : {}) };
      const utils = [...new Set(fromUtilities.filter(Boolean))];
      const fromUtility = utils.length && fromUtilities.every(Boolean) ? utils.join(" ") : undefined;
      let toUtility: string | undefined;
      if (fromUtility && toMultiplier) {
        const prefix =
          property === "gap" ? "gap" : property === "column-gap" ? "gap-x" : property === "row-gap" ? "gap-y" : selectionUtilityPrefix({ group: sel.group, sides: covers?.sides ?? [] });
        toUtility = `${prefix}-${toMultiplier.multiplier}`;
      }
      const flags = [...new Set(own.flatMap((l) => resolutions[l]?.flags ?? []))];
      const origin = own.map((l) => resolutions[l]?.origin).find(Boolean);
      styles.upsert({
        category: "spacing",
        property,
        groupId,
        elements,
        from,
        to,
        region: selSpacing?.regions.find((r) => r.kind === sel.group && own.includes(regionProperty(r))),
        before: originals.members.map((perProp) => joinValues(perProp[index] ?? [])),
        detail: {
          name: memberLabel(anchor),
          flags,
          ...(fromUtility ? { fromUtility } : {}),
          toUtility,
          ...(origin ? { origin } : {}),
          notes,
        },
      });
    });
  };

  const step = (direction: 1 | -1, fine: boolean) => {
    if (!sel) return;
    const min = sel.group === "margin" ? -Infinity : 0;
    const px = stepSelectionValue(liveValues, steps, direction, fine, min);
    const token = !fine ? tokens.find((t) => t.multiplier != null && Math.abs(t.px - px) < 0.01) : undefined;
    apply(token ? { value: token.value, token: token.name } : { value: `${px}px` });
  };

  /* ---------- I9 drag handles (spec 13.1) ---------- */
  /** A drag value as a panel value: a token keeps its CSS (records resolve it to px), px stay px. */
  const dragStyleValue = (drag: HandleDrag): StyleValue => {
    const token = drag.value.token ? tokens.find((t) => t.name === drag.value.token) : undefined;
    return token ? { value: token.value, token: token.name } : { value: `${drag.value.px}px` };
  };
  /** The sides a drag edits: the dragged side, plus its opposite with Cmd/Ctrl; a gap edits the whole gap selection. */
  const dragSelection = (drag: HandleDrag): BoxSelection => {
    if (drag.region.kind === "gap") return { group: "gap", sides: [] };
    const side = drag.region.side as BoxSide;
    const opposite = drag.opposite.replace(/^(padding|margin)-/, "") as BoxSide;
    return { group: drag.region.kind, sides: drag.symmetric ? [side, opposite] : [side] };
  };
  const handleDrag = useHandleDrag({
    steps: scale,
    // Live value through the one preview <style> (a transient draft, never a record).
    onPreview: (drag) => {
      const target = dragSelection(drag);
      const value = previewValue(recordValue(dragStyleValue(drag), tokens));
      const props = selectionProperties(target, gapInfo);
      styles.setDraft(props.flatMap((p) => longhandsOf(p).map((property) => ({ elements, property, value, key: groupIdFor(p) }))));
    },
    onCancel: () => styles.setDraft(null),
    onFinish: (drag) => {
      // Drop the draft first, so the commit reads pre-drag values exactly like a panel edit.
      styles.setDraft(null);
      if (drag.moved) applyTo(dragSelection(drag), dragStyleValue(drag));
    },
  });

  // Esc steps back one level: sides -> ring -> nothing; then the toolbar leaves Spacing.
  const onEscape = useEffectEvent(() => {
    // Esc mid-drag restores the pre-drag value and ends the drag (spec 13.1); nothing else.
    if (handleDrag.cancel()) {
      inspector.swallowNextClick();
      return true;
    }
    if (!inspector.selection) return false;
    const next = escapeSelection(inspector.selection);
    selectBox(next ? { ...next, element: inspector.selection.element } : null);
    return true;
  });
  const { setEscape } = ctx;
  useEffect(() => {
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [setEscape]);

  // Keyboard (spec 14.2): ArrowUp/Right +1 token, ArrowDown/Left -1 token, Shift ±1px.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!inspector.selection || handleDrag.drag) return;
    const target = event.composedPath()[0];
    if (isEditableElement(target as EventTarget)) return;
    const dir = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
    if (!dir || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    step(dir, event.shiftKey);
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);

  /* ---------- overlay ---------- */
  const resolveToken: TokenResolver = (element, property) => {
    const pending = coveringRecord(styles, element, property);
    if (pending?.styleChange) return tokenDisplayLabel(pending.styleChange.to.token, pending.styleDetail?.toUtility);
    return resolutionLabel(resolver.peek(element, property));
  };
  const rings: BoxRing[] = [];
  const hoverOnSelection = Boolean(hoverHit && selection && hoverHit.element === selection.element && hoverHit.group === selection.group);
  if (selection && selSpacing) {
    rings.push({ spacing: selSpacing, group: selection.group, sides: selection.group === "gap" ? null : selection.sides, selected: true, hitSide: hoverOnSelection ? hoverHit?.cell : null });
  }
  if (hoverHit && hoverSpacing && hoverHit.group !== "content" && !hoverOnSelection) {
    rings.push({ spacing: hoverSpacing, group: hoverHit.group, sides: null, selected: false, dim: Boolean(selection), hitSide: hoverHit.cell });
  }
  const hoverSide = hoverOnSelection && typeof hoverHit?.cell === "string" && hoverHit.cell !== "corner" ? hoverHit.cell : null;
  const hint =
    selection && selSpacing && selection.group !== "gap" && hoverSide && !(selection.sides.length === 1 && selection.sides[0] === hoverSide)
      ? { text: `click to narrow to ${SIDE_NAME[hoverSide]}`, at: { x: selSpacing.border.x + selSpacing.border.width / 2, y: selSpacing.border.y + selSpacing.border.height + 8 } }
      : null;
  const outlineSpacing = hoverSpacing ?? selSpacing;

  /* ---------- I9 handles and guides (spec 13): Box only ---------- */
  /** Live regions of a ring's sides (padding/margin) or its bands (gap; `firstBand` keeps one per axis). */
  const ringTargets = (spacing: ElementSpacing | null, group: BoxSelection["group"], sides: readonly BoxSide[] | null, firstBand: boolean): HandleTarget[] => {
    if (!spacing) return [];
    const regions = spacing.regions.filter((r) => r.kind === group && (group === "gap" || !sides || sides.includes(r.side as BoxSide)));
    const pick = group === "gap" && firstBand ? regions.filter((r, i) => regions.findIndex((x) => x.side === r.side) === i) : regions;
    return pick.map((region) => ({ spacing, region }));
  };
  const drag = handleDrag.drag;
  const handleTargets: HandleTarget[] = ctx.handles && selection ? ringTargets(selSpacing, selection.group, selection.group === "gap" ? null : selection.sides, false) : [];
  let guideTargets: HandleTarget[] = [];
  if (ctx.guides) {
    if (selection) guideTargets = ringTargets(selSpacing, selection.group, selection.group === "gap" ? null : selection.sides, true);
    else if (hoverHit && hoverHit.group !== "content") guideTargets = ringTargets(hoverSpacing, hoverHit.group, null, true);
    // While dragging a band, its ladder replaces the first band's.
    if (drag?.region.kind === "gap") {
      const live = selSpacing?.regions.find((r) => r.kind === "gap" && r.side === drag.region.side && (r.index ?? 0) === (drag.region.index ?? 0));
      if (live && selSpacing) guideTargets = [...guideTargets.filter((t) => t.region.side !== live.side), { spacing: selSpacing, region: live }];
    }
  }
  const showMembers = Boolean(anchor && members.length > 1 && (scopePreview || scope === "all"));

  /* ---------- panel ---------- */
  const elementKey = anchor ? identifyElement(anchor, attributeNames) : null;
  const rows: SideRow[] = anchor
    ? withoutPreview([anchor], () => longhands.map((p) => ({ p, value: computedValue(anchor, p) }))).map(({ p, value }) => {
        const r = resolver.resolve(anchor, p);
        return { property: p, current: { value, ...(r.token ? { token: r.utility ? `${r.utility} · ${r.token}` : r.token } : {}) }, flags: r.flags };
      })
    : [];
  const prefix = sel ? (sel.group === "gap" ? "gap" : selectionUtilityPrefix(sel)) : "p";
  const mixed = readout === "mixed";
  // A chip is pressed when every selected side has its px; a named token only when a record chose it.
  const namedToken = anchor ? longhands.map((l) => coveringRecord(styles, anchor, l)?.styleChange?.to.token).find((t) => t && !parseMultiplierToken(t)) : undefined;
  const chips: TokenChip[] = tokens
    .filter((t) => t.px <= 64 || t.multiplier == null)
    .sort((a, b) => a.px - b.px)
    .map((t) => ({
      id: tokenId(t),
      label: t.multiplier != null ? `${prefix}-${t.utility}` : t.name,
      px: t.px,
      value: { value: t.value, token: t.name },
      pressed: !mixed && liveValues.length > 0 && Math.abs(liveValues[0] - t.px) < 0.01 && (t.multiplier != null ? !namedToken : namedToken === t.name),
    }));
  const regionLabel = sel ? (sel.group === "gap" ? `${properties[0]} · ${gapRegions.length} band${gapRegions.length === 1 ? "" : "s"}` : properties.join(" + ")) : "";
  const coveringIds = anchor
    ? [...new Set(elements.flatMap((el) => longhands.map((l) => coveringRecord(styles, el, l)?.id)).filter((id): id is string => Boolean(id)))]
    : [];
  const resetSelection = () => {
    for (const id of coveringIds) styles.remove(id);
  };

  return (
    <>
      <SpacingOverlay subMode="box" spacing={outlineSpacing} rings={rings} hint={hint} pins={[]} guides={[]} measurement={null} resolveToken={resolveToken} />
      {(handleTargets.length > 0 || guideTargets.length > 0) && (
        <SpacingAids
          handles={handleTargets}
          guides={guideTargets}
          drag={drag}
          steps={scale}
          events={{ onDown: handleDrag.start, onMove: handleDrag.move, onUp: handleDrag.finish, onLost: () => void handleDrag.cancel() }}
        />
      )}
      {showMembers && <GroupOverlay kind="spacing" hover={null} members={members} anchor={anchor} badge={`${members.length} elements`} />}
      {selection && sel && anchor ? (
        <BoxPanel
          key={`${elementKey?.path ?? ""}|${sel.group}|${sel.sides.join(",")}|${scope}`}
          elementName={elementKey?.name ?? "Spacing"}
          regionLabel={regionLabel}
          group={sel.group}
          sides={sel.sides}
          values={sideValues}
          bands={gapRegions.length}
          readout={readout}
          rows={rows}
          chips={chips}
          number={mixed || !liveValues.length ? "" : String(Math.round(liveValues[0] * 100) / 100)}
          min={sel.group === "margin" ? -Infinity : 0}
          onCell={(side, additive) => selectBox({ ...toggleSide(sel, side, additive), element: anchor })}
          onPreset={(preset) => selectBox({ ...presetSelection(sel.group, preset), element: anchor })}
          onValue={apply}
          onStep={step}
          onReset={coveringIds.length > 0 ? resetSelection : undefined}
          scope={{ mode: scope, count: members.length, onChange: setScope, onPreview: setScopePreview }}
          count={elements.length > 1 ? elements.length : undefined}
          pending={ctx.pending}
          onRemove={(id) => styles.remove(id)}
          onEdit={ctx.onEdit}
          onCopy={ctx.onCopy}
        />
      ) : (
        ctx.pending.length > 0 && (
          <SpacingPanel elementName="Spacing" rows={[]} tokens={[]} pending={ctx.pending} onSet={() => undefined} onReset={() => undefined} onRemove={(id) => styles.remove(id)} onEdit={ctx.onEdit} onCopy={ctx.onCopy} />
        )
      )}
    </>
  );
}
