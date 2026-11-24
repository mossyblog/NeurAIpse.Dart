import type { PointerEvent, Ref } from "react";
import { cn } from "cn";
import { MessageSquarePlus } from "lucide-react";
import type { DockSide } from "../core/types.ts";
import { NotchFillet } from "./chrome.tsx";

export type LauncherProps = {
  annotationCount: number;
  side: DockSide;
  centerY: number;
  dragging?: boolean;
  notchRef?: Ref<HTMLButtonElement>;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    onClick: () => void;
  };
};

/** Collapsed Apple-style side notch tab docked flush to the left or right viewport edge. */
export function Launcher({
  annotationCount,
  side,
  centerY,
  dragging,
  notchRef,
  handlers,
}: LauncherProps) {
  const isRight = side === "right";
  return (
    <button
      ref={notchRef}
      type="button"
      aria-label="Start feedback mode"
      aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
      title="Start feedback mode (drag vertically or across screen to switch side)"
      data-annotate-notch="launcher"
      data-dock-side={side}
      style={{
        top: centerY,
        transform: "translateY(-50%)",
        borderRightWidth: isRight ? 0 : 1,
        borderLeftWidth: isRight ? 1 : 0,
      }}
      className={cn(
        "group pointer-events-auto fixed z-30 flex min-h-[76px] w-10 flex-col items-center justify-center gap-1.5 overflow-visible border-y border-solid py-4 text-foreground select-none outline-none touch-none",
        "bg-[var(--annotate-notch-bg)] border-[var(--annotate-notch-border)] shadow-[var(--annotate-notch-shadow)]",
        "transition-[width,padding] duration-150 ease-out hover:w-12 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
        isRight
          ? "right-0 rounded-l-[18px] pr-2.5 pl-2"
          : "left-0 rounded-r-[18px] pl-2.5 pr-2",
        dragging ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing",
      )}
      {...handlers}
    >
      <NotchFillet side={side} position="top" />
      <NotchFillet side={side} position="bottom" />

      {/* Subtle Apple-style edge bar hugging the flush viewport edge */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-full bg-muted-foreground/30 transition-all duration-150 group-hover:h-7 group-hover:bg-foreground/45",
          isRight ? "right-1.5" : "left-1.5",
        )}
      />

      <span className="annotate-notch-icon flex size-4 items-center justify-center transition-transform duration-150 ease-out group-hover:scale-125 motion-reduce:transition-none">
        <MessageSquarePlus aria-hidden />
      </span>

      {annotationCount > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none font-semibold tabular-nums text-primary-foreground">
          {annotationCount}
        </span>
      )}
    </button>
  );
}
