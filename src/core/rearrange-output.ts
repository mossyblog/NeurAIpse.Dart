import type { RearrangeRelation } from "./rearrange-geometry.ts";
import type { Annotation, OutputDetail, Rect } from "./types.ts";

/**
 * Rearrange mode records and the `### Rearrangements` output section (parity spec 10.2,
 * 10.3). Records are `kind: "rearrange"` annotations; the section follows feedback, style
 * changes and layout placements, so output without rearrangements is unchanged.
 */

/** Package extension stored next to `rearrange` (the spec 7 type stays exact). */
export type RearrangeDetail = {
  /** Delete / Backspace: hidden in the preview; `currentRect` keeps the last rect. */
  removed?: boolean;
  /** Nearest sibling (or parent) at the last commit. */
  relation?: RearrangeRelation | null;
  /** Short label of the parent element, e.g. `.cards`. */
  parent?: string;
  /** Forensic: computed layout properties at first touch and at the last commit (preview on). */
  computed?: { before: Record<string, string>; after: Record<string, string> };
};

/** Computed properties captured for forensic output, in print order. */
export const REARRANGE_COMPUTED = ["position", "display", "width", "height", "margin", "translate", "transform"] as const;

/** Toolbar / panel status when a stored selector no longer matches exactly one element. */
export const REARRANGE_NOT_FOUND = "Element not found for this rearrangement";

const TIMES = "×";
const ARROW = "→";

export function isRearrangeAnnotation(a: Annotation): boolean {
  return a.kind === "rearrange" && Boolean(a.rearrange);
}

export function rearrangeItems<T extends Annotation>(list: readonly T[]): T[] {
  return list.filter(isRearrangeAnnotation);
}

const r = Math.round;

/** `40,320 160×80` (document px). */
export function rectText(rect: Rect): string {
  return `${r(rect.x)},${r(rect.y)} ${r(rect.width)}${TIMES}${r(rect.height)}`;
}

const MINUS = "−";
const signed = (n: number) => `${n < 0 ? MINUS : "+"}${Math.abs(n)}px`;
const px = (n: number) => `${Math.abs(n)}px`;

/** `moved 24px right, 8px up; resized 120→160 wide` ("" when nothing changed). */
export function deltaText(from: Rect, to: Rect): string {
  const dx = r(to.x) - r(from.x);
  const dy = r(to.y) - r(from.y);
  const parts: string[] = [];
  const moved: string[] = [];
  if (dx) moved.push(`${px(dx)} ${dx > 0 ? "right" : "left"}`);
  if (dy) moved.push(`${px(dy)} ${dy > 0 ? "down" : "up"}`);
  if (moved.length) parts.push(`moved ${moved.join(", ")}`);
  const sized: string[] = [];
  if (r(to.width) !== r(from.width)) sized.push(`${r(from.width)}${ARROW}${r(to.width)} wide`);
  if (r(to.height) !== r(from.height)) sized.push(`${r(from.height)}${ARROW}${r(to.height)} tall`);
  if (sized.length) parts.push(`resized ${sized.join(", ")}`);
  return parts.join("; ");
}

/** `now 16px below .title`, `now overlaps .title`, `inside .cards at +32px left, +32px top`. */
export function relationText(rel: RearrangeRelation | null | undefined): string {
  if (!rel) return "";
  if (rel.relation === "overlapping") return `now overlaps ${rel.label}`;
  if (rel.relation === "inside") {
    const o = rel.offset ?? { left: 0, top: 0 };
    return `inside ${rel.label} at ${signed(o.left)} left, ${signed(o.top)} top`;
  }
  return `now ${rel.distance}px ${rel.relation} ${rel.label}`;
}

/** One-line change summary, used by the compact tier and the panel. */
export function rearrangeSummary(a: Annotation): string {
  const rec = a.rearrange;
  if (!rec) return "";
  if (a.rearrangeDetail?.removed) return "removed";
  return deltaText(rec.originalRect, rec.currentRect) || "unchanged";
}

function computedText(values: Record<string, string>): string {
  // `visibility` only appears in the after values of a removed element.
  return [...REARRANGE_COMPUTED, "visibility"].filter((p) => values[p] != null && values[p] !== "").map((p) => `${p}: ${values[p]}`).join("; ");
}

function block(a: Annotation, n: number, detail: OutputDetail): string[] {
  const rec = a.rearrange!;
  const extra = a.rearrangeDetail ?? {};
  const removed = Boolean(extra.removed);
  const lines = [`**${n}. ${rec.label}** · \`${rec.selector}\``];
  lines.push(`- From: ${rectText(rec.originalRect)} ${ARROW} ${removed ? "removed" : `To: ${rectText(rec.currentRect)}`}`);
  lines.push(`- Change: ${removed ? "removed from the layout (hidden in the preview)" : rearrangeSummary(a)}`);
  const relation = removed ? "" : relationText(extra.relation);
  if (relation) lines.push(`- Relation: ${relation}`);
  if (a.sourceFile) lines.push(`- Source: ${a.sourceFile}`);
  if (detail === "detailed" || detail === "forensic") {
    lines.push(`- Element: \`${rec.tagName}\`${extra.parent ? ` in \`${extra.parent}\`` : ""}`);
  }
  if (detail === "forensic") {
    const o = rec.originalRect;
    const c = rec.currentRect;
    lines.push(`- Delta: dx ${r(c.x) - r(o.x)}, dy ${r(c.y) - r(o.y)}, dw ${r(c.width) - r(o.width)}, dh ${r(c.height) - r(o.height)}`);
    if (extra.computed) {
      const before = computedText(extra.computed.before);
      const after = computedText(extra.computed.after);
      if (before) lines.push(`- Computed before: ${before}`);
      if (after) lines.push(`- Computed after: ${after}`);
    }
  }
  return lines;
}

/**
 * The `### Rearrangements` section (spec 10.3), or [] when there are none. Compact is
 * one line per item; standard, detailed and forensic are blocks with growing detail.
 */
export function rearrangeSection(list: readonly Annotation[], detail: OutputDetail): string[] {
  const items = rearrangeItems(list);
  if (!items.length) return [];
  const out = ["### Rearrangements"];
  items.forEach((a, index) => {
    const n = index + 1;
    const rec = a.rearrange!;
    if (detail === "compact") {
      const source = a.sourceFile ? ` (${a.sourceFile})` : "";
      const relation = a.rearrangeDetail?.removed ? "" : relationText(a.rearrangeDetail?.relation);
      out.push(`${n}. **${rec.label}**${source}: ${rearrangeSummary(a)}${relation ? `; ${relation}` : ""}`);
    } else {
      out.push(...block(a, n, detail));
    }
  });
  out.push("");
  return out;
}
