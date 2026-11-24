import { forwardRef, useState, type PointerEvent } from "react";
import { cn } from "cn";
import { LayoutGrid, Search, X } from "lucide-react";
import { PALETTE, PALETTE_GROUPS, type PaletteGroup, type PaletteItem } from "../core/layout-palette.ts";
import { FIELD_CLASS, FloatingPanel, SectionLabel } from "./chrome.tsx";
import { Wireframe } from "./layout-wireframes.tsx";

export type LayoutPaletteProps = {
  /** The armed item (ghost follows the cursor until the next click on the page). */
  armed?: string;
  onPointerDownItem: (item: PaletteItem, event: PointerEvent<HTMLButtonElement>) => void;
};

type CategoryFilter = "All" | PaletteGroup;
const CATEGORIES: readonly CategoryFilter[] = ["All", ...PALETTE_GROUPS];

/** Left side palette of wireframe components (parity spec 10), searchable & filterable. */
export const LayoutPalette = forwardRef<HTMLDivElement, LayoutPaletteProps>(function LayoutPalette(props, ref) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");

  const normalized = query.trim().toLowerCase();
  const visibleGroups = PALETTE_GROUPS.filter((group) => category === "All" || category === group)
    .map((group) => ({
      group,
      items: PALETTE.filter(
        (item) =>
          item.group === group &&
          (!normalized || item.label.toLowerCase().includes(normalized) || item.group.toLowerCase().includes(normalized)),
      ),
    }))
    .filter((entry) => entry.items.length > 0);

  return (
    <FloatingPanel
      side="left"
      width="sm"
      label="Layout components"
      icon={<LayoutGrid className="size-3.5" />}
      modeLabel="Layout"
      title="Components"
      subtitle="Click or drag onto the page"
      collapsible
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      panelRef={ref}
      dataAttrs={{
        "data-annotate-layout-palette": "",
      }}
    >
      <div className="flex flex-col gap-2.5">
        <div className="sticky top-0 z-10 -mx-3 -mt-2.5 flex flex-col gap-1.5 border-b border-border/60 bg-popover/95 px-3 pt-2.5 pb-2 backdrop-blur-md">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search components…"
              aria-label="Search layout components"
              data-annotate-palette-search=""
              className={cn(FIELD_CLASS, "w-full pr-6 pl-7")}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1.5 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Component categories">
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "h-6 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    active
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
            No components match “{query}”.
          </div>
        ) : (
          visibleGroups.map(({ group, items }) => (
            <section key={group} aria-label={group} className="flex flex-col gap-1.5">
              <SectionLabel meta={<span className="font-mono tabular-nums">{items.length}</span>}>{group}</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    data-annotate-palette-item={item.type}
                    aria-pressed={props.armed === item.type}
                    title={`${item.label} (${item.width}×${item.height})`}
                    onPointerDown={(event) => props.onPointerDownItem(item, event)}
                    className={cn(
                      "flex cursor-grab touch-none flex-col items-stretch gap-1.5 rounded-lg bg-background/70 p-2 text-left ring-1 ring-foreground/[0.08] transition-all outline-none select-none hover:bg-muted/70 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing dark:bg-background/40 dark:ring-white/[0.08]",
                      props.armed === item.type && "bg-muted ring-2 ring-primary",
                    )}
                  >
                    <span className="flex h-9 items-center justify-center rounded-md bg-muted/40 p-1">
                      <Wireframe type={item.type} width={item.width} height={item.height} />
                    </span>
                    <span className="flex items-baseline justify-between gap-1">
                      <span className="truncate text-[11px] font-medium text-foreground">{item.label}</span>
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">{`${item.width}×${item.height}`}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </FloatingPanel>
  );
});
