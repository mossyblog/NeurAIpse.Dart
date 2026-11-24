import { useEffect, useRef, type CSSProperties } from "react";
import { Button } from "@ui-sdk/react/button";
import type { Annotation, Point } from "../core/types.ts";
import type { TrackedPositions } from "./use-marker-tracking.ts";

export type MarkersProps = {
  annotations: readonly Annotation[];
  color: string;
  activeId?: string;
  positions: TrackedPositions;
  onSelect: (annotation: Annotation, index: number) => void;
};

function Marker({
  annotation,
  index,
  color,
  active,
  position,
  onSelect,
}: {
  annotation: Annotation;
  index: number;
  color: string;
  active: boolean;
  position?: Point;
  onSelect: MarkersProps["onSelect"];
}) {
  const style: CSSProperties = {
    left: position ? position.x : `${annotation.x}vw`,
    top: position ? position.y : annotation.y,
    position: annotation.isFixed ? "fixed" : "absolute",
    backgroundColor: color,
    textShadow: "0 1px 1.5px rgba(0, 0, 0, 0.45)",
  };
  return (
    <Button
      type="button"
      aria-label={`Annotation ${index + 1}: ${annotation.element}`}
      title={annotation.comment || annotation.element}
      onClick={() => onSelect(annotation, index)}
      className="pointer-events-auto flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full font-mono text-[11px] leading-none font-semibold text-white tabular-nums shadow-md ring-2 ring-background transition-transform duration-150 outline-none select-none hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[active=true]:z-10 data-[active=true]:scale-110 motion-reduce:transition-none"
      data-active={active}
      data-annotate-marker={index + 1}
      data-marker-position={annotation.isFixed ? "fixed" : "absolute"}
      data-marker-frame={annotation.frame ? annotation.frame.path.map((p) => p.id ?? p.index).join("/") : undefined}
      style={style}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            border: `1.5px solid color-mix(in oklch, ${color} 72%, transparent)`,
            boxShadow: `0 0 0 4px color-mix(in oklch, ${color} 22%, transparent)`,
          }}
        />
      )}
      {index + 1}
    </Button>
  );
}

/**
 * Numbered markers. Page-anchored markers are `position: absolute` in a layer shifted by
 * the document scroll (the overlay host is fixed in the top layer), so they scroll with
 * the page; markers for fixed elements are `position: fixed` and stay put.
 */
export function Markers({ annotations, color, activeId, positions, onSelect }: MarkersProps) {
  const pageLayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      if (pageLayer.current) {
        pageLayer.current.style.transform = `translate(${-window.scrollX}px, ${-window.scrollY}px)`;
      }
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  const render = (fixed: boolean) =>
    annotations.map((annotation, index) => {
      const position = positions.get(annotation.id);
      // Hidden: frame navigated, removed or out of view (or not located yet).
      if (position === null || (annotation.frame && position === undefined)) return null;
      return Boolean(annotation.isFixed) === fixed ? (
        <Marker
          key={annotation.id}
          annotation={annotation}
          index={index}
          color={color}
          active={annotation.id === activeId}
          position={position}
          onSelect={onSelect}
        />
      ) : null;
    });

  return (
    <>
      <div ref={pageLayer} className="pointer-events-none absolute top-0 left-0">
        {render(false)}
      </div>
      <div className="pointer-events-none fixed top-0 left-0">{render(true)}</div>
    </>
  );
}
