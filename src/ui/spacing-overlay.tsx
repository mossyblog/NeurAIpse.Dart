import type { CSSProperties } from "react";
import { cn } from "cn";
import type { BoxCell, BoxGroup } from "../core/box-select.ts";
import type { Guide, Measurement } from "../core/measure.ts";
import { BOX_SIDES, regionLabel, regionProperty, type BoxSide, type SpacingRegion, type TokenResolver } from "../core/spacing.ts";
import type { ElementSpacing } from "../core/spacing-dom.ts";
import { ownsLayer, type InspectorSubMode, type OverlayLayer } from "../core/spacing-modes.ts";
import type { Rect } from "../core/types.ts";
import { PILL_CLASS } from "./chrome.tsx";

/** Region tints: distinct palette tokens at low alpha (spec 3.1). Stacking: margin < padding < gap < labels. */
export const SPACING_TINTS = {
  margin: "var(--annotate-marker-orange)",
  padding: "var(--annotate-marker-green)",
  gap: "var(--annotate-marker-purple)",
} as const;
const MEASURE_COLOR = "var(--annotate-marker-pink)";
const GUIDE_COLOR = "var(--annotate-marker-blue)";
const DIM = "color-mix(in oklch, var(--muted-foreground, #888) 14%, transparent)";
const Z = { margin: 1, padding: 2, gap: 3, border: 4, guide: 5, measure: 6, label: 7 } as const;

const box = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height });
const layerAttr = (layer: OverlayLayer) => ({ "data-annotate-layer": layer });
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const thickness = (r: SpacingRegion) => (r.side === "top" || r.side === "bottom" ? r.rect.height : r.rect.width);

function Label({ at, text, color, attr, dim }: { at: { x: number; y: number }; text: string; color: string; attr?: Record<string, string | undefined>; dim?: boolean }) {
  return (
    <span
      {...attr}
      className="fixed -translate-x-1/2 -translate-y-1/2 rounded px-1.5 font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-white tabular-nums"
      style={{
        left: at.x,
        top: at.y,
        zIndex: Z.label,
        backgroundColor: `color-mix(in oklch, ${color} 72%, #09090b)`,
        boxShadow: `0 0 0 1px color-mix(in oklch, ${color} 55%, rgba(0, 0, 0, 0.25)), 0 1px 3px rgba(0, 0, 0, 0.28)`,
        textShadow: "0 1px 1px rgba(0, 0, 0, 0.28)",
        opacity: dim ? 0.5 : undefined,
      }}
    >
      {text}
    </span>
  );
}

/** One ring (padding or margin sides, or every gap band) of one element, drawn by Box. */
export type BoxRing = {
  spacing: ElementSpacing;
  group: BoxGroup;
  /** Emphasised sides; null = every side (hover, gap). */
  sides: readonly BoxSide[] | null;
  /** Selected look: solid outline on the emphasised sides, dim fill on the others. */
  selected: boolean;
  /** Hover preview while something else is selected: faint, no pills. */
  dim?: boolean;
  /** The side under the cursor (`data-annotate-hit`), for hints and e2e. */
  hitSide?: BoxCell | null;
};

/** Estimated pill box (font-mono text-[11px], px-1.5, leading-4): ~6.8px per glyph + 14px padding, 16px tall. */
const PILL_H = 16;
const pillWidth = (text: string) => Math.ceil(text.length * 7.2) + 16;
/** Outward offset of a moved pill from its band's outer edge, on the 8px grid. */
const PILL_GAP = 8;

/** A laid-out pill: centre, size, and the side (or `all` for the summary pill) it names. */
export type PillPlacement = { side: string; region: SpacingRegion; text: string; x: number; y: number; w: number; h: number };

const overlaps = (a: PillPlacement, b: PillPlacement) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

/** Centre of a pill placed `steps` levels outside its band's outer edge (8px gap, then stacked). */
function outward(p: PillPlacement, steps: number): PillPlacement {
  const r = p.region.rect;
  const c = center(r);
  const along = (size: number) => PILL_GAP + size / 2 + (steps - 1) * (size + PILL_GAP);
  switch (p.region.side) {
    case "top":
      return { ...p, x: c.x, y: r.y - along(p.h) };
    case "bottom":
      return { ...p, x: c.x, y: r.y + r.height + along(p.h) };
    case "left":
      return { ...p, x: r.x - along(p.w), y: c.y };
    default:
      return { ...p, x: r.x + r.width + along(p.w), y: c.y };
  }
}

/** `pt-4 · 16` -> `p-4 · 16`: the side letter dropped from a one-side utility label. */
const summaryText = (text: string) => text.replace(/^(-?[pm])[trblxyse]-/, "$1-");

/**
 * Pill layout for one padding / margin ring (spec 14.2): each pill starts on its band's
 * centre; a top/bottom band thinner than the pill moves its pill outward. When pills
 * still collide, four equal sides collapse to one summary pill (`p-4 · 16`); otherwise
 * pills that overhang their band move outward, and any still colliding stack further
 * out in 8px steps until clear. Every
 * emphasised side keeps a pill, so a selected side's value is never hidden.
 */
export function layoutRingPills(regions: readonly SpacingRegion[], labelOf: (r: SpacingRegion) => string): PillPlacement[] {
  const pills = regions.map((region): PillPlacement => {
    const text = labelOf(region);
    const c = center(region.rect);
    return { side: region.side, region, text, x: c.x, y: c.y, w: pillWidth(text), h: PILL_H };
  });
  for (let i = 0; i < pills.length; i++) {
    const p = pills[i];
    const vertical = p.side === "top" || p.side === "bottom";
    if (thickness(p.region) < 1 || (vertical && thickness(p.region) < p.h)) pills[i] = outward(p, 1);
  }
  const collides = () => pills.some((a, i) => pills.some((b, j) => i < j && overlaps(a, b)));
  if (!collides()) return pills;
  const texts = pills.map((p) => summaryText(p.text));
  if (pills.length === 4 && BOX_SIDES.every((side) => pills.some((p) => p.side === side)) && texts.every((t) => t === texts[0])) {
    const top = pills.find((p) => p.side === "top") ?? pills[0];
    const summary: PillPlacement = { ...top, side: "all", text: texts[0], w: pillWidth(texts[0]) };
    const c = center(top.region.rect);
    return [thickness(top.region) >= PILL_H ? { ...summary, x: c.x, y: c.y } : outward(summary, 1)];
  }
  // Pills that overhang their band (left/right pills wider than the band) move outward together, so the ring reads symmetric.
  for (let i = 0; i < pills.length; i++) {
    const p = pills[i];
    const vertical = p.side === "top" || p.side === "bottom";
    if (thickness(p.region) < (vertical ? p.h : p.w)) pills[i] = outward(p, 1);
  }
  const placed: PillPlacement[] = [];
  for (const p of pills) {
    let next = p;
    for (let steps = 1; steps <= 6 && placed.some((q) => overlaps(q, next)); steps++) next = outward(p, steps);
    placed.push(next);
  }
  // A pill left on its band may now sit under one that moved past it: move it out too.
  for (let i = 0; i < placed.length; i++) {
    for (let steps = 1; steps <= 6 && placed.some((q, j) => j !== i && overlaps(q, placed[i])); steps++) placed[i] = outward(pills[i], steps);
  }
  return placed;
}

/** Pill label of a region: its token (or `?`) and px. */
const labelFor = (r: SpacingRegion, resolveToken: TokenResolver) => regionLabel(r, resolveToken(r.element, regionProperty(r), r.value));

/** Laid-out pills of a padding / margin ring (null for gap rings and dim previews, which keep band-centre pills or none). */
function ringPills(ring: BoxRing, resolveToken: TokenResolver): PillPlacement[] | null {
  if (ring.group === "gap" || ring.dim) return null;
  const regions = ring.spacing.regions.filter((r) => r.kind === ring.group && (ring.sides == null || ring.sides.includes(r.side as BoxSide)));
  return layoutRingPills(regions, (r) => labelFor(r, resolveToken));
}

function Ring({ ring, resolveToken, pills }: { ring: BoxRing; resolveToken: TokenResolver; pills: PillPlacement[] | null }) {
  const { spacing, group, sides, selected, dim } = ring;
  const tint = SPACING_TINTS[group];
  const regions = spacing.regions.filter((r) => r.kind === group);
  const gapIndex = (r: SpacingRegion) => regions.indexOf(r);
  const emphasised = (r: SpacingRegion) => group === "gap" || sides == null || sides.includes(r.side as BoxSide);
  const hit = (r: SpacingRegion) => (group === "gap" ? ring.hitSide === gapIndex(r) : ring.hitSide === r.side);
  const label = (r: SpacingRegion) => labelFor(r, resolveToken);
  const bandLayer: OverlayLayer = group === "gap" ? "gap" : "ring";
  return (
    <div
      data-annotate-ring={group}
      {...(selected ? { "data-annotate-selected": group, "data-annotate-selected-sides": group === "gap" ? "bands" : (sides ?? []).join(" ") } : {})}
      {...(dim ? { "data-annotate-dim": "" } : {})}
    >
      {regions.map((region, i) => {
        const on = emphasised(region);
        const common = {
          "data-annotate-region": regionProperty(region),
          "data-annotate-region-kind": region.kind,
          "data-index": region.index,
          "data-value": region.value,
          "data-active": on || undefined,
          "data-annotate-hit": hit(region) || undefined,
          "data-annotate-side-selected": (selected && on) || undefined,
          title: label(region),
        };
        if (thickness(region) < 1 && group !== "gap") {
          // A side at 0 stays visible (and selectable) as a dashed ghost edge (spec 14.2).
          return (
            <div
              key={i}
              {...layerAttr("ghost")}
              {...common}
              className="fixed"
              style={{ ...box(region.rect), zIndex: Z[group], outline: `1px dashed ${tint}`, opacity: dim ? 0.5 : undefined }}
            />
          );
        }
        return (
          <div
            key={i}
            {...layerAttr(bandLayer)}
            {...common}
            className="fixed"
            style={{
              ...box(region.rect),
              zIndex: Z[group],
              backgroundColor: dim ? `color-mix(in oklch, ${tint} 16%, transparent)` : on ? `color-mix(in oklch, ${tint} ${selected ? 42 : 30}%, transparent)` : DIM,
              outline: selected && on ? `1.5px solid ${tint}` : dim ? `1px dashed color-mix(in oklch, ${tint} 45%, transparent)` : `1px solid color-mix(in oklch, ${tint} 65%, transparent)`,
              outlineOffset: selected && on ? -1.5 : -1,
            }}
          />
        );
      })}
      {!dim &&
        (pills ?? regions.filter(emphasised).map((region) => ({ ...center(region.rect), region, text: label(region), side: String(gapIndex(region)) }))).map((pill, i) => (
          <Label
            key={`l${i}`}
            at={{ x: pill.x, y: pill.y }}
            text={pill.text}
            color={tint}
            attr={{
              ...layerAttr("region-pill"),
              "data-annotate-label": pill.side === "all" ? group : regionProperty(pill.region),
              "data-annotate-label-side": pill.side,
              "data-selected": selected ? "" : undefined,
            }}
          />
        ))}
    </div>
  );
}

export type SpacingOverlayProps = {
  /** Box or Lines (spec 14). Layers owned by the other sub-mode are not mounted. */
  subMode: InspectorSubMode;
  /** Lines: hovered element geometry (edges). Box: the hovered element (border box outline, grid note). */
  spacing: ElementSpacing | null;
  /** Box: the selected ring, then the hover ring (or its dim preview while something is selected). */
  rings?: BoxRing[];
  /** Box: `click to narrow to <side>` under the selected element. */
  hint?: { text: string; at: { x: number; y: number } } | null;
  /** Lines: pinned outlines (pin A, pin B). */
  pins: { rect: Rect; label: string }[];
  guides: Guide[];
  measurement: Measurement | null;
  resolveToken: TokenResolver;
};

/** Spacing inspector visuals, in viewport px inside the shadow root. Never hit-testable. */
export function SpacingOverlay({ subMode, spacing, rings = [], hint, pins, guides, measurement, resolveToken }: SpacingOverlayProps) {
  // Every node passes this gate (spec 14.5 layer ownership).
  const on = (layer: OverlayLayer) => ownsLayer(subMode, layer);
  const ringPillsList = rings.map((ring) => ringPills(ring, resolveToken));
  // The hint sits under the element; a pill moved out below it pushes the hint down (8px clear).
  const hintTop = hint ? Math.max(hint.at.y, ...ringPillsList.flat().flatMap((p) => (p && Math.abs(p.x - hint.at.x) * 2 < p.w + 160 && p.y + p.h / 2 > hint.at.y - 8 ? [p.y + p.h / 2 + PILL_GAP] : []))) : 0;
  const hintLeft = hint ? Math.max(96, Math.min(window.innerWidth - 96, hint.at.x)) : 0;
  return (
    <div data-annotate-spacing-overlay data-annotate-sub-mode={subMode} className="pointer-events-none fixed top-0 left-0">
      {spacing && (
        <>
          {spacing.fragments.map((fragment, index) => {
            const layer: OverlayLayer = on("outline") ? "outline" : "edge";
            return (
              <div
                key={`b${index}`}
                {...layerAttr(layer)}
                {...(layer === "outline" ? { "data-annotate-border-box": "" } : { "data-annotate-edge": "" })}
                className="fixed"
                style={{
                  ...box(fragment),
                  // Zero-size boxes still get a 1px marker (spec 3.5).
                  minWidth: 1,
                  minHeight: 1,
                  zIndex: Z.border,
                  outline: `1px ${layer === "outline" ? "dashed" : "solid"} ${GUIDE_COLOR}`,
                }}
              />
            );
          })}
          {spacing.gridNote && on("note") && (
            <Label
              at={{ x: spacing.border.x + spacing.border.width / 2, y: spacing.border.y + 8 }}
              text={spacing.gridNote}
              color={GUIDE_COLOR}
              attr={{ ...layerAttr("note"), "data-annotate-grid-note": "" }}
            />
          )}
        </>
      )}
      {on("ring") && rings.map((ring, i) => <Ring key={`r${i}`} ring={ring} resolveToken={resolveToken} pills={ringPillsList[i]} />)}
      {hint && on("hint") && (
        <span
          {...layerAttr("hint")}
          data-annotate-hint=""
          className={cn(PILL_CLASS, "fixed -translate-x-1/2 px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap")}
          style={{ left: hintLeft, top: Math.min(window.innerHeight - 28, hintTop), zIndex: Z.label }}
        >
          {hint.text}
        </span>
      )}
      {on("edge") &&
        pins.map((pin, index) => (
          <div
            key={`p${index}`}
            {...layerAttr("edge")}
            data-annotate-pin={index === 0 ? "a" : "b"}
            className="fixed"
            style={{ ...box(pin.rect), minWidth: 1, minHeight: 1, zIndex: Z.guide, outline: `2px solid ${GUIDE_COLOR}` }}
          />
        ))}
      {(on("guide") || on("measure") || on("dashed")) && (
        <svg className="fixed top-0 left-0 overflow-visible" width="1" height="1" style={{ zIndex: Z.guide }} aria-hidden>
          {on("guide") &&
            guides.flatMap((guide, g) =>
              guide.lines.map((line, i) => (
                <line key={`g${g}-${i}`} {...layerAttr("guide")} data-annotate-guide={guide.orientation} {...line} stroke={GUIDE_COLOR} strokeWidth={1} />
              )),
            )}
          {measurement?.lines.map((line, i) => (
            <g key={`m${i}`}>
              {on("measure") && (
                <line {...layerAttr("measure")} data-annotate-measure-line={line.axis} data-distance={line.distance} {...line.line} stroke={MEASURE_COLOR} strokeWidth={1} />
              )}
              {on("dashed") &&
                line.extensions.map((ext, j) => (
                  <line key={j} {...layerAttr("dashed")} data-annotate-measure-extension {...ext} stroke={MEASURE_COLOR} strokeWidth={1} strokeDasharray="4 4" />
                ))}
            </g>
          ))}
        </svg>
      )}
      {on("guide") &&
        guides.map((guide, g) => (
          <Label key={`gl${g}`} at={guide.labelAt} text={guide.label} color={GUIDE_COLOR} attr={{ ...layerAttr("guide"), "data-annotate-guide-label": "" }} />
        ))}
      {on("measure-pill") &&
        measurement?.lines.map((line, i) => (
          <Label
            key={`ml${i}`}
            at={{ x: (line.line.x1 + line.line.x2) / 2 + (line.axis === "y" ? 16 : 0), y: (line.line.y1 + line.line.y2) / 2 - (line.axis === "x" ? 16 : 0) }}
            text={line.label}
            color={MEASURE_COLOR}
            attr={{ ...layerAttr("measure-pill"), "data-annotate-measure-label": line.axis, "data-case": line.case }}
          />
        ))}
    </div>
  );
}
