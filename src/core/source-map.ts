/**
 * Source-map lookup for owner-stack frames (dev bundles only). Resolves a bundle
 * position (`chunk.js:1432:214`) to `path:line:column` in the original file.
 * Supports plain v3 maps and index maps with `sections` (Turbopack dev chunks).
 */
import type { StackFrame } from "./stack.ts";

export type Mapping = {
  generatedColumn: number;
  source: number;
  originalLine: number;
  originalColumn: number;
};

/** Decoded `mappings`: one array per generated line (all values 0-based). */
export type DecodedLines = Mapping[][];

export type BasicSourceMap = { version: number; sources: string[]; mappings: string; sourceRoot?: string };
export type SectionedSourceMap = {
  version: number;
  sections: { offset: { line: number; column: number }; map: BasicSourceMap | SectionedSourceMap }[];
};
export type SourceMap = BasicSourceMap | SectionedSourceMap;

export type OriginalPosition = { source: string; line: number; column: number };

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map(Array.from(BASE64, (char, index) => [char, index]));

/** Decodes a base64 VLQ string into signed integers. Returns null on bad input. */
export function decodeVlq(segment: string): number[] | null {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) return null;
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
    value = 0;
    shift = 0;
  }
  return shift === 0 ? values : null;
}

/** Decodes a v3 `mappings` string. Segments without a source are dropped. */
export function decodeMappings(mappings: string): DecodedLines {
  const lines: DecodedLines = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const lineText of mappings.split(";")) {
    const line: Mapping[] = [];
    let generatedColumn = 0;
    if (lineText) {
      for (const segmentText of lineText.split(",")) {
        if (!segmentText) continue;
        const fields = decodeVlq(segmentText);
        if (!fields || fields.length === 0) continue;
        generatedColumn += fields[0];
        if (fields.length < 4) continue;
        source += fields[1];
        originalLine += fields[2];
        originalColumn += fields[3];
        line.push({ generatedColumn, source, originalLine, originalColumn });
      }
    }
    line.sort((a, b) => a.generatedColumn - b.generatedColumn);
    lines.push(line);
  }
  return lines;
}

const decodedCache = new WeakMap<BasicSourceMap, DecodedLines>();

function decoded(map: BasicSourceMap): DecodedLines {
  let lines = decodedCache.get(map);
  if (!lines) {
    lines = decodeMappings(map.mappings ?? "");
    decodedCache.set(map, lines);
  }
  return lines;
}

/**
 * Original position for a 0-based generated line/column. Uses the closest mapping at or
 * before the column on the same generated line only (never a previous line).
 */
export function originalPositionFor(map: SourceMap, line: number, column: number): OriginalPosition | null {
  if ("sections" in map && Array.isArray(map.sections)) {
    let chosen: SectionedSourceMap["sections"][number] | null = null;
    for (const section of map.sections) {
      const { line: l, column: c } = section.offset;
      if (l < line || (l === line && c <= column)) chosen = section;
      else break;
    }
    if (!chosen) return null;
    const innerLine = line - chosen.offset.line;
    const innerColumn = innerLine === 0 ? column - chosen.offset.column : column;
    return originalPositionFor(chosen.map, innerLine, innerColumn);
  }
  const basic = map as BasicSourceMap;
  const segments = decoded(basic)[line];
  if (!segments || segments.length === 0) return null;
  let found: Mapping | null = null;
  for (const segment of segments) {
    if (segment.generatedColumn <= column) found = segment;
    else break;
  }
  if (!found) return null;
  const source = basic.sources[found.source];
  if (source == null) return null;
  const root = basic.sourceRoot ? basic.sourceRoot.replace(/\/?$/, "/") : "";
  return { source: root && !/^[a-z]+:/i.test(source) ? `${root}${source}` : source, line: found.originalLine, column: found.originalColumn };
}

const PROJECT_MARKERS = ["/apps/", "/packages/", "/modules/", "/src/"];

/**
 * Turns a source-map `sources` entry into a project-relative path:
 * `file:///Users/me/repo/apps/host/src/page.tsx` -> `apps/host/src/page.tsx`,
 * `turbopack:///[project]/src/page.tsx` -> `src/page.tsx`, `webpack://_N_E/./src/x.tsx` -> `src/x.tsx`.
 * Returns null for sources that are not files (e.g. `about://`, `[turbopack]/runtime`).
 */
export function toProjectPath(source: string): string | null {
  let path = source;
  try {
    path = decodeURIComponent(source);
  } catch {
    // Keep the raw value.
  }
  const project = /\[project\]\/(.+)$/.exec(path);
  if (project) return project[1].replace(/[?#].*$/, "");
  if (/^webpack:\/\//.test(path)) {
    return path.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "").replace(/[?#].*$/, "") || null;
  }
  if (path.startsWith("file://")) path = path.slice("file://".length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  path = path.replace(/[?#].*$/, "");
  if (!path.startsWith("/")) return path.replace(/^\.\//, "") || null;
  if (path.includes("/node_modules/")) return path.slice(path.lastIndexOf("/node_modules/") + 1);
  let cut = -1;
  for (const marker of PROJECT_MARKERS) {
    const index = path.indexOf(marker);
    if (index >= 0 && (cut < 0 || index < cut)) cut = index;
  }
  return cut >= 0 ? path.slice(cut + 1) : path;
}

const TRUSTED = /^(?![a-z][\w+.-]*:\/\/)[^\s:]+\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx)$/i;

/** `path:line:column`, 1-based, from a 0-based original position. */
export function formatSourceFile(path: string, line: number, column: number): string {
  return `${path}:${line + 1}:${column + 1}`;
}

/**
 * True for a project file location an editor can open: `path:line:column` with positive
 * integers, a script/component extension, no URL scheme and not inside node_modules.
 */
export function isTrustworthySourceFile(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = /^(.+):(\d+):(\d+)$/.exec(value);
  if (!match) return false;
  const [, path, line, column] = match;
  if (Number(line) < 1 || Number(column) < 1) return false;
  if (path.includes("node_modules/")) return false;
  return TRUSTED.test(path);
}

export type FetchText = (url: string) => Promise<string | null>;

/** Only same-origin http(s) bundles are looked up; server (`about://React/...`) frames never are. */
export function isFetchableBundle(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === origin;
  } catch {
    return false;
  }
}

/** Resolves frames through `<bundle>.map` (or the bundle's sourceMappingURL), caching per bundle. */
export function createSourceResolver(fetchText: FetchText, origin: string) {
  const maps = new Map<string, Promise<SourceMap | null>>();

  const loadMap = (bundle: string): Promise<SourceMap | null> => {
    let pending = maps.get(bundle);
    if (!pending) {
      pending = (async () => {
        const parse = (text: string | null) => {
          if (!text) return null;
          try {
            const value = JSON.parse(text) as SourceMap;
            return value && typeof value === "object" && ("mappings" in value || "sections" in value) ? value : null;
          } catch {
            return null;
          }
        };
        const direct = parse(await fetchText(`${bundle}.map`));
        if (direct) return direct;
        const code = await fetchText(bundle);
        const ref = code && /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/.exec(code.trimEnd());
        if (!ref || ref[1].startsWith("data:")) return null;
        return parse(await fetchText(new URL(ref[1], bundle).href));
      })().catch(() => null);
      maps.set(bundle, pending);
    }
    return pending;
  };

  /** Original project path and 0-based position for a frame, or null. */
  const resolve = async (frame: StackFrame): Promise<(OriginalPosition & { path: string }) | null> => {
    const bundle = frame.url.replace(/[?#].*$/, "");
    if (!isFetchableBundle(bundle, origin)) return null;
    const map = await loadMap(bundle);
    if (!map) return null;
    const position = originalPositionFor(map, frame.line - 1, frame.column - 1);
    if (!position) return null;
    const path = toProjectPath(position.source);
    return path ? { ...position, path } : null;
  };

  return { resolve };
}

export type SourceResolver = ReturnType<typeof createSourceResolver>;
