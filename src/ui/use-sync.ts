import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getRouteKey, type StorageLike } from "../core/storage.ts";
import { createSyncClient, SyncEngine, type SyncStatus } from "../core/sync.ts";
import type { Annotation } from "../core/types.ts";

export type SyncOptions = {
  endpoint?: string;
  sessionId?: string;
  routeKey: string;
  url: string;
  annotations: Annotation[];
  useHashLocation: boolean;
  apply: (routeKey: string, update: (list: Annotation[]) => Annotation[]) => void;
  onSessionCreated?: (sessionId: string) => void;
};

/** Poll interval for agent-side changes (status, intent, severity, thread). */
const POLL_MS = 3000;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Endpoint sync for the toolbar: one engine per endpoint/session, fed every list change. */
export function useSync(options: SyncOptions) {
  const { endpoint, sessionId, routeKey, url, annotations, useHashLocation } = options;
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [sessions, setSessions] = useState<ReadonlyMap<string, string>>(() => new Map());
  const engine = useRef<SyncEngine | null>(null);
  const apply = useEffectEvent((key: string, update: (list: Annotation[]) => Annotation[]) => options.apply(key, update));
  const created = useEffectEvent((id: string) => options.onSessionCreated?.(id));

  useEffect(() => {
    if (!endpoint?.trim()) return;
    const instance = new SyncEngine({
      client: createSyncClient(endpoint, (target, init) => window.fetch(target, init)),
      storage: safeStorage(),
      sessionId: sessionId || undefined,
      routeOfUrl: (value) => {
        const parsed = new URL(value, window.location.href);
        return getRouteKey({ pathname: parsed.pathname, hash: parsed.hash }, useHashLocation);
      },
      apply: (key, update) => apply(key, update),
      onSessionCreated: (id) => created(id),
      onSessionReady: (key, id) =>
        setSessions((current) => (current.get(key) === id ? current : new Map(current).set(key, id))),
      onStatus: setStatus,
      pollMs: POLL_MS,
    });
    engine.current = instance;
    return () => {
      instance.dispose();
      if (engine.current === instance) engine.current = null;
      setStatus("idle");
    };
  }, [endpoint, sessionId, useHashLocation]);

  useEffect(() => {
    engine.current?.track(routeKey, url, annotations);
  }, [routeKey, url, annotations, endpoint, sessionId, useHashLocation]);

  return {
    status: endpoint?.trim() ? status : undefined,
    sessionId: sessions.get(routeKey),
    /** Pushes everything now; resolves false when the server is unreachable. */
    flush: () => engine.current?.flush() ?? Promise.resolve(false),
    /** Keep server copies when these ids are cleared locally next. */
    retainOnServer: (ids: readonly string[]) => engine.current?.retainOnServer(ids),
  };
}
