import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { TokenDiamondButton } from "./token-popover.tsx";

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.22) 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
};

/* -------------------------------------------------------------------------- */
/*  DesignSection                                                             */
/* -------------------------------------------------------------------------- */

export type DesignSectionProps = {
  title: string;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** Collapsible inspector section with hairline divider, 12px medium header, and optional right action. */
export function DesignSection({ title, action, defaultOpen = true, children }: DesignSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      data-annotate-design-section={title.toLowerCase()}
      className="border-t border-border/60 first:border-t-0 dark:border-white/[0.07]"
    >
      <div className="flex min-h-9 items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none select-none"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
          )}
          <span className="truncate text-xs font-medium tracking-[-0.01em] text-foreground/90 group-hover:text-foreground">
            {title}
          </span>
        </button>

        {action && (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            {action}
          </div>
        )}
      </div>

      {open && <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  LayerBreadcrumb                                                           */
/* -------------------------------------------------------------------------- */

export type LayerBreadcrumbItem = {
  el: Element;
  label: string;
  kind: "text" | "container" | "element";
};

export type LayerBreadcrumbProps = {
  ancestors: readonly LayerBreadcrumbItem[];
  active: Element;
  onSelect: (el: Element) => void;
};

const KIND_DOT_CLASS: Record<LayerBreadcrumbItem["kind"], string> = {
  text: "bg-sky-400",
  container: "bg-purple-400",
  element: "bg-emerald-400",
};

/** Compact horizontal scrollable layer trail (`main > .grid > section.card > h2`). */
export function LayerBreadcrumb({ ancestors, active, onSelect }: LayerBreadcrumbProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, ancestors.length]);

  return (
    <nav
      aria-label="Layer hierarchy"
      data-annotate-layer-breadcrumb
      className="flex items-center gap-0.5 overflow-x-auto border-b border-border/60 px-2.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-white/[0.07]"
    >
      {ancestors.map((item, index) => {
        const isActive = item.el === active;
        return (
          <div key={`${item.label}-${index}`} className="flex shrink-0 items-center gap-0.5">
            {index > 0 && (
              <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/45" />
            )}
            <button
              ref={isActive ? activeRef : undefined}
              type="button"
              aria-current={isActive ? "location" : undefined}
              title={item.label}
              onClick={() => onSelect(item.el)}
              className={cn(
                "inline-flex h-5 max-w-36 cursor-pointer items-center gap-1 rounded-md px-1.5 font-mono text-[11px] leading-none transition-colors outline-none select-none",
                "focus-visible:ring-2 focus-visible:ring-ring/40",
                isActive
                  ? "bg-ring/15 font-medium text-foreground ring-1 ring-inset ring-ring/30 dark:bg-white/[0.11] dark:ring-white/[0.14]"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:hover:bg-white/[0.07]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  KIND_DOT_CLASS[item.kind],
                  !isActive && "opacity-65",
                )}
              />
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/*  AlignmentGrid3x3                                                          */
/* -------------------------------------------------------------------------- */

export type AlignAxis = "start" | "center" | "end";

export type AlignmentGrid3x3Props = {
  row: AlignAxis;
  col: AlignAxis;
  onChange: (row: AlignAxis, col: AlignAxis) => void;
};

const AXES: readonly AlignAxis[] = ["start", "center", "end"];

const JUSTIFY_MAP: Record<AlignAxis, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

/** Tactile 3×3 dot/bar alignment matrix (Figma/Pencil Flex Layout style). */
export function AlignmentGrid3x3({ row, col, onChange }: AlignmentGrid3x3Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Content alignment"
      data-annotate-alignment-grid
      className="grid size-[68px] shrink-0 grid-cols-3 grid-rows-3 rounded-lg bg-muted/45 p-1 ring-1 ring-inset ring-foreground/[0.06] dark:bg-white/[0.04] dark:ring-white/[0.08]"
    >
      {AXES.map((r) =>
        AXES.map((c) => {
          const active = row === r && col === c;
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Align ${r} ${c}`}
              title={`${r} / ${c}`}
              onClick={() => onChange(r, c)}
              className={cn(
                "group flex cursor-pointer items-center justify-center rounded-[4px] transition-colors outline-none",
                "focus-visible:ring-1 focus-visible:ring-ring/60",
                active
                  ? "bg-ring/15 dark:bg-ring/25"
                  : "hover:bg-foreground/[0.06] dark:hover:bg-white/[0.07]",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className={cn("flex flex-col gap-[2px]", JUSTIFY_MAP[c])}
                >
                  <span className="block h-[2px] w-2.5 rounded-full bg-ring" />
                  <span className="block h-[2px] w-3.5 rounded-full bg-ring" />
                  <span className="block h-[2px] w-2 rounded-full bg-ring" />
                </span>
              ) : (
                <span
                  aria-hidden
                  className="size-1 rounded-full bg-muted-foreground/45 transition-transform group-hover:scale-125 group-hover:bg-foreground/70"
                />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CompactField                                                              */
/* -------------------------------------------------------------------------- */

export type CompactFieldProps = {
  prefix?: ReactNode;
  value: string;
  placeholder?: string;
  onChange: (val: string) => void;
  onStep?: (dir: 1 | -1, fine: boolean) => void;
  tokenActive?: boolean;
  onTokenClick?: (el: HTMLButtonElement) => void;
  ariaLabel: string;
};

/** Compact rounded-lg inspector input with optional prefix, ArrowUp/Down stepping, and purple token trigger. */
export function CompactField({
  prefix,
  value,
  placeholder,
  onChange,
  onStep,
  tokenActive = false,
  onTokenClick,
  ariaLabel,
}: CompactFieldProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!onStep) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onStep(1, event.shiftKey);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onStep(-1, event.shiftKey);
    }
  };

  return (
    <div
      data-annotate-compact-field
      data-token-active={tokenActive || undefined}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1 rounded-lg border px-1.5 transition-colors",
        tokenActive
          ? "border-purple-500/35 bg-purple-500/[0.07] hover:border-purple-500/50 focus-within:border-purple-500/70 focus-within:ring-2 focus-within:ring-purple-500/25 dark:border-purple-400/30 dark:bg-purple-500/[0.11]"
          : "border-transparent bg-muted/45 hover:border-border/60 hover:bg-muted/65 focus-within:border-ring/70 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/30 dark:bg-white/[0.05] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.08] dark:focus-within:bg-background/90",
      )}
    >
      {prefix !== undefined && prefix !== null && (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center font-mono text-[10px] font-medium text-muted-foreground/75 select-none [&_svg]:size-3"
        >
          {prefix}
        </span>
      )}

      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent font-mono text-xs tabular-nums outline-none placeholder:text-muted-foreground/55",
          tokenActive ? "font-medium text-purple-600 dark:text-purple-300" : "text-foreground",
        )}
      />

      {onTokenClick && (
        <TokenDiamondButton
          active={tokenActive}
          title={tokenActive ? `Variable bound (${ariaLabel})` : `Bind variable for ${ariaLabel}`}
          onClick={onTokenClick}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ColorPillField                                                            */
/* -------------------------------------------------------------------------- */

export type ColorPillFieldProps = {
  color: string;
  label: string;
  tokenActive?: boolean;
  modified?: boolean;
  onSwatchClick: (el: HTMLButtonElement) => void;
  onTokenClick?: (el: HTMLButtonElement) => void;
  onReset?: () => void;
};

/** The `[swatch] token-or-hex ◇` pill row for color properties. */
export function ColorPillField({
  color,
  label,
  tokenActive = false,
  modified = false,
  onSwatchClick,
  onTokenClick,
  onReset,
}: ColorPillFieldProps) {
  return (
    <div
      data-annotate-color-pill
      data-modified={modified || undefined}
      data-token-active={tokenActive || undefined}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1 rounded-lg border px-1.5 transition-colors",
        tokenActive
          ? "border-purple-500/35 bg-purple-500/[0.07] hover:border-purple-500/50 dark:border-purple-400/30 dark:bg-purple-500/[0.11]"
          : modified
            ? "border-ring/35 bg-muted/55 hover:border-ring/50 dark:bg-white/[0.07]"
            : "border-transparent bg-muted/45 hover:border-border/60 hover:bg-muted/65 dark:bg-white/[0.05] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.08]",
      )}
    >
      <button
        type="button"
        onClick={(event) => onSwatchClick(event.currentTarget)}
        title={`Pick color (${label})`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none select-none"
      >
        <span
          aria-hidden
          className="relative inline-block size-4 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-foreground/15 dark:ring-white/20"
          style={CHECKERBOARD_STYLE}
        >
          <span className="absolute inset-0" style={{ backgroundColor: color }} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-xs",
            tokenActive ? "font-medium text-purple-600 dark:text-purple-300" : "text-foreground/95",
          )}
        >
          {label}
        </span>
      </button>

      {onTokenClick && (
        <TokenDiamondButton
          active={tokenActive}
          title={tokenActive ? `Variable bound (${label})` : "Bind color variable"}
          onClick={onTokenClick}
        />
      )}

      {modified && onReset && (
        <button
          type="button"
          aria-label={`Reset ${label}`}
          title="Reset color"
          onClick={onReset}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/[0.1]"
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </div>
  );
}
