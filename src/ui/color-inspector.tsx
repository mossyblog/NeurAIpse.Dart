"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "cn";
import { colorKey, composite, contrastRatio, formatRatio, parseColor, toHex, wcagRating, type RGBA } from "../core/color.ts";
import { backgroundBehind, colorProperties, computedColor, resolveColorValue } from "../core/inspect-dom.ts";
import type { StyleValue } from "../core/style-change.ts";
import { colorTokens } from "../core/token-catalog.ts";
import { FIELD_CLASS, SectionLabel } from "./chrome.tsx";
import { GroupOverlay } from "./group-overlay.tsx";
import { EDIT_NOT_FOUND, type InspectorContext } from "./inspector-context.ts";
import { PanelFrame } from "./inspector-panel.tsx";
import { StyleRow } from "./style-row.tsx";
import { memberLabel } from "./use-style-changes.ts";
import { useElementPicker } from "./use-element-picker.ts";

/** `base` names the pick; each property is its own change group (`<base>:<property>`). */
type Selection = { anchor: Element; members: Element[]; property: string; sameColor: boolean; groupId: string; base: string };

let groupCounter = 0;

/** Resolver property for a colour property (`border-color` is read from the top side). */
export const colorLonghand = (p: string) => (p === "border-color" ? "border-top-color" : p);

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

  const onFocus = useEffectEvent((id: string) => {
    const a = styles.items.find((item) => item.id === id);
    if (a?.styleChange?.category !== "color" || !a.styleDetail?.groupId) return;
    const members = styles.reattach(a);
    if (!members.length) return ctx.notify(EDIT_NOT_FOUND);
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
  const live = sel && (property === "color" || property === "background-color") ? contrastFor(property, nextColor) : null;
  const rating = live ? wcagRating(live.ratio) : null;
  void picker.tick;

  return (
    <>
      <GroupOverlay kind="color" hover={picker.hover} members={sel?.members ?? []} anchor={sel?.anchor ?? null} badge={sel ? `${sel.members.length} element${sel.members.length === 1 ? "" : "s"}` : undefined} />
      {(sel || ctx.pending.length > 0) && (
        <PanelFrame
          label="Colour inspector"
          kind="color"
          elementName={sel ? memberLabel(sel.anchor) : "Colour"}
          regionLabel={sel ? property : "Click an element to pick its colours"}
          count={sel?.members.length}
          pending={ctx.pending}
          onRemove={(id) => styles.remove(id)}
          onEdit={ctx.onEdit}
          onCopy={ctx.onCopy}
        >
          {sel && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-1.5 ring-1 ring-foreground/[0.06] dark:ring-white/[0.07]">
                <select
                  aria-label="Colour property"
                  data-annotate-color-property
                  className={cn(FIELD_CLASS, "min-w-0 flex-1 font-mono")}
                  value={property}
                  onChange={(event) => setSelection(select(sel.anchor, event.target.value, undefined, sel.base))}
                >
                  {colorProperties(sel.anchor).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-xs font-medium select-none">
                  <input
                    type="checkbox"
                    data-annotate-same-color
                    className="size-3.5 cursor-pointer rounded border-border accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    checked={sel.sameColor}
                    onChange={(event) => {
                      const next = select(sel.anchor, property, event.target.checked, sel.base);
                      setSelection(next);
                      syncMembers(next);
                    }}
                  />
                  <span>Same colour</span>
                </label>
              </div>
              <StyleRow
                key={`${sel.groupId}-${property}`}
                property={property}
                current={pending?.from ?? { value: currentHex ?? computed, ...(res?.status === "token" && res.token ? { token: res.token } : {}) }}
                next={pending?.to}
                computed={computed}
                flags={pending ? (pendingFor(property)?.styleDetail?.flags ?? []) : (res?.flags ?? [])}
                tokens={tokens.map((t) => ({ id: t.token, label: `${t.token} · ${t.hex}` }))}
                selectedToken={pending?.to.token}
                onToken={(id) => {
                  const t = tokens.find((x) => x.token === id);
                  if (t) set(property, { value: t.hex ?? "", token: t.token });
                }}
                rawValue={pending && !pending.to.token ? pending.to.value : (currentHex ?? computed)}
                units={[]}
                unit=""
                onRaw={(v) => {
                  const value = v.trim();
                  const ok = value !== "" && CSS.supports("color", value) && !/[;{}<>\\]/.test(value);
                  if (ok) set(property, { value });
                  return ok;
                }}
                onReset={() => {
                  const a = pendingFor(property);
                  if (a) styles.remove(a.id);
                }}
                swatch={{ current: currentHex, next: nextColor ? toHex(nextColor) : undefined }}
              >
                {tokens.length > 0 && (
                  <div className="flex flex-col gap-1 pt-0.5" data-annotate-color-swatches>
                    <SectionLabel meta={<span className="font-mono tabular-nums">{tokens.length}</span>}>Theme swatches</SectionLabel>
                    <div className="annotate-scroll grid max-h-28 grid-cols-8 gap-1.5 overflow-y-auto rounded-md bg-background/60 p-1.5 ring-1 ring-foreground/[0.05] dark:bg-background/35 dark:ring-white/[0.06]">
                      {tokens.map((t) => {
                        const active = pending?.to.token === t.token;
                        return (
                          <button
                            key={t.token}
                            type="button"
                            aria-label={`${t.token} (${t.hex ?? ""})`}
                            aria-pressed={active}
                            title={`${t.token} · ${t.hex ?? ""}`}
                            onClick={() => set(property, { value: t.hex ?? "", token: t.token })}
                            className={cn(
                              "aspect-square w-full cursor-pointer rounded-md border border-foreground/15 transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15",
                              active && "scale-105 ring-2 ring-foreground ring-offset-1 ring-offset-background",
                            )}
                            style={{ backgroundColor: t.hex }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {live && rating && (
                  <div
                    className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5 text-[11px] ring-1 ring-foreground/[0.05] dark:bg-background/40 dark:ring-white/[0.06]"
                    data-annotate-contrast={formatRatio(live.ratio)}
                    data-annotate-contrast-background={toHex(live.background)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <span>Contrast</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">{formatRatio(live.ratio)}</span>
                      <span>on</span>
                      <span className="inline-flex items-center gap-1 font-mono text-foreground tabular-nums">
                        <span
                          aria-hidden
                          className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20 dark:ring-white/20"
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
              </StyleRow>
            </div>
          )}
        </PanelFrame>
      )}
    </>
  );
}
