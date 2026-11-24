import type { PointerEvent } from "react";
import { Button } from "./primitives.tsx";
import { MessageSquarePlus } from "lucide-react";

export type LauncherProps = {
  annotationCount: number;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    onClick: () => void;
  };
};

/** Collapsed, draggable entry point. */
export function Launcher({ annotationCount, handlers }: LauncherProps) {
  return (
    <Button
      variant="default"
      size="icon-lg"
      aria-label="Start feedback mode"
      aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
      title="Start feedback mode"
      className="relative size-10 cursor-grab touch-none rounded-full shadow-[var(--ann-shadow-float)] ring-1 ring-foreground/15 transition-transform hover:scale-105 active:scale-95 active:cursor-grabbing dark:ring-white/15"
      {...handlers}
    >
      <MessageSquarePlus className="size-4.5" />
      {annotationCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-popover px-1 font-mono text-[11px] font-semibold tabular-nums text-popover-foreground shadow-sm ring-1 ring-border">
          {annotationCount}
        </span>
      )}
    </Button>
  );
}
