"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { hasDirectText } from "../core/inspect-dom.ts";
import type { LayerBreadcrumbItem } from "./design-controls.tsx";
import { DesignPanel } from "./design-panel.tsx";
import { GroupOverlay } from "./group-overlay.tsx";
import { EDIT_NOT_FOUND, type InspectorContext } from "./inspector-context.ts";
import { useElementPicker } from "./use-element-picker.ts";
import { memberLabel } from "./use-style-changes.ts";

const SKIP_TAGS = new Set(["script", "style", "link", "meta", "noscript", "template", "br", "head", "title"]);
const MAX_ANCESTORS = 6;
const MAX_CHILDREN = 8;

function layerKind(el: Element): LayerBreadcrumbItem["kind"] {
  if (hasDirectText(el) && el.children.length === 0) return "text";
  const display = getComputedStyle(el).display;
  if (display.includes("flex") || display.includes("grid") || el.children.length > 0) return "container";
  return hasDirectText(el) ? "text" : "element";
}

function buildAncestors(el: Element, isOverlay: (node: Element) => boolean): LayerBreadcrumbItem[] {
  const chain: Element[] = [];
  for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
    if (isOverlay(cur)) break;
    chain.push(cur);
    if (cur === document.body) break;
  }
  chain.reverse();
  // Drop body when there are deeper meaningful layers so the trail starts from body's child.
  const trimmed = chain.length > 1 && chain[0] === document.body ? chain.slice(1) : chain;
  const limited = trimmed.slice(-MAX_ANCESTORS);
  return limited.map((node) => ({
    el: node,
    label: memberLabel(node),
    kind: layerKind(node),
  }));
}

function buildDirectChildren(el: Element, isOverlay: (node: Element) => boolean): LayerBreadcrumbItem[] {
  const out: LayerBreadcrumbItem[] = [];
  for (const child of Array.from(el.children)) {
    if (out.length >= MAX_CHILDREN) break;
    if (isOverlay(child) || SKIP_TAGS.has(child.localName)) continue;
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({ el: child, label: memberLabel(child), kind: layerKind(child) });
  }
  return out;
}

/**
 * Unified Figma/Pencil-grade per-layer Design Mode: hover highlights any element,
 * click selects that layer, and DesignPanel edits Layout, Appearance, Fill, Stroke,
 * and Typography live with token variable & color popovers.
 */
export function DesignMode({ ctx }: { ctx: InspectorContext }) {
  const { surface, resolver, styles } = ctx;
  const [selected, setSelected] = useState<Element | null>(null);

  const isOverlay = (el: Element) => el === surface.host || el.getRootNode() === surface.shadow;

  const picker = useElementPicker({
    surface,
    resolve: (el) => (isOverlay(el) ? null : el),
    onPick: (el) => setSelected(el),
  });

  // Keep GroupOverlay bounding box and live computed readouts locked on every edit/token update.
  useEffect(() => picker.redraw(), [styles.items, picker.redraw]);
  useEffect(() => resolver.subscribe(picker.redraw), [resolver, picker.redraw]);

  // First Esc deselects the active layer; when nothing is selected, returns false so toolbar handles it.
  const onEscape = useEffectEvent(() => {
    if (!selected?.isConnected) {
      if (selected) setSelected(null);
      return false;
    }
    setSelected(null);
    return true;
  });
  const { setEscape } = ctx;
  useEffect(() => {
    setEscape(() => onEscape());
    return () => setEscape(null);
  }, [setEscape]);

  // Edit button in pending queue re-selects that change's element.
  const onFocus = useEffectEvent((id: string) => {
    const a = styles.items.find((item) => item.id === id);
    if (!a?.styleChange) return;
    const members = styles.reattach(a);
    if (!members.length) {
      ctx.notify(EDIT_NOT_FOUND);
      return;
    }
    setSelected(members[0]);
  });
  useEffect(() => {
    const request = ctx.focus;
    if (!request) return;
    queueMicrotask(() => onFocus(request.id));
  }, [ctx.focus]);

  // Reference picker.tick so React reads fresh geometry & computed styles on redraws.
  void picker.tick;

  const sel = selected && selected.isConnected ? selected : null;
  const ancestors = sel ? buildAncestors(sel, isOverlay) : [];
  const directChildren = sel ? buildDirectChildren(sel, isOverlay) : [];
  const selRect = sel ? sel.getBoundingClientRect() : null;
  const badge = sel && selRect ? `${memberLabel(sel)} · ${Math.round(selRect.width)}×${Math.round(selRect.height)}` : undefined;

  return (
    <>
      <GroupOverlay
        kind="spacing"
        hover={picker.hover}
        members={sel ? [sel] : []}
        anchor={sel}
        badge={badge}
      />
      {(sel || ctx.pending.length > 0) && (
        <DesignPanel
          ctx={ctx}
          selected={sel}
          ancestors={ancestors}
          directChildren={directChildren}
          onSelectElement={(el) => setSelected(el)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
