import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Move } from "lucide-react";
import type { MeasureLine } from "../core/measure.ts";
import { REARRANGE_HANDLES, type RearrangeHandle, type SnapGuide } from "../core/rearrange-geometry.ts";
import type { Rect } from "../core/types.ts";

/** One element box in viewport px: selected boxes get handles and a grip. */
export type OverlayBox = {
  key: string;
  element: Element;
  rect: Rect;
  /** Where the element was before the rearrangement (dashed). */
  ghost?: Rect;
  selected: boolean;
  removed: boolean;
  name: string;
};

/** Visible handle square and its 24px hit area (8px grid). */
const HANDLE = 8;
const HIT = 24;
const GUIDE = "var(--annotate-marker-pink, #e0379a)";

const CURSORS: Record<RearrangeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function handlePoint(rect: Rect, handle: RearrangeHandle): { x: number; y: number } {
  const x = handle.includes("w") ? rect.x : handle.includes("e") ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = handle.includes("n") ? rect.y : handle.includes("s") ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

const box = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

export type RearrangeOverlayProps = {
  color: string;
  boxes: OverlayBox[];
  hover: { rect: Rect; name: string } | null;
  guides: SnapGuide[];
  lines: MeasureLine[];
  marquee?: Rect;
  onHandleDown: (element: Element, handle: RearrangeHandle, event: ReactPointerEvent) => void;
  onGripDown: (event: ReactPointerEvent) => void;
};

/**
 * Rearrange overlay (spec 10.2), fixed in viewport px inside the shadow surface: hover
 * outline, selected boxes with 8 resize handles and a clamped move grip, dashed ghosts of
 * the original positions, removed markers, snap guides, slim distance pills and marquee.
 */
export function RearrangeOverlay(props: RearrangeOverlayProps) {
  const { color } = props;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const firstSelected = props.boxes.find((b) => b.selected);
  const gripLeft = firstSelected ? clamp(firstSelected.rect.x, 8, viewport.width - 180) : 0;
  const gripTop = firstSelected
    ? firstSelected.rect.y >= 36
      ? clamp(firstSelected.rect.y - 30, 8, viewport.height - 32)
      : clamp(firstSelected.rect.y + firstSelected.rect.height + 6, 8, viewport.height - 32)
    : 0;

  return (
    <div data-annotate-rearrange-overlay className="pointer-events-none fixed top-0 left-0" style={{ width: viewport.width, height: viewport.height }}>
      {props.hover && (
        <div
          data-annotate-rearrange-hover
          className="fixed rounded-[3px] border border-dashed"
          style={{ ...box(props.hover.rect), borderColor: color, backgroundColor: `color-mix(in oklch, ${color} 6%, transparent)` }}
        />
      )}
      {props.boxes.map((b) => (
        <div key={b.key}>
          {b.ghost && (
            <div data-annotate-rearrange-ghost className="fixed rounded-[3px] border border-dashed border-muted-foreground/60" style={box(b.ghost)} />
          )}
          <div
            data-annotate-rearrange-box={b.selected ? "selected" : "changed"}
            data-annotate-rearrange-removed={b.removed || undefined}
            className="fixed rounded-[3px] border-2"
            style={{
              ...box(b.rect),
              borderColor: b.removed ? "var(--destructive)" : color,
              borderStyle: b.removed ? "dashed" : "solid",
              backgroundColor: b.removed ? "color-mix(in oklch, var(--destructive) 8%, transparent)" : b.selected ? `color-mix(in oklch, ${color} 8%, transparent)` : "transparent",
            }}
          />
          {b.removed && (
            <span
              className="fixed rounded bg-destructive px-1.5 py-0.5 text-[11px] leading-none font-medium text-white shadow-sm"
              style={{ left: clamp(b.rect.x, 8, viewport.width - 80), top: clamp(b.rect.y - 24, 8, viewport.height - 28) }}
            >
              Removed
            </span>
          )}
          {b.selected &&
            REARRANGE_HANDLES.map((handle) => {
              const p = handlePoint(b.rect, handle);
              return (
                <div
                  key={handle}
                  data-annotate-rearrange-handle={handle}
                  aria-label={`Resize ${handle}`}
                  className="pointer-events-auto fixed flex items-center justify-center"
                  style={{ left: p.x - HIT / 2, top: p.y - HIT / 2, width: HIT, height: HIT, cursor: CURSORS[handle], touchAction: "none" }}
                  onPointerDown={(event) => props.onHandleDown(b.element, handle, event)}
                >
                  <span className="rounded-[2px] border-[1.5px] bg-background shadow-xs" style={{ width: HANDLE, height: HANDLE, borderColor: color }} />
                </div>
              );
            })}
        </div>
      ))}
      {firstSelected && (
        <button
          type="button"
          data-annotate-rearrange-grip
          aria-label="Move selection"
          title="Drag to move (Shift: one axis, Alt: no snapping)"
          className="pointer-events-auto fixed flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] leading-none font-medium text-white shadow-sm"
          style={{
            left: gripLeft,
            top: gripTop,
            backgroundColor: `color-mix(in oklch, ${color} 78%, #09090b)`,
            boxShadow: `0 0 0 1px color-mix(in oklch, ${color} 55%, rgba(0, 0, 0, 0.25)), 0 2px 6px rgba(0, 0, 0, 0.28)`,
            textShadow: "0 1px 1px rgba(0, 0, 0, 0.25)",
            cursor: "move",
            touchAction: "none",
          }}
          onPointerDown={props.onGripDown}
        >
          <Move aria-hidden className="size-3.5 shrink-0" />
          <span className="max-w-44 truncate">{firstSelected.name}</span>
        </button>
      )}
      {props.marquee && (
        <div
          data-annotate-rearrange-marquee
          className="fixed rounded-[3px] border border-dashed"
          style={{ ...box(props.marquee), borderColor: color, backgroundColor: `color-mix(in oklch, ${color} 8%, transparent)` }}
        />
      )}
      <svg className="fixed top-0 left-0 overflow-visible" width={viewport.width} height={viewport.height} aria-hidden>
        {props.guides.map((g, i) =>
          g.axis === "x" ? (
            <line key={`g${i}`} data-annotate-rearrange-guide="x" x1={g.pos} x2={g.pos} y1={g.from} y2={g.to} stroke={GUIDE} strokeWidth={1} />
          ) : (
            <line key={`g${i}`} data-annotate-rearrange-guide="y" x1={g.from} x2={g.to} y1={g.pos} y2={g.pos} stroke={GUIDE} strokeWidth={1} />
          ),
        )}
        {props.lines.map((l, i) => (
          <g key={`l${i}`}>
            <line data-annotate-rearrange-distance={l.axis} data-distance={l.distance} x1={l.line.x1} y1={l.line.y1} x2={l.line.x2} y2={l.line.y2} stroke={GUIDE} strokeWidth={1} />
            {l.extensions.map((e, j) => (
              <line key={j} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={GUIDE} strokeWidth={1} strokeDasharray="4 4" />
            ))}
          </g>
        ))}
      </svg>
      {props.lines.map((l, i) => (
        <span
          key={`p${i}`}
          data-annotate-rearrange-pill={l.axis}
          className="fixed -translate-x-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium whitespace-nowrap text-white tabular-nums shadow-sm"
          style={{
            left: clamp((l.line.x1 + l.line.x2) / 2, 24, viewport.width - 24),
            top: clamp((l.line.y1 + l.line.y2) / 2, 14, viewport.height - 14),
            backgroundColor: `color-mix(in oklch, ${GUIDE} 78%, #09090b)`,
            boxShadow: `0 0 0 1px color-mix(in oklch, ${GUIDE} 55%, rgba(0, 0, 0, 0.25)), 0 1px 3px rgba(0, 0, 0, 0.25)`,
            textShadow: "0 1px 1px rgba(0, 0, 0, 0.25)",
          }}
        >
          {l.label}
        </span>
      ))}
    </div>
  );
}
