import { deepActiveElement } from "./dom.ts";

type FieldSelection = { el: HTMLInputElement | HTMLTextAreaElement; start: number | null; end: number | null };

type SavedFocus = {
  active: HTMLElement | null;
  ranges: Range[];
  field: FieldSelection | null;
};

function saveFocus(doc: Document): SavedFocus {
  const active = deepActiveElement(doc) as HTMLElement | null;
  const selection = doc.getSelection();
  const ranges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i).cloneRange());
  }
  let field: FieldSelection | null = null;
  if (active && (active.localName === "input" || active.localName === "textarea")) {
    const input = active as HTMLInputElement;
    try {
      field = { el: input, start: input.selectionStart, end: input.selectionEnd };
    } catch {
      field = null;
    }
  }
  return { active, ranges, field };
}

function restoreFocus(doc: Document, saved: SavedFocus): void {
  try {
    saved.active?.focus?.({ preventScroll: true });
  } catch {
    // Element may be gone.
  }
  const selection = doc.getSelection();
  if (selection && saved.ranges.length > 0) {
    selection.removeAllRanges();
    for (const range of saved.ranges) selection.addRange(range);
  }
  if (saved.field && saved.field.start != null && saved.field.end != null) {
    try {
      saved.field.el.setSelectionRange(saved.field.start, saved.field.end);
    } catch {
      // Some input types do not support selection.
    }
  }
}

/** Hidden readonly textarea + execCommand("copy"). Restores focus and selection. */
export function copyWithExecCommand(text: string, doc: Document): boolean {
  const saved = saveFocus(doc);
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  (doc.body ?? doc.documentElement).appendChild(textarea);
  let ok = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    textarea.remove();
    restoreFocus(doc, saved);
  }
  return ok;
}

/** Writes text to the clipboard. Resolves false when every method fails. */
export async function copyToClipboard(text: string, doc: Document): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  return copyWithExecCommand(text, doc);
}
