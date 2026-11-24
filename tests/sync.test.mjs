// Phase 5: sync signature, debounce, endpoint client and engine against the in-repo mock server.
import { strict as assert } from "node:assert";
import { after, before, beforeEach, test } from "node:test";
import {
  SyncEngine,
  clientFields,
  createDebouncer,
  createSyncClient,
  getSessionStorageKey,
  hashString,
  mergeServerFields,
  removedAnnotations,
  retryDelay,
  syncActionFor,
  syncMarker,
  syncSignature,
} from "../dist/core/index.js";
import { startMockServer } from "./mock-server.mjs";

const base = { id: "a1", x: 10, y: 20, comment: "Fix", element: "button", elementPath: "main > button", timestamp: 1, url: "https://app.test/settings" };

function memoryStorage() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

/** Manual timers so debounce and retry are deterministic. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const queue = new Map();
  return {
    setTimeout: (fn, ms) => {
      seq += 1;
      queue.set(seq, { fn, at: now + ms });
      return seq;
    },
    clearTimeout: (id) => queue.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, item] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= now) {
          queue.delete(id);
          item.fn();
        }
      }
    },
    get size() {
      return queue.size;
    },
  };
}

test("syncSignature ignores key order, server-owned fields and the marker itself", () => {
  // Intent: agent status/thread updates and _syncedTo never cause a re-sync; content edits do.
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(syncSignature(base), syncSignature(reordered));
  assert.equal(syncSignature(base), syncSignature({ ...base, status: "resolved", thread: [{ id: "t", role: "agent", content: "ok", timestamp: 2 }], _syncedTo: "x", updatedAt: "now" }));
  assert.notEqual(syncSignature(base), syncSignature({ ...base, comment: "Fix it" }));
  assert.match(hashString("abc"), /^[0-9a-f]{8}$/);
});

test("syncActionFor picks create, update or nothing from the per-annotation marker", () => {
  // Intent: unchanged annotations are skipped; a new session means create again.
  assert.equal(syncActionFor(base, "s1"), "create");
  const synced = { ...base, _syncedTo: syncMarker("s1", base) };
  assert.equal(syncActionFor(synced, "s1"), null);
  assert.equal(syncActionFor({ ...synced, comment: "changed" }, "s1"), "update");
  assert.equal(syncActionFor(synced, "s2"), "create");
});

test("removedAnnotations only reports annotations that reached the server", () => {
  // Intent: deleting a never-synced annotation sends no DELETE.
  const synced = { ...base, _syncedTo: "s1:x" };
  const local = { ...base, id: "a2" };
  assert.deepEqual(removedAnnotations([synced, local], []).map((a) => a.id), ["a1"]);
  assert.deepEqual(removedAnnotations([synced], [synced]), []);
});

test("mergeServerFields copies intent/severity/status/thread and keeps identity when unchanged", () => {
  // Intent: server-populated fields land locally without churning React state.
  const merged = mergeServerFields(base, { status: "acknowledged", intent: "fix", severity: "blocking", thread: [], comment: "server comment" });
  assert.equal(merged.status, "acknowledged");
  assert.equal(merged.intent, "fix");
  assert.equal(merged.severity, "blocking");
  assert.equal(merged.comment, "Fix", "client-owned fields are not overwritten");
  assert.equal(mergeServerFields(merged, { status: "acknowledged" }), merged);
  assert.equal(mergeServerFields(base, null), base);
});

test("clientFields strips server-owned fields and the marker from request bodies", () => {
  // Intent: a comment edit can never overwrite a status the agent set.
  const body = clientFields({ ...base, status: "pending", _syncedTo: "s:x", url: undefined }, "https://fallback/");
  assert.equal("status" in body, false);
  assert.equal("_syncedTo" in body, false);
  assert.equal(body.url, "https://fallback/");
});

test("retryDelay backs off exponentially with a cap", () => {
  // Intent: failed-server tolerance without hammering.
  assert.deepEqual([0, 1, 2, 3].map((n) => retryDelay(n)), [1000, 2000, 4000, 8000]);
  assert.equal(retryDelay(10), 30000);
});

test("getSessionStorageKey is per route (pathname + hash)", () => {
  // Intent: per-route sessions are remembered under their own key.
  assert.equal(getSessionStorageKey("feedback-annotations-/settings#/a"), "feedback-session-/settings#/a");
  assert.equal(getSessionStorageKey("/x"), "feedback-session-/x");
});

test("createDebouncer coalesces calls and flushes on demand", () => {
  // Intent: rapid edits produce one sync; flush runs the pending call immediately.
  const timers = fakeTimers();
  let calls = 0;
  const debounce = createDebouncer(() => (calls += 1), 300, timers);
  debounce.schedule();
  timers.advance(200);
  debounce.schedule();
  timers.advance(200);
  assert.equal(calls, 0);
  timers.advance(100);
  assert.equal(calls, 1);
  debounce.schedule();
  debounce.flush();
  assert.equal(calls, 2);
  debounce.flush();
  assert.equal(calls, 2, "flush without a pending call does nothing");
});

// ---- Against the mock server ----

let mock;
before(async () => {
  mock = await startMockServer();
});
after(() => mock.close());
beforeEach(async () => {
  await fetch(`${mock.url}/__reset`, { method: "POST" });
});

const routeOfUrl = (url) => `feedback-annotations-${new URL(url).pathname}`;
const ROUTE = "feedback-annotations-/settings";
const PAGE = "https://app.test/settings";

/** Engine wired to an in-memory bucket store, like the toolbar's updateRoute. */
function harness(options = {}) {
  const buckets = new Map();
  const events = { created: [], statuses: [] };
  const timers = fakeTimers();
  const storage = options.storage ?? memoryStorage();
  const engine = new SyncEngine({
    client: createSyncClient(options.endpoint ?? mock.url, (u, i) => fetch(u, i)),
    storage,
    sessionId: options.sessionId,
    routeOfUrl,
    apply: (key, update) => {
      buckets.set(key, update(buckets.get(key) ?? []));
      engine.track(key, PAGE, buckets.get(key));
    },
    onSessionCreated: (id) => events.created.push(id),
    onStatus: (status) => events.statuses.push(status),
    timers,
    debounceMs: 300,
  });
  const set = (key, list) => {
    buckets.set(key, list);
    engine.track(key, PAGE, list);
  };
  return { engine, buckets, events, timers, storage, set };
}

const log = async () => (await (await fetch(`${mock.url}/__log`)).json()).log;

test("first sync creates a session, reports it, remembers it per route and marks annotations", async () => {
  // Intent: session create + onSessionCreated + per-annotation _syncedTo after a create.
  const h = harness();
  h.set(ROUTE, [base]);
  assert.equal(await h.engine.flush(), true);
  assert.equal(h.events.created.length, 1);
  const sessionId = h.events.created[0];
  assert.equal(h.storage.getItem(getSessionStorageKey(ROUTE)), sessionId);
  const [stored] = h.buckets.get(ROUTE);
  assert.equal(stored._syncedTo, syncMarker(sessionId, base));
  assert.equal(stored.status, "pending", "server-populated status merged in");
  assert.equal(h.engine.status, "connected");
  // Intent: an unchanged annotation is not sent again.
  const before = (await log()).length;
  assert.equal(await h.engine.flush(), true);
  assert.equal((await log()).length - before, 0, "verified session and unchanged signature: no requests");
  h.engine.dispose();
});

test("edits update, deletions remove, and debounce coalesces bursts", async () => {
  // Intent: debounced create/update/remove mirroring with one request per change set.
  const h = harness();
  h.set(ROUTE, [base]);
  await h.engine.flush();
  const synced = h.buckets.get(ROUTE)[0];
  for (const comment of ["one", "two", "three"]) h.set(ROUTE, [{ ...synced, comment }]);
  const beforeBurst = (await log()).length;
  h.timers.advance(300);
  await h.engine.flush();
  const burst = (await log()).slice(beforeBurst).filter((r) => r.method === "PATCH");
  assert.equal(burst.length, 1);
  assert.equal(burst[0].body.comment, "three");
  h.set(ROUTE, []);
  await h.engine.flush();
  const deletes = (await log()).filter((r) => r.method === "DELETE");
  assert.deepEqual(deletes.map((r) => r.path), ["/annotations/a1"]);
  assert.equal(mock.state.annotations.size, 0);
  h.engine.dispose();
});

test("retainOnServer: clearing after Send keeps the server copies", async () => {
  // Intent: "Clear on send" empties the toolbar without deleting what the agent was sent.
  const h = harness();
  h.set(ROUTE, [base]);
  await h.engine.flush();
  h.engine.retainOnServer(["a1"]);
  h.set(ROUTE, []);
  await h.engine.flush();
  assert.equal(mock.state.annotations.size, 1);
  assert.equal((await log()).filter((r) => r.method === "DELETE").length, 0);
  // Intent: the exemption is one-shot; a later removal of the same id is mirrored.
  h.set(ROUTE, [{ ...base, _syncedTo: "previously-synced" }]);
  h.set(ROUTE, []);
  await h.engine.flush();
  assert.equal((await log()).filter((r) => r.method === "DELETE").length, 1);
  h.engine.dispose();
});

test("offline server: data is kept, status goes offline, and a retry syncs it later", async () => {
  // Intent: failed-server tolerance with retry and no data loss.
  const h = harness();
  mock.setFailing(true);
  h.set(ROUTE, [base]);
  assert.equal(await h.engine.flush(), false);
  assert.equal(h.engine.status, "offline");
  assert.equal(h.buckets.get(ROUTE).length, 1, "local data untouched");
  assert.equal(h.buckets.get(ROUTE)[0]._syncedTo, undefined);
  mock.setFailing(false);
  h.timers.advance(1000);
  // The retry timer called flush(); wait for it.
  await h.engine.flush();
  assert.equal(h.engine.status, "connected");
  assert.ok(h.buckets.get(ROUTE)[0]._syncedTo);
  assert.equal(mock.state.annotations.size, 1);
  h.engine.dispose();
});

test("unreachable endpoint (connection refused) is tolerated the same way", async () => {
  // Intent: a server that is not running at all never throws into the UI.
  const h = harness({ endpoint: "http://127.0.0.1:9" });
  h.set(ROUTE, [base]);
  assert.equal(await h.engine.flush(), false);
  assert.equal(h.engine.status, "offline");
  h.engine.dispose();
});

test("explicit sessionId joins the session and pulls annotations for the active route only", async () => {
  // Intent: join flow; server-only annotations whose url matches the route appear locally.
  const session = await (await fetch(`${mock.url}/sessions`, { method: "POST", body: JSON.stringify({ url: PAGE }) })).json();
  for (const [id, url] of [["remote-1", PAGE], ["remote-2", "https://app.test/other"]]) {
    await fetch(`${mock.url}/sessions/${session.id}/annotations`, { method: "POST", body: JSON.stringify({ ...base, id, url }) });
  }
  const h = harness({ sessionId: session.id });
  h.set(ROUTE, []);
  assert.equal(await h.engine.flush(), true);
  assert.deepEqual(h.events.created, [], "joined, not created");
  assert.deepEqual(h.buckets.get(ROUTE).map((a) => a.id), ["remote-1"]);
  assert.equal(h.engine.sessionFor(ROUTE), session.id);
  h.engine.dispose();
});

test("refresh pulls agent-side status, intent, severity and thread without re-sending", async () => {
  // Intent: annotation fields populated from the server; the synced signature stays valid.
  const h = harness();
  h.set(ROUTE, [base]);
  await h.engine.flush();
  await fetch(`${mock.url}/annotations/a1`, { method: "PATCH", body: JSON.stringify({ status: "resolved", intent: "fix", severity: "important" }) });
  await fetch(`${mock.url}/annotations/a1/thread`, { method: "POST", body: JSON.stringify({ role: "agent", content: "Done" }) });
  await h.engine.refresh();
  const local = h.buckets.get(ROUTE)[0];
  assert.equal(local.status, "resolved");
  assert.equal(local.intent, "fix");
  assert.equal(local.severity, "important");
  assert.equal(local.thread[0].content, "Done");
  assert.equal(syncActionFor(local, h.engine.sessionFor(ROUTE)), null);
  // Intent: a later local comment edit does not clobber the agent's status on the server.
  h.set(ROUTE, [{ ...local, comment: "Edited" }]);
  await h.engine.flush();
  assert.equal(mock.state.annotations.get("a1").status, "resolved");
  assert.equal(mock.state.annotations.get("a1").comment, "Edited");
  h.engine.dispose();
});

test("per-route sessions: each route gets its own session, remembered across engines", async () => {
  // Intent: hash/path routes map to separate sessions, and a reload reuses them.
  const storage = memoryStorage();
  const h = harness({ storage });
  const other = "feedback-annotations-/settings#/b";
  h.set(ROUTE, [base]);
  h.set(other, [{ ...base, id: "b1" }]);
  await h.engine.flush();
  assert.equal(h.events.created.length, 2);
  assert.notEqual(h.engine.sessionFor(ROUTE), h.engine.sessionFor(other));
  h.engine.dispose();
  const again = harness({ storage });
  again.set(ROUTE, h.buckets.get(ROUTE));
  await again.engine.flush();
  assert.deepEqual(again.events.created, [], "remembered session reused");
  assert.equal(again.engine.sessionFor(ROUTE), h.engine.sessionFor(ROUTE));
  again.engine.dispose();
});

test("a lost session (server restart) is recreated and annotations re-synced", async () => {
  // Intent: in-memory servers forget sessions; the client recovers without losing data.
  const h = harness();
  h.set(ROUTE, [base]);
  await h.engine.flush();
  const first = h.engine.sessionFor(ROUTE);
  await fetch(`${mock.url}/__reset`, { method: "POST" });
  await h.engine.refresh();
  assert.notEqual(h.engine.sessionFor(ROUTE), first);
  assert.equal(mock.state.annotations.size, 1);
  h.engine.dispose();
});
