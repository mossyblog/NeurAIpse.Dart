"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "./primitives.tsx";
import { cn } from "cn";
import { RotateCcw } from "lucide-react";
import { colorKey, composite, contrastRatio, formatRatio, parseColor, toHex, wcagRating, type RGBA } from "../core/color.ts";
import { backgroundBehind, colorProperties, computedColor, resolveColorValue } from "../core/inspect-dom.ts";
import type { StyleValue } from "../core/style-change.ts";
import { borderWidthTokens, colorTokens } from "../core/token-catalog.ts";
import { FIELD_CLASS, SectionLabel, SegmentedControl } from "./chrome.tsx";
import { GroupOverlay } from "./group-overlay.tsx";
import { EDIT_NOT_FOUND, type InspectorContext } from "./inspector-context.ts";
import { FlagBadges, PanelFrame } from "./inspector-panel.tsx";
import { memberLabel } from "./use-style-changes.ts";
import { useElementPicker } from "./use-element-picker.ts";

/** `base` names the pick; each property is its own change group (`<base>:<property>`). */
type Selection = { anchor: Element; members: Element[]; property: string; sameColor: boolean; groupId: string; base: string };

let groupCounter = 0;

/** Resolver property for a colour property (`border-color` is read from the top side). */
export const colorLonghand = (p: string) => (p === "border-color" ? "border-top-color" : p);

const PROPERTY_TAB_LABEL: Record<string, string> = {
  color: "Text",
  "background-color": "Background",
  "border-color": "Border",
};

const hexOf = (value: string, context?: Element) => {
  const c = resolveColorValue(value, context);
  return c ? toHex(c) : undefined;
};

/**
 * Every page element whose `property` resolves to the same colour (spec 8 detection).
 * `fromValue` is the pre-preview colour when the anchor is already previewed; `keep` are
 * current members (previewed, so their live colour no longer matches).
 */
function sameColorElements(anchor: Element, property: string, isOverlay: (el: Element) => boolean, fromValue?: string, keep: readonly Element[] = []): Element[] {
  const target = (fromValue ? resolveColorValue(fromValue, anchor) : undefined) ?? parseColor(computedColor(anchor, property));
  if (!target) return [anchor];
  const key = colorKey(target);
  const out: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (isOverlay(el) || ["script", "style", "link", "meta", "template", "noscript"].includes(el.localName)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (!colorProperties(el).includes(property)) continue;
    const c = parseColor(computedColor(el, property));
    if (keep.includes(el) || (c && colorKey(c) === key)) out.push(el);
  }
  return out.includes(anchor) ? out : [anchor, ...out];
}

/**
 * Colour inspector (spec 8, phase I8; shortcut K because C is Copy): click any element
 * (eyedropper style) to read its colour properties, pick a colour token read from
 * `:root` at runtime or type hex/rgb/oklch, see the WCAG contrast against the element's
 * effective background, and preview live. "Same colour" extends the edit to every
 * element with the same resolved value.
 */
export function ColorInspector({ ctx }: { ctx: InspectorContext }) {
  const { surface, resolver, styles } = ctx;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<{ key: string; value: string; invalid: boolean } | null>(null);
  const [strokeIndividual, setStrokeIndividual] = useState(false);
  const [strokeSide, setStrokeSide] = useState<"top" | "right" | "bottom" | "left">("top");

  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;
  const defaultProperty = (el: Element) => {
    const props = colorProperties(el);
    const bg = parseColor(computedColor(el, "background-color"));
    return bg && bg.a > 0 && !el.textContent?.trim() ? "background-color" : props[0];
  };
  /** Pending colour change of `property` that already holds this live element. */
  const recordFor = (el: Element, property: string) =>
    styles.items.find((a) => a.styleChange?.category === "color" && a.styleChange.property === property && styles.elementsFor(a).includes(el));

  /**
   * A selection for one property. An existing record for (element, property) is restored
   * (same group, members, pre-preview colour) unless `sameColor` is toggled explicitly.
   */
  const select = (anchor: Element, property: string, sameColor?: boolean, base = `co-${++groupCounter}`): Selection => {
    const record = recordFor(anchor, property);
    const recorded = record ? styles.elementsFor(record) : [];
    if (record && sameColor === undefined) {
      return { anchor, property, sameColor: recorded.length > 1, members: recorded, groupId: record.styleDetail?.groupId ?? `${base}:${property}`, base };
    }
    const wantSame = sameColor ?? false;
    const members = wantSame ? sameColorElements(anchor, property, isOverlay, record?.styleChange?.from.value, recorded) : [anchor];
    return { anchor, property, sameColor: wantSame, members, groupId: record?.styleDetail?.groupId ?? `${base}:${property}`, base };
  };

  /** Re-records the pending change of this group for a new member list. */
  const syncMembers = (next: Selection) => {
    for (const a of styles.items) {
      if (a.styleDetail?.groupId !== next.groupId || !a.styleChange) continue;
      styles.upsert({ category: "color", property: a.styleChange.property, groupId: next.groupId, elements: next.members, from: a.styleChange.from, to: a.styleChange.to });
    }
  };

  const picker = useElementPicker({
    surface,
    resolve: (el) => (isOverlay(el) ? null : el),
    onPick: (el, shift) => {
      setDraft(null);
      if (shift && selection) {
        const members = selection.members.includes(el) ? selection.members.filter((m) => m !== el) : [...selection.members, el];
        if (!members.length) return;
        const next = { ...selection, members, anchor: members.includes(selection.anchor) ? selection.anchor : members[0] };
        setSelection(next);
        syncMembers(next);
        return;
      }
      setSelection(select(el, defaultProperty(el)));
    },
  });
  useEffect(() => picker.redraw(), [styles.items, picker.redraw]);
  useEffect(() => resolver.subscribe(picker.redraw), [resolver, picker.redraw]);

  const onEscape = useEffectEvent(() => {
    if (!selection?.anchor.isConnected) {
      if (selection) setSelection(null);
      return false;
    }
    setSelection(null);
    return true;
  });
  const { setEscape } = ctx;
  useEffect(() => {
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [setEscape]);

  const onFocus = useEffectEvent((id: string) => {
    const a = styles.items.find((item) => item.id === id);
    if (a?.styleChange?.category !== "color" || !a.styleDetail?.groupId) return;
    const members = styles.reattach(a);
    if (!members.length) return ctx.notify(EDIT_NOT_FOUND);
    setDraft(null);
    setSelection({ anchor: members[0], members, property: a.styleChange.property, sameColor: members.length > 1, groupId: a.styleDetail.groupId, base: a.styleDetail.groupId.split(":")[0] });
  });
  useEffect(() => {
    const request = ctx.focus;
    if (!request) return;
    // Deferred: the target may need re-attaching (a state update in the toolbar) first.
    queueMicrotask(() => onFocus(request.id));
  }, [ctx.focus]);

  const sel = selection && selection.anchor.isConnected ? selection : null;
  const pendingFor = (p: string) => (sel ? styles.items.find((a) => a.styleDetail?.groupId === sel.groupId && a.styleChange?.property === p) : undefined);
  const vars = sel ? resolver.rootVars() : {};
  const tokens = sel ? colorTokens(vars, (value) => resolveColorValue(value, sel.anchor)) : [];

  /** Contrast of text on its background with an optional replacement for one side. */
  const contrastFor = (property: string, replacement?: RGBA): { ratio: number; background: RGBA } | null => {
    if (!sel) return null;
    const el = sel.anchor;
    const textColor = property === "color" && replacement ? replacement : parseColor(computedColor(el, "color"));
    let background = backgroundBehind(el).color;
    if (property === "background-color" && replacement) {
      const under = backgroundBehind(el, true).color;
      background = replacement.a >= 1 ? replacement : composite(replacement, under);
    }
    if (!textColor) return null;
    return { ratio: contrastRatio(textColor, background), background };
  };

  const set = (property: string, to: StyleValue) => {
    if (!sel) return;
    const pending = pendingFor(property)?.styleChange;
    const res = resolver.resolve(sel.anchor, colorLonghand(property));
    const computed = computedColor(sel.anchor, property);
    const from: StyleValue = pending?.from ?? { value: hexOf(computed, sel.anchor) ?? computed, ...(res.status === "token" && res.token ? { token: res.token } : {}) };
    const before = (property === "color" || property === "background-color") && pending == null ? contrastFor(property) : null;
    const replacement = resolveColorValue(to.token ? `var(${to.token})` : to.value, sel.anchor);
    const after = (property === "color" || property === "background-color") && replacement ? contrastFor(property, replacement) : null;
    const previous = pendingFor(property)?.styleDetail?.contrast;
    styles.upsert({
      category: "color",
      property,
      groupId: sel.groupId,
      elements: sel.members,
      from,
      to,
      detail: {
        name: memberLabel(sel.anchor),
        flags: pendingFor(property)?.styleDetail?.flags ?? res.flags,
        ...(res.origin ? { origin: res.origin } : {}),
        ...(after
          ? { contrast: { before: previous?.before ?? (before ? formatRatio(before.ratio) : undefined), after: formatRatio(after.ratio), background: toHex(after.background) } }
          : {}),
      },
    });
  };

  const property = sel?.property ?? "color";
  const pending = pendingFor(property)?.styleChange;
  const res = sel ? resolver.resolve(sel.anchor, colorLonghand(property)) : null;
  const computed = sel ? computedColor(sel.anchor, property) : "";
  const currentHex = sel ? hexOf(pending?.from.value ?? computed, sel.anchor) : undefined;
  const nextColor = sel && pending ? resolveColorValue(pending.to.token ? `var(${pending.to.token})` : pending.to.value, sel.anchor) : undefined;
  const nextHex = nextColor ? toHex(nextColor) : undefined;
  const activeHex = nextHex ?? currentHex;
  const activeToken = pending?.to.token ?? (res?.status === "token" ? res.token : undefined);
  const live = sel && (property === "color" || property === "background-color") ? contrastFor(property, nextColor) : null;
  const rating = live ? wcagRating(live.ratio) : null;
  const availableProps = sel ? colorProperties(sel.anchor) : [];
  const rawFlags = pending ? (pendingFor(property)?.styleDetail?.flags ?? []) : (res?.flags ?? []);
  const visibleFlags = tokens.length > 0 ? rawFlags : rawFlags.filter((f) => f !== "no token");
  const sameMatches = sel ? sameColorElements(sel.anchor, property, isOverlay, pending?.from.value, sel.members) : [];
  const showScope = Boolean(sel && (sameMatches.length > 1 || sel.sameColor));

  const draftKey = sel ? `${sel.groupId}-${property}-${pending?.to.token ?? ""}` : "";
  const activeDraft = draft && draft.key === draftKey ? draft : null;
  const inputValue = activeDraft?.value ?? (pending && !pending.to.token ? pending.to.value : (currentHex ?? computed));

  const commitRaw = (v: string) => {
    const value = v.trim();
    const ok = value !== "" && CSS.supports("color", value) && !/[;{}<>\\]/.test(value);
    setDraft({ key: draftKey, value: v, invalid: !ok });
    if (ok) set(property, { value });
  };

  void picker.tick;

  return (
    <>
      <GroupOverlay kind="color" hover={picker.hover} members={sel?.members ?? []} anchor={sel?.anchor ?? null} badge={sel ? `${sel.members.length} element${sel.members.length === 1 ? "" : "s"}` : undefined} />
      {(sel || ctx.pending.length > 0) && (
        <PanelFrame
          label="Color inspector"
          kind="color"
          elementName={sel ? memberLabel(sel.anchor) : "Colour"}
          regionLabel={sel ? (PROPERTY_TAB_LABEL[property] ?? property) : "Click an element to pick its colours"}
          count={sel && sel.members.length > 1 ? sel.members.length : undefined}
          pending={ctx.pending}
          onRemove={(id) => styles.remove(id)}
          onEdit={ctx.onEdit}
          onCopy={ctx.onCopy}
        >
          {sel && (
            <div className="flex flex-col gap-3" data-annotate-panel-row={property}>
              {availableProps.length > 1 && (
                <SegmentedControl
                  className="grid w-full"
                  style={{ gridTemplateColumns: `repeat(${availableProps.length}, minmax(0, 1fr))` }}
                  role="group"
                  aria-label="Colour property"
                  data-annotate-color-property={property}
                >
                  {availableProps.map((p) => {
                    const active = p === property;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={active}
                        className={cn(
                          "h-6 cursor-pointer truncate rounded-md px-2 text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                          active
                            ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => {
                          setDraft(null);
                          setSelection(select(sel.anchor, p, undefined, sel.base));
                        }}
                      >
                        {PROPERTY_TAB_LABEL[p] ?? p}
                      </button>
                    );
                  })}
                </SegmentedControl>
              )}

              <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-muted/35 p-3">
                <div className="flex items-center gap-3">
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-lg shadow-xs ring-1 ring-inset ring-foreground/15 dark:ring-white/15">
                    <span
                      aria-hidden
                      className="block size-full"
                      style={{ backgroundColor: activeHex ?? "transparent" }}
                    />
                    {pending && currentHex && nextHex && currentHex !== nextHex && (
                      <span
                        aria-hidden
                        title={`Original: ${currentHex}`}
                        className="absolute right-0.5 bottom-0.5 size-3 rounded-[4px] ring-1 ring-background"
                        style={{ backgroundColor: currentHex }}
                      />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        data-annotate-current={!pending ? "" : undefined}
                        data-annotate-new={pending ? "" : undefined}
                        className="truncate font-mono text-xs font-semibold text-foreground tabular-nums"
                      >
                        {activeHex ?? computed}
                      </span>
                      {pending && (
                        <Button
                          variant="ghost"
                          size="xs"
                          data-annotate-reset
                          className="h-5 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setDraft(null);
                            const a = pendingFor(property);
                            if (a) styles.remove(a.id);
                          }}
                        >
                          <RotateCcw className="size-3" />
                          Reset
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {activeToken && (
                        <span
                          className="max-w-full truncate rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground ring-1 ring-foreground/[0.06] dark:bg-background/45 dark:ring-white/[0.08]"
                          title={activeToken}
                        >
                          {activeToken}
                        </span>
                      )}
                      {pending && currentHex && (
                        <span data-annotate-current className="font-mono text-[10px] text-muted-foreground/80 tabular-nums">
                          was {currentHex}
                        </span>
                      )}
                      <FlagBadges flags={visibleFlags} />
                    </div>
                  </div>
                </div>

                {live && rating && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border/50 pt-2 text-[11px]"
                    data-annotate-contrast={formatRatio(live.ratio)}
                    data-annotate-contrast-background={toHex(live.background)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <span>Contrast</span>
                      <span className="font-mono font-semibold text-foreground tabular-nums">{formatRatio(live.ratio)}</span>
                      <span className="text-muted-foreground/60">on</span>
                      <span className="inline-flex items-center gap-1 font-mono text-foreground/90 tabular-nums">
                        <span
                          aria-hidden
                          className="inline-block size-2.5 shrink-0 rounded-[3px] ring-1 ring-foreground/20 dark:ring-white/20"
                          style={{ backgroundColor: toHex(live.background) }}
                        />
                        {toHex(live.background)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold",
                        rating.normal === "fail"
                          ? "bg-[var(--annotate-destructive-soft)] text-[var(--annotate-destructive)]"
                          : "bg-[var(--annotate-success-soft)] text-[var(--annotate-success)]",
                      )}
                      data-annotate-wcag={rating.normal}
                    >
                      {rating.normal === "fail" ? `AA fail${rating.large !== "fail" ? " · large AA" : ""}` : rating.normal}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionLabel>Value</SectionLabel>
                <div className="relative flex items-center">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 size-3.5 rounded-[4px] ring-1 ring-foreground/20 dark:ring-white/20"
                    style={{ backgroundColor: activeHex ?? "transparent" }}
                  />
                  <input
                    aria-label={`${property} value`}
                    aria-invalid={activeDraft?.invalid || undefined}
                    data-annotate-raw-input
                    placeholder="#000000, rgb(), oklch()"
                    className={cn(
                      FIELD_CLASS,
                      "h-8 w-full rounded-lg pl-8 font-mono text-xs tabular-nums",
                      activeDraft?.invalid && "border-destructive",
                    )}
                    value={inputValue}
                    onChange={(event) => commitRaw(event.target.value)}
                    onBlur={() => {
                      if (activeDraft && !activeDraft.invalid) setDraft(null);
                    }}
                  />
                </div>
              </div>

              {tokens.length > 0 && (
                <div className="flex flex-col gap-1.5" data-annotate-color-swatches>
                  <SectionLabel meta={<span className="font-mono text-[10px] text-muted-foreground tabular-nums">{tokens.length}</span>}>
                    Tokens
                  </SectionLabel>
                  <div className="annotate-scroll grid max-h-32 grid-cols-7 gap-1.5 overflow-y-auto rounded-xl border border-border/50 bg-muted/25 p-2">
                    {tokens.map((t) => {
                      const active = pending?.to.token === t.token;
                      return (
                        <button
                          key={t.token}
                          type="button"
                          aria-label={`${t.token} (${t.hex ?? ""})`}
                          aria-pressed={active}
                          title={`${t.token} · ${t.hex ?? ""}`}
                          onClick={() => {
                            setDraft(null);
                            set(property, { value: t.hex ?? "", token: t.token });
                          }}
                          className={cn(
                            "aspect-square w-full cursor-pointer rounded-md border border-foreground/15 transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15",
                            active && "scale-105 ring-2 ring-foreground ring-offset-2 ring-offset-background",
                          )}
                          style={{ backgroundColor: t.hex }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {property === "border-color" && (() => {
                const cs = getComputedStyle(sel.anchor);
                const rootFontPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
                const strokeTokens = borderWidthTokens(vars, rootFontPx);
                const sideWidths = {
                  top: Math.round((Number.parseFloat(cs.borderTopWidth) || 0) * 100) / 100,
                  right: Math.round((Number.parseFloat(cs.borderRightWidth) || 0) * 100) / 100,
                  bottom: Math.round((Number.parseFloat(cs.borderBottomWidth) || 0) * 100) / 100,
                  left: Math.round((Number.parseFloat(cs.borderLeftWidth) || 0) * 100) / 100,
                };
                const allEqual = sideWidths.top === sideWidths.right && sideWidths.top === sideWidths.bottom && sideWidths.top === sideWidths.left;
                const currentStyle = cs.borderTopStyle || "solid";
                const strokeProps = ["border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style"];
                const strokeRecords = styles.items.filter(
                  (a) =>
                    a.kind === "style-change" &&
                    a.styleDetail?.groupId === sel.groupId &&
                    a.styleChange?.property &&
                    strokeProps.includes(a.styleChange.property),
                );
                const applyStrokeWidth = (prop: string, next: StyleValue) => {
                  const existing = pendingFor(prop)?.styleChange;
                  const fromVal: StyleValue = existing?.from ?? { value: `${sideWidths.top}px` };
                  if (prop === "border-width") {
                    for (const s of ["top", "right", "bottom", "left"] as const) {
                      const rec = pendingFor(`border-${s}-width`);
                      if (rec) styles.remove(rec.id);
                    }
                  } else {
                    const uniform = pendingFor("border-width");
                    if (uniform) styles.remove(uniform.id);
                  }
                  styles.upsert({
                    category: "color",
                    property: prop,
                    groupId: sel.groupId,
                    elements: sel.members,
                    from: fromVal,
                    to: next,
                    detail: { name: memberLabel(sel.anchor) },
                  });
                };
                const applyStrokeStyle = (nextStyle: string) => {
                  const existing = pendingFor("border-style")?.styleChange;
                  styles.upsert({
                    category: "color",
                    property: "border-style",
                    groupId: sel.groupId,
                    elements: sel.members,
                    from: existing?.from ?? { value: currentStyle },
                    to: { value: nextStyle },
                    detail: { name: memberLabel(sel.anchor) },
                  });
                };
                const activeStrokeProp = strokeIndividual ? `border-${strokeSide}-width` : "border-width";
                const activeStrokePx = strokeIndividual ? sideWidths[strokeSide] : sideWidths.top;
                const activeStrokeToken = pendingFor(activeStrokeProp)?.styleChange?.to.token;

                const sideIcon = (side: "top" | "right" | "bottom" | "left") => (
                  <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden>
                    <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="1.5 1.5" />
                    {side === "top" && <line x1="2" y1="2" x2="10" y2="2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
                    {side === "right" && <line x1="10" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
                    {side === "bottom" && <line x1="2" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
                    {side === "left" && <line x1="2" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
                  </svg>
                );

                return (
                  <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/30 p-2.5" data-annotate-stroke-section="">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Stroke</span>
                      {strokeRecords.length > 0 && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => strokeRecords.forEach((r) => styles.remove(r.id))}
                        >
                          <RotateCcw className="size-3" />
                          Reset
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                      <select
                        aria-label="Border style"
                        data-annotate-border-style=""
                        className="h-7 cursor-pointer rounded-lg border border-border/70 bg-background/85 px-2 text-xs text-foreground outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20 dark:bg-background/45"
                        value={pendingFor("border-style")?.styleChange?.to.value ?? currentStyle}
                        onChange={(e) => applyStrokeStyle(e.target.value)}
                      >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                        <option value="none">None</option>
                      </select>

                      <div className="flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-background/85 px-2 focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-background/45">
                        <span className="text-[10px] font-medium text-muted-foreground">W</span>
                        <input
                          aria-label="Border width in px"
                          data-annotate-border-width=""
                          inputMode="decimal"
                          placeholder={allEqual ? undefined : "mix"}
                          className="h-full w-full min-w-0 bg-transparent font-mono text-xs text-foreground tabular-nums outline-none"
                          value={allEqual ? String(sideWidths.top) : ""}
                          onChange={(e) => {
                            const n = Number(e.target.value.trim());
                            if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) {
                              applyStrokeWidth("border-width", { value: `${Math.round(n * 100) / 100}px` });
                            }
                          }}
                        />
                      </div>

                      <button
                        type="button"
                        aria-label="Individual border sides"
                        aria-pressed={strokeIndividual}
                        title="Individual border sides"
                        data-annotate-stroke-individual=""
                        onClick={() => setStrokeIndividual((v) => !v)}
                        className={cn(
                          "flex size-7 cursor-pointer items-center justify-center rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                          strokeIndividual
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-border/60 bg-background/75 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-background/40",
                        )}
                      >
                        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
                          <rect x="2.25" y="2.25" width="9.5" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                      </button>
                    </div>

                    {strokeIndividual && (
                      <div className="grid grid-cols-2 gap-1.5" data-annotate-stroke-sides="">
                        {(["top", "right", "bottom", "left"] as const).map((side) => {
                          const focused = strokeSide === side;
                          return (
                            <label
                              key={side}
                              onClick={() => setStrokeSide(side)}
                              className={cn(
                                "flex h-7 cursor-text items-center gap-1.5 rounded-lg border px-2 transition-colors",
                                focused
                                  ? "border-primary/50 bg-background/95 ring-1 ring-primary/20 dark:bg-background/60"
                                  : "border-border/60 bg-background/75 dark:bg-background/40",
                              )}
                            >
                              <span className={cn(focused ? "text-foreground" : "text-muted-foreground")}>{sideIcon(side)}</span>
                              <input
                                aria-label={`Border ${side} width`}
                                data-annotate-border-side={side}
                                inputMode="decimal"
                                className="h-full w-full min-w-0 bg-transparent font-mono text-xs text-foreground tabular-nums outline-none"
                                value={String(sideWidths[side])}
                                onFocus={() => setStrokeSide(side)}
                                onChange={(e) => {
                                  const n = Number(e.target.value.trim());
                                  if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) {
                                    applyStrokeWidth(`border-${side}-width`, { value: `${Math.round(n * 100) / 100}px` });
                                  }
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {strokeTokens.length > 0 && (
                      <div className="grid grid-cols-2 gap-1.5 pt-0.5" data-annotate-stroke-tokens="">
                        {strokeTokens.map((t) => {
                          const active = activeStrokeToken ? activeStrokeToken === t.token : Math.abs(activeStrokePx - (t.px ?? 0)) < 0.25;
                          return (
                            <Button
                              key={t.token}
                              variant={active ? "default" : "outline"}
                              size="xs"
                              aria-pressed={active}
                              title={`${t.token} · ${t.px}px`}
                              className={cn(
                                "h-6 min-w-0 justify-between gap-1 rounded-md px-2 font-mono text-[10px] tabular-nums",
                                !active && "border-border/60 bg-background/70 hover:bg-muted/60 dark:bg-background/35",
                              )}
                              onClick={() => applyStrokeWidth(activeStrokeProp, { value: `${t.px ?? 0}px`, token: t.token })}
                            >
                              <span className="min-w-0 truncate">{t.token}</span>
                              <span className={cn("shrink-0", active ? "opacity-75" : "text-muted-foreground")}>{`${t.px ?? 0}px`}</span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {showScope && (
                <div className="flex flex-col gap-1.5">
                  <SectionLabel>Scope</SectionLabel>
                  <SegmentedControl className="grid w-full grid-cols-2" role="group" aria-label="Color scope">
                    <button
                      type="button"
                      aria-pressed={!sel.sameColor}
                      className={cn(
                        "h-6 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        !sel.sameColor
                          ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => {
                        const next = select(sel.anchor, property, false, sel.base);
                        setSelection(next);
                        syncMembers(next);
                      }}
                    >
                      This element
                    </button>
                    <button
                      type="button"
                      aria-pressed={sel.sameColor}
                      data-annotate-same-color=""
                      className={cn(
                        "h-6 cursor-pointer truncate rounded-md px-2 text-[11px] font-medium tabular-nums transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        sel.sameColor
                          ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => {
                        const next = select(sel.anchor, property, true, sel.base);
                        setSelection(next);
                        syncMembers(next);
                      }}
                    >
                      {`All ${sameMatches.length} matching`}
                    </button>
                  </SegmentedControl>
                </div>
              )}
            </div>
          )}
        </PanelFrame>
      )}
    </>
  );
}
