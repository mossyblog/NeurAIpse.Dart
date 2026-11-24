import { regionProperty, type SpacingRegion } from "./spacing.ts";

/**
 * Style change records, spacing tokens and the stepper (inspector spec 5, 6, 7.4).
 * Records are held for the Style changes serializer (phase I7); nothing here writes source.
 */

export type StyleValue = { value: string; token?: string };

/** Spec 7.4. `region.element` is serialised as a selector path. */
export type StyleChange = {
  category: "spacing" | "typography" | "color";
  property: string;
  from: StyleValue;
  to: StyleValue;
  region?: SpacingRegion<string>;
  group: {
    count: number;
    selectors: string[];
    signature?: string;
  };
  measure?: {
    fromRegion: SpacingRegion<string>;
    toRegion: SpacingRegion<string>;
    distance: number;
  };
};

/**
 * Package extension stored next to `styleChange` on the annotation (the spec 7.4 type
 * stays exact): drift flags, guesses, utilities, element labels and forensic data.
 */
export type StyleChangeDetail = {
  /** Change group identity shared by the properties of one edit (one element, type or colour group). */
  groupId?: string;
  /** Heading target: `.card-body`, `text-sm`. */
  name?: string;
  /** Drift flags of the from value (spec 5.3): `off-grid: 14px`, `no token`, `token unknown (guess: …)`. */
  flags?: string[];
  /** Flags that hold for only some members of a group, with their count. */
  memberFlags?: { flag: string; count: number }[];
  /** Tailwind utility of the winning rule (`p-4`) and the matching new one (`p-6`). */
  fromUtility?: string;
  toUtility?: string;
  /** Short label per member, parallel to `group.selectors`: `.card-body`, `span`. */
  labels?: string[];
  /** Forensic: computed value before and after the preview, parallel to `group.selectors`. */
  computed?: { before: string; after: string }[];
  /** Forensic: origin of the winning declaration. `href` is a URL, `<style>` or `inline`. */
  origin?: { href: string; layer?: string; selector?: string; inherited?: boolean };
  /** Measure labels for `styleChange.measure`, e.g. [`.card-header`, `.card-body`]. */
  measureLabels?: [string, string];
  /**
   * Box-mode edit notes (spec 14.2), printed on the Note line: `authored as \`p-4\`; split
   * it, keep the other sides unchanged`, `padding-top was 0, so no existing utility to
   * edit`, `one value shared by 3 bands`, `At viewport 1280px`.
   */
  notes?: string[];
  /** Colour only: WCAG contrast before and after against the element background. */
  contrast?: { before?: string; after?: string; background?: string };
};

/** Copies a live region into the record form, with its element as a selector. */
export function serializeRegion(region: SpacingRegion<unknown>, selector: string): SpacingRegion<string> {
  const { element: _element, ...rest } = region;
  void _element;
  return { ...rest, rect: { ...region.rect }, element: selector, ...(region.flags ? { flags: [...region.flags] } : {}) };
}

export function spacingStyleChange(input: {
  /** The region the edit belongs to, when one exists (a single-line flex has no row-gap band). */
  region?: SpacingRegion<unknown>;
  selector: string;
  property?: string;
  from: StyleValue;
  to: StyleValue;
}): StyleChange {
  const property = input.property ?? (input.region ? regionProperty(input.region) : "");
  return {
    category: "spacing",
    property,
    from: { ...input.from },
    to: { ...input.to },
    ...(input.region ? { region: serializeRegion(input.region, input.selector) } : {}),
    group: { count: 1, selectors: [input.selector] },
  };
}

/* ---------------- Tokens ---------------- */

export type SpacingToken = {
  /** CSS custom property, e.g. `--spacing`. */
  token: string;
  /** Multiplier for the Tailwind `calc(var(--spacing) * N)` form; absent for named tokens. */
  multiplier?: number;
  /** Display name: `--spacing × 4`, or the named token. */
  name: string;
  /** Tailwind utility suffix (`4` as in `p-4`) when the multiplier form applies. */
  utility?: string;
  /** CSS value written to the preview, e.g. `calc(var(--spacing) * 4)`. */
  value: string;
  /** Resolved px at read time. */
  px: number;
  onGrid: boolean;
};

export const GRID = 8;

/** Resolves a custom-property length to px: px, rem, em (against the root font size), unitless 0. */
export function resolveLength(value: string, rootFontPx = 16): number | undefined {
  const v = value.trim();
  if (v === "0") return 0;
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(v);
  if (!match) return undefined;
  const n = Number(match[1]);
  return match[2] === "px" ? n : n * rootFontPx;
}

export function isOnGrid(px: number): boolean {
  return Math.abs(px % GRID) < 0.01 || Math.abs(Math.abs(px % GRID) - GRID) < 0.01;
}

/**
 * Spacing tokens from the `:root` custom properties read at runtime. `--spacing` (the
 * Tailwind base) yields its multiples up to `maxPx`: 0, then every on-grid multiple
 * (8, 16, 24...), then the rare 4px step. Named `--spacing-*` tokens are listed as-is,
 * on-grid first. Nothing is hardcoded: an empty map gives an empty list.
 */
export function spacingTokens(vars: Readonly<Record<string, string>>, rootFontPx = 16, maxPx = 128): SpacingToken[] {
  const grid: SpacingToken[] = [];
  const rare: SpacingToken[] = [];
  const base = vars["--spacing"] != null ? resolveLength(vars["--spacing"], rootFontPx) : undefined;
  if (base && base > 0) {
    for (let n = 0; n * base <= maxPx + 0.01; n++) {
      const px = Math.round(n * base * 100) / 100;
      const token: SpacingToken = {
        token: "--spacing",
        multiplier: n,
        name: `--spacing × ${n}`,
        utility: String(n),
        value: `calc(var(--spacing) * ${n})`,
        px,
        onGrid: isOnGrid(px),
      };
      if (token.onGrid) grid.push(token);
      else if (px === GRID / 2) rare.push(token);
    }
  }
  const named: SpacingToken[] = [];
  for (const [name, raw] of Object.entries(vars)) {
    if (!/^--spacing-[\w-]+$/.test(name)) continue;
    const px = resolveLength(raw, rootFontPx);
    if (px == null) continue;
    named.push({ token: name, name, value: `var(${name})`, px, onGrid: isOnGrid(px) });
  }
  named.sort((a, b) => Number(b.onGrid) - Number(a.onGrid) || a.px - b.px);
  return [...grid, ...rare, ...named];
}

/** Token id used by selects: `--spacing*4` or the named token. */
export function tokenId(token: Pick<SpacingToken, "token" | "multiplier">): string {
  return token.multiplier != null ? `${token.token}*${token.multiplier}` : token.token;
}

/** Display token for records: `--spacing × 4` or the named token. */
export function tokenLabel(token: Pick<SpacingToken, "name">): string {
  return token.name;
}

/* ---------------- Stepper and units ---------------- */

/**
 * Stepper (spec 6): ±8 on the grid, snapping to the grid first when off-grid; ±1 with
 * the fine modifier (Shift). Results never go below `min` (0 for padding and gap).
 */
export function stepSpacing(px: number, direction: 1 | -1, fine = false, min = -Infinity): number {
  let next: number;
  if (fine) next = px + direction;
  else if (!isOnGrid(px)) next = direction > 0 ? Math.ceil(px / GRID) * GRID : Math.floor(px / GRID) * GRID;
  else next = Math.round(px / GRID) * GRID + direction * GRID;
  return Math.max(min, Math.round(next * 100) / 100);
}

export const SPACING_UNITS = ["px", "rem", "em", "%"] as const;
export type SpacingUnit = (typeof SPACING_UNITS)[number];

/** Minimum value per property: margins may be negative, padding and gaps may not. */
export function minFor(property: string): number {
  return property.startsWith("margin") ? -Infinity : 0;
}

/** A raw numeric input as a CSS value, or null when invalid. `%` is not valid for gaps here. */
export function rawValue(input: string, unit: SpacingUnit, property: string): string | null {
  const n = Number(input.trim());
  if (input.trim() === "" || !Number.isFinite(n)) return null;
  if (n < minFor(property)) return null;
  return `${Math.round(n * 1000) / 1000}${unit}`;
}

/** Defensive check for values injected into the preview style element. */
export function isSafeCssValue(value: string): boolean {
  return value.length > 0 && value.length < 200 && !/[;{}<>\\]|\/\*|!/.test(value);
}

/* ---------------- Preview CSS ---------------- */

export const PREVIEW_ATTRIBUTE = "data-annotate-preview";
export const GROUP_ATTRIBUTE = "data-annotate-group";
export const PREVIEW_LAYER = "annotate-preview";
/** Short-lived hidden element used to resolve colour values in context; ignored by observers. */
export const PROBE_ATTRIBUTE = "data-annotate-probe";

export type PreviewRule = { group: string; property: string; value: string };

/**
 * The single preview stylesheet (spec 6). Rules sit in `@layer annotate-preview` with
 * `!important`. The element is inserted first in `<head>`, so this layer is the first
 * declared: for important declarations the earliest layer wins, so it beats authored
 * normal and `!important` rules, layered or not. Only inline `!important` styles win.
 */
export function buildPreviewCss(rules: readonly PreviewRule[]): string {
  const byGroup = new Map<string, Map<string, string>>();
  for (const rule of rules) {
    if (!/^[\w-]+$/.test(rule.group) || !/^[a-z-]+$/.test(rule.property) || !isSafeCssValue(rule.value)) continue;
    const props = byGroup.get(rule.group) ?? new Map<string, string>();
    props.set(rule.property, rule.value);
    byGroup.set(rule.group, props);
  }
  if (byGroup.size === 0) return "";
  const body = [...byGroup].map(([group, props]) => {
    const decls = [...props].map(([p, v]) => `${p}: ${v} !important;`).join(" ");
    return `  [${GROUP_ATTRIBUTE}="${group}"] { ${decls} }`;
  });
  return `@layer ${PREVIEW_LAYER} {\n${body.join("\n")}\n}\n`;
}
