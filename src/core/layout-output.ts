import { componentLabel } from "./layout-palette.ts";
import { placementsOf, type PlacementAnnotation } from "./layout-placement.ts";
import type { Annotation, OutputDetail } from "./types.ts";

/**
 * Parity spec 10: the `### Layout placements` section, appended after the feedback list
 * and the style sections. Placements are numbered 1..n on their own. Output without
 * placements never reaches this module, so the other sections stay byte-identical.
 */

const TIMES = "×";

export type LayoutOutputEnvironment = { viewport: { width: number; height: number } };

function size(p: PlacementAnnotation): string {
  return `${Math.round(p.placement.width)}${TIMES}${Math.round(p.placement.height)}px`;
}

function position(p: PlacementAnnotation): string {
  return `${p.x.toFixed(1)}% from left, ${Math.round(p.y)}px from top`;
}

function clean(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").trim();
}

function compactLine(p: PlacementAnnotation, i: number): string {
  const text = p.placement.text ? ` "${clean(p.placement.text)}"` : "";
  const comment = clean(p.comment ?? "");
  return `${i}. **${componentLabel(p.placement.componentType)}**${text} ${size(p)} at ${position(p)}, near \`${p.elementPath}\`${comment ? `: ${comment}` : ""}`;
}

function block(p: PlacementAnnotation, i: number, detail: OutputDetail, env?: LayoutOutputEnvironment): string[] {
  const lines = [`**${i}. ${componentLabel(p.placement.componentType)}** (${size(p)})`, `- Position: ${position(p)}`];
  const deep = detail === "detailed" || detail === "forensic";
  lines.push(deep && p.element ? `- Near: \`${p.elementPath}\` (${p.element})` : `- Near: \`${p.elementPath}\``);
  if (p.placement.text) lines.push(`- Text: "${clean(p.placement.text)}"`);
  if (deep && p.boundingBox) {
    const b = p.boundingBox;
    lines.push(`- Page box: x:${Math.round(b.x)}, y:${Math.round(b.y)} (${size(p)})`);
  }
  if (detail === "forensic") {
    if (env) lines.push(`- Viewport: ${env.viewport.width}${TIMES}${env.viewport.height}`);
    lines.push(`- Scroll Y at placement: ${Math.round(p.placement.scrollY)}px`);
    if (Number.isFinite(p.timestamp) && p.timestamp > 0) lines.push(`- Placed: ${new Date(p.timestamp).toISOString()}`);
  }
  const comment = clean(p.comment ?? "");
  if (comment) lines.push(`- Comment: ${comment}`);
  return lines;
}

/** Section lines (ending with a blank line), or [] when the list has no placements. */
export function layoutSection(list: readonly Annotation[], detail: OutputDetail, env?: LayoutOutputEnvironment): string[] {
  const placements = placementsOf(list);
  if (placements.length === 0) return [];
  const out = ["### Layout placements"];
  placements.forEach((p, index) => {
    if (detail === "compact") out.push(compactLine(p, index + 1));
    else out.push(...block(p, index + 1, detail, env));
  });
  out.push("");
  return out;
}
