/**
 * Endpoint / MCP sync (spec section 11). Mirrors each route's annotations to a server
 * session with debounced create / update / remove, skipping annotations whose
 * `_syncedTo` marker (`<sessionId>:<signature>`) already matches. Tolerates an offline
 * or failing server: local data is never dropped, and failed runs retry with backoff.
 *
 * Wire contract (the public Agentation HTTP API endpoint list; shapes are this package's
 * reading of it and are verified only against tests/mock-server.mjs):
 *   POST   /sessions                    { url }            -> Session
 *   GET    /sessions/:id                                   -> Session & { annotations }
 *   POST   /sessions/:id/annotations    Annotation         -> Annotation
 *   PATCH  /annotations/:id             Partial<Annotation> -> Annotation
 *   DELETE /annotations/:id                                -> 2xx (404 counts as done)
 */
import { publicAnnotation } from "./send.ts";
import { ANNOTATIONS_KEY_PREFIX, type StorageLike } from "./storage.ts";
import type { Annotation } from "./types.ts";

/** Fields the server (or an agent) owns. Copied from the server, never part of the signature. */
export const SERVER_FIELDS = [
  "intent",
  "severity",
  "status",
  "thread",
  "resolvedAt",
  "resolvedBy",
  "authorId",
  "createdAt",
  "sessionId",
] as const;

const UNSIGNED = new Set<string>([...SERVER_FIELDS, "_syncedTo", "updatedAt"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a 32-bit, hex. */
export function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Signature of the client-owned content of an annotation (key order independent). */
export function syncSignature(annotation: Annotation): string {
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotation)) if (!UNSIGNED.has(key)) own[key] = value;
  return hashString(canonical(own));
}

export function syncMarker(sessionId: string, annotation: Annotation): string {
  return `${sessionId}:${syncSignature(annotation)}`;
}

/** What the next sync must do for an annotation in a session. */
export function syncActionFor(annotation: Annotation, sessionId: string): "create" | "update" | null {
  if (annotation._syncedTo === syncMarker(sessionId, annotation)) return null;
  return annotation._syncedTo?.startsWith(`${sessionId}:`) ? "update" : "create";
}

/** Previously synced annotations that are gone from the next list (need a server DELETE). */
export function removedAnnotations(previous: readonly Annotation[], next: readonly Annotation[]): Annotation[] {
  const ids = new Set(next.map((a) => a.id));
  return previous.filter((a) => !ids.has(a.id) && Boolean(a._syncedTo));
}

/** Copies server-owned fields onto the local annotation; returns the same object when nothing changed. */
export function mergeServerFields(local: Annotation, server: Partial<Annotation> | null | undefined): Annotation {
  if (!server) return local;
  let merged: Annotation | null = null;
  for (const key of SERVER_FIELDS) {
    const value = server[key];
    if (value === undefined) continue;
    if (canonical(value) === canonical(local[key])) continue;
    merged ??= { ...local };
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged ?? local;
}

/** Request body: client-owned fields only, so a comment edit never overwrites agent status. */
export function clientFields(annotation: Annotation, fallbackUrl: string): Annotation {
  const body = { ...publicAnnotation(annotation) } as Record<string, unknown>;
  for (const key of SERVER_FIELDS) delete body[key];
  body.url = annotation.url ?? fallbackUrl;
  return body as Annotation;
}

/** Exponential backoff: 1s, 2s, 4s ... capped at 30s. */
export function retryDelay(attempt: number, base = 1000, max = 30000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt));
}

export const SESSION_KEY_PREFIX = "feedback-session-";

/** Remembered session per route: `feedback-session-<pathname>[hash]`. */
export function getSessionStorageKey(routeKey: string): string {
  const route = routeKey.startsWith(ANNOTATIONS_KEY_PREFIX) ? routeKey.slice(ANNOTATIONS_KEY_PREFIX.length) : routeKey;
  return `${SESSION_KEY_PREFIX}${route}`;
}

export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Trailing debounce with an explicit flush. */
export function createDebouncer(fn: () => void, ms: number, timers: Timers = defaultTimers) {
  let timer: unknown = null;
  return {
    schedule() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      if (timer === null) return;
      timers.clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
    get pending() {
      return timer !== null;
    },
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Session = { id: string; url?: string; status?: string; annotations?: Annotation[] };

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> };
export type SyncFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

function unwrap<T>(value: unknown, key: string): T {
  if (value && typeof value === "object" && key in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>)[key] as T;
  }
  return value as T;
}

/** The HTTP contract in one place. Every method throws HttpError or a network error on failure. */
export function createSyncClient(endpoint: string, fetchImpl: SyncFetch) {
  const base = endpoint.trim().replace(/\/+$/, "");
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new HttpError(response.status, `${method} ${path} -> ${response.status}`);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const id = encodeURIComponent;
  return {
    endpoint: base,
    createSession: async (url: string) => unwrap<Session>(await request("POST", "/sessions", { url }), "session"),
    getSession: async (sessionId: string): Promise<Session | null> => {
      try {
        return unwrap<Session>(await request("GET", `/sessions/${id(sessionId)}`), "session");
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    },
    addAnnotation: async (sessionId: string, annotation: Annotation) =>
      unwrap<Annotation>(await request("POST", `/sessions/${id(sessionId)}/annotations`, annotation), "annotation"),
    updateAnnotation: async (annotationId: string, patch: Partial<Annotation>) =>
      unwrap<Annotation>(await request("PATCH", `/annotations/${id(annotationId)}`, patch), "annotation"),
    deleteAnnotation: async (annotationId: string) => {
      try {
        await request("DELETE", `/annotations/${id(annotationId)}`);
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
    },
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;

export type SyncStatus = "idle" | "connecting" | "connected" | "offline";

export type SyncEngineOptions = {
  client: SyncClient;
  storage?: StorageLike | null;
  /** Join this session for every route instead of one remembered session per route. */
  sessionId?: string;
  /** Route key for an annotation's `url`; server annotations of other routes are not merged in. */
  routeOfUrl: (url: string) => string;
  /** Applies a change to one route's stored list (current route or not). */
  apply: (routeKey: string, update: (list: Annotation[]) => Annotation[]) => void;
  onSessionCreated?: (sessionId: string) => void;
  /** A route's session is known (joined, remembered or created). */
  onSessionReady?: (routeKey: string, sessionId: string) => void;
  onStatus?: (status: SyncStatus) => void;
  debounceMs?: number;
  /** Poll interval for server-side changes (status, thread...). 0 disables. */
  pollMs?: number;
  timers?: Timers;
};

type RouteEntry = { url: string; list: Annotation[] };

export class SyncEngine {
  private options: SyncEngineOptions;
  private timers: Timers;
  private routes = new Map<string, RouteEntry>();
  private sessions = new Map<string, string>();
  private verified = new Set<string>();
  private removals: { id: string }[] = [];
  /** Ids removed locally whose server copies must stay (clear after a successful send). */
  private keepRemote = new Set<string>();
  private running: Promise<boolean> | null = null;
  private dirty = false;
  private attempt = 0;
  private retryTimer: unknown = null;
  private pollTimer: unknown = null;
  private activeRoute: string | null = null;
  private disposed = false;
  private debouncer: ReturnType<typeof createDebouncer>;
  status: SyncStatus = "idle";

  constructor(options: SyncEngineOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
    this.debouncer = createDebouncer(() => void this.flush(), options.debounceMs ?? 300, this.timers);
  }

  /** Session id currently used for a route, if known. */
  sessionFor(routeKey: string): string | undefined {
    return this.sessions.get(routeKey);
  }

  private setStatus(status: SyncStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  /** Records a route's latest list (call on every change and on navigation); schedules a sync. */
  track(routeKey: string, url: string, list: readonly Annotation[]) {
    if (this.disposed) return;
    const previous = this.routes.get(routeKey);
    if (previous) {
      for (const removed of removedAnnotations(previous.list, list)) {
        if (this.keepRemote.delete(removed.id)) continue;
        this.removals.push({ id: removed.id });
      }
    }
    this.routes.set(routeKey, { url, list: [...list] });
    this.activeRoute = routeKey;
    if (this.status === "idle") this.setStatus("connecting");
    this.debouncer.schedule();
  }

  /**
   * The next local removal of these ids is not mirrored: after Send, "Clear on send" empties
   * the toolbar but the agent still needs the sent annotations in its session.
   */
  retainOnServer(ids: readonly string[]) {
    for (const id of ids) this.keepRemote.add(id);
  }

  /** Runs a sync now. Resolves true when everything tracked is on the server. */
  flush(): Promise<boolean> {
    this.debouncer.cancel();
    if (this.running) {
      // The in-flight run loops once more to pick up this change.
      this.dirty = true;
      return this.running;
    }
    const loop = async () => {
      let ok = false;
      do {
        this.dirty = false;
        ok = await this.run();
      } while (this.dirty && !this.disposed);
      return ok;
    };
    this.running = loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async ensureSession(routeKey: string, url: string): Promise<string> {
    const { client, storage } = this.options;
    const known = this.sessions.get(routeKey);
    if (known && this.verified.has(known)) return known;
    const storageKey = getSessionStorageKey(routeKey);
    let candidate = this.options.sessionId ?? known;
    if (!candidate) {
      try {
        candidate = storage?.getItem(storageKey) ?? undefined;
      } catch {
        candidate = undefined;
      }
    }
    if (candidate) {
      const session = this.verified.has(candidate) ? { id: candidate } : await client.getSession(candidate);
      if (session) {
        this.verified.add(candidate);
        this.sessions.set(routeKey, candidate);
        this.options.onSessionReady?.(routeKey, candidate);
        if (session.annotations) this.pull(routeKey, candidate, session.annotations);
        return candidate;
      }
    }
    const created = await client.createSession(url);
    if (!created?.id) throw new Error("Session create returned no id");
    this.verified.add(created.id);
    this.sessions.set(routeKey, created.id);
    if (!this.options.sessionId) {
      try {
        storage?.setItem(storageKey, created.id);
      } catch {
        // Unavailable storage: the session is remembered for this page load only.
      }
    }
    this.options.onSessionCreated?.(created.id);
    this.options.onSessionReady?.(routeKey, created.id);
    return created.id;
  }

  /** Merges server-owned fields, and server-only annotations for this route, into the route's list. */
  private pull(routeKey: string, sessionId: string, serverList: readonly Annotation[]) {
    const pendingRemoval = new Set(this.removals.map((r) => r.id));
    const relevant = serverList.filter((a) => {
      if (!a || typeof a.id !== "string" || pendingRemoval.has(a.id)) return false;
      if (!a.url) return true;
      try {
        return this.options.routeOfUrl(a.url) === routeKey;
      } catch {
        return false;
      }
    });
    if (relevant.length === 0) return;
    const byId = new Map(relevant.map((a) => [a.id, a]));
    this.options.apply(routeKey, (list) => {
      let changed = false;
      const ids = new Set(list.map((a) => a.id));
      const next = list.map((local) => {
        const merged = mergeServerFields(local, byId.get(local.id));
        if (merged !== local) changed = true;
        return merged;
      });
      for (const server of relevant) {
        if (ids.has(server.id)) continue;
        const incoming = { ...server } as Annotation;
        delete incoming._syncedTo;
        incoming._syncedTo = syncMarker(sessionId, incoming);
        next.push(incoming);
        changed = true;
      }
      return changed ? next : list;
    });
  }

  private async run(): Promise<boolean> {
    const { client } = this.options;
    try {
      while (this.removals.length > 0) {
        await client.deleteAnnotation(this.removals[0].id);
        this.removals.shift();
      }
      for (const [routeKey, entry] of this.routes) {
        const sessionId = await this.ensureSession(routeKey, entry.url);
        const results = new Map<string, { marker: string; server: Annotation | null }>();
        for (const annotation of entry.list) {
          const action = syncActionFor(annotation, sessionId);
          if (!action) continue;
          const body = clientFields(annotation, entry.url);
          let server: Annotation | null = null;
          if (action === "update") {
            try {
              server = await client.updateAnnotation(annotation.id, body);
            } catch (error) {
              if (!(error instanceof HttpError && error.status === 404)) throw error;
              server = await client.addAnnotation(sessionId, body);
            }
          } else {
            try {
              server = await client.addAnnotation(sessionId, body);
            } catch (error) {
              if (!(error instanceof HttpError && error.status === 409)) throw error;
              server = await client.updateAnnotation(annotation.id, body);
            }
          }
          results.set(annotation.id, { marker: syncMarker(sessionId, annotation), server });
        }
        if (results.size > 0) {
          this.options.apply(routeKey, (list) =>
            list.map((item) => {
              const result = results.get(item.id);
              if (!result) return item;
              return { ...mergeServerFields(item, result.server), _syncedTo: result.marker };
            }),
          );
        }
      }
      this.attempt = 0;
      this.setStatus("connected");
      this.schedulePoll();
      return true;
    } catch {
      this.setStatus("offline");
      this.scheduleRetry();
      return false;
    }
  }

  private scheduleRetry() {
    if (this.disposed) return;
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, retryDelay(this.attempt));
    this.attempt += 1;
  }

  private schedulePoll() {
    const pollMs = this.options.pollMs ?? 0;
    if (this.disposed || pollMs <= 0) return;
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = null;
      void this.refresh();
    }, pollMs);
  }

  /** Pulls server-side changes (status, intent, severity, thread) for the active route. */
  async refresh(): Promise<void> {
    const routeKey = this.activeRoute;
    if (this.disposed || !routeKey || this.running) {
      this.schedulePoll();
      return;
    }
    const sessionId = this.sessions.get(routeKey);
    if (!sessionId) return;
    try {
      const session = await this.options.client.getSession(sessionId);
      if (!session) {
        // Server lost the session (restart): resync everything into a new one.
        this.verified.delete(sessionId);
        this.sessions.delete(routeKey);
        await this.flush();
        return;
      }
      if (session.annotations) this.pull(routeKey, sessionId, session.annotations);
      this.setStatus("connected");
      this.schedulePoll();
    } catch {
      this.setStatus("offline");
      this.scheduleRetry();
    }
  }

  dispose() {
    this.disposed = true;
    this.debouncer.cancel();
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
  }
}
