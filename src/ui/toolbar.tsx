import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from "react";
import {
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
} from "./primitives.tsx";
import { cn } from "cn";
import {
  DOCK_BASE_SIZE,
  DOCK_INFLUENCE_RADIUS,
  DOCK_MAX_SIZE,
  DOCK_RENDER_SIZE,
  DOCK_SLOT_PITCH,
  computeDockOffsets,
  dockMagnification,
  dockMetricsForFactor,
} from "../core/dock.ts";
import { SEND_LABELS, type SendState } from "../core/send.ts";
import { DEFAULT_GOOEY_NAV_SETTINGS } from "../core/settings.ts";
import type { InspectorSubMode } from "../core/spacing-modes.ts";
import type { SyncStatus } from "../core/sync.ts";
import type { DockSide, GooeyNavSettings, GooeyNavSize, Theme } from "../core/types.ts";
import {
  contrastInkForColor,
  createGooeyNavEngine,
  type GooeyEngineHandle,
  type GooeyRect,
} from "./gooey-nav-engine.ts";
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  GripHorizontal,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  MousePointerClick,
  Move,
  PanelLeft,
  PanelRight,
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
import {
  KbdHint,
  NotchFillet,
  PILL_CLASS,
  SegmentedControl,
  SURFACE_CLASS,
  ToolbarDivider,
} from "./chrome.tsx";
import type { DragPointerHandlers } from "./use-drag-position.ts";

type ToolMode = "annotate" | "spacing" | "type" | "color" | "layout" | "rearrange" | "measure-v" | "measure-h";

const MODE_ORDER: readonly ToolMode[] = ["annotate", "spacing", "type", "color", "layout", "rearrange"];
const GOOEY_PILLS: Record<Theme, { color: string; hover: string; shadow: number }> = {
  dark: { color: "#f4f4f5", hover: "rgba(255, 255, 255, 0.08)", shadow: 0.4 },
  light: { color: "#27272a", hover: "rgba(24, 24, 27, 0.06)", shadow: 0.2 },
};

const NOTCH_SIZES: Record<GooeyNavSize, { baseSize: number; maxSize: number; slotPitch: number }> = {
  sm: { baseSize: 22, maxSize: 38, slotPitch: 26 },
  md: { baseSize: DOCK_BASE_SIZE, maxSize: DOCK_MAX_SIZE, slotPitch: DOCK_SLOT_PITCH },
  lg: { baseSize: 28, maxSize: 48, slotPitch: 32 },
};

const TOTAL_DOCK_ITEMS = 14;
const SPRING_RATE = 24;

function syntheticOffset(index: number, slotPitch = DOCK_SLOT_PITCH): number {
  return (index - (TOTAL_DOCK_ITEMS - 1) / 2) * slotPitch;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

type DockButtonProps = {
  index: number;
  side: DockSide;
  slotPitch: number;
  restScale: number;
  gooeyCanvasActive?: boolean;
  gooeyHoverActive?: boolean;
  activePillColor?: string;
  activeIconInk?: string;
  showTooltip: boolean;
  registerSlot: (index: number, el: HTMLElement | null) => void;
  registerButton: (index: number, el: HTMLElement | null) => void;
  onHoverItem: (index: number) => void;
  onFocusItem: (index: number) => void;
  onBlurItem: (index: number) => void;
  label: string;
  tooltip?: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Send button only: exposed as `data-send-state` and in the tooltip. */
  sendState?: SendState;
  tone?: "mode" | "action" | "warning" | "success" | "destructive";
  badge?: number;
  className?: string;
  children: ReactNode;
};

function NotchDockButton({
  index,
  side,
  slotPitch,
  restScale,
  gooeyCanvasActive,
  gooeyHoverActive,
  activePillColor,
  activeIconInk,
  showTooltip,
  registerSlot,
  registerButton,
  onHoverItem,
  onFocusItem,
  onBlurItem,
  label,
  tooltip,
  shortcut,
  pressed,
  disabled,
  onClick,
  sendState,
  tone = "action",
  badge,
  className,
  children,
}: DockButtonProps) {
  const tip = sendState && sendState !== "idle" ? SEND_LABELS[sendState] : (tooltip ?? label);
  const isRight = side === "right";
  const activeStyle =
    tone === "mode"
      ? pressed
        ? gooeyCanvasActive
          ? "bg-transparent hover:bg-transparent"
          : "shadow-sm"
        : gooeyHoverActive
          ? "text-muted-foreground hover:text-foreground"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-foreground/10"
      : tone === "warning" && pressed
        ? "bg-[var(--annotate-warning-soft)] text-[var(--annotate-warning)] ring-1 ring-[var(--annotate-warning)]/30 hover:bg-[var(--annotate-warning-soft)]"
        : tone === "success"
          ? "bg-[var(--annotate-success-soft)] text-[var(--annotate-success)] hover:bg-[var(--annotate-success-soft)]"
          : tone === "destructive"
            ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            : pressed
              ? "bg-muted text-foreground ring-1 ring-foreground/10 dark:ring-white/15"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground";

  return (
    <div
      ref={(el) => registerSlot(index, el)}
      style={{ width: `${slotPitch}px`, height: `${slotPitch}px` }}
      className="relative flex shrink-0 items-center justify-center"
      onPointerEnter={() => onHoverItem(index)}
    >
      <ToolbarButtonPrimitive
        ref={(el: HTMLElement | null) => registerButton(index, el)}
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        data-send-state={sendState}
        data-dock-item={index}
        data-dock-factor="0.00"
        disabled={disabled}
        onClick={onClick}
        onFocus={() => onFocusItem(index)}
        onBlur={() => onBlurItem(index)}
        style={{
          width: `${DOCK_RENDER_SIZE}px`,
          height: `${DOCK_RENDER_SIZE}px`,
          transform: `translate3d(0px, 0px, 0) scale(${restScale})`,
          ...(tone === "mode" && pressed
            ? {
                color: activeIconInk,
                ...(gooeyCanvasActive ? {} : { backgroundColor: activePillColor }),
              }
            : {}),
        }}
        className={cn(
          "annotate-notch-item relative shrink-0 p-0 active:translate-y-0",
          tone === "mode" ? "rounded-full" : "rounded-xl",
          activeStyle,
          className,
        )}
      >
        <span aria-hidden className="annotate-notch-icon flex size-5 items-center justify-center">
          {children}
        </span>
        {badge != null && badge > 0 && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 font-mono text-[10px] leading-none font-semibold tabular-nums text-primary-foreground",
              isRight ? "-left-0.5" : "-right-0.5",
            )}
          >
            {badge}
          </span>
        )}
      </ToolbarButtonPrimitive>

      {showTooltip && (
        <span
          aria-hidden
          data-dock-tooltip=""
          className={cn(
            PILL_CLASS,
            "pointer-events-none absolute top-1/2 z-40 flex -translate-y-1/2 items-center gap-1.5 px-2 py-1 text-[11px] leading-none font-medium whitespace-nowrap",
            isRight ? "right-full mr-5" : "left-full ml-5",
          )}
        >
          <span>{tip}</span>
          {shortcut && <KbdHint>{shortcut}</KbdHint>}
        </span>
      )}
    </div>
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
  /** Pointer-only drag handlers for sliding the notch vertically or across to the other edge. */
  dragHandlers?: DragPointerHandlers;
  /** Active theme for WebGL2 GooeyNav pill colour. */
  theme?: Theme;
  /** Which viewport edge the side notch is docked to. */
  dockSide?: DockSide;
  /** Gooey selection animation settings for the mode bar. */
  gooeyNav?: GooeyNavSettings;
  /** Flip the notch to the opposite viewport edge. */
  onToggleDockSide?: () => void;
  /** Vertical center coordinate (px) for the edge-docked notch. */
  centerY?: number;
  /** True while the notch is being dragged. */
  dragging?: boolean;
  /** Ref attached to the vertical notch body for height measurement. */
  notchRef?: Ref<HTMLDivElement>;
};

const SUB_MODES: { value: InspectorSubMode; label: string; title: string }[] = [
  { value: "box", label: "Box", title: "Box: margin, padding and gap regions" },
  { value: "lines", label: "Lines", title: "Lines: guides and measure" },
];

const MODE_META: Record<Exclude<ToolMode, "annotate">, { label: string; dot: string; hint?: string }> = {
  spacing: { label: "Spacing", dot: "bg-[var(--annotate-marker-green)]" },
  type: { label: "Type", dot: "bg-[var(--annotate-marker-purple)]" },
  color: { label: "Color", dot: "bg-[var(--annotate-marker-blue)]", hint: "Click to pick color" },
  layout: { label: "Layout", dot: "bg-[var(--annotate-marker-cyan)]", hint: "Click or drag components" },
  rearrange: { label: "Rearrange", dot: "bg-[var(--annotate-marker-orange)]", hint: "Drag to move · Del hides" },
  "measure-v": { label: "Vertical ruler", dot: "bg-[var(--annotate-marker-pink)]", hint: "Hover & click to pin · Drag for custom · 2 horiz" },
  "measure-h": { label: "Horizontal ruler", dot: "bg-[var(--annotate-marker-pink)]", hint: "Hover & click to pin · Drag for custom · 1 vert" },
};

const SEGMENT_BTN_ACTIVE =
  "bg-background text-foreground shadow-2xs ring-1 ring-foreground/10 hover:bg-background dark:bg-foreground/15 dark:ring-white/12";
const SEGMENT_BTN_IDLE =
  "text-muted-foreground hover:bg-background/50 hover:text-foreground dark:hover:bg-foreground/10";

/** I9 toggles, styled in a compact segmented track. Handles only where `onToggleHandles` is given (Spacing). */
function InspectorAids(props: Pick<ToolbarProps, "handles" | "guides" | "onToggleHandles" | "onToggleGuides">) {
  const toggles = [
    ...(props.onToggleHandles
      ? [
          {
            id: "handles",
            label: "Handles",
            on: Boolean(props.handles),
            title: "Handles: drag a selected side to a spacing token (Box)",
            onClick: props.onToggleHandles,
          },
        ]
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
  const side: DockSide = props.dockSide ?? "right";
  const theme: Theme = props.theme ?? "dark";
  const gooey: GooeyNavSettings = props.gooeyNav ?? DEFAULT_GOOEY_NAV_SETTINGS;
  const sizeConfig = NOTCH_SIZES[gooey.size] ?? NOTCH_SIZES.md;
  const sizeConfigRef = useRef(sizeConfig);
  sizeConfigRef.current = sizeConfig;
  const restScale = Number((sizeConfig.baseSize / DOCK_RENDER_SIZE).toFixed(4));
  const effectivePillColor = gooey.color || GOOEY_PILLS[theme].color;
  const activeIconInk = contrastInkForColor(effectivePillColor);
  const gooeyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gooeyEngineRef = useRef<GooeyEngineHandle | null>(null);
  const [gooeyWebGL, setGooeyWebGL] = useState(false);
  const activeModeIndex = Math.max(0, MODE_ORDER.indexOf(mode));
  const activeModeIndexRef = useRef(activeModeIndex);
  activeModeIndexRef.current = activeModeIndex;
  const isRight = side === "right";
  const centerY = props.centerY ?? (typeof window === "undefined" ? 360 : Math.round(window.innerHeight / 2));
  const empty = props.annotationCount === 0;
  /** Copy, Send and Clear include style changes and measurements (inspector I7). */
  const nothing = empty && !props.styleChangeCount && !props.placementCount && !props.rearrangeCount;
  const totalCount =
    props.annotationCount +
    (props.styleChangeCount ?? 0) +
    (props.rearrangeCount ?? 0) +
    (props.placementCount ?? 0);

  const hasCounts = totalCount > 0;
  const hasSync = props.syncStatus === "connected" || props.syncStatus === "offline";
  const hasLeftTray = mode !== "annotate" || props.frozen;
  const hasRightTray = hasCounts || hasSync || Boolean(props.status);
  const showTray = hasLeftTray || hasRightTray;
  const modeMeta = mode === "annotate" ? null : MODE_META[mode];

  // GPU-composited macOS Dock hover magnification (zero React re-renders during pointermove).
  const notchElRef = useRef<HTMLDivElement | null>(null);
  const gripElRef = useRef<HTMLButtonElement | null>(null);
  const divider1ElRef = useRef<HTMLDivElement | null>(null);
  const divider2ElRef = useRef<HTMLDivElement | null>(null);
  const slotElsRef = useRef<(HTMLElement | null)[]>([]);
  const buttonElsRef = useRef<(HTMLElement | null)[]>([]);
  const restingOffsetsRef = useRef<number[]>([]);
  const notchCenterYRef = useRef<number | null>(null);
  const sideRef = useRef<DockSide>(side);
  const pointerRelYRef = useRef<number | null>(null);
  const pivotIndexRef = useRef<number | null>(null);
  const currentFactorsRef = useRef<number[]>(new Array<number>(TOTAL_DOCK_ITEMS).fill(0));
  const targetFactorsRef = useRef<number[]>(new Array<number>(TOTAL_DOCK_ITEMS).fill(0));
  const rafIdRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  const [dockHovered, setDockHovered] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  useEffect(() => {
    sideRef.current = side;
  }, [side]);

  const setNotchRef = useCallback(
    (node: HTMLDivElement | null) => {
      notchElRef.current = node;
      if (typeof props.notchRef === "function") props.notchRef(node);
      else if (props.notchRef && "current" in props.notchRef) {
        (props.notchRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [props.notchRef],
  );

  const registerSlot = useCallback((index: number, el: HTMLElement | null) => {
    slotElsRef.current[index] = el;
  }, []);

  const registerButton = useCallback((index: number, el: HTMLElement | null) => {
    buttonElsRef.current[index] = el;
  }, []);

  const computeModeRects = useCallback((factors: readonly number[], offsetsY: readonly number[]): GooeyRect[] => {
    const cfg = sizeConfigRef.current;
    const rects: GooeyRect[] = [];
    for (let i = 0; i < MODE_ORDER.length; i++) {
      const metrics = dockMetricsForFactor(factors[i] ?? 0, {
        baseSize: cfg.baseSize,
        maxSize: cfg.maxSize,
      });
      const size = metrics.buttonSize;
      const cx = cfg.slotPitch / 2;
      const cy = i * cfg.slotPitch + cfg.slotPitch / 2 + (offsetsY[i] ?? 0);
      rects.push({ x: cx - size / 2, y: cy - size / 2, w: size, h: size });
    }
    return rects;
  }, []);

  /** Writes GPU-only translate3d + scale directly to button DOM nodes (zero layout reflow). */
  const applyFactorsToDom = useCallback((factors: readonly number[], pivot: number | null) => {
    const cfg = sizeConfigRef.current;
    const offsetsY = computeDockOffsets(factors, pivot, {
      baseSize: cfg.baseSize,
      maxSize: cfg.maxSize,
      slotPitch: cfg.slotPitch,
    });
    for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) {
      const btn = buttonElsRef.current[i];
      if (!btn) continue;
      const metrics = dockMetricsForFactor(factors[i] ?? 0, {
        baseSize: cfg.baseSize,
        maxSize: cfg.maxSize,
      });
      const shiftY = offsetsY[i] ?? 0;
      // Keep every icon dead-center in its vertical lane (shiftX = 0).
      btn.style.transform = `translate3d(0px, ${shiftY}px, 0) scale(${metrics.scale})`;
      btn.style.zIndex = metrics.factor > 0.5 ? "3" : metrics.factor > 0.05 ? "2" : "1";
      btn.setAttribute("data-dock-factor", metrics.factor.toFixed(2));
    }
    gooeyEngineRef.current?.syncRects(
      cfg.slotPitch,
      MODE_ORDER.length * cfg.slotPitch,
      computeModeRects(factors, offsetsY),
    );
    // Glide the grip and section dividers with the dock wave so icons never collide with them.
    if (gripElRef.current) {
      const topShift = Math.min(0, offsetsY[0] ?? 0);
      gripElRef.current.style.transform = `translate3d(0px, ${topShift}px, 0)`;
    }
    if (divider1ElRef.current) {
      const mid1 = Number((((offsetsY[5] ?? 0) + (offsetsY[6] ?? 0)) / 2).toFixed(2));
      divider1ElRef.current.style.transform = `translate3d(0px, ${mid1}px, 0)`;
    }
    if (divider2ElRef.current) {
      const mid2 = Number((((offsetsY[10] ?? 0) + (offsetsY[11] ?? 0)) / 2).toFixed(2));
      divider2ElRef.current.style.transform = `translate3d(0px, ${mid2}px, 0)`;
    }
  }, [computeModeRects]);

  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    if (rafIdRef.current !== null) return;
    lastFrameRef.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const alpha = 1 - Math.exp(-dt * SPRING_RATE);
      const current = currentFactorsRef.current;
      const target = targetFactorsRef.current;
      let maxDiff = 0;
      for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) {
        const diff = target[i] - current[i];
        if (Math.abs(diff) < 0.002) {
          current[i] = target[i];
        } else {
          current[i] += diff * alpha;
          if (Math.abs(target[i] - current[i]) > maxDiff) {
            maxDiff = Math.abs(target[i] - current[i]);
          }
        }
      }
      applyFactorsToDom(current, pivotIndexRef.current);
      if (maxDiff > 0.002) {
        rafIdRef.current = window.requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = window.requestAnimationFrame(tick);
  }, [applyFactorsToDom]);

  const setTargets = useCallback(
    (relY: number | null, pivot: number | null, immediate = false) => {
      pivotIndexRef.current = pivot;
      const target = targetFactorsRef.current;
      const pitch = sizeConfigRef.current.slotPitch;
      for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) {
        const resting = restingOffsetsRef.current[i] ?? syntheticOffset(i, pitch);
        target[i] = relY === null ? 0 : dockMagnification(relY - resting, DOCK_INFLUENCE_RADIUS);
      }
      if (immediate || prefersReducedMotion()) {
        stopLoop();
        for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) currentFactorsRef.current[i] = target[i];
        applyFactorsToDom(currentFactorsRef.current, pivot);
        return;
      }
      startLoop();
    },
    [applyFactorsToDom, startLoop, stopLoop],
  );

  useEffect(() => () => stopLoop(), [stopLoop]);

  // Mount the ported React Bits WebGL2 SDF GooeyNav engine on the mode group canvas.
  useLayoutEffect(() => {
    const canvas = gooeyCanvasRef.current;
    if (!canvas) return;
    const palette = GOOEY_PILLS[theme];
    const pillColor = gooey.color || palette.color;
    const engine = createGooeyNavEngine(canvas, gooey, pillColor, palette.hover, palette.shadow);
    gooeyEngineRef.current = engine;
    setGooeyWebGL(engine.hasWebGL);
    const restingOffsets = new Array<number>(TOTAL_DOCK_ITEMS).fill(0);
    const cfg = sizeConfigRef.current;
    engine.syncRects(
      cfg.slotPitch,
      MODE_ORDER.length * cfg.slotPitch,
      computeModeRects(currentFactorsRef.current, restingOffsets),
    );
    engine.go(activeModeIndexRef.current, false);
    return () => {
      engine.dispose();
      gooeyEngineRef.current = null;
    };
  }, [computeModeRects]);

  useEffect(() => {
    const palette = GOOEY_PILLS[theme];
    const pillColor = gooey.color || palette.color;
    gooeyEngineRef.current?.updateSettings(gooey, pillColor, palette.hover, palette.shadow);
  }, [gooey, theme]);

  useEffect(() => {
    applyFactorsToDom(currentFactorsRef.current, pivotIndexRef.current);
  }, [gooey.size, applyFactorsToDom]);

  useEffect(() => {
    gooeyEngineRef.current?.go(activeModeIndex, true);
  }, [activeModeIndex]);

  useEffect(() => {
    const modeHover = hoveredIndex !== null && hoveredIndex < MODE_ORDER.length ? hoveredIndex : -1;
    gooeyEngineRef.current?.setHover(modeHover);
  }, [hoveredIndex]);

  // Reset magnification cleanly when dragging starts.
  useEffect(() => {
    if (!props.dragging) return;
    pointerRelYRef.current = null;
    setDockHovered(false);
    setHoveredIndex(null);
    setTargets(null, null, true);
  }, [props.dragging, setTargets]);

  /**
   * Snapshots resting slot centers ONCE on pointer entry (never during pointermove)
   * so there is zero forced synchronous layout during cursor tracking.
   */
  const captureGeometry = useCallback((): boolean => {
    const notch = notchElRef.current;
    if (!notch) return false;
    const notchRect = notch.getBoundingClientRect();
    const pitch = sizeConfigRef.current.slotPitch;
    if (notchRect.height <= 0) {
      notchCenterYRef.current = null;
      restingOffsetsRef.current = Array.from({ length: TOTAL_DOCK_ITEMS }, (_, i) => syntheticOffset(i, pitch));
      return false;
    }
    const notchCenter = notchRect.top + notchRect.height / 2;
    notchCenterYRef.current = notchCenter;
    const offsets: number[] = [];
    for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) {
      const el = slotElsRef.current[i];
      if (!el) {
        offsets[i] = syntheticOffset(i, pitch);
        continue;
      }
      const rect = el.getBoundingClientRect();
      offsets[i] = rect.height > 0 ? rect.top + rect.height / 2 - notchCenter : syntheticOffset(i, pitch);
    }
    restingOffsetsRef.current = offsets;
    return true;
  }, []);

  /** Computes continuous floating-point pivot index from pointerRelY for silky wave gliding. */
  const resolvePivot = (relY: number): { pivot: number; nearest: number; dist: number } => {
    const offsets = restingOffsetsRef.current;
    const pitch = sizeConfigRef.current.slotPitch;
    let nearest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < TOTAL_DOCK_ITEMS; i++) {
      const dist = Math.abs(relY - (offsets[i] ?? syntheticOffset(i, pitch)));
      if (dist < bestDist) {
        bestDist = dist;
        nearest = i;
      }
    }
    let pivot = nearest;
    const cur = offsets[nearest] ?? syntheticOffset(nearest, pitch);
    if (relY > cur && nearest < TOTAL_DOCK_ITEMS - 1) {
      const next = offsets[nearest + 1] ?? syntheticOffset(nearest + 1, pitch);
      if (next > cur) pivot = nearest + Math.min(1, (relY - cur) / (next - cur));
    } else if (relY < cur && nearest > 0) {
      const prev = offsets[nearest - 1] ?? syntheticOffset(nearest - 1, pitch);
      if (cur > prev) pivot = nearest - Math.min(1, (cur - relY) / (cur - prev));
    }
    return { pivot, nearest, dist: bestDist };
  };

  const handleDockPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (props.dragging) return;
    setDockHovered(true);
    const hasLayout = captureGeometry();
    if (hasLayout && notchCenterYRef.current !== null) {
      const relY = event.clientY - notchCenterYRef.current;
      pointerRelYRef.current = relY;
      const { pivot, nearest, dist } = resolvePivot(relY);
      if (dist < DOCK_INFLUENCE_RADIUS * 0.55) {
        setHoveredIndex((prev) => (prev === nearest ? prev : nearest));
      }
      setTargets(relY, pivot);
    }
  };

  const handleDockPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (props.dragging) return;
    if (notchCenterYRef.current === null) {
      const hasLayout = captureGeometry();
      if (!hasLayout || notchCenterYRef.current === null) return;
    }
    const relY = event.clientY - notchCenterYRef.current;
    pointerRelYRef.current = relY;
    const { pivot, nearest, dist } = resolvePivot(relY);
    if (dist < DOCK_INFLUENCE_RADIUS * 0.55) {
      setHoveredIndex((prev) => (prev === nearest ? prev : nearest));
    } else {
      setHoveredIndex((prev) => (prev === null ? prev : null));
    }
    setTargets(relY, pivot);
  };

  const handleDockPointerLeave = () => {
    pointerRelYRef.current = null;
    notchCenterYRef.current = null;
    setDockHovered(false);
    setHoveredIndex(null);
    const hasLayout = (notchElRef.current?.getBoundingClientRect().height ?? 0) > 0;
    setTargets(null, null, !hasLayout);
  };

  const handleHoverItem = (index: number) => {
    if (props.dragging) return;
    setDockHovered(true);
    setHoveredIndex((prev) => (prev === index ? prev : index));
    if (notchCenterYRef.current === null) {
      const hasLayout = captureGeometry();
      if (!hasLayout) {
        // Synthetic / JSDOM environment without layout boxes: apply wave immediately.
        setTargets(syntheticOffset(index, sizeConfigRef.current.slotPitch), index, true);
      }
    }
  };

  const handleFocusItem = (index: number) => {
    setFocusedIndex(index);
    if (pointerRelYRef.current === null) {
      const hasLayout = captureGeometry();
      const offset = restingOffsetsRef.current[index] ?? syntheticOffset(index, sizeConfigRef.current.slotPitch);
      setTargets(offset, index, !hasLayout);
    }
  };

  const handleBlurItem = (index: number) => {
    setFocusedIndex((current) => (current === index ? null : current));
    if (pointerRelYRef.current === null) {
      const hasLayout = (notchElRef.current?.getBoundingClientRect().height ?? 0) > 0;
      setTargets(null, null, !hasLayout);
    }
  };

  const handleGripPointerEnter = () => {
    if (props.dragging) return;
    pointerRelYRef.current = null;
    setHoveredIndex(null);
    const hasLayout = (notchElRef.current?.getBoundingClientRect().height ?? 0) > 0;
    setTargets(null, null, !hasLayout);
  };

  const activeTooltipIndex = !props.dragging ? (hoveredIndex ?? focusedIndex) : null;

  const sharedDockProps = (index: number) => ({
    index,
    side,
    slotPitch: sizeConfig.slotPitch,
    restScale,
    gooeyCanvasActive: gooey.enabled && gooeyWebGL,
    gooeyHoverActive: gooey.enabled && gooeyWebGL && gooey.hoverEffect,
    activePillColor: effectivePillColor,
    activeIconInk,
    showTooltip: activeTooltipIndex === index,
    registerSlot,
    registerButton,
    onHoverItem: handleHoverItem,
    onFocusItem: handleFocusItem,
    onBlurItem: handleBlurItem,
  });

  return (
    <ToolbarPrimitive
      orientation="vertical"
      aria-label="Feedback controls"
      data-dock-side={side}
      className={cn("pointer-events-none", props.className)}
    >
      {/* Apple-style side notch with 120fps GPU macOS Dock hover magnification */}
      <div
        ref={setNotchRef}
        data-annotate-notch="toolbar"
        data-dock-side={side}
        data-gooey-frame={String(gooey.frame)}
        data-gooey-size={gooey.size}
        data-dock-hovered={dockHovered && !props.dragging ? "true" : undefined}
        style={{
          top: centerY,
          transform: "translateY(-50%)",
          borderRightWidth: isRight ? 0 : 1,
          borderLeftWidth: isRight ? 1 : 0,
        }}
        onPointerEnter={handleDockPointerEnter}
        onPointerMove={handleDockPointerMove}
        onPointerLeave={handleDockPointerLeave}
        className={cn(
          "pointer-events-auto fixed z-30 flex flex-col items-center gap-1 overflow-visible border-y border-solid px-2.5 py-5",
          gooey.frame
            ? "bg-[var(--annotate-notch-bg)] text-popover-foreground border-[var(--annotate-notch-border)] shadow-[var(--annotate-notch-shadow)]"
            : "bg-transparent text-popover-foreground border-transparent shadow-none",
          isRight ? "right-0 rounded-l-[18px]" : "left-0 rounded-r-[18px]",
        )}
      >
        {gooey.frame && (
          <>
            <NotchFillet side={side} position="top" />
            <NotchFillet side={side} position="bottom" />
          </>
        )}

        {props.dragHandlers && (
          <button
            ref={gripElRef}
            type="button"
            aria-label="Move toolbar"
            title="Drag vertically to reposition · Drag across screen to switch side"
            data-annotate-toolbar-grip=""
            className={cn(
              "mb-1 flex h-6 w-full shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground/55 transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              props.dragging ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing",
            )}
            onPointerEnter={(event) => {
              event.stopPropagation();
              handleGripPointerEnter();
            }}
            onPointerDown={props.dragHandlers.onPointerDown}
            onPointerMove={(event) => {
              if (!props.dragging) event.stopPropagation();
              props.dragHandlers?.onPointerMove(event);
            }}
            onPointerUp={props.dragHandlers.onPointerUp}
            onPointerCancel={props.dragHandlers.onPointerCancel}
          >
            <GripHorizontal aria-hidden className="size-3.5" />
          </button>
        )}

        {/* Mode selection group with ported React Bits WebGL2 GooeyNav */}
        <div
          role="group"
          aria-label="Tool modes"
          data-gooey-nav=""
          data-gooey-enabled={String(gooey.enabled)}
          data-gooey-active={mode}
          className="relative isolate flex flex-col items-center"
        >
          <canvas
            ref={gooeyCanvasRef}
            aria-hidden
            data-gooey-canvas=""
            className="pointer-events-none absolute top-0 left-0 z-0"
          />
          <NotchDockButton
            {...sharedDockProps(0)}
            tone="mode"
            label="Annotate"
            pressed={mode === "annotate"}
            onClick={() => props.onSelectMode?.("annotate")}
          >
            <MousePointerClick />
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(1)}
            tone="mode"
            label="Spacing inspector"
            shortcut="M"
            pressed={mode === "spacing"}
            onClick={() => props.onSelectMode?.(mode === "spacing" ? "annotate" : "spacing")}
          >
            <RulerDimensionLine />
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(2)}
            tone="mode"
            label="Type inspector"
            shortcut="T"
            pressed={mode === "type"}
            onClick={() => props.onSelectMode?.(mode === "type" ? "annotate" : "type")}
          >
            <Type />
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(3)}
            tone="mode"
            label="Color inspector"
            shortcut="K"
            pressed={mode === "color"}
            onClick={() => props.onSelectMode?.(mode === "color" ? "annotate" : "color")}
          >
            <Pipette />
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(4)}
            tone="mode"
            label="Layout"
            shortcut="L"
            pressed={mode === "layout"}
            onClick={() => props.onSelectMode?.(mode === "layout" ? "annotate" : "layout")}
          >
            <LayoutGrid />
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(5)}
            tone="mode"
            label="Rearrange"
            shortcut="R"
            pressed={mode === "rearrange"}
            onClick={() => props.onSelectMode?.(mode === "rearrange" ? "annotate" : "rearrange")}
          >
            <Move />
          </NotchDockButton>
        </div>

        <div ref={divider1ElRef} className="flex w-full justify-center py-0.5">
          <ToolbarDivider orientation="horizontal" />
        </div>

        {/* Canvas & output actions */}
        <div className="flex flex-col items-center">
          <NotchDockButton
            {...sharedDockProps(6)}
            tone="warning"
            label={props.frozen ? "Unfreeze" : "Freeze"}
            shortcut="P"
            pressed={props.frozen}
            onClick={props.onToggleFreeze}
          >
            {props.frozen ? <Play /> : <Pause />}
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(7)}
            label={props.markersHidden ? "Show overlays" : "Hide overlays"}
            shortcut="H"
            pressed={props.markersHidden}
            onClick={props.onToggleMarkers}
          >
            {props.markersHidden ? <EyeOff /> : <Eye />}
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(8)}
            tone={props.copied ? "success" : "action"}
            label="Copy"
            shortcut="C"
            badge={totalCount}
            disabled={nothing}
            onClick={props.onCopy}
          >
            {props.copied ? <Check /> : <Copy />}
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(9)}
            label="Send Annotations"
            tooltip={!props.sendAvailable ? "Send Annotations · Set webhook or MCP" : undefined}
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
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(10)}
            tone="destructive"
            label="Clear all"
            shortcut="X"
            disabled={nothing}
            onClick={props.onClear}
          >
            <Trash2 />
          </NotchDockButton>
        </div>

        <div ref={divider2ElRef} className="flex w-full justify-center py-0.5">
          <ToolbarDivider orientation="horizontal" />
        </div>
        <div className="flex flex-col items-center">
          <NotchDockButton
            {...sharedDockProps(11)}
            label={isRight ? "Move notch to left side" : "Move notch to right side"}
            onClick={props.onToggleDockSide}
          >
            {isRight ? <PanelLeft /> : <PanelRight />}
          </NotchDockButton>
          <NotchDockButton
            {...sharedDockProps(12)}
            label="Settings"
            pressed={props.settingsOpen}
            onClick={props.onToggleSettings}
          >
            <Settings />
          </NotchDockButton>
          <NotchDockButton {...sharedDockProps(13)} label="Exit" shortcut="Esc" onClick={props.onExit}>
            <X />
          </NotchDockButton>
        </div>
      </div>

      {/* Contextual secondary tray: floats cleanly at the bottom edge aligned with the notch side. */}
      <div
        data-annotate-toolbar-tray={showTray ? "" : undefined}
        className={cn(
          showTray
            ? cn(
                "annotate-enter pointer-events-auto fixed bottom-4 z-30 flex max-w-[calc(100vw-88px)] flex-wrap items-center gap-1.5 rounded-xl px-2 py-1 text-xs",
                SURFACE_CLASS,
                isRight
                  ? "right-[var(--annotate-inset-right,64px)]"
                  : "left-[var(--annotate-inset-left,64px)]",
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
                  <span
                    aria-label={`${props.annotationCount} annotations`}
                    title="Annotations"
                    className="inline-flex h-4 min-w-4 items-center gap-1 px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground select-none [&_svg]:size-3 [&_svg]:text-muted-foreground"
                  >
                    <MessageSquare aria-hidden />
                    {props.annotationCount}
                  </span>
                )}
                {(props.styleChangeCount ?? 0) > 0 && (
                  <span
                    data-style-change-count={props.styleChangeCount}
                    aria-label={`${props.styleChangeCount} style changes`}
                    title="Style changes and measurements"
                    className="inline-flex h-4 items-center gap-1 px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground select-none [&_svg]:size-3 [&_svg]:text-muted-foreground"
                  >
                    <Pipette aria-hidden />
                    {props.styleChangeCount}
                  </span>
                )}
                {(props.rearrangeCount ?? 0) > 0 && (
                  <span
                    data-rearrange-count={props.rearrangeCount}
                    aria-label={`${props.rearrangeCount} rearrangements`}
                    title="Rearrangements"
                    className="inline-flex h-4 items-center gap-1 px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground select-none [&_svg]:size-3 [&_svg]:text-muted-foreground"
                  >
                    <Move aria-hidden />
                    {props.rearrangeCount}
                  </span>
                )}
                {(props.placementCount ?? 0) > 0 && (
                  <span
                    data-placement-count={props.placementCount}
                    aria-label={`${props.placementCount} layout placements`}
                    title="Layout placements"
                    className="inline-flex h-4 items-center gap-1 px-1 font-mono text-[11px] font-semibold tabular-nums text-foreground select-none [&_svg]:size-3 [&_svg]:text-muted-foreground"
                  >
                    <LayoutGrid aria-hidden />
                    {props.placementCount}
                  </span>
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
    </ToolbarPrimitive>
  );
}
