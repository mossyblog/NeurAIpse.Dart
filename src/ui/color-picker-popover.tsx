import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { parseColor, toHex, type RGBA } from "../core/color.ts";

export type ColorPickerPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: string;
  onChange: (value: string) => void;
  anchorEl: HTMLElement | null;
};

type HSVA = { h: number; s: number; v: number; a: number };
type ColorFormat = "hex" | "rgba";

const POPOVER_WIDTH = 256;
const EDGE = 12;
const GAP = 8;
const DEFAULT_HEIGHT = 276;

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.25) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.25) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.25) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.25) 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function rgbToHsv(r: number, g: number, b: number, fallbackHue = 0): { h: number; s: number; v: number } {
  const rr = clamp01(r);
  const gg = clamp01(g);
  const bb = clamp01(b);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = fallbackHue;
  if (d > 1e-6) {
    if (max === rr) h = (((gg - bb) / d) % 6) * 60;
    else if (max === gg) h = ((bb - rr) / d + 2) * 60;
    else h = ((rr - gg) / d + 4) * 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return { r: r + m, g: g + m, b: b + m };
}

function parseToHsva(input: string, prevHue = 220): HSVA {
  const parsed = parseColor(input);
  if (!parsed) return { h: prevHue, s: 0, v: 0.5, a: 1 };
  const { h, s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b, prevHue);
  return { h, s, v, a: clamp01(parsed.a) };
}

function formatOutput(rgba: RGBA, format: ColorFormat): string {
  if (format === "hex") {
    return toHex(rgba);
  }
  const r = Math.round(clamp01(rgba.r) * 255);
  const g = Math.round(clamp01(rgba.g) * 255);
  const b = Math.round(clamp01(rgba.b) * 255);
  const a = Math.round(clamp01(rgba.a) * 100) / 100;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function computePosition(anchorEl: HTMLElement | null, measuredHeight: number): CSSProperties {
  if (!anchorEl || typeof window === "undefined") {
    return { left: EDGE, top: EDGE };
  }
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = measuredHeight > 0 ? measuredHeight : DEFAULT_HEIGHT;

  let left = rect.left - POPOVER_WIDTH - GAP;
  if (left < EDGE) {
    left = rect.right + GAP;
  }
  left = Math.max(EDGE, Math.min(left, vw - POPOVER_WIDTH - EDGE));

  let top = rect.top - 4;
  if (top + height > vh - EDGE) {
    const flipped = rect.bottom - height + 4;
    top = flipped >= EDGE ? flipped : vh - height - EDGE;
  }
  top = Math.max(EDGE, top);

  return { left, top };
}

/** Floating HSV color picker popover with 2D S/V square, Hue & Alpha sliders, and HEX/RGBA inputs. */
export function ColorPickerPopover({
  open,
  onOpenChange,
  color,
  onChange,
  anchorEl,
}: ColorPickerPopoverProps) {
  const [hsva, setHsva] = useState<HSVA>(() => parseToHsva(color));
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [pos, setPos] = useState<CSSProperties>(() => computePosition(anchorEl, DEFAULT_HEIGHT));

  const cardRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string | null>(null);

  // Sync external color prop into local HSVA without clobbering hue while dragging.
  useEffect(() => {
    if (color === lastEmittedRef.current) return;
    setHsva((prev) => parseToHsva(color, prev.h));
    setHexDraft(null);
  }, [color, open]);

  // Measure and position beside anchorEl.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const h = cardRef.current?.getBoundingClientRect().height ?? DEFAULT_HEIGHT;
      setPos(computePosition(anchorEl, h));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorEl, format]);

  // Close on Escape (capture) or outside pointerdown (Shadow DOM safe).
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (cardRef.current && path.includes(cardRef.current)) return;
      if (anchorEl && path.includes(anchorEl)) return;
      onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, anchorEl, onOpenChange]);

  const emit = useCallback(
    (next: HSVA, fmt: ColorFormat = format) => {
      setHsva(next);
      setHexDraft(null);
      const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
      const out = formatOutput({ r, g, b, a: next.a }, fmt);
      lastEmittedRef.current = out;
      onChange(out);
    },
    [format, onChange],
  );

  // 2D Saturation / Brightness drag
  const updateSvFromPointer = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp01((clientX - rect.left) / Math.max(1, rect.width));
    const v = clamp01(1 - (clientY - rect.top) / Math.max(1, rect.height));
    emit({ ...hsva, s, v });
  };

  const onSvPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSvFromPointer(event.clientX, event.clientY);
  };

  const onSvPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateSvFromPointer(event.clientX, event.clientY);
  };

  // Hue slider drag
  const updateHueFromPointer = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp01((clientX - rect.left) / Math.max(1, rect.width));
    emit({ ...hsva, h: ratio * 360 });
  };

  const onHuePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHueFromPointer(event.clientX);
  };

  const onHuePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateHueFromPointer(event.clientX);
  };

  // Alpha slider drag
  const updateAlphaFromPointer = (clientX: number) => {
    const el = alphaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const a = Math.round(clamp01((clientX - rect.left) / Math.max(1, rect.width)) * 100) / 100;
    emit({ ...hsva, a });
  };

  const onAlphaPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateAlphaFromPointer(event.clientX);
  };

  const onAlphaPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateAlphaFromPointer(event.clientX);
  };

  if (!open) return null;

  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const r255 = Math.round(clamp01(rgb.r) * 255);
  const g255 = Math.round(clamp01(rgb.g) * 255);
  const b255 = Math.round(clamp01(rgb.b) * 255);
  const alphaPct = Math.round(clamp01(hsva.a) * 100);
  const currentHex = toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: hsva.a });
  const opaqueCss = `rgb(${r255}, ${g255}, ${b255})`;
  const previewCss = `rgba(${r255}, ${g255}, ${b255}, ${hsva.a})`;
  const hueCss = `hsl(${Math.round(hsva.h)} 100% 50%)`;

  const handleHexChange = (raw: string) => {
    setHexDraft(raw);
    const normalized = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
    const parsed = parseColor(normalized);
    if (parsed) {
      const { h, s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b, hsva.h);
      const next: HSVA = { h, s, v, a: normalized.length > 7 ? clamp01(parsed.a) : hsva.a };
      setHsva(next);
      const out = formatOutput({ r: parsed.r, g: parsed.g, b: parsed.b, a: next.a }, "hex");
      lastEmittedRef.current = out;
      onChange(out);
    }
  };

  const handleRgbChannel = (channel: "r" | "g" | "b", raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(255, n)) / 255;
    const nextRgb = { r: rgb.r, g: rgb.g, b: rgb.b, [channel]: clamped };
    const { h, s, v } = rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b, hsva.h);
    emit({ h, s, v, a: hsva.a }, "rgba");
  };

  const handleAlphaNumeric = (raw: string, mode: "pct" | "unit") => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const a = mode === "pct" ? clamp01(n / 100) : clamp01(n);
    emit({ ...hsva, a: Math.round(a * 100) / 100 });
  };

  const content = (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Color picker"
      data-annotate-ui="color-picker-popover"
      style={pos}
      className={cn(
        "fixed z-50 flex w-64 flex-col gap-2.5 rounded-xl border border-border/80 bg-popover/98 p-3 text-popover-foreground shadow-xl backdrop-blur-xl select-none",
        "dark:border-white/[0.1] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 2D Saturation / Brightness Gradient Square */}
      <div
        ref={svRef}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, Brightness ${Math.round(hsva.v * 100)}%`}
        tabIndex={0}
        onPointerDown={onSvPointerDown}
        onPointerMove={onSvPointerMove}
        className="relative h-36 w-full cursor-crosshair overflow-hidden rounded-lg ring-1 ring-inset ring-black/15 dark:ring-white/10 touch-none"
        style={{
          backgroundColor: hueCss,
          backgroundImage:
            "linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45),0_2px_4px_rgba(0,0,0,0.35)]"
          style={{
            left: `${hsva.s * 100}%`,
            top: `${(1 - hsva.v) * 100}%`,
            backgroundColor: opaqueCss,
          }}
        />
      </div>

      {/* Sliders row with live preview swatch */}
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden
          className="relative size-7 shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/15 dark:ring-white/15"
          style={CHECKERBOARD_STYLE}
        >
          <div className="absolute inset-0" style={{ backgroundColor: previewCss }} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Rainbow Hue Slider */}
          <div
            ref={hueRef}
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsva.h)}
            tabIndex={0}
            onPointerDown={onHuePointerDown}
            onPointerMove={onHuePointerMove}
            className="relative h-3 w-full cursor-ew-resize rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/10 touch-none"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.35)]"
              style={{
                left: `${(hsva.h / 360) * 100}%`,
                backgroundColor: hueCss,
              }}
            />
          </div>

          {/* Checkerboard Alpha Slider */}
          <div
            ref={alphaRef}
            role="slider"
            aria-label="Opacity"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={alphaPct}
            tabIndex={0}
            onPointerDown={onAlphaPointerDown}
            onPointerMove={onAlphaPointerMove}
            className="relative h-3 w-full cursor-ew-resize overflow-visible rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/10 touch-none"
            style={CHECKERBOARD_STYLE}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(${r255}, ${g255}, ${b255}, 0), ${opaqueCss})`,
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.35)]"
              style={{
                left: `${hsva.a * 100}%`,
                backgroundColor: previewCss,
              }}
            />
          </div>
        </div>
      </div>

      {/* Format toggle + live inputs */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFormat((f) => (f === "hex" ? "rgba" : "hex"))}
          title="Switch color format"
          aria-label={`Color format: ${format.toUpperCase()}`}
          className="h-7 shrink-0 cursor-pointer rounded-md border border-border/70 bg-muted/55 px-1.5 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
        >
          {format.toUpperCase()}
        </button>

        {format === "hex" ? (
          <>
            <input
              type="text"
              aria-label="Hex color"
              value={hexDraft ?? currentHex}
              onChange={(e) => handleHexChange(e.target.value)}
              onBlur={() => setHexDraft(null)}
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-muted/50 px-2 font-mono text-xs text-foreground uppercase outline-none transition-colors hover:border-border/60 focus:border-ring/70 focus:bg-background focus:ring-2 focus:ring-ring/30 dark:bg-white/[0.06] dark:hover:border-white/[0.12] dark:focus:bg-background/90"
            />
            <div className="flex h-7 w-14 shrink-0 items-center rounded-md border border-transparent bg-muted/50 px-1.5 transition-colors hover:border-border/60 focus-within:border-ring/70 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/30 dark:bg-white/[0.06] dark:hover:border-white/[0.12] dark:focus-within:bg-background/90">
              <input
                type="number"
                aria-label="Alpha percentage"
                min={0}
                max={100}
                value={alphaPct}
                onChange={(e) => handleAlphaNumeric(e.target.value, "pct")}
                className="w-full min-w-0 bg-transparent text-right font-mono text-xs text-foreground tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">%</span>
            </div>
          </>
        ) : (
          <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
            {(
              [
                { key: "r", label: "R", val: r255 },
                { key: "g", label: "G", val: g255 },
                { key: "b", label: "B", val: b255 },
              ] as const
            ).map((ch) => (
              <label key={ch.key} className="flex flex-col items-center gap-0.5">
                <input
                  type="number"
                  aria-label={`Red Green Blue ${ch.label}`}
                  min={0}
                  max={255}
                  value={ch.val}
                  onChange={(e) => handleRgbChannel(ch.key, e.target.value)}
                  className="h-7 w-full rounded-md border border-transparent bg-muted/50 px-1 text-center font-mono text-[11px] text-foreground tabular-nums outline-none transition-colors hover:border-border/60 focus:border-ring/70 focus:bg-background focus:ring-2 focus:ring-ring/30 dark:bg-white/[0.06] dark:hover:border-white/[0.12] dark:focus:bg-background/90 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="font-mono text-[9px] text-muted-foreground/70">{ch.label}</span>
              </label>
            ))}
            <label className="flex flex-col items-center gap-0.5">
              <input
                type="number"
                aria-label="Alpha"
                min={0}
                max={1}
                step={0.05}
                value={Math.round(hsva.a * 100) / 100}
                onChange={(e) => handleAlphaNumeric(e.target.value, "unit")}
                className="h-7 w-full rounded-md border border-transparent bg-muted/50 px-1 text-center font-mono text-[11px] text-foreground tabular-nums outline-none transition-colors hover:border-border/60 focus:border-ring/70 focus:bg-background focus:ring-2 focus:ring-ring/30 dark:bg-white/[0.06] dark:hover:border-white/[0.12] dark:focus:bg-background/90 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="font-mono text-[9px] text-muted-foreground/70">A</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );

  const portalTarget = anchorEl?.closest("[data-theme]");
  return portalTarget ? createPortal(content, portalTarget) : content;
}
