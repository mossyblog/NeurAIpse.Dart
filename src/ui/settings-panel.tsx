import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./primitives.tsx";
import { Input } from "@ui-sdk/react/input";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Moon, RotateCcw, Sparkles, Sun, X } from "lucide-react";
import {
  DEFAULT_GOOEY_NAV_SETTINGS,
  GOOEY_NAV_BOUNDS,
  MARKER_COLOR_IDS,
  OUTPUT_DETAILS,
  OUTPUT_DETAIL_LABELS,
  applyGooeyNavPreset,
  isGooeyNavModified,
  nextOutputDetail,
  nextTheme,
  outputDetailLevel,
  webhookUrlError,
} from "../core/settings.ts";
import type { SyncStatus } from "../core/sync.ts";
import type {
  DockSide,
  GooeyNavPreset,
  GooeyNavSettings,
  GooeyNavSize,
  OutputDetail,
  Settings,
  Theme,
} from "../core/types.ts";
import { FIELD_CLASS, SURFACE_CLASS, SectionLabel, SegmentedControl } from "./chrome.tsx";
import { MARKER_COLOR_NAMES, markerColor } from "./colors.ts";
import { ScrubberColorPicker, ScrubberSelect, ScrubberSlider, ScrubberSwitch } from "./gooey-controls.tsx";
import { Switch } from "./switch.tsx";

export type SettingsPanelProps = {
  settings: Settings;
  theme: Theme;
  /** Active dock side, used to anchor the Notch settings sheet. */
  dockSide?: DockSide;
  /** Endpoint prop, shown read-only in the MCP section. */
  endpoint?: string;
  syncStatus?: SyncStatus;
  sessionId?: string;
  /** `webhookUrl` prop, used when the setting is empty. */
  webhookUrlProp?: string;
  onChange: (settings: Settings) => void;
  onThemeChange: (theme: Theme) => void;
  onClose?: () => void;
  setEscape?: (handler: (() => boolean) | null) => void;
};

const DETAIL_TIP = "Controls how much detail is included in the copied output";
const CLEAR_TIP = "Automatically clear annotations after copying";

const PRESET_LABELS: Record<GooeyNavPreset, string> = {
  classic: "Classic",
  accent: "Accent",
  splash: "Splash",
  calm: "Calm",
  custom: "Custom",
};

const PRESET_OPTIONS: readonly { value: Exclude<GooeyNavPreset, "custom">; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "accent", label: "Accent" },
  { value: "splash", label: "Splash" },
  { value: "calm", label: "Calm" },
];

const SIZE_OPTIONS: readonly { value: GooeyNavSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

const OUTPUT_DETAIL_DESCRIPTIONS: Record<OutputDetail, string> = {
  compact: "Element, selector & comment only",
  standard: "Adds location, classes & React tree",
  detailed: "Adds nearby context, box & styles",
  forensic: "Full DOM path, computed styles & env",
};

const SYNC_LABELS: Record<SyncStatus, string> = {
  idle: "Not started",
  connecting: "Connecting…",
  connected: "MCP Connected",
  offline: "Offline, retrying",
};

function integrationDotClass(endpoint?: string, syncStatus?: SyncStatus, hasWebhook?: boolean): string {
  if (endpoint) {
    if (syncStatus === "connected") return "bg-[var(--annotate-marker-green)]";
    if (syncStatus === "connecting") return "bg-[var(--annotate-marker-amber)]";
    if (syncStatus === "offline") return "bg-[var(--annotate-marker-red)]";
    return "bg-muted-foreground/40";
  }
  return hasWebhook ? "bg-[var(--annotate-marker-blue)]" : "bg-muted-foreground/40";
}

function Row({
  label,
  labelId,
  title,
  children,
}: {
  label: string;
  labelId: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span id={labelId} className="text-xs font-medium text-foreground" title={title}>
        {label}
      </span>
      {children}
    </div>
  );
}

function DetailDots({ level }: { level: number }) {
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {OUTPUT_DETAILS.map((detail, index) => (
        <span
          key={detail}
          data-filled={index < level}
          className={cn(
            "h-1.5 w-2.5 rounded-full transition-colors",
            index < level ? "bg-foreground" : "bg-foreground/15",
          )}
        />
      ))}
    </span>
  );
}

function MainView({
  settings,
  theme,
  endpoint,
  syncStatus,
  webhookUrlProp,
  onChange,
  onThemeChange,
  onClose,
  onManage,
  onOpenNotchSheet,
}: SettingsPanelProps & {
  onManage: () => void;
  onOpenNotchSheet: () => void;
}) {
  const id = useId();
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const level = outputDetailLevel(settings.outputDetail);
  const activeColorName = MARKER_COLOR_NAMES[settings.annotationColorId] ?? "Blue";
  const hasWebhook = Boolean(
    settings.webhooksEnabled && (settings.webhookUrl.trim() || webhookUrlProp?.trim()),
  );

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xs font-semibold tracking-tight text-foreground">Settings</span>
          <span className="truncate text-[11px] text-muted-foreground">Feedback preferences</span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close settings"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="annotate-scroll flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-y-auto">
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <SectionLabel>Output</SectionLabel>
          <div className="flex flex-col gap-1">
            <Row label="Output Detail" labelId={`${id}-detail`} title={DETAIL_TIP}>
              <Button
                variant="outline"
                size="xs"
                className="h-7 gap-1.5 px-2 text-xs font-medium"
                aria-labelledby={`${id}-detail`}
                aria-description={OUTPUT_DETAIL_LABELS[settings.outputDetail]}
                title={DETAIL_TIP}
                data-output-detail={settings.outputDetail}
                onClick={() => set({ outputDetail: nextOutputDetail(settings.outputDetail) })}
              >
                <DetailDots level={level} />
                <span>{OUTPUT_DETAIL_LABELS[settings.outputDetail]}</span>
                <ChevronsUpDown aria-hidden className="size-3 text-muted-foreground" />
              </Button>
            </Row>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {OUTPUT_DETAIL_DESCRIPTIONS[settings.outputDetail]}
            </p>
          </div>
          <Row label="React Components" labelId={`${id}-react`}>
            <Switch
              aria-labelledby={`${id}-react`}
              checked={settings.reactEnabled}
              onCheckedChange={(reactEnabled) => set({ reactEnabled })}
            />
          </Row>
        </div>

        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <SectionLabel>Appearance</SectionLabel>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span id={`${id}-color`} className="text-xs font-medium text-foreground">
                Marker Color
              </span>
              <span className="text-[11px] text-muted-foreground">{activeColorName}</span>
            </div>
            <RadioGroup
              aria-labelledby={`${id}-color`}
              className="grid grid-cols-9 place-items-center gap-1.5 py-0.5"
              value={settings.annotationColorId}
              onValueChange={(annotationColorId) => {
                if (annotationColorId !== null) set({ annotationColorId });
              }}
            >
              {MARKER_COLOR_IDS.map((colorId) => {
                const selected = settings.annotationColorId === colorId;
                return (
                  <Radio
                    key={colorId}
                    value={colorId}
                    aria-label={MARKER_COLOR_NAMES[colorId]}
                    title={MARKER_COLOR_NAMES[colorId]}
                    data-color-id={colorId}
                    className={cn(
                      "size-5 cursor-pointer rounded-full transition-transform duration-150 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                      selected
                        ? "scale-105 ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                        : "ring-1 ring-foreground/15",
                    )}
                    style={{ backgroundColor: markerColor(colorId) }}
                  />
                );
              })}
            </RadioGroup>
          </div>
          <Row label="Theme" labelId={`${id}-theme`}>
            <Button
              variant="outline"
              size="xs"
              className="h-7 gap-1.5 px-2.5 text-xs font-medium"
              aria-labelledby={`${id}-theme`}
              data-theme-value={theme}
              onClick={() => onThemeChange(nextTheme(theme))}
            >
              {theme === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              {theme === "dark" ? "Dark" : "Light"}
            </Button>
          </Row>
          <Row label="Notch side" labelId={`${id}-dock-side`}>
            <SegmentedControl>
              <RadioGroup
                aria-labelledby={`${id}-dock-side`}
                className="flex items-center gap-0.5"
                value={settings.dockSide}
                onValueChange={(dockSide) => {
                  if (dockSide === "left" || dockSide === "right") set({ dockSide });
                }}
              >
                {(["left", "right"] as const).map((side) => {
                  const active = settings.dockSide === side;
                  return (
                    <Radio
                      key={side}
                      value={side}
                      data-dock-side-option={side}
                      className={cn(
                        "inline-flex h-6 cursor-pointer items-center justify-center rounded-[5px] px-2.5 text-xs font-medium transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        active
                          ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/10 dark:bg-foreground/15"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {side === "left" ? "Left" : "Right"}
                    </Radio>
                  );
                })}
              </RadioGroup>
            </SegmentedControl>
          </Row>
          <Row label="Gooey selection" labelId={`${id}-gooey-sheet`}>
            <Button
              variant="outline"
              size="xs"
              className="h-7 gap-1.5 px-2 text-xs font-medium"
              aria-labelledby={`${id}-gooey-sheet`}
              data-open-notch-sheet=""
              onClick={onOpenNotchSheet}
            >
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span>
                {settings.gooeyNav.enabled ? PRESET_LABELS[settings.gooeyNav.preset] : "Off"}
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </Button>
          </Row>
        </div>

        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <SectionLabel>Behavior</SectionLabel>
          <Row label="Clear on copy/send" labelId={`${id}-clear`} title={CLEAR_TIP}>
            <Switch
              aria-labelledby={`${id}-clear`}
              title={CLEAR_TIP}
              checked={settings.autoClearAfterCopy}
              onCheckedChange={(autoClearAfterCopy) => set({ autoClearAfterCopy })}
            />
          </Row>
          <Row label="Block page interactions" labelId={`${id}-block`}>
            <Switch
              aria-labelledby={`${id}-block`}
              checked={settings.blockInteractions}
              onCheckedChange={(blockInteractions) => set({ blockInteractions })}
            />
          </Row>
          <Row label="Marker click" labelId={`${id}-marker`}>
            <SegmentedControl>
              <RadioGroup
                aria-labelledby={`${id}-marker`}
                className="flex items-center gap-0.5"
                value={settings.markerClickBehavior}
                onValueChange={(markerClickBehavior) => {
                  if (markerClickBehavior !== null) set({ markerClickBehavior });
                }}
              >
                {(["edit", "delete"] as const).map((behavior) => {
                  const active = settings.markerClickBehavior === behavior;
                  return (
                    <Radio
                      key={behavior}
                      value={behavior}
                      className={cn(
                        "inline-flex h-6 cursor-pointer items-center justify-center rounded-[5px] px-2.5 text-xs font-medium transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        active
                          ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/10 dark:bg-foreground/15"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {behavior === "edit" ? "Edit" : "Delete"}
                    </Radio>
                  );
                })}
              </RadioGroup>
            </SegmentedControl>
          </Row>
        </div>
      </div>

      <div className="border-t border-border/70 bg-muted/25 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2 text-xs font-medium text-foreground"
          onClick={onManage}
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                integrationDotClass(endpoint, syncStatus, hasWebhook),
              )}
            />
            <span>Manage MCP &amp; Webhooks</span>
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </>
  );
}

function WebhooksView({
  settings,
  endpoint,
  syncStatus,
  sessionId,
  webhookUrlProp,
  onChange,
  onBack,
  onClose,
}: SettingsPanelProps & { onBack: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState(settings.webhookUrl);
  const error = webhookUrlError(draft);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ChevronLeft className="size-3.5" />
            Back
          </Button>
          <span aria-hidden className="text-xs text-muted-foreground/50">
            ·
          </span>
          <span className="truncate text-xs font-semibold tracking-tight text-foreground">
            MCP &amp; Webhooks
          </span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close settings"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="annotate-scroll flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <SectionLabel>MCP</SectionLabel>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
            <span className="text-xs break-all text-muted-foreground" data-mcp-status>
              {endpoint ? `Endpoint: ${endpoint}` : "No endpoint set. Pass the endpoint prop to sync."}
            </span>
            {endpoint && (
              <span
                className="flex items-center gap-1.5 text-xs font-medium text-foreground"
                data-sync-status={syncStatus ?? "idle"}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    integrationDotClass(endpoint, syncStatus),
                  )}
                />
                <span className="truncate">
                  {SYNC_LABELS[syncStatus ?? "idle"]}
                  {sessionId ? ` · Session ${sessionId}` : ""}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <SectionLabel>Webhooks</SectionLabel>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-url`} className="text-xs font-medium text-foreground">
              Webhook URL
            </label>
            <Input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              placeholder={webhookUrlProp || "https://example.com/hook"}
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value);
                set({ webhookUrl: value.trim() });
              }}
              className={cn(FIELD_CLASS, "h-8 w-full px-2.5 text-xs")}
            />
            {error && (
              <span id={`${id}-error`} role="alert" className="text-[11px] font-medium text-destructive">
                {error}
              </span>
            )}
          </div>
          <Row label="Send to webhook" labelId={`${id}-enabled`}>
            <Switch
              aria-labelledby={`${id}-enabled`}
              checked={settings.webhooksEnabled}
              onCheckedChange={(webhooksEnabled) => set({ webhooksEnabled })}
            />
          </Row>
        </div>
      </div>
    </>
  );
}

function NotchSettingsSheet({
  settings,
  theme,
  onChange,
  onBack,
  onClose,
  onRegisterEscape,
}: {
  settings: Settings;
  theme: Theme;
  onChange: (settings: Settings) => void;
  onBack: () => void;
  onClose?: () => void;
  onRegisterEscape?: (handler: (() => boolean) | null) => void;
}) {
  const gooey = settings.gooeyNav;
  const setGooey = (patch: Partial<GooeyNavSettings>) =>
    onChange({ ...settings, gooeyNav: { ...gooey, ...patch } });
  const setFeel = (patch: Partial<GooeyNavSettings>) =>
    setGooey({ ...patch, preset: "custom" });
  const modified = isGooeyNavModified(gooey);
  const defaultPill = theme === "light" ? "#27272a" : "#f4f4f5";

  return (
    <div
      role="dialog"
      aria-label="Notch settings"
      data-annotate-notch-sheet=""
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ChevronLeft className="size-3.5" />
            Settings
          </Button>
          <span aria-hidden className="text-xs text-muted-foreground/50">
            ·
          </span>
          <span className="text-xs font-semibold tracking-tight text-foreground">Customize</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={!modified}
            className={cn(
              "h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground",
              !modified && "opacity-40",
            )}
            title="Reset Gooey Nav defaults"
            data-gooey-reset=""
            onClick={() =>
              onChange({
                ...settings,
                gooeyNav: { ...DEFAULT_GOOEY_NAV_SETTINGS, colors: [] },
              })
            }
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close settings"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={onClose ?? onBack}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="annotate-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <div className="rounded-xl border border-border/60 bg-[var(--annotate-customize-well-bg)] p-2">
          <div className="annotate-customize-grid">
            <ScrubberSelect
              title="Preset"
              options={PRESET_OPTIONS}
              value={gooey.preset}
              displayLabel={gooey.preset === "custom" ? PRESET_LABELS.custom : undefined}
              disabled={!gooey.enabled}
              controlKey="preset"
              onRegisterEscape={onRegisterEscape}
              onChange={(preset) =>
                onChange({ ...settings, gooeyNav: applyGooeyNavPreset(gooey, preset) })
              }
            />
            <ScrubberColorPicker
              title="Pill Color"
              color={gooey.color || defaultPill}
              disabled={!gooey.enabled}
              controlKey="color"
              onRegisterEscape={onRegisterEscape}
              onChange={(color) => setFeel({ color, colors: [] })}
            />
            <ScrubberSelect
              title="Size"
              options={SIZE_OPTIONS}
              value={gooey.size}
              controlKey="size"
              onRegisterEscape={onRegisterEscape}
              onChange={(size) => setGooey({ size })}
            />
            <ScrubberSlider
              title="Particle Count"
              min={GOOEY_NAV_BOUNDS.particleCount.min}
              max={GOOEY_NAV_BOUNDS.particleCount.max}
              step={GOOEY_NAV_BOUNDS.particleCount.step}
              value={gooey.particleCount}
              disabled={!gooey.enabled}
              controlKey="particleCount"
              onChange={(particleCount) => setFeel({ particleCount })}
            />
            <ScrubberSlider
              title="Spread"
              min={GOOEY_NAV_BOUNDS.spread.min}
              max={GOOEY_NAV_BOUNDS.spread.max}
              step={GOOEY_NAV_BOUNDS.spread.step}
              value={gooey.spread}
              valueUnit="px"
              disabled={!gooey.enabled}
              controlKey="spread"
              onChange={(spread) => setFeel({ spread })}
            />
            <ScrubberSlider
              title="Animation Time"
              min={GOOEY_NAV_BOUNDS.animationTime.min}
              max={GOOEY_NAV_BOUNDS.animationTime.max}
              step={GOOEY_NAV_BOUNDS.animationTime.step}
              value={gooey.animationTime}
              valueUnit="ms"
              disabled={!gooey.enabled}
              controlKey="animationTime"
              onChange={(animationTime) => setFeel({ animationTime })}
            />
            <ScrubberSlider
              title="Time Variance"
              min={GOOEY_NAV_BOUNDS.timeVariance.min}
              max={GOOEY_NAV_BOUNDS.timeVariance.max}
              step={GOOEY_NAV_BOUNDS.timeVariance.step}
              value={gooey.timeVariance}
              valueUnit="ms"
              disabled={!gooey.enabled}
              controlKey="timeVariance"
              onChange={(timeVariance) => setFeel({ timeVariance })}
            />
            <ScrubberSlider
              title="Gooeyness"
              min={GOOEY_NAV_BOUNDS.gooeyness.min}
              max={GOOEY_NAV_BOUNDS.gooeyness.max}
              step={GOOEY_NAV_BOUNDS.gooeyness.step}
              value={gooey.gooeyness}
              disabled={!gooey.enabled}
              controlKey="gooeyness"
              onChange={(gooeyness) => setFeel({ gooeyness })}
            />
            <ScrubberSlider
              title="Wobble"
              min={GOOEY_NAV_BOUNDS.wobble.min}
              max={GOOEY_NAV_BOUNDS.wobble.max}
              step={GOOEY_NAV_BOUNDS.wobble.step}
              value={gooey.wobble}
              disabled={!gooey.enabled}
              controlKey="wobble"
              onChange={(wobble) => setFeel({ wobble })}
            />
            <ScrubberSwitch
              title="Frame"
              checked={gooey.frame}
              controlKey="frame"
              onChange={(frame) => setGooey({ frame })}
            />
            <ScrubberSwitch
              title="Hover Effect"
              checked={gooey.hoverEffect}
              disabled={!gooey.enabled}
              controlKey="hoverEffect"
              onChange={(hoverEffect) => setGooey({ hoverEffect })}
            />
            <ScrubberSwitch
              title="Gooey Effect"
              checked={gooey.enabled}
              controlKey="enabled"
              onChange={(enabled) => setGooey({ enabled })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Feedback settings (spec section 4). Every change is persisted by the caller. */
export function SettingsPanel(props: SettingsPanelProps) {
  const [view, setView] = useState<"main" | "webhooks">("main");
  const [notchSheetOpen, setNotchSheetOpen] = useState(false);
  const controlEscapeRef = useRef<(() => boolean) | null>(null);
  const stateRef = useRef({ view, notchSheetOpen });
  stateRef.current = { view, notchSheetOpen };

  const registerControlEscape = useCallback((handler: (() => boolean) | null) => {
    controlEscapeRef.current = handler;
  }, []);

  const { setEscape } = props;
  useEffect(() => {
    const handleEscape = (): boolean => {
      if (controlEscapeRef.current?.()) return true;
      if (stateRef.current.notchSheetOpen) {
        setNotchSheetOpen(false);
        return true;
      }
      if (stateRef.current.view === "webhooks") {
        setView("main");
        return true;
      }
      return false;
    };
    if (setEscape) {
      setEscape(handleEscape);
      return () => setEscape(null);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && handleEscape()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setEscape]);

  return (
    <section
      role="region"
      aria-label="Feedback settings"
      className={cn(
        "annotate-enter flex max-h-[calc(100vh-32px)] flex-col overflow-hidden text-sm",
        notchSheetOpen ? "w-[min(740px,calc(100vw-88px))]" : "w-80",
        SURFACE_CLASS,
      )}
    >
      {notchSheetOpen ? (
        <NotchSettingsSheet
          settings={props.settings}
          theme={props.theme}
          onChange={props.onChange}
          onBack={() => setNotchSheetOpen(false)}
          onClose={props.onClose}
          onRegisterEscape={registerControlEscape}
        />
      ) : view === "main" ? (
        <MainView
          {...props}
          onManage={() => setView("webhooks")}
          onOpenNotchSheet={() => setNotchSheetOpen(true)}
        />
      ) : (
        <WebhooksView {...props} onBack={() => setView("main")} />
      )}
    </section>
  );
}
