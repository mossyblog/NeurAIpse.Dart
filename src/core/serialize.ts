import { feedbackOnly, styleSections, type StyleChangeStyle } from "./style-output.ts";
import type { Annotation, OutputDetail } from "./types.ts";
import { layoutSection } from "./layout-output.ts";
import { withoutPlacements } from "./layout-placement.ts";
import { rearrangeSection } from "./rearrange-output.ts";

export type OutputEnvironment = {
  viewport: { width: number; height: number };
  /** Required for forensic output. */
  url?: string;
  userAgent?: string;
  /** ISO 8601. */
  timestamp?: string;
  devicePixelRatio?: number;
};

export type OutputOptions = {
  appName?: string;
  environment?: OutputEnvironment;
  /** Inspector spec 7.1: style changes as blocks (default) or `- [ ] Change …` TODO lines. */
  styleChangeStyle?: StyleChangeStyle;
};

const TIMES = "×";
const COMPACT_QUOTE_LIMIT = 30;
const CONTEXT_LIMIT = 100;

/** Collapses CR/LF/tab runs to one space, trims, and escapes markdown syntax. */
export function sanitizeAppName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>]/g, "\\$&");
}

/** Reads the environment from a browser window. */
export function readEnvironment(win: Window): OutputEnvironment {
  return {
    viewport: { width: win.innerWidth, height: win.innerHeight },
    url: win.location.href,
    userAgent: win.navigator.userAgent,
    timestamp: new Date().toISOString(),
    devicePixelRatio: win.devicePixelRatio,
  };
}

function viewportText(env: OutputEnvironment): string {
  return `${env.viewport.width}${TIMES}${env.viewport.height}`;
}

function header(pathname: string, detail: OutputDetail, options: OutputOptions): string[] {
  const env = options.environment ?? { viewport: { width: 0, height: 0 } };
  const lines = [`## Page Feedback: ${pathname}`];
  const appName = options.appName ? sanitizeAppName(options.appName) : "";
  if (appName) lines.push(`**App:** ${appName}`);
  if (detail === "forensic") {
    lines.push(
      "",
      "**Environment:**",
      `- Viewport: ${viewportText(env)}`,
      `- URL: ${env.url ?? ""}`,
      `- User Agent: ${env.userAgent ?? ""}`,
      `- Timestamp: ${env.timestamp ?? ""}`,
      `- Device Pixel Ratio: ${env.devicePixelRatio ?? 1}`,
      "",
      "---",
    );
  } else if (detail !== "compact") {
    lines.push(`**Viewport:** ${viewportText(env)}`);
  }
  lines.push("");
  return lines;
}

function compactLine(a: Annotation, i: number): string {
  const source = a.sourceFile ? ` (${a.sourceFile})` : "";
  let line = `${i}. **${a.element}**${source}: ${a.comment}`;
  if (a.selectedText) {
    const text = a.selectedText;
    const quote =
      text.length > COMPACT_QUOTE_LIMIT ? `${text.slice(0, COMPACT_QUOTE_LIMIT)}...` : text;
    line += ` (re: "${quote}")`;
  }
  return line;
}

function sizeText(box: { width: number; height: number }): string {
  return `${Math.round(box.width)}${TIMES}${Math.round(box.height)}px`;
}

function standardBlock(a: Annotation, i: number, detailed: boolean): string[] {
  const lines = [`### ${i}. ${a.element}`, `**Location:** ${a.elementPath}`];
  if (a.sourceFile) lines.push(`**Source:** ${a.sourceFile}`);
  if (a.reactComponents) lines.push(`**React:** ${a.reactComponents}`);
  if (detailed) {
    if (a.cssClasses) lines.push(`**Classes:** ${a.cssClasses}`);
    if (a.boundingBox) {
      const box = a.boundingBox;
      lines.push(
        `**Position:** ${Math.round(box.x)}px, ${Math.round(box.y)}px (${sizeText(box)})`,
      );
    }
  }
  if (a.selectedText) lines.push(`**Selected text:** "${a.selectedText}"`);
  if (detailed && !a.selectedText && a.nearbyText) {
    lines.push(`**Context:** ${a.nearbyText.slice(0, CONTEXT_LIMIT)}`);
  }
  lines.push(`**Feedback:** ${a.comment}`, "");
  return lines;
}

function forensicBlock(a: Annotation, i: number): string[] {
  const lines = [`### ${i}. ${a.element}`];
  if (a.isMultiSelect && a.fullPath) {
    lines.push("*Forensic data shown for first element of selection*");
  }
  if (a.fullPath) lines.push(`**Full DOM Path:** ${a.fullPath}`);
  if (a.cssClasses) lines.push(`**CSS Classes:** ${a.cssClasses}`);
  if (a.boundingBox) {
    const box = a.boundingBox;
    lines.push(`**Position:** x:${Math.round(box.x)}, y:${Math.round(box.y)} (${sizeText(box)})`);
  }
  lines.push(
    `**Annotation at:** ${a.x.toFixed(1)}% from left, ${Math.round(a.y)}px from top`,
  );
  if (a.selectedText) lines.push(`**Selected text:** "${a.selectedText}"`);
  if (!a.selectedText && a.nearbyText) {
    lines.push(`**Context:** ${a.nearbyText.slice(0, CONTEXT_LIMIT)}`);
  }
  if (a.computedStyles) lines.push(`**Computed Styles:** ${a.computedStyles}`);
  if (a.accessibility) lines.push(`**Accessibility:** ${a.accessibility}`);
  if (a.nearbyElements) lines.push(`**Nearby Elements:** ${a.nearbyElements}`);
  if (a.sourceFile) lines.push(`**Source:** ${a.sourceFile}`);
  if (a.reactComponents) lines.push(`**React:** ${a.reactComponents}`);
  lines.push(`**Feedback:** ${a.comment}`, "");
  return lines;
}

/**
 * Section 8 markdown. Returns "" for an empty list. Style changes and measurements
 * (inspector spec 7) are not numbered feedback: they follow the feedback list in their
 * own sections, so annotation-only output is unchanged byte for byte.
 */
export function generateOutput(
  annotations: readonly Annotation[],
  pathname: string,
  detail: OutputDetail = "standard",
  options: OutputOptions = {},
): string {
  if (annotations.length === 0) return "";
  const lines = header(pathname, detail, options);
  withoutPlacements(feedbackOnly(annotations)).forEach((a, index) => {
    const i = index + 1;
    if (detail === "compact") lines.push(compactLine(a, i));
    else if (detail === "forensic") lines.push(...forensicBlock(a, i));
    else lines.push(...standardBlock(a, i, detail === "detailed"));
  });
  const style = styleSections(annotations, detail, options.styleChangeStyle);
  if (style.length) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(...style);
  }
  // Parity spec 10: layout placements follow feedback and style changes.
  const layout = layoutSection(annotations, detail, options.environment);
  if (layout.length) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(...layout);
  }
  // Parity spec 10.3: rearrangements come last.
  const rearrange = rearrangeSection(annotations, detail);
  if (rearrange.length) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(...rearrange);
  }
  return lines.join("\n").trimEnd();
}
