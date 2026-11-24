import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Button } from "./primitives.tsx";
import { Dialog, DialogContent } from "@ui-sdk/react/dialog";
import { Textarea } from "@ui-sdk/react/textarea";
import { cn } from "cn";
import { SquareArrowOutUpRight } from "lucide-react";
import { isTrustworthySourceFile } from "../core/source-map.ts";
import type { DockSide } from "../core/types.ts";
import { KbdHint, SURFACE_CLASS } from "./chrome.tsx";

const WIDTH = 320;
const EDGE = 16;
const DOCK_INSET = 64;
const GAP = 16;
/** Typical popup height, used to decide whether to flip above the target. */
const ESTIMATED_HEIGHT = 228;
const SELECTED_TEXT_HEIGHT = 68;

export type PopupProps = {
  element: string;
  selectedText?: string;
  initialComment: string;
  editing: boolean;
  allowEmpty: boolean;
  accent: string;
  /** Viewport point the popup is placed against. */
  point: { x: number; y: number };
  /** Active dock side, used to keep the popup clear of the docked notch. */
  dockSide?: DockSide;
  closing: boolean;
  /** Increments on each outside click. */
  shake: number;
  /** Trustworthy `path:line:column`; with `onOpenSource` shows "Open in editor". */
  sourceFile?: string;
  onOpenSource?: (sourceFile: string) => void;
  onSubmit: (comment: string) => void;
  onDelete: () => void;
  onCancel: () => void;
};

function placement(
  point: { x: number; y: number },
  dockSide?: DockSide,
  hasSelectedText?: boolean,
): CSSProperties {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const leftInset = dockSide === "left" ? DOCK_INSET : EDGE;
  const rightInset = dockSide === "right" ? DOCK_INSET : EDGE;
  const effectiveWidth = Math.min(WIDTH, Math.max(0, width - EDGE * 2));
  const maxLeft = Math.max(leftInset, width - effectiveWidth - rightInset);
  const left = Math.min(Math.max(leftInset, point.x - effectiveWidth / 2), maxLeft);
  const estimatedHeight = ESTIMATED_HEIGHT + (hasSelectedText ? SELECTED_TEXT_HEIGHT : 0);
  const below = point.y + GAP + estimatedHeight <= height - EDGE;
  return below
    ? { left, top: Math.max(EDGE, point.y + GAP) }
    : { left, bottom: Math.max(EDGE, height - point.y + GAP) };
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Popup(props: PopupProps) {
  const [comment, setComment] = useState(props.initialComment);
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const canSubmit = props.allowEmpty || comment.trim().length > 0;
  const showOpenSource = Boolean(props.onOpenSource && isTrustworthySourceFile(props.sourceFile));

  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (props.shake === 0 || !card.current) return;
    if (reducedMotion()) {
      field.current?.focus({ preventScroll: true });
      return;
    }
    card.current.animate(
      [0, -8, 8, -8, 8, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 320, easing: "ease-in-out" },
    );
  }, [props.shake]);

  const submit = () => {
    if (canSubmit && !props.closing) props.onSubmit(comment.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="fixed z-30 w-80 max-w-[calc(100vw-32px)]"
      style={placement(props.point, props.dockSide, Boolean(props.selectedText))}
    >
      <Dialog open={!props.closing} modal={false} dismissible={false} closeOnOutsidePress={false}>
        <DialogContent
          inline
          keepMounted
          initialFocus="none"
          finalFocus="none"
          render={<div />}
          ref={card}
          aria-label={`Annotate ${props.element}`}
          className={cn(
            "flex min-w-0 flex-col overflow-hidden text-sm",
            SURFACE_CLASS,
            props.closing
              ? "pointer-events-none animate-out fade-out-0 zoom-out-95 fill-mode-forwards"
              : "animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                data-annotate-accent
                className="size-2 shrink-0 rounded-full ring-1 ring-foreground/15"
                style={{ backgroundColor: props.accent }}
              />
              <span
                className="truncate text-xs font-semibold tracking-tight text-foreground"
                title={props.element}
              >
                {props.element}
              </span>
            </div>
            {showOpenSource && props.sourceFile && (
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title={props.sourceFile}
                data-annotate-open-source={props.sourceFile}
                onClick={() => props.sourceFile && props.onOpenSource?.(props.sourceFile)}
              >
                <SquareArrowOutUpRight />
                Open in editor
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2 p-3">
            {props.selectedText && (
              <blockquote
                className="line-clamp-3 rounded-r-md border-l-2 bg-muted/60 py-1.5 pr-2.5 pl-2.5 text-xs leading-relaxed text-muted-foreground italic"
                style={{ borderLeftColor: props.accent }}
              >
                “{props.selectedText}”
              </blockquote>
            )}
            <Textarea
              ref={field}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              placeholder="What should change?"
              aria-label="Feedback"
              style={{ "--ring": props.accent } as CSSProperties}
              className="min-h-20 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground shadow-2xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/25 px-3 py-2">
            {props.editing ? (
              <Button variant="destructive" size="sm" onClick={props.onDelete}>
                Delete
              </Button>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                <span className="inline-flex items-center gap-1">
                  <KbdHint>↵</KbdHint>
                  <span>save</span>
                </span>
                <span aria-hidden className="text-muted-foreground/50">
                  ·
                </span>
                <span className="inline-flex items-center gap-1">
                  <KbdHint>Esc</KbdHint>
                  <span>cancel</span>
                </span>
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canSubmit} onClick={submit}>
                {props.editing ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
