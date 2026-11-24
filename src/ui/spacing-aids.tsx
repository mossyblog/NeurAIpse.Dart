import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { cn } from "cn";
import {
  dragLabel,
  edgePosition,
  growDirection,
  guideLines,
  guideOffsets,
  sideAxis,
  stepLabel,
  type GuideLine,
  type ScaleStep,
} from "../core/drag-guides.ts";
import { regionProperty } from "../core/spacing.ts";
import { PILL_CLASS } from "./chrome.tsx";
import { SPACING_TINTS } from "./spacing-overlay.tsx";
import { gapReversed, handleKey, pageScroll, type HandleDrag, type HandleTarget } from "./use-handle-drag.ts";

/** Handle hit area (spec 13.1: 24px minimum, on the 8px grid). The visible bar is smaller. */
const HIT = 24;
/** Above the spacing overlay labels (z 7). */
const Z_HANDLE = 8;
const Z_GUIDE = 5;
/** Pointer distance at which a guide counts as under the cursor. */
const HOT_PX = 4;
/** A guide more than this far outside the viewport is not drawn (spec 13.3). */
const GUIDE_OVERFLOW = 24;

/** Page events a handle swallows: the page never sees a handle (spec 13.1 events). */
const SWALLOW = ["pointerover", "pointerout", "mouseover", "mouseout", "mousemove", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "pointercancel"] as const;

type Placed = { target: HandleTarget; key: string; x: number; y: number; dragging: boolean };

function place(target: HandleTarget, drag: HandleDrag | null): Placed {
  const { region, spacing } = target;
  const key = handleKey(region);
  const axis = sideAxis(region.side);
  const s = (axis === "x" ? spacing.scale.x : spacing.scale.y) || 1;
  const reversed = gapReversed(region);
  const r = region.rect;
  const dragging = drag?.key === key;
  let along: number;
  if (dragging && drag) {
    // Frozen geometry: the handle follows the snapped value, so it lands on its guide.
    const anchor = drag.anchorPage - pageScroll(axis);
    const factor = region.kind === "gap" ? 0.5 : 1;
    along = anchor + growDirection(region.kind, region.side, drag.reversed) * drag.value.px * drag.elementScale * factor;
  } else if (region.kind === "gap") {
    along = axis === "x" ? r.x + r.width / 2 : r.y + r.height / 2;
  } else {
    along = edgePosition(r, region.kind, region.side, region.value, s, reversed);
  }
  // Across the region: a quarter in on long bands so the centred value pill stays clear.
  const crossStart = axis === "x" ? r.y : r.x;
  const crossLength = axis === "x" ? r.height : r.width;
  const cross = crossStart + (crossLength >= 96 ? crossLength / 4 : crossLength / 2);
  return axis === "x" ? { target, key, x: along, y: cross, dragging } : { target, key, x: cross, y: along, dragging };
}

type HandleEvents = {
  onDown: (event: PointerEvent, target: HandleTarget, el: Element) => void;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  onLost: () => void;
};

function Handle({ placed, events }: { placed: Placed; events: HandleEvents }) {
  const ref = useRef<HTMLDivElement>(null);
  const { region } = placed.target;
  const axis = sideAxis(region.side);
  const down = useEffectEvent((event: PointerEvent, el: Element) => events.onDown(event, placed.target, el));
  const move = useEffectEvent((event: PointerEvent) => events.onMove(event));
  const up = useEffectEvent((event: PointerEvent) => events.onUp(event));
  const lost = useEffectEvent(() => events.onLost());
  // Native listeners on the handle: every event stops here, before the page sees it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (event: Event) => {
      event.stopPropagation();
      if (event.type !== "pointerover" && event.type !== "pointerout" && event.type !== "mouseover" && event.type !== "mouseout") event.preventDefault();
    };
    const onDown = (event: PointerEvent) => {
      stop(event);
      down(event, el);
    };
    const onMove = (event: PointerEvent) => {
      event.stopPropagation();
      move(event);
    };
    const onUp = (event: PointerEvent) => {
      stop(event);
      up(event);
    };
    const onLost = () => lost();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("lostpointercapture", onLost);
    for (const type of SWALLOW) el.addEventListener(type, stop);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("lostpointercapture", onLost);
      for (const type of SWALLOW) el.removeEventListener(type, stop);
    };
  }, []);
  const tint = SPACING_TINTS[region.kind];
  return (
    <div
      ref={ref}
      data-annotate-layer="handle"
      data-annotate-handle={regionProperty(region)}
      data-annotate-handle-kind={region.kind}
      data-dragging={placed.dragging || undefined}
      className="fixed flex items-center justify-center"
      style={{
        left: placed.x - HIT / 2,
        top: placed.y - HIT / 2,
        width: HIT,
        height: HIT,
        zIndex: Z_HANDLE,
        pointerEvents: "auto",
        touchAction: "none",
        cursor: axis === "x" ? "ew-resize" : "ns-resize",
      }}
    >
      <span
        aria-hidden
        className={cn("block rounded-full shadow-sm ring-2 ring-background transition-transform", placed.dragging && "scale-110")}
        style={{ width: axis === "x" ? 4 : 16, height: axis === "x" ? 16 : 4, backgroundColor: tint }}
      />
    </div>
  );
}

export type SpacingAidsProps = {
  /** Regions that get a handle (the selected sides), live geometry. Empty when Handles is off. */
  handles: HandleTarget[];
  /** Regions the token guides are drawn across (selected sides, else the hovered ring). Empty when Guides is off. */
  guides: HandleTarget[];
  drag: HandleDrag | null;
  steps: ScaleStep[];
  events: HandleEvents;
};

type DrawnGuide = GuideLine & { highlight: boolean };
type GuideMeta = { key: string; axis: "x" | "y"; cross: [number, number]; property: string; kind: HandleTarget["region"]["kind"]; value: number };
type GuideSet = { meta: GuideMeta; lines: DrawnGuide[] };

/** Guide ladder for one region: frozen at the drag anchor while that region is dragged. */
function guideSet(target: HandleTarget, drag: HandleDrag | null, steps: ScaleStep[], hot: { key: string; px: number } | null, viewport: { width: number; height: number }): GuideSet {
  const { region, spacing } = target;
  const key = handleKey(region);
  const axis = sideAxis(region.side);
  const s = (axis === "x" ? spacing.scale.x : spacing.scale.y) || 1;
  const reversed = gapReversed(region);
  const r = region.rect;
  // Labels: a gap is one shared value (`gap-6`), never per axis (spec 14.2, 14.6).
  const property = region.kind === "gap" ? "gap" : regionProperty(region);
  const cross: [number, number] = axis === "x" ? [r.y, r.y + r.height] : [r.x, r.x + r.width];
  if (drag && drag.key === key) {
    // Dragging: the ladder follows the snapped value; the start value stays solid.
    const anchor = drag.anchorPage - pageScroll(axis);
    const dir = growDirection(region.kind, region.side, drag.reversed);
    const extent = axis === "x" ? viewport.width : viewport.height;
    const lines = guideOffsets(drag.value.px, steps, 4, 2)
      .map((g) => ({ ...g, pos: anchor + dir * g.px * drag.elementScale, current: Math.abs(g.px - drag.start) < 0.01, highlight: Math.abs(g.px - drag.value.px) < 0.01 }))
      .filter((g) => g.pos >= -GUIDE_OVERFLOW && g.pos <= extent + GUIDE_OVERFLOW);
    return { meta: { key, axis, cross, property, kind: region.kind, value: drag.value.px }, lines };
  }
  const lines = guideLines({ rect: r, kind: region.kind, side: region.side, value: region.value, scale: steps, elementScale: s, reversed, viewport, threshold: GUIDE_OVERFLOW }).map((g) => ({
    ...g,
    highlight: hot != null && hot.key === key && Math.abs(g.px - hot.px) < 0.01,
  }));
  return { meta: { key, axis, cross, property, kind: region.kind, value: region.value }, lines };
}

/**
 * I9 overlay (spec 13): drag handles on the selected sides and token guides across them.
 * Box only (layers `handle`, `token-guide`). Guides never take pointer events.
 */
export function SpacingAids({ handles, guides, drag, steps, events }: SpacingAidsProps) {
  const [hot, setHot] = useState<{ key: string; px: number } | null>(null);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const sets = guides.map((t) => guideSet(t, drag, steps, hot, viewport));

  // Guide under the cursor (with handles on, this is where a drag would snap).
  const geometry = useRef<GuideSet[]>(sets);
  useEffect(() => {
    geometry.current = sets;
  });
  const onPointer = useEffectEvent((event: PointerEvent) => {
    // The guide under the cursor highlights only with Handles on (spec 13.3): it is where a drag would snap.
    if (handles.length === 0) return setHot(null);
    let next: { key: string; px: number } | null = null;
    for (const { meta, lines } of geometry.current) {
      const along = meta.axis === "x" ? event.clientX : event.clientY;
      const across = meta.axis === "x" ? event.clientY : event.clientX;
      if (across < meta.cross[0] - 8 || across > meta.cross[1] + 8) continue;
      const near = lines.find((g) => Math.abs(g.pos - along) <= HOT_PX);
      if (near) {
        next = { key: meta.key, px: near.px };
        break;
      }
    }
    setHot((value) => (value?.key === next?.key && value?.px === next?.px ? value : next));
  });
  const guiding = guides.length > 0;
  useEffect(() => {
    if (!guiding) return;
    const listener = (event: PointerEvent) => onPointer(event);
    window.addEventListener("pointermove", listener, { capture: true, passive: true });
    return () => window.removeEventListener("pointermove", listener, true);
  }, [guiding]);

  // Stable DOM order: moving a node (e.g. re-sorting as a band shrinks) would drop its pointer capture mid-drag.
  const ordered = [...handles];
  const placed = ordered.map((t) => place(t, drag));
  const active = placed.find((p) => p.dragging);

  return (
    <div data-annotate-spacing-aids className="pointer-events-none fixed top-0 left-0">
      {sets.map(({ meta, lines }) => {
        const tint = SPACING_TINTS[meta.kind];
        // One token label per side: the highlighted guide, else the nearest non-current step (ties go up).
        const labelled =
          lines.find((g) => g.highlight) ??
          lines.filter((g) => !g.current).sort((a, b) => Math.abs(a.px - meta.value) - Math.abs(b.px - meta.value) || b.px - a.px)[0];
        return (
          <div key={meta.key} data-annotate-token-guides={meta.property}>
            {lines.map((g) => {
              const style: CSSProperties =
                meta.axis === "y"
                  ? { left: meta.cross[0], top: g.pos - 0.5, width: Math.max(1, meta.cross[1] - meta.cross[0]), height: 0, borderTop: `1px ${g.current || g.highlight ? "solid" : "dashed"} ${tint}` }
                  : { left: g.pos - 0.5, top: meta.cross[0], width: 0, height: Math.max(1, meta.cross[1] - meta.cross[0]), borderLeft: `1px ${g.current || g.highlight ? "solid" : "dashed"} ${tint}` };
              return (
                <div
                  key={`${g.px}-${g.current}`}
                  data-annotate-layer="token-guide"
                  data-annotate-token-guide={meta.property}
                  data-px={g.px}
                  data-token={g.token}
                  data-pos={Math.round(g.pos * 100) / 100}
                  data-current={g.current || undefined}
                  data-highlight={g.highlight || undefined}
                  className="fixed"
                  style={{ ...style, zIndex: Z_GUIDE, opacity: g.highlight ? 1 : g.current ? 0.9 : 0.45 }}
                />
              );
            })}
            {labelled && (
              <span
                data-annotate-layer="token-guide"
                data-annotate-token-guide-label={meta.property}
                data-px={labelled.px}
                className={cn(PILL_CLASS, "fixed px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap tabular-nums")}
                style={
                  meta.axis === "y"
                    ? { left: Math.min(viewport.width - 100, meta.cross[1] + 6), top: labelled.pos - 8, zIndex: Z_GUIDE }
                    : { left: Math.min(viewport.width - 100, labelled.pos + 6), top: Math.max(8, meta.cross[0] - 18), zIndex: Z_GUIDE }
                }
              >
                {`${stepLabel(meta.property, labelled.token || undefined) ?? "no token"} · ${labelled.px}`}
              </span>
            )}
          </div>
        );
      })}
      {placed.map((p) => (
        <Handle key={p.key} placed={p} events={events} />
      ))}
      {active && drag && (
        <span
          data-annotate-layer="handle"
          data-annotate-drag-label
          className="fixed rounded px-1.5 py-0.5 font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-white tabular-nums"
          style={{
            left: Math.max(8, Math.min(viewport.width - 180, active.x + (drag.axis === "y" ? HIT : 0))),
            top: Math.max(8, Math.min(viewport.height - 28, active.y - (drag.axis === "x" ? HIT : 8))),
            zIndex: Z_HANDLE,
            backgroundColor: `color-mix(in oklch, ${SPACING_TINTS[drag.region.kind]} 72%, #09090b)`,
            boxShadow: `0 0 0 1px color-mix(in oklch, ${SPACING_TINTS[drag.region.kind]} 55%, rgba(0, 0, 0, 0.25)), 0 2px 6px rgba(0, 0, 0, 0.28)`,
            textShadow: "0 1px 1px rgba(0, 0, 0, 0.28)",
          }}
        >
          {dragLabel({
            from: drag.start,
            to: drag.value.px,
            mode: drag.mode,
            labels: drag.symmetric
              ? [stepLabel(drag.property, drag.value.token), stepLabel(drag.opposite, drag.value.token)]
              : [stepLabel(drag.region.kind === "gap" ? "gap" : drag.property, drag.value.token)],
            ...(drag.symmetric ? { otherFrom: drag.otherStart, symmetric: true } : {}),
          }) + (drag.region.flags?.includes("may collapse") ? " · may collapse" : "")}
        </span>
      )}
    </div>
  );
}
