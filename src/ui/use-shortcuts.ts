import { useEffect, useEffectEvent } from "react";
import {
  isEditableElement,
  isToggleShortcut,
  resolveShortcut,
  type ShortcutAction,
} from "../core/shortcuts.ts";
import type { SendState } from "../core/send.ts";
import { realTarget } from "./shadow-surface.ts";

export type ShortcutOptions = {
  active: boolean;
  enableKeyboardShortcuts: boolean;
  annotationCount: number;
  /** Pending inspector style changes (X clears them). */
  styleChangeCount?: number;
  /** Rearrangements (parity spec 10.2): C and X include them. */
  rearrangeCount?: number;
  canSend: boolean;
  sendState: SendState;
  /** Spacing inspector on: enables V (sub-mode toggle). */
  spacingActive?: boolean;
  /** Same-origin frame windows that also receive the shortcuts (focus may be inside one). */
  frameWindows?: readonly Window[];
  onToggle: () => void;
  onEscape: () => void;
  onAction: (action: ShortcutAction) => void;
};

const EMPTY: readonly Window[] = [];

/** Cmd/Ctrl+Shift+F, Esc and the single-key shortcuts from spec section 2. */
export function useShortcuts(options: ShortcutOptions) {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (isToggleShortcut(event, options.enableKeyboardShortcuts)) {
      event.preventDefault();
      options.onToggle();
      return;
    }
    if (!options.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    const action = resolveShortcut(event, {
      active: options.active,
      enableKeyboardShortcuts: options.enableKeyboardShortcuts,
      editableTarget: isEditableElement(realTarget(event)),
      annotationCount: options.annotationCount,
      styleChangeCount: options.styleChangeCount,
      rearrangeCount: options.rearrangeCount,
      canSend: options.canSend,
      sendState: options.sendState,
      spacingActive: options.spacingActive,
    });
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      options.onAction(action);
    }
  });

  const frames = options.frameWindows ?? EMPTY;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handle(event);
    const windows = [window, ...frames];
    for (const win of windows) {
      try {
        win.addEventListener("keydown", onKeyDown, true);
      } catch {
        // Frame gone.
      }
    }
    return () => {
      for (const win of windows) {
        try {
          win.removeEventListener("keydown", onKeyDown, true);
        } catch {
          // Frame gone.
        }
      }
    };
  }, [frames]);
}
