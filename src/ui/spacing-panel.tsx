import { useId, useState } from "react";
import { Button } from "./primitives.tsx";
import { Input } from "@ui-sdk/react/input";
import { cn } from "cn";
import { Minus, Plus, RotateCcw, Ruler } from "lucide-react";
import {
  minFor,
  rawValue,
  SPACING_UNITS,
  stepSpacing,
  tokenId,
  type SpacingToken,
  type SpacingUnit,
  type StyleValue,
} from "../core/style-change.ts";
import type { BoxGroup } from "../core/box-select.ts";
import { parsePx, type BoxSide } from "../core/spacing.ts";
import { FIELD_CLASS, SectionLabel, SegmentedControl } from "./chrome.tsx";
import { FlagBadges, PanelFrame, type PendingItem } from "./inspector-panel.tsx";

/** One editable property row. `current` is the pre-preview value; `next` the pending one. */
export type PanelRow = {
  property: string;
  current: StyleValue;
  next?: StyleValue;
  /** Live computed value of the element (after preview), for the px readout. */
  computed: string;
  pinned: boolean;
  /** Drift flags of the current value (spec 5.3), from token resolution. */
  flags: string[];
};

export type SpacingPanelProps = {
  elementName: string;
  regionLabel?: string;
  rows: PanelRow[];
  tokens: SpacingToken[];
  pending: PendingItem[];
  onSet: (property: string, value: StyleValue) => void;
  onReset: (property: string) => void;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  onCopy?: () => void;
  /** Live measure between the two pins (`Distance between A and B: 24px`), with a save action. */
  measure?: { text: string; onSave: () => void };
};

const GROUP_TINT: Record<BoxGroup, string> = {
  margin: "var(--annotate-marker-orange)",
  padding: "var(--annotate-marker-green)",
  gap: "var(--annotate-marker-purple)",
};

const GROUP_LABEL: Record<BoxGroup, string> = {
  margin: "Margin",
  padding: "Padding",
  gap: "Gap",
};

function splitValue(value: string): { number: string; unit: SpacingUnit } {
  const match = /^(-?\d*\.?\d+)(px|rem|em|%)$/.exec(value.trim());
  return match ? { number: match[1], unit: match[2] as SpacingUnit } : { number: String(parsePx(value)), unit: "px" };
}

function Row({ row, tokens, onSet, onReset }: { row: PanelRow; tokens: SpacingToken[]; onSet: SpacingPanelProps["onSet"]; onReset: SpacingPanelProps["onReset"] }) {
  const id = useId();
  const shown = row.next ?? row.current;
  const parts = splitValue(row.next && !row.next.token ? row.next.value : row.computed);
  const [draft, setDraft] = useState<{ number: string; unit: SpacingUnit; invalid: boolean } | null>(null);
  const number = draft?.number ?? parts.number;
  const unit = draft?.unit ?? parts.unit;
  const selected = row.next?.token ? tokens.find((t) => t.name === row.next?.token) : undefined;
  const computedPx = parsePx(row.computed);
  const visibleFlags = tokens.length > 0 ? row.flags : row.flags.filter((f) => f !== "no token");

  const commitRaw = (n: string, u: SpacingUnit) => {
    const value = rawValue(n, u, row.property);
    setDraft({ number: n, unit: u, invalid: !value });
    if (value) onSet(row.property, { value });
  };
  const step = (direction: 1 | -1, fine: boolean) => {
    const next = stepSpacing(computedPx, direction, fine, minFor(row.property));
    setDraft(null);
    onSet(row.property, { value: `${next}px` });
  };

  return (
    <div
      data-annotate-panel-row={row.property}
      data-pinned={row.pinned || undefined}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2.5 transition-colors",
        row.next
          ? "border-primary/25 bg-muted/50"
          : row.pinned
            ? "border-border/70 bg-muted/45"
            : "border-border/50 bg-muted/30",
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span id={`${id}-label`} className="font-mono text-[11px] font-semibold tracking-tight text-foreground">
            {row.property}
          </span>
          <FlagBadges flags={visibleFlags} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!row.next && (
            <span data-annotate-current className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {row.current.value}
            </span>
          )}
          {row.next && (
            <Button
              variant="ghost"
              size="xs"
              data-annotate-reset
              className="h-5 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft(null);
                onReset(row.property);
              }}
            >
              <RotateCcw className="size-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {row.next && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg bg-background/70 px-2 py-1 text-[11px] ring-1 ring-foreground/[0.05] dark:bg-background/40 dark:ring-white/[0.06]">
          <span data-annotate-current className="min-w-0 font-mono text-muted-foreground tabular-nums break-all">
            {row.current.value}
            {row.current.token ? ` · ${row.current.token}` : ""}
          </span>
          <span aria-hidden className="text-muted-foreground/50">
            →
          </span>
          <span data-annotate-new className="min-w-0 font-mono font-medium text-foreground tabular-nums break-all">
            {`${shown.token ? `${shown.token} · ` : ""}${row.computed}`}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/75 tabular-nums" data-annotate-readout>
            {row.computed}
          </span>
        </div>
      )}

      {tokens.length > 0 && (
        <select
          aria-label={`${row.property} token`}
          data-annotate-token-select
          className={cn(FIELD_CLASS, "w-full rounded-lg font-mono")}
          value={selected ? tokenId(selected) : ""}
          onChange={(event) => {
            const token = tokens.find((t) => tokenId(t) === event.target.value);
            setDraft(null);
            if (token) onSet(row.property, { value: token.value, token: token.name });
          }}
        >
          <option value="">Choose a token</option>
          {tokens.map((token) => (
            <option key={tokenId(token)} value={tokenId(token)}>
              {`${token.name} · ${token.px}px${token.onGrid ? "" : " (off-grid)"}`}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-1.5">
        <div className="flex h-7 min-w-0 flex-1 items-center rounded-lg border border-border/70 bg-background/90 shadow-2xs transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-background/50">
          <input
            aria-label={`${row.property} value`}
            aria-invalid={draft?.invalid || undefined}
            data-annotate-raw-input
            inputMode="decimal"
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground tabular-nums outline-none",
              draft?.invalid && "text-destructive",
            )}
            value={number}
            onChange={(event) => commitRaw(event.target.value, unit)}
            onBlur={() => {
              if (draft && !draft.invalid) setDraft(null);
            }}
          />
          <select
            aria-label={`${row.property} unit`}
            data-annotate-unit
            className="h-full shrink-0 cursor-pointer border-l border-border/60 bg-transparent px-1.5 font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground"
            value={unit}
            onChange={(event) => commitRaw(number, event.target.value as SpacingUnit)}
          >
            {SPACING_UNITS.filter((u) => u !== "%" || !row.property.endsWith("gap")).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="outline" size="icon-xs" aria-label={`Decrease ${row.property}`} title="−8 (Shift: −1)" data-annotate-step="-1" onClick={(event) => step(-1, event.shiftKey)}>
            <Minus />
          </Button>
          <Button variant="outline" size="icon-xs" aria-label={`Increase ${row.property}`} title="+8 (Shift: +1)" data-annotate-step="1" onClick={(event) => step(1, event.shiftKey)}>
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Read-only current value of one selected side (Box): px, utility, token, drift flags. */
export type SideRow = { property: string; current: StyleValue; flags: string[] };

/** One token chip: `p-4 · 16`, applied to every selected side at once. */
export type TokenChip = { id: string; label: string; px: number; value: StyleValue; pressed: boolean };

export type BoxPanelProps = {
  elementName: string;
  regionLabel: string;
  group: BoxGroup;
  /** Selected sides (empty for gap). */
  sides: readonly BoxSide[];
  /** Current value per side (padding, margin), px, for the diagram cells. */
  values?: Partial<Record<BoxSide, number>>;
  /** Gap: number of bands sharing the one value. */
  bands?: number;
  /** `16px`, or `mixed` when the selected sides differ. */
  readout: string;
  rows: SideRow[];
  chips: TokenChip[];
  /** Number input value (px) shown for the selection; empty when mixed. */
  number: string;
  min: number;
  onCell: (side: BoxSide, additive: boolean) => void;
  onPreset: (preset: "all" | "vertical" | "horizontal") => void;
  onValue: (value: StyleValue) => void;
  onStep: (direction: 1 | -1, fine: boolean) => void;
  /** Reset pending changes covering the active selection. */
  onReset?: () => void;
  /** Scope toggle: this element, or every element like it (spec 14.2). */
  scope?: { mode: "one" | "all"; count: number; onChange: (mode: "one" | "all") => void; onPreview: (on: boolean) => void };
  count?: number;
  pending: PendingItem[];
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  onCopy?: () => void;
};

const SIDE_SHORT: Record<BoxSide, string> = { top: "T", right: "R", bottom: "B", left: "L" };

function activePreset(sides: readonly BoxSide[]): "all" | "vertical" | "horizontal" | null {
  if (sides.length === 4) return "all";
  if (sides.length === 2 && sides.includes("top") && sides.includes("bottom")) return "vertical";
  if (sides.length === 2 && sides.includes("left") && sides.includes("right")) return "horizontal";
  return null;
}

/**
 * Box panel (spec 14.2): a sleek Figma/Webflow-inspired spacing pad synced with the canvas
 * selection, compact axis presets, tactile numeric stepper, contextual token chips,
 * and scope toggle when multiple matching elements exist.
 */
export function BoxPanel(props: BoxPanelProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const number = draft ?? props.number;
  const gap = props.group === "gap";
  const tint = GROUP_TINT[props.group];
  const presetMatch = activePreset(props.sides);

  // Only show per-side detail rows when they carry real token or drift information
  // (avoids repeating 4 identical plain px rows already visible in the box pad).
  const detailRows = props.rows.filter(
    (row) => Boolean(row.current.token) || row.flags.some((flag) => flag !== "no token"),
  );
  const showScope = Boolean(props.scope && props.scope.count > 1);

  const cell = (side: BoxSide) => {
    const selected = props.sides.includes(side);
    const val = props.values?.[side];
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${side} side`}
        data-annotate-cell={side}
        className={cn(
          "flex h-7 w-full cursor-pointer items-center justify-center gap-1 rounded-lg border px-1.5 font-mono text-[11px] leading-none tabular-nums transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          selected
            ? "font-semibold text-foreground"
            : "border-border/50 bg-background/80 text-muted-foreground hover:border-border/80 hover:bg-background hover:text-foreground dark:bg-background/45 dark:hover:bg-background/70",
        )}
        style={
          selected
            ? {
                borderColor: `color-mix(in oklch, ${tint} 42%, transparent)`,
                backgroundColor: `color-mix(in oklch, ${tint} 12%, var(--background))`,
                boxShadow: `0 0 0 2px color-mix(in oklch, ${tint} 14%, transparent)`,
              }
            : undefined
        }
        onClick={(event) => {
          setDraft(null);
          props.onCell(side, event.shiftKey);
        }}
      >
        <span className={cn("text-[10px] font-medium", selected ? "text-foreground/65" : "text-muted-foreground/70")}>
          {SIDE_SHORT[side]}
        </span>
        {val != null && <span>{val}</span>}
      </button>
    );
  };

  return (
    <PanelFrame
      label="Spacing inspector"
      kind="spacing"
      elementName={props.elementName}
      regionLabel={props.regionLabel}
      count={props.count}
      pending={props.pending}
      onRemove={props.onRemove}
      onEdit={props.onEdit}
      onCopy={props.onCopy}
    >
      <div className="flex flex-col gap-3" data-annotate-box-panel={props.group}>
        {gap ? (
          <div
            data-annotate-box-diagram="gap"
            className="flex items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2.5 text-xs text-foreground"
            style={{
              backgroundColor: `color-mix(in oklch, ${tint} 8%, transparent)`,
              borderColor: `color-mix(in oklch, ${tint} 32%, transparent)`,
            }}
          >
            <span className="flex items-center gap-2 font-medium">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
              Gap
            </span>
            <span className="rounded-md bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums ring-1 ring-foreground/[0.06] dark:bg-background/40 dark:ring-white/[0.08]">
              {`${props.bands ?? 0} band${props.bands === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-muted/30 p-3">
            <div
              data-annotate-box-diagram={props.group}
              className="grid grid-cols-3 grid-rows-3 items-center gap-1.5"
            >
              <span />
              {cell("top")}
              <span />
              {cell("left")}
              <div className="flex h-7 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-background/55 px-1.5 dark:bg-background/25">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full opacity-80" style={{ backgroundColor: tint }} />
                <span className="truncate text-[10px] font-medium text-muted-foreground">
                  {GROUP_LABEL[props.group]}
                </span>
              </div>
              {cell("right")}
              <span />
              {cell("bottom")}
              <span />
            </div>

            <SegmentedControl className="grid w-full grid-cols-3" role="group" aria-label="Side selection">
              {(["all", "vertical", "horizontal"] as const).map((preset) => {
                const active = presetMatch === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    data-annotate-preset={preset}
                    className={cn(
                      "h-6 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      active
                        ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setDraft(null);
                      props.onPreset(preset);
                    }}
                  >
                    {preset[0].toUpperCase() + preset.slice(1)}
                  </button>
                );
              })}
            </SegmentedControl>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-border/70 bg-background/90 p-0.5 shadow-2xs transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-background/50">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Decrease"
              title="One token down (Shift: −1px)"
              data-annotate-box-step="-1"
              className="rounded-md text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                setDraft(null);
                props.onStep(-1, event.shiftKey);
              }}
            >
              <Minus />
            </Button>
            <div className="relative flex h-full min-w-0 flex-1 items-center border-x border-border/50">
              <Input
                aria-label="Value in px for every selected side"
                data-annotate-box-input
                inputMode="decimal"
                placeholder={props.readout === "mixed" ? "mixed" : undefined}
                className="h-full w-full min-w-0 bg-transparent px-7 text-center font-mono text-xs font-medium text-foreground tabular-nums outline-none placeholder:text-muted-foreground/70"
                value={number}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft(text);
                  const n = Number(text.trim());
                  if (text.trim() !== "" && Number.isFinite(n) && n >= props.min) props.onValue({ value: `${Math.round(n * 1000) / 1000}px` });
                }}
                onBlur={() => setDraft(null)}
              />
              <span aria-hidden className="pointer-events-none absolute right-2 font-mono text-[10px] text-muted-foreground/75">
                px
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Increase"
              title="One token up (Shift: +1px)"
              data-annotate-box-step="1"
              className="rounded-md text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                setDraft(null);
                props.onStep(1, event.shiftKey);
              }}
            >
              <Plus />
            </Button>
            <output data-annotate-value-readout className="sr-only">
              {props.readout}
            </output>
          </div>
          {props.onReset && (
            <Button
              variant="outline"
              size="sm"
              data-annotate-reset
              aria-label="Reset selected spacing"
              title="Reset selected spacing"
              className="h-8 shrink-0 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft(null);
                props.onReset?.();
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
        </div>

        {props.chips.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel meta={<span className="font-mono text-[10px] text-muted-foreground tabular-nums">{props.chips.length}</span>}>
              Tokens
            </SectionLabel>
            <div
              className="annotate-scroll grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto p-px"
              data-annotate-token-chips
            >
              {props.chips.map((chip) => (
                <Button
                  key={chip.id}
                  variant={chip.pressed ? "default" : "outline"}
                  size="xs"
                  aria-pressed={chip.pressed}
                  data-annotate-token-chip={chip.id}
                  title={`${chip.label} · ${chip.px}px`}
                  className={cn(
                    "h-7 min-w-0 justify-between gap-1.5 rounded-lg px-2 font-mono text-[11px] tabular-nums",
                    !chip.pressed && "border-border/60 bg-background/70 hover:bg-muted/60 dark:bg-background/35",
                  )}
                  onClick={() => {
                    setDraft(null);
                    props.onValue(chip.value);
                  }}
                >
                  <span className="min-w-0 truncate">{chip.label}</span>
                  <span className={cn("shrink-0 text-[10px]", chip.pressed ? "opacity-75" : "text-muted-foreground")}>{chip.px}px</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {showScope && props.scope && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Scope</SectionLabel>
            <SegmentedControl className="grid w-full grid-cols-2" role="group" aria-label="Scope">
              <button
                type="button"
                aria-pressed={props.scope.mode === "one"}
                data-annotate-scope="one"
                className={cn(
                  "h-6 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  props.scope.mode === "one"
                    ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => props.scope?.onChange("one")}
              >
                This element
              </button>
              <button
                type="button"
                aria-pressed={props.scope.mode === "all"}
                data-annotate-scope="all"
                data-count={props.scope.count}
                className={cn(
                  "h-6 cursor-pointer truncate rounded-md px-2 text-[11px] font-medium tabular-nums transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  props.scope.mode === "all"
                    ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/[0.08] dark:bg-foreground/15 dark:ring-white/10"
                    : "text-muted-foreground hover:text-foreground",
                )}
                // Pointer over/out bubble inside the shadow root (mouseenter is unreliable there).
                onPointerOver={() => props.scope?.onPreview(true)}
                onPointerOut={() => props.scope?.onPreview(false)}
                onFocus={() => props.scope?.onPreview(true)}
                onBlur={() => props.scope?.onPreview(false)}
                onClick={() => props.scope?.onChange("all")}
              >
                {`All ${props.scope.count} like this`}
              </button>
            </SegmentedControl>
          </div>
        )}

        {detailRows.length > 0 && (
          <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-muted/25 px-2.5 py-0.5">
            {detailRows.map((row) => (
              <div key={row.property} data-annotate-panel-row={row.property} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                <span className="shrink-0 font-mono text-muted-foreground">{row.property}</span>
                <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                  <span data-annotate-current className="flex min-w-0 max-w-full font-mono text-foreground tabular-nums">
                    <span className="shrink-0">{row.current.value}</span>
                    {row.current.token && (
                      <span className="truncate text-muted-foreground" title={row.current.token}>
                        {`\u00a0· ${row.current.token}`}
                      </span>
                    )}
                  </span>
                  <FlagBadges flags={row.flags.filter((f) => f !== "no token")} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelFrame>
  );
}

/** Right side panel for the spacing inspector (spec 6), on the shared panel frame. */
export function SpacingPanel(props: SpacingPanelProps) {
  return (
    <PanelFrame
      label="Spacing inspector"
      kind="spacing"
      elementName={props.elementName}
      regionLabel={props.regionLabel ?? "Click a margin, padding or gap"}
      pending={props.pending}
      onRemove={props.onRemove}
      onEdit={props.onEdit}
      onCopy={props.onCopy}
    >
      {(props.rows.length > 0 || props.measure) && (
        <div className="flex flex-col gap-2.5">
          {props.rows.map((row) => (
            <Row key={row.property} row={row} tokens={props.tokens} onSet={props.onSet} onReset={props.onReset} />
          ))}
          {props.measure && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/35 px-3 py-2 text-[11px]" data-annotate-panel-measure>
              <span className="min-w-0 font-mono text-foreground tabular-nums">{props.measure.text}</span>
              <Button variant="outline" size="xs" data-annotate-save-measure onClick={props.measure.onSave}>
                <Ruler />
                Add
              </Button>
            </div>
          )}
        </div>
      )}
    </PanelFrame>
  );
}
