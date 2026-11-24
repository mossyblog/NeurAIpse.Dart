// Minimal in-memory server for tests only. It implements the subset of the public
// Agentation HTTP API endpoint list that @neuraipse/annotate uses, plus test controls.
// It is NOT the real Agentation MCP server and makes no claim of full compatibility.
//
//   POST   /sessions                   { url }        -> 201 Session
//   GET    /sessions/:id                              -> Session & { annotations }
//   POST   /sessions/:id/annotations   Annotation     -> 201 Annotation (status "pending")
//   PATCH  /annotations/:id            fields         -> Annotation
//   DELETE /annotations/:id                           -> 204
//   POST   /annotations/:id/thread     { role, content } -> Annotation
//   GET    /health                                    -> { ok: true }
//   POST   /webhook                    any JSON       -> 204 (recorded, for webhook tests)
// Test controls: GET /__log (requests + webhooks), POST /__fail { fail: bool } (500 everything
// except /__*), POST /__reset. CORS is open, OPTIONS preflights answer 204.
//
// CLI: node packages/annotate/tests/mock-server.mjs [port]
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export function startMockServer({ port = 0, host = "127.0.0.1" } = {}) {
  const state = { sessions: new Map(), annotations: new Map(), log: [], webhooks: [], fail: false };

  const send = (res, status, body) => {
    res.writeHead(status, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Agentation-Delivery-Id",
      "Access-Control-Allow-Private-Network": "true",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

  const sessionView = (session) => ({
    ...session,
    annotations: [...state.annotations.values()].filter((a) => a.sessionId === session.id),
  });

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, "http://mock");
    const path = url.pathname;
    const body = req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req);
    if (!path.startsWith("/__")) {
      state.log.push({ method: req.method, path, body, headers: { delivery: req.headers["x-agentation-delivery-id"] } });
    }

    if (path === "/__log") return send(res, 200, { log: state.log, webhooks: state.webhooks, fail: state.fail });
    if (path === "/__fail") {
      state.fail = Boolean(body.fail);
      return send(res, 200, { fail: state.fail });
    }
    if (path === "/__reset") {
      state.sessions.clear();
      state.annotations.clear();
      state.log.length = 0;
      state.webhooks.length = 0;
      state.fail = false;
      return send(res, 200, { ok: true });
    }
    if (state.fail) return send(res, 500, { error: "injected failure" });

    if (path === "/webhook" && req.method === "POST") {
      state.webhooks.push({ body, delivery: req.headers["x-agentation-delivery-id"] });
      return send(res, 204);
    }
    if (path === "/health") return send(res, 200, { ok: true });

    if (path === "/sessions" && req.method === "POST") {
      const session = { id: `s_${randomUUID().slice(0, 8)}`, url: body.url ?? "", status: "active", createdAt: new Date().toISOString() };
      state.sessions.set(session.id, session);
      return send(res, 201, session);
    }
    if (path === "/sessions" && req.method === "GET") return send(res, 200, [...state.sessions.values()]);

    let match = /^\/sessions\/([^/]+)$/.exec(path);
    if (match && req.method === "GET") {
      const session = state.sessions.get(decodeURIComponent(match[1]));
      return session ? send(res, 200, sessionView(session)) : send(res, 404, { error: "not found" });
    }
    match = /^\/sessions\/([^/]+)\/annotations$/.exec(path);
    if (match && req.method === "POST") {
      const sessionId = decodeURIComponent(match[1]);
      if (!state.sessions.has(sessionId)) return send(res, 404, { error: "no session" });
      const id = body.id ?? randomUUID();
      if (state.annotations.has(id)) return send(res, 409, { error: "exists" });
      const now = new Date().toISOString();
      const annotation = { status: "pending", ...body, id, sessionId, createdAt: now, updatedAt: now };
      state.annotations.set(id, annotation);
      return send(res, 201, annotation);
    }
    match = /^\/annotations\/([^/]+)(\/thread)?$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const existing = state.annotations.get(id);
      if (match[2] && req.method === "POST") {
        if (!existing) return send(res, 404, { error: "not found" });
        const message = { id: randomUUID(), role: body.role ?? "agent", content: body.content ?? "", timestamp: Date.now() };
        existing.thread = [...(existing.thread ?? []), message];
        return send(res, 200, existing);
      }
      if (req.method === "GET") return existing ? send(res, 200, existing) : send(res, 404, { error: "not found" });
      if (req.method === "PATCH") {
        if (!existing) return send(res, 404, { error: "not found" });
        const updated = { ...existing, ...body, id, sessionId: existing.sessionId, updatedAt: new Date().toISOString() };
        // Agent-owned fields survive a client PATCH that does not carry them.
        for (const key of ["status", "intent", "severity", "thread", "resolvedAt", "resolvedBy"]) {
          if (body[key] === undefined && existing[key] !== undefined) updated[key] = existing[key];
        }
        state.annotations.set(id, updated);
        return send(res, 200, updated);
      }
      if (req.method === "DELETE") {
        if (!existing) return send(res, 404, { error: "not found" });
        state.annotations.delete(id);
        return send(res, 204);
      }
    }
    return send(res, 404, { error: "no route" });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        port: address.port,
        state,
        setFailing: (fail) => {
          state.fail = fail;
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4747);
  startMockServer({ port, host: "127.0.0.1" }).then((mock) => console.log(`mock sync server on ${mock.url}`));
}
