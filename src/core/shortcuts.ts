export type ShortcutAction = "freeze" | "layout" | "hide" | "copy" | "clear" | "send" | "spacing" | "type" | "color" | "subMode" | "rearrange" | "measureV" | "measureH";

export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};

export type ShortcutState = {
  active: boolean;
  enableKeyboardShortcuts: boolean;
  /** True when the event's real target is an input, textarea, select or contenteditable. */
  editableTarget: boolean;
  annotationCount: number;
  placementCount?: number;
  rearrangeCount?: number;
  /** Pending inspector style changes and measurements: Copy, Send and X include them. */
  styleChangeCount?: number;
  canSend?: boolean;
  sendState?: "idle" | "sending" | "sent" | "failed";
  /** The spacing inspector is on: V toggles its Box / Lines sub-mode (spec 14.1). */
  spacingActive?: boolean;
};

const KEYS: Record<string, ShortcutAction> = {
  p: "freeze",
  l: "layout",
  h: "hide",
  c: "copy",
  x: "clear",
  s: "send",
  m: "spacing",
  t: "type",
  // C is Copy, so the colour inspector uses K.
  k: "color",
  // Spacing sub-mode Box / Lines (spec 14.1): free of P L H C X S M T K; Tab and B stay free.
  v: "subMode",
  // Rearrange mode (parity spec 10.2): free of P L H C X S M T K V.
  r: "rearrange",
  // Interactive measurement rulers: 1 = vertical, 2 = horizontal.
  "1": "measureV",
  "2": "measureH",
};

/** Cmd/Ctrl+Shift+F toggles the toolbar unless shortcuts are disabled. */
export function isToggleShortcut(event: KeyInput, enableKeyboardShortcuts = true): boolean {
  return (
    enableKeyboardShortcuts &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.repeat &&
    event.key.toLowerCase() === "f"
  );
}

/** Section 2 gating for single-key shortcuts. Returns null when the key must be ignored. */
export function resolveShortcut(event: KeyInput, state: ShortcutState): ShortcutAction | null {
  if (!state.active || !state.enableKeyboardShortcuts || state.editableTarget) return null;
  if (event.metaKey || event.ctrlKey || event.repeat) return null;
  const action = KEYS[event.key.toLowerCase()];
  if (!action) return null;
  const hasAnnotations = state.annotationCount > 0;
  const hasStyle = (state.styleChangeCount ?? 0) > 0;
  const hasAny =
    hasAnnotations || hasStyle || (state.placementCount ?? 0) > 0 || (state.rearrangeCount ?? 0) > 0;
  switch (action) {
    case "freeze":
    case "hide":
    case "layout":
    case "rearrange":
    case "spacing":
    case "type":
    case "color":
    case "measureV":
    case "measureH":
      return action;
    case "subMode":
      return state.spacingActive ? action : null;
    case "copy":
    case "clear":
      return hasAny ? action : null;
    case "send":
      return (hasAnnotations || hasStyle || (state.rearrangeCount ?? 0) > 0) && state.canSend && (state.sendState ?? "idle") === "idle"
        ? action
        : null;
  }
}

/** Whether an element accepts typing, so single-key shortcuts must not fire. */
export function isEditableElement(target: EventTarget | null | undefined): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null | undefined;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  return Boolean(el.closest?.('[contenteditable]:not([contenteditable="false"])'));
}
