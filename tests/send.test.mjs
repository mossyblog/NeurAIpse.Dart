// Phase 5: Send state machine, S-key gating, webhook payloads, URL validation and delivery.
import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import {
  DELIVERY_HEADER,
  SEND_LABELS,
  buildWebhookPayload,
  canSend,
  deliverWebhook,
  effectiveWebhookUrl,
  hasSendTarget,
  isValidWebhookUrl,
  nextSendState,
  publicAnnotation,
  resolveShortcut,
  sameFeedback,
} from "../dist/core/index.js";
import { startMockServer } from "./mock-server.mjs";

const annotation = { id: "a1", x: 1, y: 2, comment: "c", element: "button", elementPath: "button", timestamp: 3, _syncedTo: "s:x" };
const noSleep = async () => {};

test("send states move idle -> sending -> sent|failed -> idle only", () => {
  // Intent: the four icon states and the delayed revert follow spec section 11.
  assert.equal(nextSendState("idle", "start"), "sending");
  assert.equal(nextSendState("sending", "success"), "sent");
  assert.equal(nextSendState("sending", "failure"), "failed");
  assert.equal(nextSendState("sent", "reset"), "idle");
  assert.equal(nextSendState("failed", "reset"), "idle");
  // Intent: invalid transitions are ignored (no double send, no reset mid-flight).
  assert.equal(nextSendState("sending", "start"), "sending");
  assert.equal(nextSendState("sending", "reset"), "sending");
  assert.equal(nextSendState("idle", "success"), "idle");
  assert.equal(SEND_LABELS.idle, "Send Annotations");
});

test("canSend needs annotations, a target (onSubmit, endpoint or webhook) and idle", () => {
  // Intent: the Send button and S key enable only when sending can do something.
  assert.equal(hasSendTarget({}), false);
  assert.equal(hasSendTarget({ endpoint: "  " }), false);
  assert.equal(hasSendTarget({ onSubmit: () => {} }), true);
  assert.equal(hasSendTarget({ webhookUrl: "https://hook.test" }), true);
  assert.equal(canSend(1, { endpoint: "http://localhost:4747" }, "idle"), true);
  assert.equal(canSend(0, { endpoint: "http://localhost:4747" }, "idle"), false);
  assert.equal(canSend(1, { endpoint: "http://localhost:4747" }, "sending"), false);
});

test("S shortcut is gated on annotations, canSend and idle state", () => {
  // Intent: section 2 gating for S, using the same inputs the toolbar passes.
  const key = { key: "s", metaKey: false, ctrlKey: false, shiftKey: false, repeat: false };
  const state = { active: true, enableKeyboardShortcuts: true, editableTarget: false, annotationCount: 1, canSend: true, sendState: "idle" };
  assert.equal(resolveShortcut(key, state), "send");
  assert.equal(resolveShortcut(key, { ...state, canSend: false }), null);
  assert.equal(resolveShortcut(key, { ...state, sendState: "sending" }), null);
  assert.equal(resolveShortcut(key, { ...state, annotationCount: 0 }), null);
});

test("publicAnnotation drops only the local sync marker", () => {
  // Intent: callbacks and webhooks never see _syncedTo; other fields pass through.
  assert.equal("_syncedTo" in publicAnnotation(annotation), false);
  assert.equal(publicAnnotation(annotation).comment, "c");
  const plain = { ...annotation };
  delete plain._syncedTo;
  assert.equal(publicAnnotation(plain), plain);
});

test("sameFeedback ignores sync bookkeeping but not content changes", () => {
  // Intent: auto-clear after Send/Copy still happens when sync only added _syncedTo/status.
  const list = [annotation];
  assert.equal(sameFeedback(list, [{ ...annotation, _syncedTo: "s:y", status: "pending" }]), true);
  assert.equal(sameFeedback(list, [{ ...annotation, comment: "edited" }]), false);
  assert.equal(sameFeedback(list, []), false);
  assert.equal(sameFeedback(list, [{ ...annotation, id: "other" }]), false);
});

test("buildWebhookPayload follows the public event shapes", () => {
  // Intent: annotation.* carry `annotation`, clear carries `annotations`, submit adds `output`.
  const ctx = { url: "https://app.test/x", timestamp: 5 };
  assert.deepEqual(Object.keys(buildWebhookPayload("annotation.add", { annotation }, ctx)).sort(), ["annotation", "event", "timestamp", "url"]);
  assert.equal(buildWebhookPayload("annotation.add", { annotation }, ctx).annotation._syncedTo, undefined);
  assert.equal(buildWebhookPayload("annotations.clear", { annotations: [annotation] }, ctx).annotations.length, 1);
  const submit = buildWebhookPayload("submit", { annotations: [annotation], output: "## Page Feedback: /x" }, ctx);
  assert.equal(submit.output, "## Page Feedback: /x");
  assert.equal(submit.event, "submit");
});

test("effectiveWebhookUrl: http(s) only, setting wins over prop, disabled means none", () => {
  // Intent: webhook URL validation and precedence.
  const on = { webhooksEnabled: true, webhookUrl: "" };
  assert.equal(effectiveWebhookUrl(on, "https://prop.test/h"), "https://prop.test/h");
  assert.equal(effectiveWebhookUrl({ ...on, webhookUrl: " https://set.test/h " }, "https://prop.test/h"), "https://set.test/h");
  assert.equal(effectiveWebhookUrl({ ...on, webhookUrl: "ftp://x.test" }, "https://prop.test/h"), null);
  assert.equal(effectiveWebhookUrl(on, "javascript:alert(1)"), null);
  assert.equal(effectiveWebhookUrl({ webhooksEnabled: false, webhookUrl: "https://set.test" }), null);
  assert.equal(isValidWebhookUrl("http://localhost:4747/webhook"), true);
});

let mock;
before(async () => {
  mock = await startMockServer();
});
after(() => mock.close());

test("deliverWebhook POSTs JSON with a delivery id to the receiver", async () => {
  // Intent: real HTTP delivery of an annotation event.
  const payload = buildWebhookPayload("annotation.add", { annotation }, { url: "https://app.test/", timestamp: 1 });
  assert.equal(await deliverWebhook(`${mock.url}/webhook`, payload, { fetch: (u, i) => fetch(u, i), sleep: noSleep }), true);
  const hook = mock.state.webhooks.at(-1);
  assert.equal(hook.body.event, "annotation.add");
  assert.equal(hook.body.annotation.id, "a1");
  assert.ok(hook.delivery);
});

test("deliverWebhook retries with the same delivery id, then reports failure without throwing", async () => {
  // Intent: failures never lose data; receivers can dedupe retries.
  const ids = [];
  let calls = 0;
  const flaky = async (url, init) => {
    calls += 1;
    ids.push(init.headers[DELIVERY_HEADER]);
    if (calls < 3) throw new Error("network");
    return { ok: true, status: 200 };
  };
  const payload = buildWebhookPayload("submit", { annotations: [annotation], output: "x" }, { url: "u", timestamp: 1 });
  assert.equal(await deliverWebhook("https://hook.test", payload, { fetch: flaky, sleep: noSleep }), true);
  assert.equal(new Set(ids).size, 1);
  assert.equal(calls, 3);
  mock.setFailing(true);
  assert.equal(await deliverWebhook(`${mock.url}/webhook`, payload, { fetch: (u, i) => fetch(u, i), sleep: noSleep }), false);
  mock.setFailing(false);
  assert.equal(await deliverWebhook("http://127.0.0.1:9/hook", payload, { fetch: (u, i) => fetch(u, i), sleep: noSleep, attempts: 1 }), false);
  // Intent: invalid URLs are never requested.
  let used = false;
  assert.equal(await deliverWebhook("file:///etc/passwd", payload, { fetch: async () => ((used = true), { ok: true, status: 200 }) }), false);
  assert.equal(used, false);
});

test("deliverWebhook does not retry a 4xx rejection", async () => {
  // Intent: a receiver that rejects the payload is not hammered.
  let calls = 0;
  const reject = async () => ((calls += 1), { ok: false, status: 400 });
  assert.equal(await deliverWebhook("https://hook.test", { event: "submit", timestamp: 1, url: "u" }, { fetch: reject, sleep: noSleep }), false);
  assert.equal(calls, 1);
});
