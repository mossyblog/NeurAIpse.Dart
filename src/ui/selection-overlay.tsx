import type { CSSProperties } from "react";
import { cn } from "cn";
import type { Rect } from "../core/types.ts";
import { PILL_CLASS } from "./chrome.tsx";

const EDGE = 8;
const GAP = 6;
const PILL_HEIGHT = 24;
const MULTI_TAG_MAX_WIDTH = 300;
const SIZE_PILL_MIN_WIDTH = 96;

function areaSizePlacement(region: Rect): CSSProperties {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const bottom = region.y + region.height;
  const rightEdge = region.x + region.width;

  const top =
    bottom + GAP + PILL_HEIGHT <= vh - EDGE
      ? bottom + GAP
      : region.y >= PILL_HEIGHT + GAP + EDGE
        ? region.y - PILL_HEIGHT - GAP
        : Math.min(Math.max(EDGE, bottom - PILL_HEIGHT - GAP), Math.max(EDGE, vh - PILL_HEIGHT - EDGE));

  if (rightEdge >= SIZE_PILL_MIN_WIDTH + EDGE) {
    return { right: Math.max(EDGE, vw - rightEdge), top };
  }
  return { left: Math.max(EDGE, region.x), top };
}

function multiTagPlacement(rect: Rect): CSSProperties {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const maxWidth = Math.max(160, Math.min(MULTI_TAG_MAX_WIDTH, vw - EDGE * 2));

  const top =
    rect.y >= PILL_HEIGHT + GAP + EDGE
      ? rect.y - PILL_HEIGHT - GAP
      : rect.y + rect.height + GAP + PILL_HEIGHT <= vh - EDGE
        ? rect.y + rect.height + GAP
        : Math.min(Math.max(EDGE, rect.y + GAP), Math.max(EDGE, vh - PILL_HEIGHT - EDGE));

  if (rect.x + maxWidth + EDGE <= vw) {
    return { left: Math.max(EDGE, rect.x), top, maxWidth };
  }

  const right = Math.max(EDGE, vw - (rect.x + rect.width));
  return {
    right,
    top,
    maxWidth: Math.max(160, Math.min(maxWidth, vw - right - EDGE)),
  };
}

/** Dashed region while an area is being drawn (viewport px). */
export function AreaOverlay({ region, color }: { region: Rect; color: string }) {
  const width = Math.round(region.width);
  const height = Math.round(region.height);
  const showSize = width >= 8 || height >= 8;

  return (
    <div className="pointer-events-none fixed top-0 left-0">
      <div
        data-annotate-area
        className="fixed rounded-[4px]"
        style={{
          left: region.x,
          top: region.y,
          width: region.width,
          height: region.height,
          border: `1.5px dashed ${color}`,
          backgroundColor: `color-mix(in oklch, ${color} 8%, transparent)`,
        }}
      />
      {showSize && (
        <div
          className={cn(
            PILL_CLASS,
            "fixed flex h-6 items-center px-2 font-mono text-[11px] font-medium tabular-nums whitespace-nowrap",
          )}
          style={areaSizePlacement(region)}
        >
          {width} × {height}
        </div>
      )}
    </div>
  );
}

/** Outlines for the pending Cmd/Ctrl multi-select, plus a hint chip. */
export function MultiSelectOverlay({ rects, color }: { rects: readonly Rect[]; color: string }) {
  const first = rects[0];
  return (
    <div className="pointer-events-none fixed top-0 left-0" data-annotate-multi={rects.length}>
      {rects.map((rect, index) => (
        <div
          key={index}
          className="fixed rounded-[4px]"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: `1.5px solid ${color}`,
            backgroundColor: `color-mix(in oklch, ${color} 8%, transparent)`,
          }}
        />
      ))}
      {first && (
        <div
          className={cn(
            PILL_CLASS,
            "fixed flex h-6 items-center gap-1.5 px-2 text-[11px] font-medium",
          )}
          style={multiTagPlacement(first)}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="truncate tabular-nums">
            {rects.length} selected. Release Cmd/Ctrl to annotate.
          </span>
        </div>
      )}
    </div>
  );
}
