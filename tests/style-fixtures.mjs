/** Worked examples for the Style changes serializer (inspector spec 7.2). */

const region = (kind, side, element, value) => ({ kind, side, rect: { x: 0, y: 0, width: 10, height: value }, value, element });

const header = "main > section.card > div.card-header";
const body = "main > section.card > div.card-body";
const bodies = [body, "main > section.card:nth-of-type(2) > div.card-body", "main > section.card:nth-of-type(3) > div.card-body"];

/** Spacing with measure: padding-top 8 -> 24 on three .card-body elements, measured against the header. */
export const spacingChange = {
  id: "s1",
  kind: "style-change",
  x: 0,
  y: 0,
  comment: "",
  element: ".card-body",
  elementPath: body,
  timestamp: 10,
  sourceFile: "apps/host/src/app/components/card/page.tsx:42",
  styleChange: {
    category: "spacing",
    property: "padding-top",
    from: { value: "8px", token: "--spacing-2" },
    to: { value: "24px", token: "--spacing-3" },
    region: region("padding", "top", body, 8),
    group: { count: 3, selectors: bodies },
    measure: { fromRegion: region("padding", "bottom", header, 0), toRegion: region("padding", "top", body, 8), distance: 24 },
  },
  styleDetail: {
    name: ".card-body",
    labels: [".card-body", ".card-body", ".card-body"],
    measureLabels: [".card-header", ".card-body"],
    computed: [
      { before: "8px", after: "24px" },
      { before: "8px", after: "24px" },
      { before: "8px", after: "24px" },
    ],
    origin: { href: "https://localhost/_next/app.css", layer: "utilities", selector: ".pt-2" },
  },
};

const metas = Array.from({ length: 7 }, (_, i) => `main > p.meta:nth-of-type(${i + 1})`);
const labels = Array.from({ length: 4 }, (_, i) => `form > span.label:nth-of-type(${i + 1})`);
const typeSelectors = [...metas, ...labels, "form > small.hint"];
const typeLabels = [...metas.map(() => ".meta"), ...labels.map(() => ".label"), ".hint"];
const signature = "Inter, sans-serif|14px|20px|500|normal";
const typeGroup = { count: 12, selectors: typeSelectors, signature };

/** Type: text-sm -> text-base on a 12-element group; line-height follows; 2 members had 21px. */
export const typeSize = {
  id: "t1",
  kind: "style-change",
  x: 0,
  y: 0,
  comment: "",
  element: "text-sm",
  elementPath: metas[0],
  timestamp: 11,
  styleChange: {
    category: "typography",
    property: "font-size",
    from: { value: "14px", token: "--text-sm" },
    to: { value: "16px", token: "--text-base" },
    group: typeGroup,
  },
  styleDetail: { name: "text-sm", labels: typeLabels },
};

export const typeLine = {
  id: "t2",
  kind: "style-change",
  x: 0,
  y: 0,
  comment: "",
  element: "text-sm",
  elementPath: metas[0],
  timestamp: 12,
  styleChange: {
    category: "typography",
    property: "line-height",
    from: { value: "20px", token: "--text-sm--line-height" },
    to: { value: "24px" },
    group: typeGroup,
  },
  styleDetail: { name: "text-sm", labels: typeLabels, memberFlags: [{ flag: "off-grid: 21px", count: 2 }] },
};

/** A pure measurement (kind "measure"): its own section before Style changes. */
export const measureOnly = {
  id: "m1",
  kind: "measure",
  x: 0,
  y: 0,
  comment: "",
  element: "measure",
  elementPath: header,
  timestamp: 13,
  measure: { fromRegion: region("padding", "bottom", header, 0), toRegion: region("padding", "top", body, 8), distance: 24 },
  styleDetail: { measureLabels: [".card-header", ".card-body"] },
};

/** Off-grid raw value with a guess, multiplier tokens and utilities. */
export const offGrid = {
  id: "s2",
  kind: "style-change",
  x: 0,
  y: 0,
  comment: "",
  element: "div.box",
  elementPath: "main > div.box",
  timestamp: 14,
  styleChange: {
    category: "spacing",
    property: "margin-bottom",
    from: { value: "14px" },
    to: { value: "16px", token: "--spacing × 4" },
    group: { count: 1, selectors: ["main > div.box"] },
  },
  styleDetail: { name: ".box", labels: [".box"], toUtility: "mb-4", flags: ["off-grid: 14px", "token unknown (guess: --spacing-a, --spacing-b)"] },
};
