import { useId, useState, type ReactNode } from "react";
import { Button } from "./primitives.tsx";
import { Input } from "@ui-sdk/react/input";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import {
  MARKER_COLOR_IDS,
  OUTPUT_DETAILS,
  OUTPUT_DETAIL_LABELS,
  nextOutputDetail,
  nextTheme,
  outputDetailLevel,
  webhookUrlError,
} from "../core/settings.ts";
import type { SyncStatus } from "../core/sync.ts";
import type { OutputDetail, Settings, Theme } from "../core/types.ts";
import { FIELD_CLASS, SURFACE_CLASS, SectionLabel, SegmentedControl } from "./chrome.tsx";
import { MARKER_COLOR_NAMES, markerColor } from "./colors.ts";
import { Switch } from "./switch.tsx";

export type SettingsPanelProps = {
  settings: Settings;
  theme: Theme;
  /** Endpoint prop, shown read-only in the MCP section. */
  endpoint?: string;
  syncStatus?: SyncStatus;
  sessionId?: string;
  /** `webhookUrl` prop, used when the setting is empty. */
  webhookUrlProp?: string;
  onChange: (settings: Settings) => void;
  onThemeChange: (theme: Theme) => void;
};

const DETAIL_TIP = "Controls how much detail is included in the copied output";
const CLEAR_TIP = "Automatically clear annotations after copying";

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
  onManage,
}: SettingsPanelProps & {
  onManage: () => void;
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
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="text-xs font-semibold tracking-tight text-foreground">Settings</span>
        <span className="text-[11px] text-muted-foreground">Feedback preferences</span>
      </div>

      <div className="annotate-scroll flex flex-col divide-y divide-border/60 overflow-y-auto">
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <SectionLabel>Output</SectionLabel>
          <div className="flex flex-col gap-1">
            <Row label="Output Detail" labelId={`${id}-detail`} title={DETAIL_TIP}>
              <Button
                variant="outline"
                size="xs"
                className="h-7 gap-2 px-2 text-xs font-medium"
                aria-labelledby={`${id}-detail`}
                aria-description={OUTPUT_DETAIL_LABELS[settings.outputDetail]}
                title={DETAIL_TIP}
                data-output-detail={settings.outputDetail}
                onClick={() => set({ outputDetail: nextOutputDetail(settings.outputDetail) })}
              >
                <DetailDots level={level} />
                <span>{OUTPUT_DETAIL_LABELS[settings.outputDetail]}</span>
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
                      "size-5 cursor-pointer rounded-full transition-transform duration-150 outline-none hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
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
}: SettingsPanelProps & { onBack: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState(settings.webhookUrl);
  const error = webhookUrlError(draft);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border/70 px-2 py-2">
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

      <div className="annotate-scroll flex flex-col divide-y divide-border/60 overflow-y-auto">
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

/** Feedback settings (spec section 4). Every change is persisted by the caller. */
export function SettingsPanel(props: SettingsPanelProps) {
  const [view, setView] = useState<"main" | "webhooks">("main");
  return (
    <section
      role="region"
      aria-label="Feedback settings"
      className={cn(
        "annotate-enter flex max-h-[calc(100vh-116px)] w-80 flex-col overflow-hidden text-sm",
        SURFACE_CLASS,
      )}
    >
      {view === "main" ? (
        <MainView {...props} onManage={() => setView("webhooks")} />
      ) : (
        <WebhooksView {...props} onBack={() => setView("main")} />
      )}
    </section>
  );
}
