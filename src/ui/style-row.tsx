import { useState, type ReactNode } from "react";
import { Button } from "./primitives.tsx";
import { cn } from "cn";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { StyleValue } from "../core/style-change.ts";
import { FIELD_CLASS } from "./chrome.tsx";
import { FlagBadges } from "./inspector-panel.tsx";

export type RowToken = { id: string; label: string };

export type StyleRowProps = {
  property: string;
  current: StyleValue;
  /** Extra readout for the current value, e.g. `normal (20px)`. */
  currentNote?: string;
  next?: StyleValue;
  /** Live computed value (after preview). */
  computed: string;
  flags: readonly string[];
  tokens: readonly RowToken[];
  selectedToken?: string;
  onToken: (id: string) => void;
  /** Raw input; `units` empty for colour text. Return false to mark the draft invalid. */
  rawValue: string;
  units: readonly string[];
  unit: string;
  onRaw: (value: string, unit: string) => boolean;
  onStep?: (direction: 1 | -1, fine: boolean) => void;
  stepTitle?: string;
  onReset: () => void;
  /** Colour rows: swatches for current and new. */
  swatch?: { current?: string; next?: string };
  children?: ReactNode;
};

/** One compact editable property row for the type and colour panels (spec 6 Current vs New). */
export function StyleRow(props: StyleRowProps) {
  const [draft, setDraft] = useState<{ token: string | undefined; value: string; unit: string; invalid: boolean } | null>(null);
  const activeDraft = draft && draft.token === props.selectedToken ? draft : null;
  const value = activeDraft?.value ?? props.rawValue;
  const unit = activeDraft?.unit ?? props.unit;
  const isInvalid = Boolean(activeDraft?.invalid);

  const commit = (v: string, u: string) => {
    const ok = props.onRaw(v, u);
    setDraft({ token: ok ? undefined : props.selectedToken, value: v, unit: u, invalid: !ok });
  };

  const swatch = (hex?: string) =>
    hex && (
      <span
        aria-hidden
        className="inline-block size-3 shrink-0 rounded-[4px] ring-1 ring-foreground/20 dark:ring-white/20"
        style={{ background: hex }}
      />
    );

  return (
    <div
      data-annotate-panel-row={props.property}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl p-2.5 ring-1 transition-colors",
        props.next
          ? "bg-muted/55 ring-ring/30 dark:bg-white/[0.05] dark:ring-ring/35"
          : "bg-muted/35 ring-foreground/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.06]",
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="font-mono text-[11px] font-medium tracking-tight text-foreground/90">{props.property}</span>
          <FlagBadges flags={props.flags} />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!props.next}
          aria-label={`Reset ${props.property}`}
          title={`Reset ${props.property}`}
          data-annotate-reset
          className="size-5 shrink-0 text-muted-foreground transition-opacity hover:text-foreground disabled:opacity-25"
          onClick={() => {
            setDraft(null);
            props.onReset();
          }}
        >
          <RotateCcw className="size-3" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg bg-background/60 px-2 py-1 text-[11px] ring-1 ring-foreground/[0.04] dark:bg-black/20 dark:ring-white/[0.05]">
        <span
          data-annotate-current
          className="inline-flex min-w-0 items-center gap-1 font-mono text-muted-foreground tabular-nums break-all"
        >
          {swatch(props.swatch?.current)}
          {props.current.value}
          {props.current.token ? ` · ${props.current.token}` : ""}
          {props.currentNote ? ` ${props.currentNote}` : ""}
        </span>
        <span aria-hidden className="text-muted-foreground/45">
          →
        </span>
        <span
          data-annotate-new
          className={cn(
            "inline-flex min-w-0 items-center gap-1 font-mono tabular-nums break-all",
            props.next ? "font-medium text-foreground" : "text-muted-foreground/50",
          )}
        >
          {props.next ? (
            <>
              {swatch(props.swatch?.next)}
              {`${props.next.token ? `${props.next.token} · ` : ""}${props.next.token ? props.next.value : props.computed}`}
            </>
          ) : (
            "—"
          )}
        </span>
        <span
          className="ml-auto font-mono text-[10px] text-muted-foreground/75 tabular-nums"
          data-annotate-readout
        >
          {props.computed}
        </span>
      </div>

      <select
        aria-label={`${props.property} token`}
        data-annotate-token-select
        className={cn(FIELD_CLASS, "w-full cursor-pointer font-mono")}
        value={props.selectedToken ?? ""}
        onChange={(event) => {
          setDraft(null);
          if (event.target.value) props.onToken(event.target.value);
        }}
      >
        <option value="">{props.tokens.length ? "Choose a token…" : "No tokens found"}</option>
        {props.tokens.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <div
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center rounded-lg border border-transparent bg-muted/40 transition-colors hover:border-border/60 hover:bg-muted/60 focus-within:border-ring/70 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/30 dark:bg-white/[0.05] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.08] dark:focus-within:bg-background/90",
            isInvalid &&
              "border-destructive bg-destructive/5 hover:border-destructive focus-within:border-destructive focus-within:ring-destructive/25",
          )}
        >
          <input
            aria-label={`${props.property} value`}
            aria-invalid={isInvalid || undefined}
            data-annotate-raw-input
            className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground tabular-nums outline-none placeholder:text-muted-foreground/70"
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
              className="mr-1 h-5 shrink-0 cursor-pointer rounded-md bg-background/70 px-1 font-mono text-[10px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground dark:bg-white/[0.08]"
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
        {props.onStep && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="outline"
              size="icon-xs"
              aria-label={`Decrease ${props.property}`}
              title={props.stepTitle}
              data-annotate-step="-1"
              className="h-7 w-6 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                setDraft(null);
                props.onStep?.(-1, event.shiftKey);
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
              className="h-7 w-6 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                setDraft(null);
                props.onStep?.(1, event.shiftKey);
              }}
            >
              <Plus />
            </Button>
          </div>
        )}
      </div>

      {props.children}
    </div>
  );
}
