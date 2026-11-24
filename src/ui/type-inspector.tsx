"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "./primitives.tsx";
import { cn } from "cn";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { guideOffsets, normalizeScale, type ScaleStep } from "../core/drag-guides.ts";
import { normalLineHeightPx, readTypeStyle, textCandidates, textTarget } from "../core/inspect-dom.ts";
import { tokensForProperty, type PickerToken } from "../core/token-catalog.ts";
import { formatPx, isGridValue, lineHeightPx, type TokenStatus } from "../core/token-values.ts";
import type { StyleValue } from "../core/style-change.ts";
import {
  groupByKey,
  primaryFamily,
  rawTypeValue,
  sameTokenKey,
  signatureLabel,
  stepTypeValue,
  TYPE_PROPERTIES,
  typeGroupName,
  typeSignature,
  type TypeProperty,
  type TypeStyle,
} from "../core/type-signature.ts";
import { GroupOverlay, TypeLadder, type TypeLadderColumn } from "./group-overlay.tsx";
import { EDIT_NOT_FOUND, type InspectorContext } from "./inspector-context.ts";
import { FlagBadges, PanelFrame } from "./inspector-panel.tsx";
import { useElementPicker } from "./use-element-picker.ts";

type Editable = Exclude<TypeProperty, "font-family">;
const EDITABLE: Editable[] = ["font-size", "line-height", "font-weight", "letter-spacing"];
const PROPERTY_LABEL: Record<Editable, string> = {
  "font-size": "Size",
  "line-height": "Line height",
  "font-weight": "Weight",
  "letter-spacing": "Tracking",
};
const UNITS: Record<Editable, string[]> = { "font-size": ["px", "rem", "em"], "line-height": ["px", ""], "font-weight": [], "letter-spacing": ["px", "em"] };
const STEP_TITLE: Record<Editable, string> = { "font-size": "±2 (Shift: ±1)", "line-height": "±4 (Shift: ±1)", "font-weight": "±100 (Shift: ±10)", "letter-spacing": "±0.5 (Shift: ±0.1)" };

type Selection = {
  anchor: Element;
  members: Element[];
  sameToken: boolean;
  /** Same-signature candidates excluded in same-token mode because their size token is unknown. */
  unknown: number;
  groupId: string;
  style: TypeStyle;
  signature: string;
  name: string;
};

let groupCounter = 0;
const rootFontPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function splitNumber(value: string): { n: string; unit: string } {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  return m ? { n: m[1], unit: m[2] ?? "" } : { n: String(Number.parseFloat(value) || 0), unit: "px" };
}

type TypeControlRowProps = {
  property: Editable;
  current: StyleValue;
  currentNote?: string;
  next?: StyleValue;
  computed: string;
  flags: readonly string[];
  tokens: readonly { id: string; label: string; short: string }[];
  selectedToken?: string;
  onToken: (id: string) => void;
  rawValue: string;
  units: readonly string[];
  unit: string;
  onRaw: (value: string, unit: string) => boolean;
  onStep: (direction: 1 | -1, fine: boolean) => void;
  stepTitle: string;
  onReset: () => void;
};

function TypeControlRow(props: TypeControlRowProps) {
  const [draft, setDraft] = useState<{ token: string | undefined; value: string; unit: string; invalid: boolean } | null>(null);
  const activeDraft = draft && draft.token === props.selectedToken ? draft : null;
  const value = activeDraft?.value ?? props.rawValue;
  const unit = activeDraft?.unit ?? props.unit;
  const visibleFlags = props.tokens.length > 0 ? props.flags : props.flags.filter((f) => f !== "no token");

  const commit = (v: string, u: string) => {
    const ok = props.onRaw(v, u);
    setDraft({ token: ok ? undefined : props.selectedToken, value: v, unit: u, invalid: !ok });
  };

  return (
    <div
      data-annotate-panel-row={props.property}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2.5 transition-colors",
        props.next ? "border-primary/25 bg-muted/50" : "border-border/50 bg-muted/30",
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{PROPERTY_LABEL[props.property]}</span>
          <FlagBadges flags={visibleFlags} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.next ? (
            <>
              <span data-annotate-current className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {props.current.value}
              </span>
              <span aria-hidden className="text-[10px] text-muted-foreground/50">
                →
              </span>
              <span data-annotate-new className="font-mono text-[11px] font-medium text-foreground tabular-nums">
                {props.next.token ? props.next.value : props.computed}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                data-annotate-reset
                aria-label={`Reset ${PROPERTY_LABEL[props.property]}`}
                title={`Reset ${PROPERTY_LABEL[props.property]}`}
                className="size-5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setDraft(null);
                  props.onReset();
                }}
              >
                <RotateCcw className="size-3" />
              </Button>
            </>
          ) : (
            <span data-annotate-current className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {props.current.value}
              {props.currentNote ? ` ${props.currentNote}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex h-7 min-w-0 flex-1 items-center rounded-lg border border-border/70 bg-background/90 shadow-2xs transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-background/50">
          <input
            aria-label={`${props.property} value`}
            aria-invalid={activeDraft?.invalid || undefined}
            data-annotate-raw-input
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground tabular-nums outline-none",
              activeDraft?.invalid && "text-destructive",
            )}
            value={value}
            onChange={(event) => commit(event.target.value, unit)}
            onBlur={() => {
              if (activeDraft && !activeDraft.invalid) setDraft(null);
            }}
          />
          {props.units.length > 0 && (
            <select
              aria-label={`${props.property} unit`}
              data-annotate-unit
              className="h-full shrink-0 cursor-pointer border-l border-border/60 bg-transparent px-1.5 font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground"
              value={unit}
              onChange={(event) => commit(value, event.target.value)}
            >
              {props.units.map((u) => (
                <option key={u} value={u}>
                  {u || "×"}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Decrease ${props.property}`}
            title={props.stepTitle}
            data-annotate-step="-1"
            onClick={(event) => {
              setDraft(null);
              props.onStep(-1, event.shiftKey);
            }}
          >
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Increase ${props.property}`}
            title={props.stepTitle}
            data-annotate-step="1"
            onClick={(event) => {
              setDraft(null);
              props.onStep(1, event.shiftKey);
            }}
          >
            <Plus />
          </Button>
        </div>
      </div>

      {props.tokens.length > 0 && (
        <div className="annotate-scroll flex max-h-20 flex-wrap gap-1 overflow-y-auto pt-0.5">
          {props.tokens.map((t) => {
            const active = props.selectedToken === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                title={t.label}
                onClick={() => {
                  setDraft(null);
                  props.onToken(t.id);
                }}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] leading-none tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-background/75 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-background/35",
                )}
              >
                <span className="max-w-28 truncate">{t.short}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Type inspector (spec 4, phase I6): click text, select every element with the same
 * type signature (or same tokens), Shift-click edits the group, and the panel edits
 * size, line-height, weight and tracking for all members through one preview group.
 */
export function TypeInspector({ ctx }: { ctx: InspectorContext }) {
  const { surface, resolver, styles } = ctx;
  const [selection, setSelection] = useState<Selection | null>(null);

  const tokenOf = (el: Element, p: TypeProperty) => {
    const r = resolver.resolve(el, p);
    return r.status === "token" ? r.token : undefined;
  };

  /**
   * Builds a group. `base` is the current selection when re-grouping (Same token toggle):
   * its members may be previewed, so they are compared by the stored pre-preview
   * signature and style, never by their live values.
   */
  const buildGroup = (anchor: Element, sameToken: boolean, groupId?: string, members?: Element[], base?: Selection): Selection => {
    const style = base?.style ?? readTypeStyle(anchor);
    const signature = base?.signature ?? typeSignature(style);
    const styleOf = (el: Element) => (base?.members.includes(el) ? base.style : readTypeStyle(el));
    const candidates = textCandidates(document.body, picker.isOverlay);
    const sameSig = candidates.filter((el) => el === anchor || typeSignature(styleOf(el)) === signature);
    let list = members ?? sameSig;
    let unknown = 0;
    if (!members && sameToken) {
      const anchorSize = tokenOf(anchor, "font-size");
      const keyOf = (el: Element) => {
        const size = tokenOf(el, "font-size");
        if (!size) return null;
        if (size !== anchorSize) return `other:${size}`;
        const tokens = Object.fromEntries(TYPE_PROPERTIES.map((p) => [p, p === "font-size" ? size : tokenOf(el, p)]));
        return sameTokenKey(styleOf(el), tokens);
      };
      const anchorKey = keyOf(anchor);
      const { groups } = groupByKey(candidates, keyOf);
      list = anchorKey ? (groups.get(anchorKey) ?? [anchor]) : [anchor];
      unknown = sameSig.filter((el) => !tokenOf(el, "font-size")).length;
    }
    if (!list.includes(anchor)) list = [anchor, ...list];
    return {
      anchor,
      members: list,
      sameToken,
      unknown,
      groupId: groupId ?? `ty-${++groupCounter}`,
      style,
      signature,
      name: base?.name ?? typeGroupName(style, tokenOf(anchor, "font-size")),
    };
  };

  /** Pending typography change that already holds this live element. */
  const recordFor = (el: Element) =>
    styles.items.find((a) => a.styleChange?.category === "typography" && a.styleDetail?.groupId && styles.elementsFor(a).includes(el));

  /**
   * Restores a selection from its record (re-click on a member, Edit): same group id,
   * members and pre-preview signature, so edits update the same annotations.
   */
  const restore = (record: NonNullable<ReturnType<typeof recordFor>>, members: Element[], anchor: Element): Selection => {
    const signature = record.styleChange?.group.signature ?? "";
    const parts = signature.split("|");
    const style = parts.length === TYPE_PROPERTIES.length ? (Object.fromEntries(TYPE_PROPERTIES.map((p, i) => [p, parts[i]])) as TypeStyle) : readTypeStyle(anchor);
    return {
      anchor,
      members,
      sameToken: false,
      unknown: 0,
      groupId: record.styleDetail?.groupId ?? `ty-${++groupCounter}`,
      style,
      signature: signature || typeSignature(style),
      name: record.styleDetail?.name ?? typeGroupName(style),
    };
  };

  /** Re-records every pending change of the group for a new member list (Shift-click). */
  const syncMembers = (next: Selection) => {
    for (const a of styles.items) {
      if (a.styleDetail?.groupId !== next.groupId || !a.styleChange) continue;
      styles.upsert({ category: "typography", property: a.styleChange.property, groupId: next.groupId, elements: next.members, from: a.styleChange.from, to: a.styleChange.to, signature: next.signature, detail: { name: next.name } });
    }
  };

  const picker = useElementPicker({
    surface,
    resolve: (el) => textTarget(el, (node) => node === surface.host || node.getRootNode() === surface.shadow),
    onPick: (el, shift) => {
      if (shift && selection) {
        const members = selection.members.includes(el) ? selection.members.filter((m) => m !== el) : [...selection.members, el];
        if (members.length === 0) return;
        const next = { ...selection, members, anchor: members.includes(selection.anchor) ? selection.anchor : members[0] };
        setSelection(next);
        syncMembers(next);
        return;
      }
      const record = recordFor(el);
      setSelection(record ? restore(record, styles.elementsFor(record), el) : buildGroup(el, selection?.sameToken ?? false));
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
    if (a?.styleChange?.category !== "typography" || !a.styleDetail?.groupId) return;
    const members = styles.reattach(a);
    if (!members.length) return ctx.notify(EDIT_NOT_FOUND);
    setSelection(restore(a, members, members[0]));
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
  const fromFontPx = () => {
    if (!sel) return 16;
    const pending = pendingFor("font-size")?.styleChange;
    return Number.parseFloat(pending?.from.value ?? sel.style["font-size"]) || 16;
  };
  const newFontPx = () => {
    const pending = pendingFor("font-size")?.styleChange;
    return pending ? Number.parseFloat(pending.to.value) || fromFontPx() : fromFontPx();
  };
  const tokenList = (p: Editable): PickerToken[] => (sel ? tokensForProperty(p, vars, { rootFontPx: rootFontPx(), fontPx: p === "font-size" ? fromFontPx() : newFontPx() }) : []);
  const tokenValue = (p: Editable, t: PickerToken) => (p === "font-weight" ? String(t.number) : formatPx(t.px ?? 0));

  /** Members whose own value of `p` is off the informational grid, for the Note line. */
  const memberFlags = (p: Editable): { flags: string[]; memberFlags: { flag: string; count: number }[] } => {
    if (!sel || p !== "line-height") return { flags: [], memberFlags: [] };
    const counts = new Map<string, number>();
    for (const el of sel.members) {
      const px = Number.parseFloat(getComputedStyle(el).lineHeight);
      if (Number.isFinite(px) && !isGridValue(px, 4)) counts.set(`off-grid: ${formatPx(px)}`, (counts.get(`off-grid: ${formatPx(px)}`) ?? 0) + 1);
    }
    const all = [...counts].filter(([, n]) => n === sel.members.length).map(([f]) => f);
    const some = [...counts].filter(([, n]) => n < sel.members.length).map(([flag, count]) => ({ flag, count }));
    return { flags: all, memberFlags: some };
  };

  const set = (p: Editable, to: StyleValue) => {
    if (!sel) return;
    const pending = pendingFor(p)?.styleChange;
    const res = resolver.resolve(sel.anchor, p);
    const from: StyleValue = pending?.from ?? { value: sel.style[p], ...(res.status === "token" && res.token ? { token: res.token } : {}) };
    const drift = memberFlags(p);
    const statusFlags = res.flags.filter((f) => !f.startsWith("off-grid"));
    styles.upsert({
      category: "typography",
      property: p,
      groupId: sel.groupId,
      elements: sel.members,
      from,
      to,
      signature: sel.signature,
      detail: { name: sel.name, flags: [...drift.flags, ...statusFlags], memberFlags: drift.memberFlags, ...(res.origin ? { origin: res.origin } : {}) },
    });
    // Tailwind text-* tokens carry a companion line-height: follow it when the element
    // uses the old token's companion (spec 5.1 Tailwind notes; spec 7.2 example).
    if (p === "font-size" && to.token && /^--text-/.test(to.token) && from.token) {
      const lh = resolver.resolve(sel.anchor, "line-height");
      const companion = `${to.token}--line-height`;
      if (lh.token === `${from.token}--line-height` && vars[companion] != null) {
        const px = lineHeightPx(vars[companion], Number.parseFloat(to.value) || 16, rootFontPx());
        if (px != null) set("line-height", { value: formatPx(px), token: companion });
      }
    }
  };

  /* ---------- I9b: token ladder (Guides on) ---------- */
  type Laddered = "font-size" | "line-height";
  /** The ladder of a property: its px tokens, sorted and one per px (the stepper snaps to these). */
  const ladderScale = (p: Laddered): ScaleStep[] => normalizeScale(tokenList(p).flatMap((t) => (t.px != null ? [{ px: t.px, token: t.token }] : [])));
  /** Live value of a laddered property on the anchor (line-height `normal` resolved to px). */
  const liveValue = (p: Laddered): number => {
    if (!sel) return 0;
    const computed = getComputedStyle(sel.anchor).getPropertyValue(p).trim();
    return p === "line-height" && computed === "normal" ? normalLineHeightPx(sel.anchor) : Number.parseFloat(computed) || 0;
  };
  const guides = Boolean(ctx.guides);
  const ladder: TypeLadderColumn[] = guides && sel ? (["font-size", "line-height"] as const).map((p) => ({ property: p, rungs: guideOffsets(liveValue(p), ladderScale(p), 4, 2) })) : [];
  /** Guides on: the stepper moves to the next ladder token (Shift keeps the fine px step). */
  const snapStep = (p: Editable, direction: 1 | -1, fine: boolean): boolean => {
    if (!guides || fine || (p !== "font-size" && p !== "line-height")) return false;
    const base = liveValue(p);
    const steps = ladderScale(p);
    const next = direction > 0 ? steps.find((s) => s.px > base + 0.01) : [...steps].reverse().find((s) => s.px < base - 0.01);
    const t = next ? tokenList(p).find((x) => x.token === next.token) : undefined;
    if (!t) return false;
    set(p, { value: tokenValue(p, t), token: t.token });
    return true;
  };

  const reset = (p: Editable) => {
    const a = pendingFor(p);
    if (a) styles.remove(a.id);
  };

  const badge = sel ? `${sel.members.length} element${sel.members.length === 1 ? "" : "s"}${sel.sameToken && sel.unknown ? ` · ${sel.unknown} unknown` : ""}` : undefined;
  const familyToken = sel ? tokenOf(sel.anchor, "font-family") : undefined;
  const familyPrimary = sel ? primaryFamily(sel.style["font-family"]) : "";
  const liveComputed = sel ? getComputedStyle(sel.anchor) : null;
  const liveSize = liveComputed ? liveComputed.fontSize : sel?.style["font-size"] ?? "";
  const liveLineHeight = liveComputed ? liveComputed.lineHeight : sel?.style["line-height"] ?? "";
  const liveWeight = liveComputed ? liveComputed.fontWeight : sel?.style["font-weight"] ?? "";
  const showScope = Boolean(sel && (sel.members.length > 1 || sel.sameToken));
  void picker.tick;

  return (
    <>
      <GroupOverlay kind="type" hover={picker.hover} members={sel?.members ?? []} anchor={sel?.anchor ?? null} badge={badge} />
      {ladder.length > 0 && <TypeLadder anchor={sel?.anchor ?? null} columns={ladder} />}
      {(sel || ctx.pending.length > 0) && (
        <PanelFrame
          label="Type inspector"
          kind="type"
          elementName={sel?.name ?? "Type"}
          regionLabel={sel ? signatureLabel(sel.style) : "Click text to select its type group"}
          count={sel && sel.members.length > 1 ? sel.members.length : undefined}
          pending={ctx.pending}
          onRemove={(id) => styles.remove(id)}
          onEdit={ctx.onEdit}
          onCopy={ctx.onCopy}
        >
          {sel && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/35 p-3" data-annotate-type-family>
                <div
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/80 text-lg leading-none text-foreground dark:bg-background/45"
                  style={{
                    fontFamily: sel.style["font-family"],
                    fontWeight: Number(liveWeight) || 500,
                  }}
                >
                  Aa
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-foreground" title={sel.style["font-family"]}>
                      {familyPrimary}
                    </span>
                    {familyToken && (
                      <span
                        className="max-w-28 truncate rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground ring-1 ring-foreground/[0.06] dark:bg-background/45 dark:ring-white/[0.08]"
                        title={familyToken}
                      >
                        {familyToken}
                      </span>
                    )}
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                    {`${liveSize} / ${liveLineHeight} · ${liveWeight}`}
                  </span>
                </div>
              </div>

              {showScope && (
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs select-none">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <span>Same token only</span>
                    {sel.sameToken && sel.unknown > 0 && (
                      <span
                        className="rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground tabular-nums ring-1 ring-foreground/[0.06] dark:bg-background/45"
                        data-annotate-unknown-count={sel.unknown}
                      >
                        {sel.unknown} unknown
                      </span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    data-annotate-same-token
                    className="size-3.5 cursor-pointer rounded border-border accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    checked={sel.sameToken}
                    onChange={(event) => {
                      const next = buildGroup(sel.anchor, event.target.checked, sel.groupId, undefined, sel);
                      setSelection(next);
                      syncMembers(next);
                    }}
                  />
                </label>
              )}

              <div className="flex flex-col gap-2">
                {EDITABLE.map((p) => {
                  const pending = pendingFor(p)?.styleChange;
                  const res = resolver.resolve(sel.anchor, p);
                  const computed = getComputedStyle(sel.anchor).getPropertyValue(p).trim();
                  const tokens = tokenList(p);
                  const shownValue = pending ? pending.to.value : computed;
                  const parts =
                    shownValue === "normal"
                      ? p === "line-height"
                        ? { n: String(normalLineHeightPx(sel.anchor)), unit: "px" }
                        : { n: "0", unit: "px" }
                      : splitNumber(shownValue);
                  const status: TokenStatus = res.status;
                  const currentToken = status === "token" ? (res.token ? res.token : undefined) : undefined;
                  return (
                    <TypeControlRow
                      key={`${sel.groupId}-${p}`}
                      property={p}
                      current={pending?.from ?? { value: sel.style[p], ...(currentToken ? { token: currentToken } : {}) }}
                      currentNote={p === "line-height" && sel.style[p] === "normal" ? `(${normalLineHeightPx(sel.anchor)}px)` : undefined}
                      next={pending?.to}
                      computed={computed}
                      flags={pending ? [...(pendingFor(p)?.styleDetail?.flags ?? [])] : res.flags}
                      tokens={tokens.map((t) => ({
                        id: t.token,
                        label: `${t.token} · ${p === "font-weight" ? t.number : `${t.px}px`}`,
                        short: `${t.token.replace(/^--(text|leading|font-weight|tracking)-/, "")} · ${p === "font-weight" ? t.number : `${t.px}px`}`,
                      }))}
                      selectedToken={pending?.to.token}
                      onToken={(id) => {
                        const t = tokens.find((x) => x.token === id);
                        if (t) set(p, { value: tokenValue(p, t), token: t.token });
                      }}
                      rawValue={parts.n}
                      units={UNITS[p]}
                      unit={p === "font-weight" ? "" : parts.unit || "px"}
                      onRaw={(v, u) => {
                        const value = rawTypeValue(p, v, u as "px" | "em" | "rem" | "");
                        if (value) set(p, { value });
                        return Boolean(value);
                      }}
                      onStep={(direction, fine) => {
                        if (snapStep(p, direction, fine)) return;
                        const base = p === "line-height" && computed === "normal" ? normalLineHeightPx(sel.anchor) : Number.parseFloat(computed) || 0;
                        const next = stepTypeValue(p, base, direction, fine);
                        set(p, { value: p === "font-weight" ? String(next) : `${next}px` });
                      }}
                      stepTitle={STEP_TITLE[p]}
                      onReset={() => reset(p)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </PanelFrame>
      )}
    </>
  );
}
