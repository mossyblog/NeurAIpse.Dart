import { useEffect, useState } from "react";
import { SURFACE_CSS } from "./surface-css.generated.ts";

export const HOST_ATTRIBUTE = "data-neuraipse-annotate";

/** Package-owned CSS paired with compiled Tailwind utilities inside the shadow root. */
const OWN_CSS = `
:host { all: initial; }
.annotate-root {
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}
/* The chart palette covers five marker hues. Keep the remaining swatches distinct
   with local colours. Provide theme-specific defaults for standalone shadow roots. */
.annotate-root [data-theme="light"] {
  color-scheme: light;
  color: var(--foreground);
  --background: #ffffff;
  --foreground: rgba(0, 0, 0, 0.88);
  --card: #ffffff;
  --card-foreground: rgba(0, 0, 0, 0.88);
  --popover: #ffffff;
  --popover-foreground: rgba(0, 0, 0, 0.88);
  --primary: #171717;
  --primary-foreground: #ffffff;
  --secondary: #f5f5f5;
  --secondary-foreground: rgba(0, 0, 0, 0.88);
  --muted: #f5f5f5;
  --muted-foreground: rgba(0, 0, 0, 0.61);
  --accent: #f5f5f5;
  --accent-foreground: rgba(0, 0, 0, 0.88);
  --destructive: #c4320a;
  --border: #e6e6e8;
  --input: #d4d4d8;
  --ring: #0060e2;
  --radius-md: 6px;
  --annotate-marker-blue: var(--chart-1, #0190fe);
  --annotate-marker-green: var(--chart-2, #5fc88a);
  --annotate-marker-amber: #e8b000;
  --annotate-marker-orange: var(--chart-3, #f28a2e);
  --annotate-marker-red: #f04438;
  --annotate-marker-pink: var(--chart-5, #ee3e9e);
  --annotate-marker-purple: var(--chart-4, #a651f0);
  --annotate-marker-teal: #13b3a0;
  --annotate-marker-cyan: #14b3f0;
  --annotate-destructive: var(--destructive, #c4320a);
  --annotate-warning: var(--warning, #b25e00);
  --annotate-warning-soft: var(--warning-soft, rgba(242, 138, 46, 0.12));
  --annotate-success: var(--success, #1e8a4f);
  --annotate-success-soft: var(--success-soft, rgba(95, 200, 138, 0.14));
  --annotate-info: var(--info, #0070d6);
  --annotate-info-soft: var(--info-soft, rgba(1, 144, 254, 0.1));
  --ann-border: rgba(0, 0, 0, 0.09);
  --ann-shadow-float: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 10px 28px -6px rgba(0, 0, 0, 0.16), 0 2px 6px -1px rgba(0, 0, 0, 0.06);
  --ann-shadow-pill: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 4px 12px -2px rgba(0, 0, 0, 0.14);
  --annotate-notch-bg: #ffffff;
  --annotate-notch-border: #dcdce2;
  --annotate-notch-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.16), 0 2px 8px -2px rgba(0, 0, 0, 0.08);
  --annotate-customize-well-bg: rgba(24, 24, 27, 0.03);
  --annotate-scrubber-track: rgba(24, 24, 27, 0.055);
  --annotate-scrubber-fill: rgba(24, 24, 27, 0.09);
  --annotate-scrubber-thumb: #71717a;
  --annotate-scrubber-tick: #d1d1d4;
  --annotate-scrubber-ghost: rgba(24, 24, 27, 0.07);
  --annotate-scrubber-ghost-highlight: 0 1px 2px rgba(24, 24, 27, 0.05);
  --annotate-scrubber-switch-track: #d4d4d8;
  --annotate-scrubber-switch-checked: #52525b;
  --annotate-scrubber-switch-knob: #ffffff;
  --annotate-scrubber-switch-knob-checked: #ffffff;
}
.annotate-root [data-theme="dark"] {
  color-scheme: dark;
  color: var(--foreground);
  --background: #1c1c1e;
  --foreground: rgba(255, 255, 255, 0.9);
  --card: #1c1c1e;
  --card-foreground: rgba(255, 255, 255, 0.9);
  --popover: #1f1f22;
  --popover-foreground: rgba(255, 255, 255, 0.9);
  --primary: #ededed;
  --primary-foreground: #161618;
  --secondary: #28282a;
  --secondary-foreground: rgba(255, 255, 255, 0.9);
  --muted: #28282a;
  --muted-foreground: rgba(255, 255, 255, 0.62);
  --accent: #28282a;
  --accent-foreground: rgba(255, 255, 255, 0.9);
  --destructive: #ff8a7a;
  --border: #3b3b3d;
  --input: #515154;
  --ring: #4d8dff;
  --radius-md: 6px;
  --annotate-marker-blue: var(--chart-1, #4fb0fe);
  --annotate-marker-green: var(--chart-2, #7dcf9f);
  --annotate-marker-amber: #e6c24d;
  --annotate-marker-orange: var(--chart-3, #f2a15c);
  --annotate-marker-red: #ff6b5f;
  --annotate-marker-pink: var(--chart-5, #f06db5);
  --annotate-marker-purple: var(--chart-4, #b98af0);
  --annotate-marker-teal: #4fc3b4;
  --annotate-marker-cyan: #5cc6ee;
  --annotate-destructive: var(--destructive, #ff8a7a);
  --annotate-warning: var(--warning, #ffb35c);
  --annotate-warning-soft: var(--warning-soft, rgba(242, 161, 92, 0.14));
  --annotate-success: var(--success, #7dcf9f);
  --annotate-success-soft: var(--success-soft, rgba(125, 207, 159, 0.14));
  --annotate-info: var(--info, #4fb0fe);
  --annotate-info-soft: var(--info-soft, rgba(79, 176, 254, 0.14));
  --ann-border: rgba(255, 255, 255, 0.12);
  --ann-shadow-float: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 14px 36px -8px rgba(0, 0, 0, 0.65), 0 2px 8px -2px rgba(0, 0, 0, 0.4);
  --ann-shadow-pill: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 4px 14px -2px rgba(0, 0, 0, 0.55);
  --annotate-notch-bg: #141416;
  --annotate-notch-border: #2a2a2f;
  --annotate-notch-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 2px 8px -2px rgba(0, 0, 0, 0.35);
  --annotate-customize-well-bg: rgba(255, 255, 255, 0.025);
  --annotate-scrubber-track: rgba(255, 255, 255, 0.04);
  --annotate-scrubber-fill: rgba(255, 255, 255, 0.06);
  --annotate-scrubber-thumb: rgba(255, 255, 255, 0.9);
  --annotate-scrubber-tick: #3f3f46;
  --annotate-scrubber-ghost: rgba(255, 255, 255, 0.07);
  --annotate-scrubber-ghost-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  --annotate-scrubber-switch-track: #3f3f46;
  --annotate-scrubber-switch-checked: #d4d4d8;
  --annotate-scrubber-switch-knob: #a1a1aa;
  --annotate-scrubber-switch-knob-checked: #18181b;
}
.annotate-root :is([data-theme="light"], [data-theme="dark"]) {
  --annotate-destructive-soft: color-mix(in srgb, var(--annotate-destructive) 12%, transparent);
}
.annotate-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklch, var(--foreground) 18%, transparent) transparent;
}
.annotate-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.annotate-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.annotate-scroll::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background: color-mix(in oklch, var(--foreground) 18%, transparent);
}
.annotate-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklch, var(--foreground) 30%, transparent);
}
@keyframes annotate-enter {
  from { opacity: 0; translate: 0 4px; }
  to { opacity: 1; translate: none; }
}
.annotate-enter {
  animation: annotate-enter 140ms var(--ease-standard, cubic-bezier(0.22, 1, 0.36, 1));
}
@keyframes annotate-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
.annotate-shake { animation: annotate-shake 320ms ease-in-out; }
.annotate-notch-item {
  will-change: transform;
  transition: background-color 120ms ease, color 120ms ease;
}
.annotate-notch-icon > svg {
  width: 100%;
  height: 100%;
}
.annotate-customize-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 820px) {
  .annotate-customize-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .annotate-customize-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.annotate-scrubber {
  position: relative;
  width: 100%;
  user-select: none;
}
.annotate-scrubber-track {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--annotate-scrubber-track);
  border: 1px solid transparent;
  cursor: pointer;
  overflow: hidden;
  touch-action: pan-y;
  outline: none;
  outline-offset: 2px;
  transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease;
}
.annotate-scrubber-track:hover:not([data-disabled="true"]) {
  background: color-mix(in srgb, var(--annotate-scrubber-track) 70%, var(--foreground) 6%);
}
.annotate-scrubber-track:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ring) 55%, transparent);
}
.annotate-scrubber-track[data-disabled="true"] {
  opacity: 0.35;
  pointer-events: none;
}
.annotate-scrubber-fill {
  position: absolute;
  inset: 0;
  right: auto;
  border-radius: 10px;
  background: var(--annotate-scrubber-fill);
  pointer-events: none;
}
.annotate-scrubber-ticks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.annotate-scrubber-tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 8px;
  border-radius: 999px;
  background: var(--annotate-scrubber-tick);
  transform: translateX(-50%) translateY(-50%);
}
.annotate-scrubber-thumb-wrapper {
  position: absolute;
  top: 50%;
  transform: translateX(-50%) translateY(-50%);
  pointer-events: none;
  z-index: 3;
}
.annotate-scrubber-thumb {
  width: 5px;
  height: 26px;
  border-radius: 999px;
  background: var(--annotate-scrubber-thumb);
  opacity: 0.32;
  transform: scaleX(0.7) scaleY(0.7);
  transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.annotate-scrubber-track[data-active="true"] .annotate-scrubber-thumb {
  opacity: 0.9;
  transform: scaleX(1) scaleY(1);
}
.annotate-scrubber-label {
  position: relative;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted-foreground);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  pointer-events: none;
  z-index: 4;
}
.annotate-scrubber-value {
  position: relative;
  flex-shrink: 0;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  z-index: 4;
}
.annotate-scrubber-track--switch,
.annotate-scrubber-track--select {
  width: 100%;
  text-align: left;
  font: inherit;
}
.annotate-scrubber-track--switch:active:not([data-disabled="true"]),
.annotate-scrubber-track--select:active:not([data-disabled="true"]) {
  transform: scale(0.985);
}
.annotate-scrubber-switch-toggle {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: var(--annotate-scrubber-switch-track);
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  z-index: 4;
  transition: background-color 150ms ease;
}
.annotate-scrubber-track--switch[data-checked="true"] .annotate-scrubber-switch-toggle {
  background: var(--annotate-scrubber-switch-checked);
}
.annotate-scrubber-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--annotate-scrubber-switch-knob);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.24);
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease;
}
.annotate-scrubber-track--switch[data-checked="true"] .annotate-scrubber-switch-knob {
  transform: translateX(16px);
  background: var(--annotate-scrubber-switch-knob-checked);
}
.annotate-scrubber-select-right {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 4;
  pointer-events: none;
}
.annotate-scrubber-track--select .annotate-scrubber-value {
  font-weight: 400;
}
.annotate-scrubber-caret {
  color: var(--muted-foreground);
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  flex-shrink: 0;
}
.annotate-scrubber-caret--open {
  transform: rotate(180deg);
}
.annotate-scrubber-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--ann-shadow-float);
  transform-origin: top center;
  animation: annotate-enter 140ms cubic-bezier(0.22, 1, 0.36, 1);
}
.annotate-scrubber-dropdown--up {
  top: auto;
  bottom: calc(100% + 4px);
  transform-origin: bottom center;
}
.annotate-scrubber-dropdown-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  color: var(--muted-foreground);
  font-size: 13px;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.annotate-scrubber-dropdown-item:hover,
.annotate-scrubber-dropdown-item--highlighted {
  background: var(--accent);
  color: var(--foreground);
}
.annotate-scrubber-dropdown-item--active {
  color: var(--foreground);
  font-weight: 500;
  background: var(--annotate-scrubber-ghost);
}
.annotate-scrubber-track--color {
  padding: 0 10px 0 12px;
  cursor: default;
}
.annotate-scrubber-color-controls {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 4;
}
.annotate-scrubber-color-swatch {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.annotate-scrubber-color-swatch:active {
  transform: scale(0.92);
}
.annotate-scrubber-color-text {
  width: 72px;
  height: 24px;
  background: var(--annotate-scrubber-ghost);
  border: 1px solid transparent;
  box-shadow: var(--annotate-scrubber-ghost-highlight);
  border-radius: 6px;
  color: var(--foreground);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 0 8px;
  text-transform: lowercase;
  outline: none;
}
.annotate-scrubber-color-text:focus-visible {
  border-color: var(--ring);
}
@media (prefers-reduced-motion: reduce) {
  .annotate-enter { animation: none; }
  .annotate-shake { animation: none; outline: 2px solid var(--ring); }
  .annotate-notch-item,
  .annotate-scrubber-track,
  .annotate-scrubber-thumb,
  .annotate-scrubber-switch-toggle,
  .annotate-scrubber-switch-knob,
  .annotate-scrubber-caret,
  .annotate-scrubber-dropdown,
  .annotate-scrubber-dropdown-item,
  .annotate-scrubber-color-swatch {
    animation: none;
    transition: none;
  }
}
`;

export type Surface = {
  host: HTMLElement;
  shadow: ShadowRoot;
  mount: HTMLElement;
  styles: HTMLElement;
};

function createSurface(doc: Document): Surface {
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  // A zero-size fixed box at the viewport origin. The inline styles also override the
  // UA [popover] defaults (inset, margin, border, padding, background, overflow).
  host.style.cssText =
    "position:fixed;inset:0 auto auto 0;width:0;height:0;margin:0;padding:0;border:0;" +
    "background:transparent;overflow:visible;z-index:2147483646;";
  const shadow = host.attachShadow({ mode: "open" });
  const styles = doc.createElement("div");
  styles.hidden = true;
  const tailwindStyle = doc.createElement("style");
  tailwindStyle.textContent = SURFACE_CSS;
  const ownStyle = doc.createElement("style");
  ownStyle.textContent = OWN_CSS;
  styles.replaceChildren(tailwindStyle, ownStyle);
  const mount = doc.createElement("div");
  mount.className = "annotate-root";
  shadow.append(styles, mount);
  return { host, shadow, mount, styles };
}

/** True when the browser implements the native Popover API. */
export function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === "function" && "popover" in el;
}

/** Moves the host into the top layer so page stacking contexts cannot cover it. */
function showInTopLayer(host: HTMLElement): void {
  if (!supportsPopover(host)) return;
  try {
    host.popover = "manual";
    if (!host.matches(":popover-open")) host.showPopover();
  } catch {
    // Not connected or unsupported here; the fixed z-index fallback still applies.
  }
}

/**
 * A shadow-DOM isolated overlay root attached to `container` (default `document.body`),
 * shown in the native top layer when the Popover API exists.
 */
export function useShadowSurface(container?: HTMLElement | ShadowRoot | null): Surface {
  const [surface] = useState(() => createSurface(document));
  useEffect(() => {
    (container ?? document.body).appendChild(surface.host);
    showInTopLayer(surface.host);
    return () => {
      surface.host.remove();
    };
  }, [container, surface]);
  return surface;
}

/** True when the event originated inside the overlay. */
export function isFromSurface(event: Event, surface: Surface): boolean {
  return event.composedPath().includes(surface.host);
}

/** The real event target, looking through shadow retargeting. */
export function realTarget(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target;
}
