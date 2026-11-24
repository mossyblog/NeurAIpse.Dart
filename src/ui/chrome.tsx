import { useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Badge, Button } from "./primitives.tsx";
import { cn } from "cn";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NOTCH_FILLET_RADIUS } from "../core/dock.ts";
import type { DockSide } from "../core/types.ts";

/** Shared elevated floating surface chrome (toolbar, popups, panels). */
export const SURFACE_CLASS =
  "rounded-xl bg-popover/95 text-popover-foreground backdrop-blur-md shadow-[var(--ann-shadow-float)] ring-1 ring-foreground/[0.08] dark:ring-white/[0.1]";

/** Shared canvas overlay micro-pill chrome (hover tags, hints, guide labels). */
export const PILL_CLASS =
  "rounded-md bg-popover/95 text-popover-foreground backdrop-blur-sm shadow-[var(--ann-shadow-pill)] ring-1 ring-foreground/[0.1] dark:ring-white/[0.12]";

/** Shared compact input and select styling inside annotate panels. */
export const FIELD_CLASS =
  "h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-2xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive";

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
        "shrink-0 bg-border/80",
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
        "inline-flex items-center gap-0.5 rounded-lg bg-muted/75 p-0.5 ring-1 ring-inset ring-foreground/[0.06] dark:ring-white/[0.08]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Consistent uppercase micro-heading for panel sections. */
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
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {children}
      </span>
      {meta}
    </div>
  );
}

/** Compact inline keyboard shortcut keycap. */
export function KbdHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded border border-border/80 bg-muted/80 px-1 font-mono text-[10px] leading-none font-medium text-muted-foreground select-none",
        className,
      )}
    >
      {children}
    </kbd>
  );
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
  headerExtra?: ReactNode;
  footer?: ReactNode;
  className?: string;
  panelRef?: Ref<HTMLDivElement>;
  dataAttrs?: Record<string, string | boolean | undefined>;
  children?: ReactNode;
};

/**
 * Unified docked floating panel shell (inspectors, Layout palette, Rearrange panel):
 * sticky header with mode eyebrow and collapse control, scrollable body, optional sticky footer.
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
  headerExtra,
  footer,
  className,
  panelRef,
  dataAttrs,
  children,
}: FloatingPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = collapsed !== undefined;
  const isCollapsed = collapsible ? (isControlled ? collapsed : internalCollapsed) : false;

  const handleToggle = () => {
    onToggleCollapse?.();
    if (!isControlled) setInternalCollapsed((current) => !current);
  };

  const extraAttrs: Record<string, string | boolean> = {};
  if (dataAttrs) {
    for (const [key, value] of Object.entries(dataAttrs)) {
      if (value !== undefined && value !== false) extraAttrs[key] = value;
    }
  }
  const titleAttrs = titleDataAttr ? { [titleDataAttr]: "" } : undefined;
  const subtitleAttrs = subtitleDataAttr ? { [subtitleDataAttr]: "" } : undefined;
  const hasEyebrow = Boolean(icon || modeLabel);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      data-collapsed={isCollapsed || undefined}
      {...extraAttrs}
      className={cn(
        "annotate-enter pointer-events-auto fixed top-4 z-20 flex max-h-[calc(100vh-116px)] flex-col overflow-hidden text-sm",
        SURFACE_CLASS,
        side === "left" ? "left-[var(--annotate-inset-left,16px)]" : "right-[var(--annotate-inset-right,16px)]",
        width === "sm" ? "w-72" : "w-80",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col gap-1 px-3 py-2.5",
          !isCollapsed && "border-b border-border/70",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {hasEyebrow ? (
              <>
                {icon && (
                  <span aria-hidden className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-3.5">
                    {icon}
                  </span>
                )}
                {modeLabel && (
                  <span className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {modeLabel}
                  </span>
                )}
              </>
            ) : (
              <span {...titleAttrs} className="truncate text-[13px] leading-tight font-semibold text-foreground">
                {title}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerExtra}
            {count != null && count > 0 && (
              <Badge
                variant="secondary"
                data-annotate-panel-count={count}
                className="h-5 min-w-5 px-1.5 font-mono text-[11px] tabular-nums"
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
                onClick={handleToggle}
              >
                {isCollapsed ? <ChevronDown /> : <ChevronUp />}
              </Button>
            )}
          </div>
        </div>
        {hasEyebrow && (
          <span {...titleAttrs} className="truncate text-[13px] leading-tight font-semibold text-foreground">
            {title}
          </span>
        )}
        {subtitle && (
          <span {...subtitleAttrs} className="truncate font-mono text-[11px] leading-snug text-muted-foreground">
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
            <div className="shrink-0 border-t border-border/70 bg-muted/25 px-3 py-2.5">
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  );
}
