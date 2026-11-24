import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const SWATCHES = [
  "#a855f7",
  "#7c3aed",
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#f43f5e",
  "#ffffff",
  "#94a3b8",
  "#000000",
] as const;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function stepDecimals(step: number): number {
  const s = step.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function roundToStep(val: number, step: number, min: number): number {
  const raw = Math.round((val - min) / step) * step + min;
  const decimals = Math.max(stepDecimals(step), stepDecimals(min));
  return Number(raw.toFixed(decimals));
}

export function ScrubberSlider({
  title,
  min = 0,
  max = 100,
  step = 1,
  value = 0,
  valueUnit = "",
  disabled = false,
  controlKey,
  onChange,
}: {
  title: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  valueUnit?: string;
  disabled?: boolean;
  controlKey: string;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const range = max - min;
  const percentage = range > 0 ? clamp(((value - min) / range) * 100, 0, 100) : 0;

  const computeValue = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return value;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return clamp(roundToStep(min + ratio * range, step, min), min, max);
    },
    [min, max, step, range, value],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // JSDOM may not support pointer capture
    }
    event.currentTarget.focus({ preventScroll: true });
    onChange(computeValue(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging && !disabled) {
      onChange(computeValue(event.clientX));
    }
  };

  const endDrag = () => setIsDragging(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = value - step;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(clamp(roundToStep(next, step, min), min, max));
  };

  const decimals = stepDecimals(step);
  const formattedValue = `${Number(value.toFixed(decimals))}${valueUnit}`;

  return (
    <div className="annotate-scrubber">
      <div
        ref={trackRef}
        className="annotate-scrubber-track"
        role="slider"
        aria-label={title}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        data-gooey-control={controlKey}
        data-dragging={isDragging}
        data-disabled={disabled}
        data-active={isDragging || isHovering}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onKeyDown={handleKeyDown}
      >
        <div className="annotate-scrubber-fill" style={{ width: `${percentage}%` }} />
        <div className="annotate-scrubber-ticks" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="annotate-scrubber-tick" style={{ left: `${(i + 1) * 10}%` }} />
          ))}
        </div>
        <div
          className="annotate-scrubber-thumb-wrapper"
          aria-hidden
          style={{ left: `${Math.max(4, Math.min(96, percentage))}%` }}
        >
          <div className="annotate-scrubber-thumb" />
        </div>
        <div className="annotate-scrubber-label">{title}</div>
        <div className="annotate-scrubber-value">{formattedValue}</div>
      </div>
    </div>
  );
}

export function ScrubberSelect<T extends string>({
  title,
  options,
  value,
  disabled = false,
  controlKey,
  onChange,
}: {
  title: string;
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  controlKey: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeLabel = options.find((opt) => opt.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const root = wrapRef.current?.getRootNode() as Document | ShadowRoot | undefined;
    const target: EventTarget = root && "addEventListener" in root ? root : document;
    const onPointerDown = (event: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: Event) => {
      if ((event as globalThis.KeyboardEvent).key === "Escape") {
        (event as globalThis.KeyboardEvent).stopPropagation();
        setOpen(false);
      }
    };
    target.addEventListener("pointerdown", onPointerDown, true);
    target.addEventListener("keydown", onKeyDown, true);
    return () => {
      target.removeEventListener("pointerdown", onPointerDown, true);
      target.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="annotate-scrubber">
      <button
        type="button"
        className="annotate-scrubber-track annotate-scrubber-track--select"
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        data-disabled={disabled}
        data-gooey-control={controlKey}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="annotate-scrubber-label">{title}</span>
        <span className="annotate-scrubber-select-right">
          <span className="annotate-scrubber-value">{activeLabel}</span>
          <svg
            aria-hidden
            className={`annotate-scrubber-caret${open ? " annotate-scrubber-caret--open" : ""}`}
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="annotate-scrubber-dropdown" role="listbox" aria-label={title}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              data-option-value={opt.value}
              className={`annotate-scrubber-dropdown-item${
                opt.value === value ? " annotate-scrubber-dropdown-item--active" : ""
              }`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScrubberColorPicker({
  title,
  color,
  disabled = false,
  controlKey,
  onChange,
}: {
  title: string;
  color: string;
  disabled?: boolean;
  controlKey: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const displayHex = draft ?? color.toLowerCase();

  useEffect(() => {
    if (!open) return;
    const root = wrapRef.current?.getRootNode() as Document | ShadowRoot | undefined;
    const target: EventTarget = root && "addEventListener" in root ? root : document;
    const onPointerDown = (event: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: Event) => {
      if ((event as globalThis.KeyboardEvent).key === "Escape") {
        (event as globalThis.KeyboardEvent).stopPropagation();
        setOpen(false);
      }
    };
    target.addEventListener("pointerdown", onPointerDown, true);
    target.addEventListener("keydown", onKeyDown, true);
    return () => {
      target.removeEventListener("pointerdown", onPointerDown, true);
      target.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const commitHex = (raw: string) => {
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (HEX_RE.test(withHash)) {
      onChange(withHash.toLowerCase());
    }
    setDraft(null);
  };

  return (
    <div ref={wrapRef} className="annotate-scrubber">
      <div
        className="annotate-scrubber-track annotate-scrubber-track--color"
        aria-disabled={disabled}
        data-disabled={disabled}
      >
        <span className="annotate-scrubber-label">{title}</span>
        <div className="annotate-scrubber-color-controls">
          <button
            type="button"
            className="annotate-scrubber-color-swatch"
            style={{ backgroundColor: color }}
            aria-label={`${title} swatch`}
            aria-expanded={open}
            disabled={disabled}
            onClick={() => !disabled && setOpen((o) => !o)}
          />
          <input
            type="text"
            className="annotate-scrubber-color-text"
            value={displayHex}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${title} hex`}
            disabled={disabled}
            data-gooey-control={controlKey}
            onFocus={(event) => {
              setDraft(color.toLowerCase());
              event.target.select();
            }}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              const withHash = next.trim().startsWith("#") ? next.trim() : `#${next.trim()}`;
              if (HEX_RE.test(withHash)) onChange(withHash.toLowerCase());
            }}
            onBlur={() => commitHex(displayHex)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitHex(displayHex);
                event.currentTarget.select();
              }
            }}
          />
        </div>
      </div>

      {open && (
        <div className="annotate-scrubber-dropdown" role="dialog" aria-label={`${title} swatches`}>
          <div className="grid grid-cols-5 gap-1.5 p-1">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                className="h-6 w-full cursor-pointer rounded-md border border-border transition-transform hover:scale-105"
                style={{ backgroundColor: swatch }}
                onClick={() => {
                  onChange(swatch);
                  setDraft(null);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label className="mt-1 flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <span>Custom color</span>
            <input
              type="color"
              value={HEX_RE.test(color) && color.length === 7 ? color : "#f4f4f5"}
              onChange={(event) => {
                onChange(event.target.value.toLowerCase());
                setDraft(null);
              }}
              className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ScrubberSwitch({
  title,
  checked,
  disabled = false,
  controlKey,
  onChange,
}: {
  title: string;
  checked: boolean;
  disabled?: boolean;
  controlKey: string;
  onChange: (checked: boolean) => void;
}) {
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  return (
    <div className="annotate-scrubber">
      <button
        type="button"
        className="annotate-scrubber-track annotate-scrubber-track--switch"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        aria-disabled={disabled}
        data-disabled={disabled}
        data-checked={checked}
        data-gooey-control={controlKey}
        tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <span className="annotate-scrubber-label">{title}</span>
        <span className="annotate-scrubber-switch-toggle" aria-hidden>
          <span className="annotate-scrubber-switch-knob" />
        </span>
      </button>
    </div>
  );
}
