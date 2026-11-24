import { useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Badge, Button } from "./primitives.tsx";
import { cn } from "cn";
import { ChevronDown, ChevronUp } from "lucide-react";

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
export function ToolbarDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("mx-0.5 h-4 w-px shrink-0 bg-border/80", className)} />;
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
        side === "left" ? "left-4" : "right-4",
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
