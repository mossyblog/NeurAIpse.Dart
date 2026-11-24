import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { Check, Search, X } from "lucide-react";

export type TokenOption = {
  id: string;
  label: string;
  value: string;
  swatch?: string;
  meta?: string;
};

export type TokenPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokens: readonly TokenOption[];
  selectedId?: string;
  onSelect: (token: TokenOption | null) => void;
  anchorEl: HTMLElement | null;
  placeholder?: string;
};

const POPOVER_WIDTH = 240;
const EDGE = 12;
const GAP = 8;
const DEFAULT_HEIGHT = 280;

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.22) 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
};

function computePosition(anchorEl: HTMLElement | null, measuredHeight: number): CSSProperties {
  if (!anchorEl || typeof window === "undefined") {
    return { left: EDGE, top: EDGE };
  }
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = measuredHeight > 0 ? measuredHeight : DEFAULT_HEIGHT;

  // Prefer left of anchorEl; flip right if near left viewport edge.
  let left = rect.left - POPOVER_WIDTH - GAP;
  if (left < EDGE) {
    left = rect.right + GAP;
  }
  left = Math.max(EDGE, Math.min(left, vw - POPOVER_WIDTH - EDGE));

  // Align to anchor top; flip/clamp upward if overflowing bottom edge.
  let top = rect.top - 4;
  if (top + height > vh - EDGE) {
    const flipped = rect.bottom - height + 4;
    top = flipped >= EDGE ? flipped : vh - height - EDGE;
  }
  top = Math.max(EDGE, top);

  return { left, top };
}

/** Searchable floating variable/token picker popover positioned beside an anchor element. */
export function TokenPopover({
  open,
  onOpenChange,
  tokens,
  selectedId,
  onSelect,
  anchorEl,
  placeholder = "Search variables...",
}: TokenPopoverProps) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<CSSProperties>(() => computePosition(anchorEl, DEFAULT_HEIGHT));
  const [activeIndex, setActiveIndex] = useState(-1);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.value.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.meta?.toLowerCase().includes(q) ?? false),
    );
  }, [tokens, query]);

  // Reset search & auto-focus on open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(-1);
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Measure and position beside anchorEl, updating on resize/scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const h = cardRef.current?.getBoundingClientRect().height ?? DEFAULT_HEIGHT;
      setPos(computePosition(anchorEl, h));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorEl, filtered.length]);

  // Close on Escape (capture) or outside pointerdown (composedPath-aware for Shadow DOM).
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (cardRef.current && path.includes(cardRef.current)) return;
      if (anchorEl && path.includes(anchorEl)) return;
      onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, anchorEl, onOpenChange]);

  if (!open) return null;

  const choose = (token: TokenOption | null) => {
    onSelect(token);
    onOpenChange(false);
  };

  // Index 0 = None, indices 1..filtered.length = filtered tokens
  const totalItems = filtered.length + 1;

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % totalItems);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      if (activeIndex === 0) choose(null);
      else if (filtered[activeIndex - 1]) choose(filtered[activeIndex - 1]);
    }
  };

  const content = (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Select variable"
      data-annotate-ui="token-popover"
      style={pos}
      className={cn(
        "fixed z-50 flex w-60 flex-col overflow-hidden rounded-xl border border-border/80 bg-popover/98 text-popover-foreground shadow-xl backdrop-blur-xl",
        "dark:border-white/[0.1] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Search bar */}
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2 dark:border-white/[0.08]">
        <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-5 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/65"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Token list */}
      <div role="listbox" aria-label="Variables" className="max-h-60 overflow-y-auto p-1">
        {/* None / unlink row */}
        <button
          type="button"
          role="option"
          aria-selected={!selectedId}
          onClick={() => choose(null)}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors outline-none",
            !selectedId
              ? "bg-muted/70 font-medium text-foreground dark:bg-white/[0.09]"
              : "text-muted-foreground hover:bg-muted/55 hover:text-foreground dark:hover:bg-white/[0.06]",
            activeIndex === 0 && "ring-1 ring-ring/50",
          )}
        >
          <span className="flex items-center gap-1.5 truncate">
            <span
              aria-hidden
              className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-dashed border-muted-foreground/45 text-[9px] text-muted-foreground"
            >
              ×
            </span>
            <span>None</span>
          </span>
          {!selectedId && <Check className="size-3.5 shrink-0 text-purple-500 dark:text-purple-400" />}
        </button>

        {filtered.length > 0 && (
          <div className="my-1 h-px bg-border/50 dark:bg-white/[0.06]" role="separator" />
        )}

        {filtered.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground/75">
            No matching variables
          </div>
        ) : (
          filtered.map((token, idx) => {
            const isSelected = selectedId === token.id;
            const isHighlighted = activeIndex === idx + 1;
            return (
              <button
                key={token.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                title={`${token.label} (${token.value})`}
                onClick={() => choose(token)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors outline-none",
                  isSelected
                    ? "bg-purple-500/12 text-foreground dark:bg-purple-500/18"
                    : "text-foreground/90 hover:bg-muted/60 dark:hover:bg-white/[0.07]",
                  isHighlighted && "ring-1 ring-ring/50",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {isSelected ? (
                    <Check className="size-3 shrink-0 text-purple-500 dark:text-purple-400" />
                  ) : (
                    <span className="size-3 shrink-0" aria-hidden />
                  )}
                  <span className={cn("truncate", isSelected && "font-medium")}>{token.label}</span>
                </span>

                <span className="flex shrink-0 items-center gap-1.5">
                  {token.meta && (
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {token.meta}
                    </span>
                  )}
                  {token.swatch && (
                    <span
                      aria-hidden
                      className="relative inline-block size-4 shrink-0 overflow-hidden rounded-sm ring-1 ring-foreground/15 dark:ring-white/20"
                      style={CHECKERBOARD_STYLE}
                    >
                      <span
                        className="absolute inset-0"
                        style={{ backgroundColor: token.swatch }}
                      />
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const portalTarget = anchorEl?.closest("[data-theme]");
  return portalTarget ? createPortal(content, portalTarget) : content;
}

export type TokenDiamondButtonProps = {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: (el: HTMLButtonElement) => void;
};

/** Crisp purple-accented diamond (`◇`) variable trigger icon button. */
export function TokenDiamondButton({
  active = false,
  disabled = false,
  title = "Bind variable",
  onClick,
}: TokenDiamondButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-annotate-token-trigger
      data-active={active || undefined}
      onClick={(event) => onClick(event.currentTarget)}
      className={cn(
        "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors outline-none select-none",
        "focus-visible:border-purple-500/70 focus-visible:ring-2 focus-visible:ring-purple-500/30",
        "disabled:pointer-events-none disabled:opacity-35",
        active
          ? "border-purple-500/40 bg-purple-500/15 text-purple-600 hover:bg-purple-500/22 dark:border-purple-400/35 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-500/28"
          : "border-transparent bg-transparent text-muted-foreground/75 hover:bg-purple-500/10 hover:text-purple-600 dark:hover:bg-purple-500/15 dark:hover:text-purple-300",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
      >
        <path
          d="M6 1.25L10.75 6L6 10.75L1.25 6L6 1.25Z"
          fill={active ? "currentColor" : "none"}
          fillOpacity={active ? 0.25 : 0}
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        {active && <circle cx="6" cy="6" r="1.35" fill="currentColor" />}
      </svg>
    </button>
  );
}
