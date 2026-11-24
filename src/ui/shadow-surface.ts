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
@media (prefers-reduced-motion: reduce) {
  .annotate-enter { animation: none; }
  .annotate-shake { animation: none; outline: 2px solid var(--ring); }
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
