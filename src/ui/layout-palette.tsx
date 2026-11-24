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
      <div className="flex flex-col gap-3">
        <div className="sticky top-0 z-10 -mx-3 -mt-2.5 flex flex-col gap-2 border-b border-border/50 bg-popover/95 px-3 pt-2.5 pb-2.5 backdrop-blur-md">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search components…"
              aria-label="Search layout components"
              data-annotate-palette-search=""
              className={cn(FIELD_CLASS, "h-8 w-full rounded-lg border-border/60 bg-muted/35 pr-7 pl-8 focus-visible:bg-background")}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="flex flex-nowrap gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Component categories">
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "h-6 shrink-0 cursor-pointer rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    active
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted/45 text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-muted/25 px-3 py-4 text-center text-xs text-muted-foreground">
            <span>No components match “{query}”.</span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="cursor-pointer text-[11px] font-medium text-foreground underline underline-offset-4 hover:opacity-80"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          visibleGroups.map(({ group, items }) => (
            <section key={group} aria-label={group} className="flex flex-col gap-2">
              <SectionLabel meta={<span className="font-mono text-[10px] text-muted-foreground tabular-nums">{items.length}</span>}>
                {group}
              </SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((item) => {
                  const armed = props.armed === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      data-annotate-palette-item={item.type}
                      aria-pressed={armed}
                      title={`${item.label} (${item.width}×${item.height})`}
                      onPointerDown={(event) => props.onPointerDownItem(item, event)}
                      className={cn(
                        "group flex cursor-grab touch-none flex-col items-stretch gap-1.5 rounded-xl border p-2 text-left transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 active:cursor-grabbing",
                        armed
                          ? "border-primary/45 bg-primary/[0.06] ring-2 ring-primary/50"
                          : "border-border/50 bg-muted/30 hover:-translate-y-px hover:border-border/80 hover:bg-muted/55",
                      )}
                    >
                      <span className="relative flex h-10 items-center justify-center rounded-lg border border-border/40 bg-background/75 p-1.5 dark:bg-background/40">
                        <Wireframe type={item.type} width={item.width} height={item.height} />
                        <span className="pointer-events-none absolute right-1 bottom-0.5 rounded bg-background/85 px-1 font-mono text-[9px] leading-tight text-muted-foreground opacity-0 tabular-nums backdrop-blur-xs transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          {`${item.width}×${item.height}`}
                        </span>
                      </span>
                      <span className="truncate px-0.5 text-[11px] font-medium text-foreground">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </FloatingPanel>
  );
});
