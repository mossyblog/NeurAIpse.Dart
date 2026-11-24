import { normalizeSettings } from "./settings.ts";
import type { Annotation, Point, Settings, Theme } from "./types.ts";

export const ANNOTATIONS_KEY_PREFIX = "feedback-annotations-";
export const POSITION_KEY = "feedback-toolbar-position";
export const SETTINGS_KEY = "feedback-toolbar-settings";
export const THEME_KEY = "feedback-toolbar-theme";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `feedback-annotations-<pathname>`, plus the hash when hash routing is on. */
export function getStorageKey(pathname: string, hash?: string): string {
  return `${ANNOTATIONS_KEY_PREFIX}${pathname}${hash ?? ""}`;
}

/** The route string used for storage and marker visibility. */
export function getRouteKey(
  location: { pathname: string; hash: string },
  useHashLocation = false,
): string {
  return getStorageKey(location.pathname, useHashLocation ? location.hash : undefined);
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string, storage: StorageLike | null): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown, storage: StorageLike | null): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or unavailable; the UI keeps working in memory.
  }
}

export function loadAnnotations(key: string, storage = defaultStorage()): Annotation[] {
  const value = readJson(key, storage);
  return Array.isArray(value) ? (value as Annotation[]) : [];
}

export function saveAnnotations(key: string, list: Annotation[], storage = defaultStorage()): void {
  writeJson(key, list, storage);
}

export function loadPosition(storage = defaultStorage()): Point | null {
  const value = readJson(POSITION_KEY, storage) as Partial<Point> | undefined;
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { x: value.x as number, y: value.y as number };
  }
  return null;
}

export function savePosition(position: Point, storage = defaultStorage()): void {
  writeJson(POSITION_KEY, { x: Math.round(position.x), y: Math.round(position.y) }, storage);
}

export function loadSettings(storage = defaultStorage()): Settings {
  return normalizeSettings(readJson(SETTINGS_KEY, storage));
}

export function saveSettings(settings: Settings, storage = defaultStorage()): void {
  writeJson(SETTINGS_KEY, settings, storage);
}

export function loadTheme(storage = defaultStorage()): Theme {
  try {
    return storage?.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme, storage = defaultStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Ignore unavailable storage.
  }
}
