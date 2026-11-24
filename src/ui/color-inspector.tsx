"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "./primitives.tsx";
import { cn } from "cn";
import { RotateCcw } from "lucide-react";
import { colorKey, composite, contrastRatio, formatRatio, parseColor, toHex, wcagRating, type RGBA } from "../core/color.ts";
import { backgroundBehind, colorProperties, computedColor, resolveColorValue } from "../core/inspect-dom.ts";
import type { StyleValue } from "../core/style-change.ts";
import { colorTokens } from "../core/token-catalog.ts";
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
          label="Colour inspector"
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
