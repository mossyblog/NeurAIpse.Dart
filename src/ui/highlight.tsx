import type { CSSProperties } from "react";
import { cn } from "cn";
import type { Rect } from "../core/types.ts";
import { PILL_CLASS } from "./chrome.tsx";

export type HoverTarget = { rect: Rect; name: string };

const EDGE = 8;
const GAP = 6;
const TAG_HEIGHT = 24;
const MAX_TAG_WIDTH = 288;

function tagPlacement(rect: Rect): CSSProperties {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const maxWidth = Math.max(120, Math.min(MAX_TAG_WIDTH, vw - EDGE * 2));

  const top =
    rect.y >= TAG_HEIGHT + GAP + EDGE
      ? rect.y - TAG_HEIGHT - GAP
      : rect.y + rect.height + GAP + TAG_HEIGHT <= vh - EDGE
        ? rect.y + rect.height + GAP
        : Math.min(Math.max(EDGE, rect.y + GAP), Math.max(EDGE, vh - TAG_HEIGHT - EDGE));

  if (rect.x + maxWidth + EDGE <= vw) {
    return { left: Math.max(EDGE, rect.x), top, maxWidth };
  }

  const right = Math.max(EDGE, vw - (rect.x + rect.width));
  return {
    right,
    top,
    maxWidth: Math.max(120, Math.min(maxWidth, vw - right - EDGE)),
  };
}

/** Hover box and element name, in viewport coordinates. */
export function Highlight({ target, color }: { target: HoverTarget; color: string }) {
  const { rect, name } = target;
  return (
    <div className="pointer-events-none fixed top-0 left-0">
      <div
        data-annotate-highlight
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
      <div
        className={cn(
          PILL_CLASS,
          "fixed flex h-6 items-center gap-1.5 px-2 text-[11px] font-medium",
        )}
        style={tagPlacement(rect)}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{name}</span>
      </div>
    </div>
  );
}
