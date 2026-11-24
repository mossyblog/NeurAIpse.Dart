import { useState } from "react";
import { Badge, Button } from "./primitives.tsx";
import { Copy, Crosshair, EyeOff, Move, RotateCcw, Undo2 } from "lucide-react";
import { REARRANGE_NOT_FOUND, rearrangeSummary } from "../core/rearrange-output.ts";
import type { Annotation } from "../core/types.ts";
import { FloatingPanel, KbdHint, SectionLabel } from "./chrome.tsx";

export type RearrangeRow = {
  id: string;
  label: string;
  summary?: string;
  annotation: Annotation;
  /** False when the stored selector no longer matches exactly one element. */
  found: boolean;
  removed: boolean;
};

export type RearrangePanelProps = {
  selectedName: string;
  selectedCount: number;
  rows: RearrangeRow[];
  onReset: (id: string) => void;
  onToggleRemoved: (id: string) => void;
  onSelect: (id: string) => void;
  onCopy: () => void;
};

/**
 * Rearrange side panel (spec 10.2): built on FloatingPanel (fixed, 320px, collapsible).
 * Leads with the Rearrangements list (Select, Remove/Restore, Reset) and places the
 * gesture shortcut reference cleanly below it, with a sticky Copy footer.
 */
export function RearrangePanel(props: RearrangePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const footer = (
    <Button variant="outline" size="sm" className="w-full" data-annotate-panel-copy disabled={props.rows.length === 0} onClick={props.onCopy}>
      <Copy />
      Copy
    </Button>
  );

  return (
    <FloatingPanel
      side="right"
      width="md"
      label="Rearrange"
      icon={<Move className="size-3.5" />}
      modeLabel="Rearrange"
      title={props.selectedName || "Rearrange"}
      subtitle={props.selectedCount ? "Drag to move · handles resize" : "Click an element · drag a box to select"}
      titleDataAttr="data-annotate-panel-element"
      count={props.rows.length > 0 ? props.rows.length : undefined}
      collapsible
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      footer={footer}
      dataAttrs={{
        "data-annotate-panel": "rearrange",
        "data-annotate-rearrange-panel": "",
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Rearrangements ({props.rows.length})</SectionLabel>
          {props.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
              No rearrangements yet.
            </div>
          ) : (
            <ol className="flex flex-col gap-1.5" data-annotate-rearrange-list>
              {props.rows.map((row, index) => (
                <li
                  key={row.id}
                  data-annotate-rearrange-item={row.id}
                  data-found={row.found}
                  className="flex items-start justify-between gap-2 rounded-lg bg-muted/45 p-2 text-xs ring-1 ring-foreground/[0.06] dark:ring-white/[0.07]"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground" title={row.annotation.rearrange?.selector}>
                        <span className="font-mono text-muted-foreground tabular-nums">{index + 1}.</span> {row.label}
                      </span>
                      {row.removed && (
                        <Badge variant="destructive" className="h-4 shrink-0 rounded px-1 text-[10px] leading-none">
                          Removed
                        </Badge>
                      )}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums" data-annotate-rearrange-summary>
                      {row.summary ?? rearrangeSummary(row.annotation)}
                    </span>
                    {!row.found && (
                      <span data-annotate-rearrange-missing className="text-[11px] text-destructive">
                        {REARRANGE_NOT_FOUND}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon-xs" aria-label={`Select ${row.label}`} title={`Select ${row.label}`} disabled={!row.found} onClick={() => props.onSelect(row.id)}>
                      <Crosshair />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={row.removed ? `Restore ${row.label}` : `Remove ${row.label}`}
                      title={row.removed ? `Restore ${row.label}` : `Remove ${row.label}`}
                      disabled={!row.found}
                      onClick={() => props.onToggleRemoved(row.id)}
                    >
                      {row.removed ? <Undo2 /> : <EyeOff />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Reset ${row.label}`}
                      title={`Reset ${row.label}`}
                      className="hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => props.onReset(row.id)}
                    >
                      <RotateCcw />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
          <SectionLabel>Shortcuts</SectionLabel>
          <dl
            className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 rounded-lg bg-muted/30 p-2 text-[11px] text-muted-foreground ring-1 ring-foreground/[0.05] dark:ring-white/[0.06]"
            data-annotate-rearrange-keys
          >
            <dt>
              <KbdHint>Shift / ⌘ click</KbdHint>
            </dt>
            <dd>add to selection</dd>
            <dt>
              <KbdHint>Arrows</KbdHint>
            </dt>
            <dd>nudge 8px (Shift 1px)</dd>
            <dt>
              <KbdHint>Shift drag</KbdHint>
            </dt>
            <dd>one axis · corner keeps ratio</dd>
            <dt>
              <KbdHint>Alt drag</KbdHint>
            </dt>
            <dd>no snapping</dd>
            <dt>
              <KbdHint>Delete</KbdHint>
            </dt>
            <dd>remove from layout</dd>
            <dt>
              <KbdHint>Esc</KbdHint>
            </dt>
            <dd>cancel drag · deselect · exit</dd>
          </dl>
        </div>
      </div>
    </FloatingPanel>
  );
}
