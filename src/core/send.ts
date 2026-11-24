/** Send button state machine (spec section 11). */
import type { Annotation } from "./types.ts";

export type SendState = "idle" | "sending" | "sent" | "failed";

/** How long `sent` / `failed` stay visible before reverting to idle. */
export const SEND_RESULT_MS = 2500;

export type SendTargets = {
  onSubmit?: unknown;
  endpoint?: string | null;
  webhookUrl?: string | null;
};

/** Send is possible when an onSubmit handler, an endpoint or an active webhook exists. */
export function hasSendTarget(targets: SendTargets): boolean {
  return Boolean(targets.onSubmit || targets.endpoint?.trim() || targets.webhookUrl);
}

/** The Send button and S key are enabled only from idle, with annotations and a target. */
export function canSend(annotationCount: number, targets: SendTargets, state: SendState): boolean {
  return annotationCount > 0 && hasSendTarget(targets) && state === "idle";
}

export type SendEvent = "start" | "success" | "failure" | "reset";

export function nextSendState(state: SendState, event: SendEvent): SendState {
  switch (event) {
    case "start":
      return state === "idle" ? "sending" : state;
    case "success":
      return state === "sending" ? "sent" : state;
    case "failure":
      return state === "sending" ? "failed" : state;
    case "reset":
      return state === "sent" || state === "failed" ? "idle" : state;
  }
}

export const SEND_LABELS: Record<SendState, string> = {
  idle: "Send Annotations",
  sending: "Sending…",
  sent: "Sent",
  failed: "Send failed",
};

/** Annotations as handed to callbacks and webhooks: the local sync marker is dropped. */
export function publicAnnotation(annotation: Annotation): Annotation {
  if (!("_syncedTo" in annotation)) return annotation;
  const copy = { ...annotation };
  delete copy._syncedTo;
  return copy;
}

/**
 * Same feedback (ids, order and comments) after an await. Sync may have replaced the list to
 * record `_syncedTo` or server fields; that does not count as a change for auto-clear.
 */
export function sameFeedback(a: readonly Annotation[], b: readonly Annotation[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id && item.comment === b[index].comment);
}
