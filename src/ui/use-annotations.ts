import { useRef, useState } from "react";
import { loadAnnotations, saveAnnotations } from "../core/storage.ts";
import type { Annotation } from "../core/types.ts";

type Store = { key: string; list: Annotation[]; version: number };

let counter = 0;
/** Monotonic version stamp. */
const now = () => (counter += 1);

/**
 * Annotations for one storage key. Switching keys (route change) reloads from storage
 * during render, so a list is never saved under another route's key.
 */
export function useAnnotations(key: string) {
  const [store, setStore] = useState<Store>(() => ({ key, list: loadAnnotations(key), version: now() }));
  /** Last committed list, so several async updates in one tick compose instead of overwriting. */
  const committed = useRef<Store | null>(null);
  let current = store;
  if (store.key !== key) {
    current = { key, list: loadAnnotations(key), version: now() };
    setStore(current);
  }

  const commit = (list: Annotation[]) => {
    const next = { key, list, version: now() };
    committed.current = next;
    saveAnnotations(key, list);
    setStore(next);
  };

  /**
   * Applies `update` to any route's list: the active route through state, other routes
   * straight in storage. Safe to call after an await.
   */
  const updateRoute = (routeKey: string, update: (list: Annotation[]) => Annotation[]) => {
    if (routeKey === key) {
      const last = committed.current;
      const base = last && last.key === key && last.version >= current.version ? last.list : current.list;
      const next = update(base);
      if (next !== base) commit(next);
      return;
    }
    const stored = loadAnnotations(routeKey);
    const next = update(stored);
    if (next !== stored) saveAnnotations(routeKey, next);
  };

  return { annotations: current.list, commit, updateRoute };
}
