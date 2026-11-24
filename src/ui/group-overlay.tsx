import { cn } from "cn";
import type { Rect } from "../core/types.ts";
import { PILL_CLASS } from "./chrome.tsx";

const ACCENT = "var(--annotate-marker-purple)";
const HOVER = "var(--annotate-marker-blue)";

const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });
const rectOf = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
};

/**
 * Group highlight for the type and colour inspectors (spec 4): an outline per member,
 * a dashed outline for the hovered candidate, and an `N elements` badge on the anchor.
 * Lives in the shadow root; never hit-testable.
 */
export function GroupOverlay({ hover, members, anchor, badge, kind }: { hover: Element | null; members: readonly Element[]; anchor: Element | null; badge?: string; kind: "type" | "color" | "spacing" }) {
  const anchorRect = anchor?.isConnected ? rectOf(anchor) : null;
  const viewportWidth = window.innerWidth;
  return (
    <div data-annotate-group-overlay={kind} className="pointer-events-none fixed top-0 left-0">
      {hover && hover.isConnected && !members.includes(hover) && (
        <div
          data-annotate-hover-outline
          className="fixed rounded-[2px]"
          style={{
            ...box(rectOf(hover)),
            outline: `1.5px dashed ${HOVER}`,
            backgroundColor: `color-mix(in oklch, ${HOVER} 6%, transparent)`,
            zIndex: 4,
          }}
        />
      )}
      {members.filter((el) => el.isConnected).map((el, i) => (
        <div
          key={i}
          data-annotate-member-outline
          className="fixed rounded-[2px]"
          style={{
            ...box(rectOf(el)),
            outline: `1.5px solid ${ACCENT}`,
            outlineOffset: 1,
            backgroundColor: `color-mix(in oklch, ${ACCENT} 6%, transparent)`,
            zIndex: 5,
          }}
        />
      ))}
      {anchorRect && badge && (
        <span
          data-annotate-group-badge
          className="fixed rounded px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium whitespace-nowrap text-white tabular-nums"
          style={{
            left: Math.max(8, Math.min(viewportWidth - 160, anchorRect.x)),
            top: Math.max(8, anchorRect.y - 22),
            backgroundColor: `color-mix(in oklch, ${ACCENT} 74%, #09090b)`,
            boxShadow: `0 0 0 1px color-mix(in oklch, ${ACCENT} 55%, rgba(0, 0, 0, 0.25)), 0 1px 3px rgba(0, 0, 0, 0.28)`,
            textShadow: "0 1px 1px rgba(0, 0, 0, 0.25)",
            zIndex: 7,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

/** One type ladder rung: a token's px, its name, and whether it is the current value. */
export type LadderRung = { px: number; token: string; current: boolean };
export type TypeLadderColumn = { property: "font-size" | "line-height"; rungs: LadderRung[] };

const LADDER_TINT: Record<TypeLadderColumn["property"], string> = { "font-size": "var(--annotate-marker-purple)", "line-height": "var(--annotate-marker-blue)" };
/** Rule length and the space between the text and each column (8px grid). */
const RUNG_WIDTH = 40;
const LADDER_GAP = 8;
/** A rung more than this far below the viewport is not drawn (spec 13.3 overflow). */
const LADDER_OVERFLOW = 24;

/**
 * I9b token ladder (spec 13.7): faint rules to the right of the selected text, one column
 * per property, each rule at text top + token px (font-size: the em box; line-height: one
 * line box). Current value solid, nearest other token labelled. Never hit-testable.
 */
export function TypeLadder({ anchor, columns }: { anchor: Element | null; columns: readonly TypeLadderColumn[] }) {
  if (!anchor?.isConnected) return null;
  const r = rectOf(anchor);
  const limit = window.innerHeight + LADDER_OVERFLOW;
  const maxLabelLeft = Math.max(8, window.innerWidth - 120);
  return (
    <div data-annotate-type-ladder className="pointer-events-none fixed top-0 left-0">
      {columns.map((column, i) => {
        const left = r.x + r.width + LADDER_GAP + i * (RUNG_WIDTH + LADDER_GAP);
        const tint = LADDER_TINT[column.property];
        const current = column.rungs.find((g) => g.current)?.px ?? 0;
        const rungs = column.rungs.filter((g) => r.y + g.px <= limit);
        const labelled = rungs.filter((g) => !g.current).sort((a, b) => Math.abs(a.px - current) - Math.abs(b.px - current) || b.px - a.px)[0];
        return (
          <div key={column.property} data-annotate-type-ladder-column={column.property}>
            {rungs.map((g) => (
              <div
                key={`${g.px}-${g.current}`}
                data-annotate-type-guide={column.property}
                data-px={g.px}
                data-token={g.token}
                data-current={g.current || undefined}
                className="fixed"
                style={{ left, top: r.y + g.px - 0.5, width: RUNG_WIDTH, height: 0, borderTop: `1px ${g.current ? "solid" : "dashed"} ${tint}`, opacity: g.current ? 0.9 : 0.45, zIndex: 5 }}
              />
            ))}
            {labelled && (
              <span
                data-annotate-type-guide-label={column.property}
                className={cn(PILL_CLASS, "fixed px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap tabular-nums")}
                style={{ left: Math.min(maxLabelLeft, left + RUNG_WIDTH + 6), top: r.y + labelled.px - 8, zIndex: 5 }}
              >
                {`${labelled.token.replace(/^--/, "")} · ${Math.round(labelled.px * 100) / 100}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
