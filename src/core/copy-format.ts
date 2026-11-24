import { feedbackOnly } from "./style-output.ts";
import { withoutPlacements } from "./layout-placement.ts";
import type { Annotation, CopyFormat } from "./types.ts";

export const NO_MATCHING_METADATA = "No matching metadata";

/** Attribute names a copyFormat needs captured in addition to the defaults. */
export function copyFormatAttribute(format: CopyFormat): string | null {
  return typeof format === "object" ? format.attribute : null;
}

function unique(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** Style changes and measurements are markdown-only: metadata formats ignore them. */
function* valuesFor(annotations: readonly Annotation[], format: Exclude<CopyFormat, "markdown">) {
  for (const a of withoutPlacements(feedbackOnly(annotations))) {
    if (format === "source") {
      if (a.sourceFile) yield a.sourceFile;
    } else if (format === "classes") {
      if (a.cssClasses) yield* a.cssClasses.split(/\s+/);
    } else {
      const value = a.attributes?.[format.attribute];
      if (value != null) yield value;
    }
  }
}

/**
 * Non-markdown copy output: unique values, one per line, in first-seen order.
 * Returns null when no annotation carries the metadata.
 */
export function formatMetadata(
  annotations: readonly Annotation[],
  format: Exclude<CopyFormat, "markdown">,
): string | null {
  const values = unique(valuesFor(annotations, format));
  return values.length > 0 ? values.join("\n") : null;
}

/**
 * Text for the Copy action. Markdown uses the section 8 serializer; other formats
 * return null when no metadata matches, so the caller leaves the clipboard alone.
 */
export function buildCopyText(
  annotations: readonly Annotation[],
  format: CopyFormat,
  markdown: () => string,
): string | null {
  if (format === "markdown") return markdown();
  return formatMetadata(annotations, format);
}
