/**
 * Webhook delivery (public Agentation webhook contract): POST JSON with `event`,
 * `timestamp`, `url` and an event-specific field; `X-Agentation-Delivery-Id` stays the same
 * across retries so receivers can dedupe. Failures never touch local data.
 */
import { publicAnnotation } from "./send.ts";
import { isValidWebhookUrl } from "./settings.ts";
import type { Annotation, Settings } from "./types.ts";

export type WebhookEvent = "annotation.add" | "annotation.update" | "annotation.delete" | "annotations.clear" | "submit";

export type WebhookPayload = {
  event: WebhookEvent;
  timestamp: number;
  url: string;
  annotation?: Annotation;
  annotations?: Annotation[];
  output?: string;
};

export const DELIVERY_HEADER = "X-Agentation-Delivery-Id";

export function buildWebhookPayload(
  event: WebhookEvent,
  data: { annotation?: Annotation; annotations?: readonly Annotation[]; output?: string },
  context: { url: string; timestamp: number },
): WebhookPayload {
  const payload: WebhookPayload = { event, timestamp: context.timestamp, url: context.url };
  if (event === "annotations.clear" || event === "submit") {
    payload.annotations = (data.annotations ?? []).map(publicAnnotation);
  } else if (data.annotation) {
    payload.annotation = publicAnnotation(data.annotation);
  }
  if (event === "submit") payload.output = data.output ?? "";
  return payload;
}

/** The settings URL wins when set; otherwise the `webhookUrl` prop. Null when disabled or not http(s). */
export function effectiveWebhookUrl(
  settings: Pick<Settings, "webhookUrl" | "webhooksEnabled">,
  propUrl?: string | null,
): string | null {
  if (!settings.webhooksEnabled) return null;
  const url = settings.webhookUrl.trim() || propUrl?.trim() || "";
  return isValidWebhookUrl(url) ? url : null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; keepalive?: boolean }) => Promise<{ ok: boolean; status: number }>;

export type DeliveryOptions = {
  fetch: FetchLike;
  attempts?: number;
  /** Delay before retry n (1-based). */
  retryDelay?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  deliveryId?: string;
};

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** POSTs with retries. Resolves true on a 2xx, false after the last failed attempt. Never throws. */
export async function deliverWebhook(url: string, payload: WebhookPayload, options: DeliveryOptions): Promise<boolean> {
  if (!isValidWebhookUrl(url)) return false;
  const attempts = Math.max(1, options.attempts ?? 3);
  const delay = options.retryDelay ?? ((n: number) => 500 * 2 ** (n - 1));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = { "Content-Type": "application/json", [DELIVERY_HEADER]: options.deliveryId ?? randomId() };
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await options.fetch(url, { method: "POST", headers, body });
      if (response.ok) return true;
      // 4xx other than 408/429 will not succeed on retry.
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return false;
    } catch {
      // Network error: retry.
    }
    if (attempt < attempts) await sleep(delay(attempt));
  }
  return false;
}
