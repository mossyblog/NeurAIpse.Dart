import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button } from "./primitives.tsx";
import { cn } from "cn";
import { Check, ChevronDown, ChevronUp, Copy, Pencil, Pipette, Ruler, Trash2, Type, X } from "lucide-react";
import { FIELD_CLASS, FloatingPanel } from "./chrome.tsx";

/** One row of the shared pending list (all inspector categories, spec 6 mock-up). */
export type PendingItem = { id: string; label: string; property: string; from: string; to: string };

export const FIELD = FIELD_CLASS;

export type PanelFrameProps = {
  /** Accessible name, e.g. "Spacing inspector". */
  label: string;
  /** Data attribute marking the panel kind (`data-annotate-spacing-panel`...). */
  kind: "spacing" | "type" | "color";
  elementName: string;
  regionLabel: string;
  /** Element count badge (groups). */
  count?: number;
  children?: ReactNode;
  pending: PendingItem[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  onEdit?: (id: string) => void;
  onCopy?: () => void;
  onClose?: () => void;
};

type FlagKind = "off-grid" | "no-token" | "guess" | "unknown";

const FLAG_CLASS: Record<FlagKind, string> = {
  "off-grid": "border-transparent bg-[var(--annotate-warning-soft)] text-[var(--annotate-warning)]",
  "no-token": "border-border/60 bg-muted/60 text-muted-foreground",
  guess: "border-transparent bg-[var(--annotate-info-soft)] text-[var(--annotate-info)]",
  unknown: "border-transparent bg-[var(--annotate-destructive-soft)] text-[var(--annotate-destructive)]",
};

const PANEL_META: Record<PanelFrameProps["kind"], { label: string; icon: ReactNode }> = {
  spacing: { label: "Spacing", icon: <Ruler className="size-3.5" /> },
  type: { label: "Type", icon: <Type className="size-3.5" /> },
  color: { label: "Colour", icon: <Pipette className="size-3.5" /> },
};

/** Drift and status badges for a property row (spec 5.3). */
export function FlagBadges({ flags }: { flags: readonly string[] }) {
  return (
    <>
      {flags.map((flag) => {
        const kind: FlagKind = flag.startsWith("off-grid")
          ? "off-grid"
          : flag === "no token"
            ? "no-token"
            : flag.includes("guess")
              ? "guess"
              : "unknown";
        return (
          <Badge
            key={flag}
            variant="outline"
            data-annotate-flag={kind}
            title={flag}
            className={cn(
              "h-[18px] max-w-44 truncate rounded-md px-1.5 text-[10px] leading-none font-medium",
              FLAG_CLASS[kind],
            )}
          >
            {kind === "guess" ? `guess: ${flag.replace(/^token unknown \(guess: |\)$/g, "")}` : flag}
          </Badge>
        );
      })}
    </>
  );
}

/**
 * Shared inspector floating panel frame: draggable, collapsible FloatingPanel with
 * compact header, scrollable body, and smart collapsible pending-changes footer.
 */
export function PanelFrame(props: PanelFrameProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = () => {
    props.onCopy?.();
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
      copyTimer.current = null;
    }, 1500);
  };

  const handleClearAll = () => {
    if (props.onClearAll) {
      props.onClearAll();
      return;
    }
    for (const item of props.pending) {
      props.onRemove(item.id);
    }
  };

  const meta = PANEL_META[props.kind];
  const dataAttrs: Record<string, string | boolean | undefined> = {
    "data-annotate-panel": props.kind,
    [`data-annotate-${props.kind}-panel`]: "",
  };
  const hasPending = props.pending.length > 0;

  const footer = !hasPending ? (
    <p className="truncate text-[11px] leading-tight text-muted-foreground/75">
      Tweak any value — changes stay live until cleared
    </p>
  ) : (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setQueueOpen((open) => !open)}
          aria-expanded={queueOpen}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10.5px] tabular-nums">
            {props.pending.length} {props.pending.length === 1 ? "change" : "changes"}
          </Badge>
          <span className="text-muted-foreground/70">
            {queueOpen ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear all changes"
            title="Clear all changes"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={handleClearAll}
          >
            <Trash2 />
          </Button>
          {props.onCopy && (
            <Button
              variant="default"
              size="xs"
              data-annotate-panel-copy
              className="h-6 px-2 text-[11px]"
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </div>
      </div>

      {queueOpen && (
        <ol className="annotate-scroll flex max-h-36 flex-col gap-1 overflow-y-auto" data-annotate-pending>
          {props.pending.map((item, index) => (
            <li
              key={item.id}
              data-annotate-pending-item={item.property}
              data-annotate-pending-id={item.id}
              className="flex items-center justify-between gap-1.5 rounded-lg bg-muted/45 px-2 py-1.5 ring-1 ring-foreground/[0.05] dark:bg-white/[0.04] dark:ring-white/[0.06]"
            >
              <span
                className="flex min-w-0 flex-1 flex-col gap-0.5"
                title={`${item.label} ${item.property} ${item.from} → ${item.to}`}
              >
                <span className="truncate text-[11px] leading-tight font-medium text-foreground">
                  <span className="font-mono text-muted-foreground/75 tabular-nums">{index + 1}.</span> {item.label}{" "}
                  <span className="font-mono font-normal text-muted-foreground">{item.property}</span>
                </span>
                <span className="truncate font-mono text-[11px] leading-tight tabular-nums">
                  <span className="text-muted-foreground">{item.from}</span>
                  <span className="mx-1 text-muted-foreground/50">→</span>
                  <span className="font-medium text-foreground">{item.to}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                {props.onEdit && item.property !== "distance" && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${item.property} change`}
                    title="Edit change"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => props.onEdit?.(item.id)}
                  >
                    <Pencil />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${item.property} change`}
                  title="Revert change"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => props.onRemove(item.id)}
                >
                  <X />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <FloatingPanel
      side="right"
      width="md"
      label={props.label}
      icon={meta.icon}
      modeLabel={meta.label}
      title={props.elementName}
      subtitle={props.regionLabel}
      titleDataAttr="data-annotate-panel-element"
      subtitleDataAttr="data-annotate-panel-region"
      count={props.count != null && props.count > 0 ? props.count : undefined}
      collapsible
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      onClose={props.onClose}
      footer={footer}
      footerClassName={!hasPending ? "py-1.5" : undefined}
      dataAttrs={dataAttrs}
    >
      {props.children}
    </FloatingPanel>
  );
}
