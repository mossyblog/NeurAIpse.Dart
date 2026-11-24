import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Badge, Button } from "./primitives.tsx";
import { cn } from "cn";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { NOTCH_FILLET_RADIUS } from "../core/dock.ts";
import type { DockSide } from "../core/types.ts";

/** Shared elevated floating surface chrome (toolbar, popups, panels). */
export const SURFACE_CLASS =
  "rounded-2xl border border-border/70 bg-popover/95 text-popover-foreground backdrop-blur-xl shadow-[0_12px_36px_-8px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.5)_inset] dark:border-white/[0.09] dark:shadow-[0_12px_36px_-8px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.04)_inset]";

/** Shared canvas overlay micro-pill chrome (hover tags, hints, guide labels). */
export const PILL_CLASS =
  "rounded-lg border border-border/60 bg-popover/95 text-popover-foreground backdrop-blur-md shadow-[var(--ann-shadow-pill)] dark:border-white/[0.1]";

/** Shared compact input and select styling inside annotate panels. */
export const FIELD_CLASS =
  "h-7 rounded-lg border border-transparent bg-muted/45 px-2 text-xs text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 hover:border-border/60 hover:bg-muted/65 focus-visible:border-ring/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:bg-destructive/5 dark:bg-white/[0.05] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.08] dark:focus-visible:bg-background/90";

/** Subtle hairline separator between control groups. */
export function ToolbarDivider({
  orientation = "vertical",
  className,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 bg-border/70",
        orientation === "horizontal" ? "my-0.5 h-px w-4" : "mx-0.5 h-4 w-px",
        className,
      )}
    />
  );
}

/**
 * Tangent-continuous concave corner fillet connecting a side-docked Apple notch
 * flush to the left or right viewport edge with edge bleed so no 1px gap appears.
 */
export function NotchFillet({ side, position }: { side: DockSide; position: "top" | "bottom" }) {
  const r = NOTCH_FILLET_RADIUS;
  const bleed = 2;
  const w = r + bleed;
  const h = r + 2;
  const scaleX = side === "left" ? -1 : 1;
  const scaleY = position === "bottom" ? -1 : 1;
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn(
        "pointer-events-none absolute block overflow-visible",
        side === "right" ? "-right-[2px]" : "-left-[2px]",
        position === "top" ? "bottom-[calc(100%-1px)]" : "top-[calc(100%-1px)]",
      )}
      style={{
        transform: scaleX === 1 && scaleY === 1 ? undefined : `scale(${scaleX}, ${scaleY})`,
      }}
    >
      <path
        d={`M 0 ${h} L ${w} ${h} L ${w} 0 L ${r} 0 L ${r} 0.5 A ${r} ${r} 0 0 1 0 ${r + 0.5} Z`}
        fill="var(--annotate-notch-bg)"
      />
      <path
        d={`M 0 ${r + 0.5} A ${r} ${r} 0 0 0 ${r} 0.5`}
        fill="none"
        stroke="var(--annotate-notch-border)"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Recessed segmented track for mutually exclusive modes or compact toggle groups. */
export function SegmentedControl({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted/45 p-0.5 ring-1 ring-inset ring-foreground/[0.05] dark:bg-white/[0.04] dark:ring-white/[0.07]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Clean sans-serif micro-heading for panel sections. */
export function SectionLabel({
  children,
  meta,
  className,
}: {
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{children}</span>
      {meta}
    </div>
  );
}

/** Compact inline keyboard shortcut keycap. */
export function KbdHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/55 px-1 font-mono text-[10px] leading-none font-medium text-muted-foreground select-none dark:border-white/[0.08] dark:bg-white/[0.06]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

type PanelPosition = { x: number; y: number };

const VIEWPORT_MARGIN = 12;
const DRAG_THRESHOLD = 3;
const INTERACTIVE_SELECTOR = "button, a, input, select, textarea, [role='button'], [data-no-drag]";

/** Remember dragged panel coordinates per dock side across mode switches and remounts. */
const rememberedPositions: Partial<Record<"left" | "right", PanelPosition>> = {};

function clampPanelPosition(x: number, y: number, width: number, height: number): PanelPosition {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    x: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, x), maxX)),
    y: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, y), maxY)),
  };
}

export type FloatingPanelProps = {
  side?: "right" | "left";
  width?: "sm" | "md";
  label: string;
  icon?: ReactNode;
  modeLabel?: string;
  title: string;
  subtitle?: string;
  titleDataAttr?: string;
  subtitleDataAttr?: string;
  count?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Optional close callback; renders a compact close button in the header when provided. */
  onClose?: () => void;
  /** Allow dragging the panel freely by its header (defaults to true). */
  draggable?: boolean;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  footerClassName?: string;
  className?: string;
  panelRef?: Ref<HTMLDivElement>;
  dataAttrs?: Record<string, string | boolean | undefined>;
  children?: ReactNode;
};

/**
 * Unified draggable floating panel shell (inspectors, Layout palette, Rearrange panel):
 * compact draggable header with collapse/close controls, scrollable body, optional sticky footer.
 */
export function FloatingPanel({
  side = "right",
  width = "md",
  label,
  icon,
  modeLabel,
  title,
  subtitle,
  titleDataAttr,
  subtitleDataAttr,
  count,
  collapsible = true,
  collapsed,
  onToggleCollapse,
  onClose,
  draggable = true,
  headerExtra,
  footer,
  footerClassName,
  className,
  panelRef,
  dataAttrs,
  children,
}: FloatingPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = collapsed !== undefined;
  const isCollapsed = collapsible ? (isControlled ? collapsed : internalCollapsed) : false;

  const [position, setPosition] = useState<PanelPosition | null>(() => rememberedPositions[side] ?? null);
  const [isDragging, setIsDragging] = useState(false);
  const localRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);

  const setMergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof panelRef === "function") {
        panelRef(node);
      } else if (panelRef && typeof panelRef === "object") {
        (panelRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [panelRef],
  );

  // Keep dragged panel clamped inside viewport on window resize or mount.
  useEffect(() => {
    if (!position) return;
    const clampCurrent = () => {
      const el = localRef.current;
      const w = el?.offsetWidth || (width === "sm" ? 288 : 320);
      const h = el?.offsetHeight || 200;
      setPosition((prev) => {
        if (!prev) return prev;
        const clamped = clampPanelPosition(prev.x, prev.y, w, h);
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        rememberedPositions[side] = clamped;
        return clamped;
      });
    };
    clampCurrent();
    window.addEventListener("resize", clampCurrent);
    return () => window.removeEventListener("resize", clampCurrent);
  }, [position !== null, side, width]);

  const handleToggle = () => {
    onToggleCollapse?.();
    if (!isControlled) setInternalCollapsed((current) => !current);
  };

  const handleHeaderPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggable || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;

    const el = localRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width || (width === "sm" ? 288 : 320),
      height: rect.height || 200,
      moved: false,
    };
  };

  const handleHeaderPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!state.moved) {
      state.moved = true;
      setIsDragging(true);
    }
    const next = clampPanelPosition(state.originX + dx, state.originY + dy, state.width, state.height);
    rememberedPositions[side] = next;
    setPosition(next);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    dragRef.current = null;
    if (!state) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (state.moved) setIsDragging(false);
  };

  const handleHeaderDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!draggable) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;
    delete rememberedPositions[side];
    setPosition(null);
  };

  const extraAttrs: Record<string, string | boolean> = {};
  if (dataAttrs) {
    for (const [key, value] of Object.entries(dataAttrs)) {
      if (value !== undefined && value !== false) extraAttrs[key] = value;
    }
  }
  const titleAttrs = titleDataAttr ? { [titleDataAttr]: "" } : undefined;
  const subtitleAttrs = subtitleDataAttr ? { [subtitleDataAttr]: "" } : undefined;
  const showInlineTitlePill = Boolean(modeLabel && title && modeLabel.toLowerCase() !== title.toLowerCase());

  return (
    <div
      ref={setMergedRef}
      role="dialog"
      aria-label={label}
      data-collapsed={isCollapsed || undefined}
      data-dragging={isDragging || undefined}
      {...extraAttrs}
      style={position ? { left: position.x, top: position.y, right: "auto" } : undefined}
      className={cn(
        "annotate-enter pointer-events-auto fixed z-20 flex max-h-[calc(100vh-48px)] flex-col overflow-hidden text-sm",
        SURFACE_CLASS,
        !position && "top-4",
        !position &&
          (side === "left"
            ? "left-[calc(var(--annotate-inset-left,16px)+12px)]"
            : "right-[calc(var(--annotate-inset-right,16px)+12px)]"),
        width === "sm" ? "w-72" : "w-80",
        isDragging && "shadow-[0_18px_48px_-10px_rgba(0,0,0,0.55)] ring-1 ring-ring/30 select-none",
        className,
      )}
    >
      <div
        data-annotate-panel-header=""
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={handleHeaderDoubleClick}
        title={draggable && position ? "Drag to move · double-click to reset position" : draggable ? "Drag to move" : undefined}
        className={cn(
          "group/header flex shrink-0 flex-col gap-0.5 px-2.5 py-2 select-none",
          draggable && "cursor-grab touch-none active:cursor-grabbing",
          !isCollapsed && "border-b border-border/60 dark:border-white/[0.07]",
        )}
      >
        <div className="flex min-h-6 items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {draggable && (
              <GripVertical
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/35 transition-colors group-hover/header:text-muted-foreground/80"
              />
            )}
            {icon && (
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/60 text-foreground/80 [&_svg]:size-3 dark:bg-white/[0.07]"
              >
                {icon}
              </span>
            )}
            {showInlineTitlePill ? (
              <>
                <span className="shrink-0 text-[12.5px] leading-tight font-semibold tracking-tight text-foreground">
                  {modeLabel}
                </span>
                <span
                  {...titleAttrs}
                  title={title}
                  className="inline-flex max-w-[140px] min-w-0 items-center truncate rounded-md bg-muted/55 px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium text-foreground/85 ring-1 ring-inset ring-foreground/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.08]"
                >
                  {title}
                </span>
              </>
            ) : (
              <span
                {...titleAttrs}
                title={title}
                className="truncate text-[12.5px] leading-tight font-semibold tracking-tight text-foreground"
              >
                {title}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {headerExtra}
            {count != null && count > 0 && (
              <Badge
                variant="secondary"
                data-annotate-panel-count={count}
                className="h-5 min-w-5 px-1.5 font-mono text-[10.5px] tabular-nums"
              >
                {count}
              </Badge>
            )}
            {collapsible && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
                aria-expanded={!isCollapsed}
                className="text-muted-foreground hover:text-foreground"
                onClick={handleToggle}
              >
                {isCollapsed ? <ChevronDown /> : <ChevronUp />}
              </Button>
            )}
            {onClose && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${label}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X />
              </Button>
            )}
          </div>
        </div>
        {subtitle && !isCollapsed && (
          <span
            {...subtitleAttrs}
            title={subtitle}
            className={cn(
              "truncate text-[11px] leading-snug text-muted-foreground/85",
              draggable ? "pl-5" : "pl-0.5",
            )}
          >
            {subtitle}
          </span>
        )}
      </div>
      {!isCollapsed && (
        <>
          <div className="annotate-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5 empty:hidden">
            {children}
          </div>
          {footer && (
            <div
              className={cn(
                "shrink-0 border-t border-border/60 bg-muted/25 px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.02]",
                footerClassName,
              )}
            >
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  );
}
