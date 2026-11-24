import type { ReactNode } from "react";
import {
  Kbd,
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
} from "./primitives.tsx";
import { cn } from "cn";
import { SEND_LABELS, type SendState } from "../core/send.ts";
import type { InspectorSubMode } from "../core/spacing-modes.ts";
import type { SyncStatus } from "../core/sync.ts";
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  MousePointerClick,
  Move,
  Pause,
  Pipette,
  Play,
  RulerDimensionLine,
  Send,
  Settings,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { KbdHint, SegmentedControl, SURFACE_CLASS, ToolbarDivider } from "./chrome.tsx";
import type { DragPointerHandlers } from "./use-drag-position.ts";

type ToolMode = "annotate" | "spacing" | "type" | "color" | "layout" | "rearrange";

type ToolbarButtonProps = {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Send button only: exposed as `data-send-state` and in the tooltip. */
  sendState?: SendState;
  tone?: "mode" | "action" | "warning" | "success" | "destructive";
  className?: string;
  children: ReactNode;
};

function ToolbarButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  sendState,
  tone = "action",
  className,
  children,
}: ToolbarButtonProps) {
  const tip = sendState && sendState !== "idle" ? SEND_LABELS[sendState] : label;
  const activeStyle =
    tone === "mode"
      ? pressed
        ? "bg-background text-foreground shadow-2xs ring-1 ring-foreground/10 hover:bg-background dark:bg-foreground/15 dark:ring-white/12"
        : "text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-foreground/10"
      : tone === "warning" && pressed
        ? "bg-[var(--annotate-warning-soft)] text-[var(--annotate-warning)] ring-1 ring-[var(--annotate-warning)]/30 hover:bg-[var(--annotate-warning-soft)]"
        : tone === "success"
          ? "bg-[var(--annotate-success-soft)] text-[var(--annotate-success)] hover:bg-[var(--annotate-success-soft)]"
          : tone === "destructive"
            ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            : pressed
              ? "bg-muted text-foreground ring-1 ring-foreground/10 dark:ring-white/12"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground";

  return (
    <ToolbarButtonPrimitive
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${tip} (${shortcut})` : tip}
      data-send-state={sendState}
      disabled={disabled}
      onClick={onClick}
      className={cn("rounded-lg [&_svg]:size-4", activeStyle, className)}
    >
      {children}
    </ToolbarButtonPrimitive>
  );
}

export type ToolbarProps = {
  className?: string;
  annotationCount: number;
  /** Pending inspector style changes: Clear all stays enabled for them. */
  styleChangeCount?: number;
  /** Layout placements (parity spec 10): Copy, Clear, Hide and Send include them. */
  placementCount?: number;
  /** Rearrangements (parity spec 10.2): Copy, Clear and Send include them. */
  rearrangeCount?: number;
  /** Active tool mode (inspector spec 2): Annotate, Spacing, Type and Colour are exclusive. */
  mode?: ToolMode;
  onSelectMode?: (mode: ToolMode) => void;
  /** Spacing sub-mode (inspector spec 14.1), switched by the Box / Lines control or V. */
  subMode?: InspectorSubMode;
  onSelectSubMode?: (subMode: InspectorSubMode) => void;
  /** I9 toggles (inspector spec 13): drag handles (Spacing Box) and token guides (Spacing Box, Type). */
  handles?: boolean;
  guides?: boolean;
  onToggleHandles?: () => void;
  onToggleGuides?: () => void;
  markersHidden: boolean;
  frozen: boolean;
  settingsOpen: boolean;
  copied: boolean;
  status?: string;
  sendState: SendState;
  /** A send target exists (onSubmit, endpoint or webhook). */
  sendAvailable: boolean;
  /** Endpoint sync status; undefined when no endpoint is set. */
  syncStatus?: SyncStatus;
  onSend: () => void;
  onToggleMarkers: () => void;
  onToggleFreeze: () => void;
  onCopy: () => void;
  onClear: () => void;
  onToggleSettings: () => void;
  onExit: () => void;
  /** Pointer-only drag handlers for repositioning the expanded toolbar via its grip. */
  dragHandlers?: DragPointerHandlers;
  /** Whether the dock is anchored near the bottom viewport edge (stacks tray above bar). */
  dockBottom?: boolean;
  /** Whether the dock is anchored near the right viewport edge (aligns tray right). */
  dockRight?: boolean;
};

const SUB_MODES: { value: InspectorSubMode; label: string; title: string }[] = [
  { value: "box", label: "Box", title: "Box: margin, padding and gap regions" },
  { value: "lines", label: "Lines", title: "Lines: guides and measure" },
];

const MODE_META: Record<Exclude<ToolMode, "annotate">, { label: string; dot: string; hint?: string }> = {
  spacing: { label: "Spacing", dot: "bg-[var(--annotate-marker-green)]" },
  type: { label: "Type", dot: "bg-[var(--annotate-marker-purple)]" },
  color: { label: "Colour", dot: "bg-[var(--annotate-marker-blue)]", hint: "Click to pick colour" },
  layout: { label: "Layout", dot: "bg-[var(--annotate-marker-cyan)]", hint: "Click or drag components" },
  rearrange: { label: "Rearrange", dot: "bg-[var(--annotate-marker-orange)]", hint: "Drag to move · Del hides" },
};

const SEGMENT_BTN_ACTIVE =
  "bg-background text-foreground shadow-2xs ring-1 ring-foreground/10 hover:bg-background dark:bg-foreground/15 dark:ring-white/12";
const SEGMENT_BTN_IDLE =
  "text-muted-foreground hover:bg-background/50 hover:text-foreground dark:hover:bg-foreground/10";

/** I9 toggles, styled in a compact segmented track. Handles only where `onToggleHandles` is given (Spacing). */
function InspectorAids(props: Pick<ToolbarProps, "handles" | "guides" | "onToggleHandles" | "onToggleGuides">) {
  const toggles = [
    ...(props.onToggleHandles
      ? [{
          id: "handles",
          label: "Handles",
          on: Boolean(props.handles),
          title: "Handles: drag a selected side to a spacing token (Box)",
          onClick: props.onToggleHandles,
        }]
      : []),
    {
      id: "guides",
      label: "Guides",
      on: Boolean(props.guides),
      title: props.onToggleHandles
        ? "Guides: faint lines at the next spacing tokens (Box)"
        : "Guides: font-size and line-height token ladder",
      onClick: props.onToggleGuides,
    },
  ];
  return (
    <SegmentedControl role="group" aria-label="Inspector aids" data-annotate-aids>
      {toggles.map((t) => (
        <ToolbarButtonPrimitive
          key={t.id}
          variant="ghost"
          size="xs"
          aria-pressed={t.on}
          title={t.title}
          data-annotate-toggle={t.id}
          onClick={t.onClick}
          className={cn("h-6 rounded-md px-2 text-[11px] font-medium", t.on ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_IDLE)}
        >
          {t.label}
        </ToolbarButtonPrimitive>
      ))}
    </SegmentedControl>
  );
}

export function Toolbar(props: ToolbarProps) {
  const mode = props.mode ?? "annotate";
  const dockBottom = props.dockBottom ?? true;
  const dockRight = props.dockRight ?? true;
  const empty = props.annotationCount === 0;
  /** Copy, Send and Clear include style changes and measurements (inspector I7). */
  const nothing = empty && !props.styleChangeCount && !props.placementCount && !props.rearrangeCount;

  const hasCounts =
    props.annotationCount > 0 ||
    (props.styleChangeCount ?? 0) > 0 ||
    (props.rearrangeCount ?? 0) > 0 ||
    (props.placementCount ?? 0) > 0;
  const hasSync = props.syncStatus === "connected" || props.syncStatus === "offline";
  const hasLeftTray = mode !== "annotate" || props.frozen;
  const hasRightTray = hasCounts || hasSync || Boolean(props.status);
  const showTray = hasLeftTray || hasRightTray;
  const modeMeta = mode === "annotate" ? null : MODE_META[mode];

  return (
    <ToolbarPrimitive
      aria-label="Feedback controls"
      className={cn(
        "flex max-w-full gap-1.5",
        dockBottom ? "flex-col" : "flex-col-reverse",
        dockRight ? "items-end" : "items-start",
        props.className,
      )}
    >
      {/* Contextual secondary tray: stacks vertically so the main bar never jumps horizontally. */}
      <div
        data-annotate-toolbar-tray={showTray ? "" : undefined}
        className={cn(
          showTray
            ? cn(
                "annotate-enter flex max-w-full flex-wrap items-center gap-1.5 rounded-xl px-2 py-1 text-xs",
                SURFACE_CLASS,
              )
            : "sr-only",
        )}
      >
        {showTray && (
          <>
            {modeMeta && (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <span aria-hidden className={cn("size-1.5 rounded-full", modeMeta.dot)} />
                  {modeMeta.label}
                </span>
                {modeMeta.hint && (
                  <span className="text-[11px] text-muted-foreground">{modeMeta.hint}</span>
                )}
              </div>
            )}
            {mode === "spacing" && (
              <>
                <SegmentedControl
                  role="group"
                  aria-label="Spacing sub-mode"
                  data-annotate-sub-mode-control={props.subMode ?? "box"}
                >
                  {SUB_MODES.map(({ value, label, title }) => {
                    const active = (props.subMode ?? "box") === value;
                    return (
                      <ToolbarButtonPrimitive
                        key={value}
                        variant="ghost"
                        size="xs"
                        aria-pressed={active}
                        aria-keyshortcuts="V"
                        title={`${title} (V)`}
                        data-annotate-sub-mode={value}
                        onClick={() => props.onSelectSubMode?.(value)}
                        className={cn(
                          "h-6 rounded-md px-2 text-[11px] font-medium",
                          active ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_IDLE,
                        )}
                      >
                        {label}
                      </ToolbarButtonPrimitive>
                    );
                  })}
                </SegmentedControl>
                <KbdHint>V</KbdHint>
                <ToolbarDivider />
                <InspectorAids
                  handles={props.handles}
                  guides={props.guides}
                  onToggleHandles={props.onToggleHandles}
                  onToggleGuides={props.onToggleGuides}
                />
              </>
            )}
            {mode === "type" && (
              <InspectorAids guides={props.guides} onToggleGuides={props.onToggleGuides} />
            )}
            {props.frozen && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--annotate-warning-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--annotate-warning)]">
                Frozen
              </span>
            )}
            {hasLeftTray && hasRightTray && <ToolbarDivider />}
            {hasCounts && (
              <div className="flex items-center gap-1 rounded-md bg-muted/65 px-1.5 py-0.5 ring-1 ring-inset ring-foreground/[0.05] dark:ring-white/[0.08]">
                {props.annotationCount > 0 && (
                  <Kbd
                    aria-label={`${props.annotationCount} annotations`}
                    className="h-4 min-w-4 bg-transparent px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground"
                  >
                    {props.annotationCount}
                  </Kbd>
                )}
                {(props.styleChangeCount ?? 0) > 0 && (
                  <Kbd
                    data-style-change-count={props.styleChangeCount}
                    aria-label={`${props.styleChangeCount} style changes`}
                    title="Style changes and measurements"
                    className="h-4 bg-transparent px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground"
                  >
                    <Pipette aria-hidden />
                    {props.styleChangeCount}
                  </Kbd>
                )}
                {(props.rearrangeCount ?? 0) > 0 && (
                  <Kbd
                    data-rearrange-count={props.rearrangeCount}
                    aria-label={`${props.rearrangeCount} rearrangements`}
                    title="Rearrangements"
                    className="h-4 bg-transparent px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground"
                  >
                    <Move aria-hidden />
                    {props.rearrangeCount}
                  </Kbd>
                )}
                {(props.placementCount ?? 0) > 0 && (
                  <Kbd
                    data-placement-count={props.placementCount}
                    aria-label={`${props.placementCount} layout placements`}
                    title="Layout placements"
                    className="h-4 bg-transparent px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground"
                  >
                    <LayoutGrid aria-hidden />
                    {props.placementCount}
                  </Kbd>
                )}
              </div>
            )}
            {props.syncStatus === "connected" && (
              <span
                data-mcp-indicator="connected"
                className="flex items-center gap-1.5 px-1 text-[11px] whitespace-nowrap text-muted-foreground"
              >
                <span aria-hidden className="size-1.5 rounded-full bg-[var(--annotate-marker-green)]" />
                MCP Connected
              </span>
            )}
            {props.syncStatus === "offline" && (
              <span
                data-mcp-indicator="offline"
                className="flex items-center gap-1.5 px-1 text-[11px] whitespace-nowrap text-muted-foreground"
                title="Sync server unreachable; retrying. Feedback is kept locally."
              >
                <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                MCP Offline
              </span>
            )}
          </>
        )}
        <span
          role="status"
          aria-live="polite"
          className="px-1 text-[11px] font-medium whitespace-nowrap text-foreground empty:hidden"
        >
          {props.status}
        </span>
      </div>

      {/* Main bar: stable 4-zone layout (grip | modes | canvas & output | settings & exit). */}
      <div
        className={cn(
          "flex max-w-full items-center gap-1 rounded-2xl px-1.5 py-1.5",
          SURFACE_CLASS,
        )}
      >
        {props.dragHandlers && (
          <button
            type="button"
            aria-label="Move toolbar"
            title="Drag to move toolbar"
            data-annotate-toolbar-grip=""
            className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
            {...props.dragHandlers}
          >
            <GripVertical aria-hidden className="size-3.5" />
          </button>
        )}

        <SegmentedControl className="rounded-xl p-0.5">
          <ToolbarButton
            tone="mode"
            label="Annotate"
            pressed={mode === "annotate"}
            onClick={() => props.onSelectMode?.("annotate")}
          >
            <MousePointerClick />
          </ToolbarButton>
          <ToolbarButton
            tone="mode"
            label="Spacing inspector"
            shortcut="M"
            pressed={mode === "spacing"}
            onClick={() => props.onSelectMode?.(mode === "spacing" ? "annotate" : "spacing")}
          >
            <RulerDimensionLine />
          </ToolbarButton>
          <ToolbarButton
            tone="mode"
            label="Type inspector"
            shortcut="T"
            pressed={mode === "type"}
            onClick={() => props.onSelectMode?.(mode === "type" ? "annotate" : "type")}
          >
            <Type />
          </ToolbarButton>
          <ToolbarButton
            tone="mode"
            label="Colour inspector"
            shortcut="K"
            pressed={mode === "color"}
            onClick={() => props.onSelectMode?.(mode === "color" ? "annotate" : "color")}
          >
            <Pipette />
          </ToolbarButton>
          <ToolbarButton
            tone="mode"
            label="Layout"
            shortcut="L"
            pressed={mode === "layout"}
            onClick={() => props.onSelectMode?.(mode === "layout" ? "annotate" : "layout")}
          >
            <LayoutGrid />
          </ToolbarButton>
          <ToolbarButton
            tone="mode"
            label="Rearrange"
            shortcut="R"
            pressed={mode === "rearrange"}
            onClick={() => props.onSelectMode?.(mode === "rearrange" ? "annotate" : "rearrange")}
          >
            <Move />
          </ToolbarButton>
        </SegmentedControl>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            tone="warning"
            label={props.frozen ? "Unfreeze" : "Freeze"}
            shortcut="P"
            pressed={props.frozen}
            onClick={props.onToggleFreeze}
          >
            {props.frozen ? <Play /> : <Pause />}
          </ToolbarButton>
          <ToolbarButton
            label={props.markersHidden ? "Show markers" : "Hide markers"}
            shortcut="H"
            pressed={props.markersHidden}
            disabled={empty && !props.placementCount}
            onClick={props.onToggleMarkers}
          >
            {props.markersHidden ? <EyeOff /> : <Eye />}
          </ToolbarButton>
          <ToolbarButton
            tone={props.copied ? "success" : "action"}
            label="Copy"
            shortcut="C"
            disabled={nothing}
            onClick={props.onCopy}
          >
            {props.copied ? <Check /> : <Copy />}
          </ToolbarButton>
          <ToolbarButton
            label="Send Annotations"
            shortcut="S"
            disabled={nothing || !props.sendAvailable || props.sendState !== "idle"}
            onClick={props.onSend}
            sendState={props.sendState}
          >
            {props.sendState === "sending" ? (
              <LoaderCircle className="animate-spin" />
            ) : props.sendState === "sent" ? (
              <Check className="text-[var(--annotate-success)]" />
            ) : props.sendState === "failed" ? (
              <CircleAlert className="text-destructive" />
            ) : (
              <Send />
            )}
          </ToolbarButton>
          <ToolbarButton
            tone="destructive"
            label="Clear all"
            shortcut="X"
            disabled={nothing}
            onClick={props.onClear}
          >
            <Trash2 />
          </ToolbarButton>
        </div>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton label="Settings" pressed={props.settingsOpen} onClick={props.onToggleSettings}>
            <Settings />
          </ToolbarButton>
          <ToolbarButton label="Exit" onClick={props.onExit}>
            <X />
          </ToolbarButton>
        </div>
      </div>
    </ToolbarPrimitive>
  );
}
