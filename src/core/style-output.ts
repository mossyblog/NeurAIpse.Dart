import type { StyleChange, StyleChangeDetail, StyleValue } from "./style-change.ts";
import { tokenCss } from "./token-values.ts";
import { signatureLabel, TYPE_PROPERTIES, type TypeStyle } from "./type-signature.ts";
import type { Annotation, OutputDetail } from "./types.ts";

/**
 * Inspector spec 7: the `### Measurements` and `### Style changes` sections appended
 * after the feedback list. Annotation-only output never reaches this module, so the
 * existing tiers stay byte-identical.
 */

export type StyleChangeStyle = "blocks" | "todo";

const TIMES = "×";
const ARROW = "→";
const ELEMENT_LIMIT = 5;

export function isStyleAnnotation(a: Annotation): boolean {
  return a.kind === "style-change" || a.kind === "measure";
}

/** Feedback annotations: everything except style changes, measurements and rearrangements (parity spec 10.3). */
export function feedbackOnly<T extends Annotation>(list: readonly T[]): T[] {
  return list.filter((a) => !isStyleAnnotation(a) && a.kind !== "rearrange");
}

/** Last path segment without `:nth-*`: `main > div:nth-of-type(2)` -> `div`. */
export function shortSelector(selector: string): string {
  const parts = selector.split(">").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? selector;
  return last.replace(/:nth-(?:of-type|child)\([^)]*\)/g, "") || last;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function code(text: string): string {
  return `\`${text}\``;
}

/** `` `var(--spacing-2)` 8px `` with a token, `8px` without; utility hint in parentheses. */
export function formatStyleValue(value: StyleValue, utility?: string): string {
  if (!value.token) return value.value;
  return `${code(tokenCss(value.token))}${utility ? ` (${utility})` : ""} ${value.value}`;
}

type Item = { annotation: Annotation; change: StyleChange; detail: StyleChangeDetail };

function items(list: readonly Annotation[]): Item[] {
  return list.flatMap((annotation) =>
    annotation.kind === "style-change" && annotation.styleChange
      ? [{ annotation, change: annotation.styleChange, detail: annotation.styleDetail ?? {} }]
      : [],
  );
}

/** Heading group key (spec 7.4): category plus signature, or the member selectors. */
function groupKey(item: Item): string {
  const g = item.change.group;
  return `${item.change.category}|${g.signature ?? g.selectors.join(",")}`;
}

function groupItems(list: readonly Item[]): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const item of list) {
    const key = groupKey(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

function label(item: Item, index = 0): string {
  return item.detail.labels?.[index] ?? shortSelector(item.change.group.selectors[index] ?? "");
}

/** Heading target: detail name, else the first member's label. */
function targetName(item: Item): string {
  return item.detail.name ?? label(item);
}

function categoryTitle(group: Item[]): string {
  const category = group[0].change.category;
  if (category === "typography") return "Type";
  if (category === "color") return "Colour";
  const families = new Set(group.map((i) => i.change.property.split("-")[0].replace("row", "gap").replace("column", "gap")));
  if (families.size !== 1) return "Spacing";
  const [family] = families;
  return family === "gap" ? "Gap" : family[0].toUpperCase() + family.slice(1);
}

/** `` `.meta` ×7, `.label` ×4 `` (first five labels, then `+N more` elements). */
export function elementSummary(labels: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const entries = [...counts];
  const shown = entries.slice(0, ELEMENT_LIMIT).map(([l, n]) => `${code(l)} ${TIMES}${n}`);
  const rest = entries.slice(ELEMENT_LIMIT).reduce((sum, [, n]) => sum + n, 0);
  return rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
}

function memberLabels(item: Item): string[] {
  return item.change.group.selectors.map((_, i) => label(item, i));
}

/** Note text for one change (spec 7.1/7.2): `was off-grid (14px)`, `token unknown`... */
function notesFor(item: Item, prefix: boolean): string[] {
  const p = prefix ? `${item.change.property} ` : "";
  const out: string[] = [];
  const offGrid = (flag: string) => /^off-grid: (.+)$/.exec(flag)?.[1];
  for (const flag of item.detail.flags ?? []) {
    const grid = offGrid(flag);
    out.push(grid ? `${p}was off-grid (${grid})` : `${p}${flag}`.trim());
  }
  for (const member of item.detail.memberFlags ?? []) {
    const grid = offGrid(member.flag);
    const text = grid ? `was off-grid (${grid})` : member.flag;
    out.push(`${p}${text} in ${plural(member.count, "element")}`.trim());
  }
  // Box edit notes (spec 14.2) are about the edit, not one property: never prefixed.
  out.push(...(item.detail.notes ?? []));
  return out;
}

function measureText(change: Pick<StyleChange, "measure">, labels?: [string, string]): string | undefined {
  const m = change.measure;
  if (!m) return undefined;
  const a = labels?.[0] ?? shortSelector(m.fromRegion.element);
  const b = labels?.[1] ?? shortSelector(m.toRegion.element);
  return `Distance between ${code(a)} and ${code(b)}: ${Math.round(m.distance * 100) / 100}px`;
}

function signatureLine(signature: string | undefined): string | undefined {
  if (!signature) return undefined;
  const parts = signature.split("|");
  if (parts.length !== TYPE_PROPERTIES.length) return undefined;
  const style = Object.fromEntries(TYPE_PROPERTIES.map((p, i) => [p, parts[i]])) as TypeStyle;
  return signatureLabel(style);
}

function originText(origin: NonNullable<StyleChangeDetail["origin"]>, property: string): string {
  if (origin.href === "inline") return `${property} from inline style${origin.inherited ? " (inherited)" : ""}`;
  const where = [origin.selector ? `${code(origin.selector)} in ` : "", origin.href, origin.layer ? ` (layer ${origin.layer})` : "", origin.inherited ? " (inherited)" : ""].join("");
  return `${property} from ${where}`;
}

/** Lines shared by both phrasings below the headline: source, signature, measure, contrast, notes, elements. */
function bodyLines(group: Item[], detail: OutputDetail, indent: string, includeChanges: boolean): string[] {
  const first = group[0];
  const lines: string[] = [];
  const multi = group.length > 1;
  if (detail !== "compact") {
    if (first.change.category === "typography") {
      const sig = signatureLine(first.change.group.signature);
      if (sig && (includeChanges || detail !== "standard")) lines.push(`${indent}- Signature: ${sig}`);
    } else if (includeChanges || detail !== "standard") {
      lines.push(`${indent}- Selector: ${code(first.change.group.selectors[0] ?? "")}`);
    }
  }
  const source = group.find((i) => i.annotation.sourceFile)?.annotation.sourceFile;
  if (source) lines.push(`${indent}- Source: ${source}`);
  if (includeChanges) {
    for (const item of group) {
      lines.push(`${indent}- ${item.change.property}: ${formatStyleValue(item.change.from, item.detail.fromUtility)} ${ARROW} ${formatStyleValue(item.change.to, item.detail.toUtility)}`);
    }
  }
  for (const item of group) {
    const m = measureText(item.change, item.detail.measureLabels);
    if (m) lines.push(`${indent}- Measure: ${m}`);
  }
  for (const item of group) {
    const c = item.detail.contrast;
    if (c && (c.before || c.after)) {
      lines.push(`${indent}- Contrast${multi ? ` (${item.change.property})` : ""}: ${c.before ?? "?"} ${ARROW} ${c.after ?? "?"}${c.background ? ` on ${code(c.background)}` : ""}`);
    }
  }
  if (includeChanges || detail !== "standard") {
    lines.push(`${indent}- Elements: ${elementSummary(memberLabels(first))}`);
    if (detail === "detailed" || detail === "forensic") {
      first.change.group.selectors.forEach((selector, i) => {
        let line = `${indent}  - ${code(selector)}`;
        if (detail === "forensic") {
          const values = group
            .map((item) => {
              const c = item.detail.computed?.[i];
              return c ? `${item.change.property} ${c.before} ${ARROW} ${c.after}` : null;
            })
            .filter(Boolean);
          if (values.length) line += `: ${values.join("; ")}`;
        }
        lines.push(line);
      });
    }
  }
  if (detail === "forensic") {
    for (const item of group) {
      if (item.detail.origin) lines.push(`${indent}- Origin: ${originText(item.detail.origin, item.change.property)}`);
    }
  }
  // Per-side records of one edit share their notes (viewport, split): print each once.
  const notes = [...new Set(group.flatMap((item) => notesFor(item, multi)))];
  if (notes.length) lines.push(`${indent}- Note: ${notes.join(" | ")}`);
  return lines;
}

function blockSection(groups: Item[][], detail: OutputDetail): string[] {
  const lines: string[] = [];
  if (detail === "compact") {
    let n = 0;
    for (const group of groups) {
      for (const item of group) {
        n++;
        lines.push(`${n}. ${item.change.property} ${targetName(item)} ${TIMES}${item.change.group.count}: ${item.change.from.value} ${ARROW} ${item.change.to.value}`);
      }
    }
    return lines;
  }
  groups.forEach((group, index) => {
    const first = group[0];
    lines.push(`**${index + 1}. ${categoryTitle(group)} · ${targetName(first)}** (${plural(first.change.group.count, "element")})`);
    lines.push(...bodyLines(group, detail, "", true));
  });
  return lines;
}

function todoLine(item: Item): string {
  const c = item.change;
  return `- [ ] Change ${c.property} of ${code(targetName(item))} (${plural(c.group.count, "element")}) from ${formatStyleValue(c.from, item.detail.fromUtility)} to ${formatStyleValue(c.to, item.detail.toUtility)}`;
}

function todoSection(groups: Item[][], detail: OutputDetail): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    for (const item of group) lines.push(todoLine(item));
    if (detail !== "compact") lines.push(...bodyLines(group, detail, "  ", false));
  }
  return lines;
}

/** `- Distance between A and B: 24px` lines for `kind: "measure"` annotations. */
export function measurementLines(list: readonly Annotation[]): string[] {
  return list.flatMap((a) => {
    if (a.kind !== "measure" || !a.measure) return [];
    const text = measureText({ measure: a.measure }, a.styleDetail?.measureLabels);
    return text ? [`- ${text}`] : [];
  });
}

/**
 * The style sections (spec 7): `### Measurements` then `### Style changes`, each omitted
 * when empty. Returns [] when the list has neither.
 */
export function styleSections(list: readonly Annotation[], detail: OutputDetail, style: StyleChangeStyle = "blocks"): string[] {
  const out: string[] = [];
  const measures = measurementLines(list);
  if (measures.length) out.push("### Measurements", ...measures, "");
  const groups = groupItems(items(list));
  if (groups.length) {
    out.push("### Style changes", ...(style === "todo" ? todoSection(groups, detail) : blockSection(groups, detail)), "");
  }
  return out;
}
