import { Fragment, type ReactNode } from "react";

/**
 * Neutral greyscale wireframes for the Layout palette (parity spec 10). Each drawing is
 * a function of the box size, so a placement redraws without distortion when resized;
 * palette thumbnails draw at the default size and scale down. Colours are theme tokens.
 */

type Kind = "frame" | "fill" | "ink" | "line" | "bg";

const PAINT: Record<Kind, { fill: string; stroke?: string; opacity?: number }> = {
  frame: { fill: "var(--background)", stroke: "var(--muted-foreground)" },
  fill: { fill: "var(--muted)" },
  ink: { fill: "var(--muted-foreground)", opacity: 0.45 },
  line: { fill: "none", stroke: "var(--muted-foreground)" },
  bg: { fill: "var(--background)" },
};

function rect(x: number, y: number, w: number, h: number, r = 4, kind: Kind = "frame"): ReactNode {
  const p = PAINT[kind];
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(0, w)}
      height={Math.max(0, h)}
      rx={Math.min(r, Math.max(0, h) / 2, Math.max(0, w) / 2)}
      fill={p.fill}
      fillOpacity={p.opacity}
      stroke={p.stroke}
      strokeOpacity={p.stroke ? 0.6 : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function circle(cx: number, cy: number, r: number, kind: Kind = "frame"): ReactNode {
  const p = PAINT[kind];
  return (
    <circle
      cx={cx}
      cy={cy}
      r={Math.max(0, r)}
      fill={p.fill}
      fillOpacity={p.opacity}
      stroke={p.stroke}
      strokeOpacity={p.stroke ? 0.6 : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function path(d: string, kind: Kind = "line"): ReactNode {
  const p = PAINT[kind];
  return (
    <path
      d={d}
      fill={p.fill}
      fillOpacity={p.opacity}
      stroke={p.stroke ?? "none"}
      strokeOpacity={p.stroke ? 0.6 : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** A text placeholder bar. */
const bar = (x: number, y: number, w: number, h = 8) => rect(x, y, w, h, h / 2, "ink");

function star(cx: number, cy: number, r: number): ReactNode {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`);
  }
  return path(`M${pts.join("L")}Z`, "ink");
}

function textLines(x: number, y: number, w: number, h: number, step = 16): ReactNode[] {
  const n = Math.max(1, Math.floor((h + step - 8) / step));
  const widths = [1, 0.92, 0.84, 0.6];
  return Array.from({ length: n }, (_, i) => bar(x, y + i * step, w * (i === n - 1 && n > 1 ? 0.6 : widths[i % 3])));
}

function button(x: number, y: number, w: number, h: number, primary = true): ReactNode[] {
  return [rect(x, y, w, h, 6, primary ? "fill" : "frame"), bar(x + w * 0.25, y + h / 2 - 3, w * 0.5, 6)];
}

function input(x: number, y: number, w: number, h: number): ReactNode[] {
  return [rect(x, y, w, h, 6), bar(x + 8, y + h / 2 - 3, Math.min(w * 0.4, 96), 6)];
}

function avatar(cx: number, cy: number, r: number): ReactNode[] {
  return [circle(cx, cy, r, "fill"), circle(cx, cy - r * 0.2, r * 0.38, "ink"), path(`M${cx - r * 0.6},${cy + r * 0.62}Q${cx},${cy + r * 0.05} ${cx + r * 0.6},${cy + r * 0.62}Z`, "ink")];
}

const close = (x: number, y: number, s = 8) => path(`M${x},${y}l${s},${s}M${x + s},${y}l${-s},${s}`);
const chevron = (x: number, y: number, s = 4) => path(`M${x - s},${y - s / 2}l${s},${s}l${s},${-s}`);

type Draw = (w: number, h: number) => ReactNode[];

const DRAW: Record<string, Draw> = {
  button: (w, h) => button(0, 0, w, h),
  input: (w, h) => input(0, 0, w, h),
  text: (w, h) => textLines(0, 4, w, h - 8),
  heading: (w, h) => [bar(0, h / 2 - Math.min(24, h * 0.5) / 2, w * 0.7, Math.min(24, h * 0.5))],
  image: (w, h) => [rect(0, 0, w, h, 8, "fill"), path(`M0,0L${w},${h}M${w},0L0,${h}`), circle(w * 0.75, h * 0.3, Math.min(w, h) * 0.08, "ink")],
  card: (w, h) => [rect(0, 0, w, h, 12), rect(0, 0, w, h * 0.45, 12, "fill"), bar(16, h * 0.45 + 16, w * 0.6, 12), ...textLines(16, h * 0.45 + 40, w - 32, h * 0.55 - 56)],
  navigation: (w, h) => [rect(0, 0, w, h, 8), circle(h / 2, h / 2, h * 0.25, "ink"), ...[0, 1, 2, 3].map((i) => bar(w - 16 - (4 - i) * Math.min(72, w / 8), h / 2 - 4, Math.min(56, w / 10)))],
  table: (w, h) => {
    const rows = Math.max(2, Math.floor(h / 40));
    const rh = h / rows;
    const cols = Math.max(2, Math.min(5, Math.floor(w / 96)));
    const out: ReactNode[] = [rect(0, 0, w, h, 8), rect(0, 0, w, rh, 8, "fill")];
    for (let r = 1; r < rows; r++) out.push(path(`M0,${r * rh}H${w}`));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(bar((c * w) / cols + 12, r * rh + rh / 2 - 3, w / cols - 32, 6));
    return out;
  },
  list: (w, h) => {
    const rows = Math.max(1, Math.floor(h / 40));
    const rh = h / rows;
    const out: ReactNode[] = [rect(0, 0, w, h, 8)];
    for (let r = 0; r < rows; r++) {
      out.push(circle(20, r * rh + rh / 2, 8, "fill"), bar(40, r * rh + rh / 2 - 4, (w - 56) * (r % 2 ? 0.6 : 0.8)));
      if (r) out.push(path(`M12,${r * rh}H${w - 12}`));
    }
    return out;
  },
  modal: (w, h) => [rect(0, 0, w, h, 12), bar(24, 24, w * 0.45, 12), close(w - 32, 24), ...textLines(24, 56, w - 48, h - 136), ...button(w - 216, h - 56, 88, 32, false), ...button(w - 112, h - 56, 88, 32)],

  dropdown: (w, h) => [...input(0, 0, w, h), chevron(w - 16, h / 2)],
  toggle: (w, h) => [rect(0, 0, w, h, h / 2, "ink"), circle(w - h / 2, h / 2, h / 2 - 4, "bg")],
  stepper: (w, h) => [rect(0, 0, w, h, 6), path(`M${h},0V${h}M${w - h},0V${h}M${h / 2 - 5},${h / 2}h10M${w - h / 2 - 5},${h / 2}h10M${w - h / 2},${h / 2 - 5}v10`), bar(w / 2 - 8, h / 2 - 4, 16)],
  rating: (w, h) => Array.from({ length: 5 }, (_, i) => star((w / 5) * (i + 0.5), h / 2, Math.min(h / 2, w / 10) - 2)),
  checkbox: (w, h) => [rect(2, h / 2 - 8, 16, 16, 4), path(`M6,${h / 2}l3,3l6,-6`), bar(28, h / 2 - 4, w - 40)],
  radio: (w, h) => [circle(10, h / 2, 8), circle(10, h / 2, 4, "ink"), bar(28, h / 2 - 4, w - 40)],
  slider: (w, h) => [rect(0, h / 2 - 2, w, 4, 2, "fill"), rect(0, h / 2 - 2, w * 0.55, 4, 2, "ink"), circle(w * 0.55, h / 2, Math.min(10, h / 2 - 2))],

  avatar: (w, h) => avatar(w / 2, h / 2, Math.min(w, h) / 2 - 1),
  badge: (w, h) => [rect(0, 0, w, h, h / 2, "fill"), bar(w * 0.25, h / 2 - 3, w * 0.5, 6)],
  tag: (w, h) => [rect(0, 0, w, h, 6), bar(10, h / 2 - 3, w - 36, 6), close(w - 18, h / 2 - 3, 6)],
  breadcrumb: (w, h) => {
    const n = 3;
    const seg = w / n;
    return Array.from({ length: n }, (_, i) => [bar(i * seg, h / 2 - 4, seg - 24), i < n - 1 ? path(`M${(i + 1) * seg - 14},${h / 2 - 4}l4,4l-4,4`) : null]).flat();
  },
  pagination: (w, h) => {
    const n = Math.max(3, Math.min(7, Math.floor(w / (h + 8))));
    const gap = (w - n * h) / Math.max(1, n - 1);
    return Array.from({ length: n }, (_, i) => rect(i * (h + gap), 0, h, h, 6, i === 1 ? "fill" : "frame"));
  },
  progress: (w, h) => [rect(0, 0, w, h, h / 2, "fill"), rect(0, 0, w * 0.6, h, h / 2, "ink")],
  alert: (w, h) => [rect(0, 0, w, h, 8), rect(0, 0, 4, h, 2, "ink"), circle(28, 24, 8, "fill"), bar(48, 16, w * 0.4, 10), bar(48, 36, w * 0.7, 6)],
  toast: (w, h) => [rect(0, 0, w, h, 8), circle(28, h / 2, 10, "fill"), bar(48, h / 2 - 12, w * 0.45, 8), bar(48, h / 2 + 4, w * 0.6, 6), close(w - 24, 16)],
  notification: (w, h) => [rect(0, 0, w, h, 8), ...avatar(32, 32, 16), bar(60, 16, w * 0.4, 10), ...textLines(60, 36, w - 100, h - 44, 14), circle(w - 16, 16, 4, "ink")],
  tooltip: (w, h) => [rect(0, 0, w, h - 8, 6, "ink"), path(`M${w / 2 - 6},${h - 8}l6,8l6,-8Z`, "ink"), rect(w * 0.2, (h - 8) / 2 - 3, w * 0.6, 6, 3, "bg")],
  stat: (w, h) => [rect(0, 0, w, h, 8), bar(16, 16, w * 0.4, 8), bar(16, 36, w * 0.55, Math.min(28, h * 0.3)), bar(16, h - 24, w * 0.3, 6)],
  skeleton: (w, h) => [circle(Math.min(24, h / 2), Math.min(24, h / 2), Math.min(24, h / 2), "fill"), rect(Math.min(48, h) + 16, 8, w * 0.5, 12, 6, "fill"), rect(Math.min(48, h) + 16, 28, w * 0.35, 10, 5, "fill"), rect(0, Math.min(64, h * 0.55), w, h - Math.min(64, h * 0.55), 8, "fill")],
  chip: (w, h) => [rect(0, 0, w, h, h / 2), circle(h / 2, h / 2, h / 2 - 6, "fill"), bar(h, h / 2 - 3, w - h - 12, 6)],
  icon: (w, h) => [star(w / 2, h / 2, Math.min(w, h) / 2 - 1)],
  spinner: (w, h) => {
    const r = Math.min(w, h) / 2 - 3;
    return [circle(w / 2, h / 2, r, "line"), path(`M${w / 2},${h / 2 - r}A${r},${r} 0 0 1 ${w / 2 + r},${h / 2}`, "ink"), path(`M${w / 2},${h / 2 - r}A${r},${r} 0 0 1 ${w / 2 + r},${h / 2}`)];
  },

  pricing: (w, h) => [rect(0, 0, w, h, 12), bar(24, 24, w * 0.35, 10), bar(24, 48, w * 0.5, 28), ...[0, 1, 2, 3].flatMap((i) => [path(`M24,${108 + i * 28}l4,4l8,-8`), bar(48, 102 + i * 28, w * 0.55, 8)]), ...button(24, h - 64, w - 48, 40)],
  testimonial: (w, h) => [rect(0, 0, w, h, 12), path("M24,40q0,-16 12,-16M44,40q0,-16 12,-16"), ...textLines(24, 56, w - 48, h - 128), ...avatar(44, h - 40, 20), bar(76, h - 48, w * 0.3, 8), bar(76, h - 34, w * 0.2, 6)],
  cta: (w, h) => [rect(0, 0, w, h, 12, "fill"), bar(w * 0.25, h * 0.2, w * 0.5, 16), bar(w * 0.3, h * 0.2 + 28, w * 0.4, 8), ...button(w / 2 - 64, h - 56, 128, 40, false)],
  profile: (w, h) => [rect(0, 0, w, h, 12), rect(0, 0, w, h * 0.33, 12, "fill"), circle(w / 2, h * 0.33, 32), ...avatar(w / 2, h * 0.33, 28), bar(w * 0.3, h * 0.33 + 44, w * 0.4, 12), ...textLines(w * 0.15, h * 0.33 + 68, w * 0.7, h * 0.67 - 84)],
  feature: (w, h) => [rect(0, 0, w, h, 12), rect(24, 24, 40, 40, 8, "fill"), bar(24, 80, w * 0.5, 12), ...textLines(24, 104, w - 48, h - 120)],
  team: (w, h) => {
    const n = Math.max(2, Math.min(5, Math.floor(w / 140)));
    const col = w / n;
    const r = Math.min(col * 0.25, h * 0.2);
    return [rect(0, 0, w, h, 12), bar(w * 0.35, 20, w * 0.3, 12), ...Array.from({ length: n }, (_, i) => [...avatar(col * (i + 0.5), 56 + r, r), bar(col * (i + 0.2), 72 + r * 2, col * 0.6, 8), bar(col * (i + 0.3), 88 + r * 2, col * 0.4, 6)]).flat()];
  },
  login: (w, h) => [rect(0, 0, w, h, 12), bar(w * 0.3, 32, w * 0.4, 14), bar(32, 80, 64, 6), ...input(32, 94, w - 64, 40), bar(32, 150, 64, 6), ...input(32, 164, w - 64, 40), ...button(32, 228, w - 64, 40), bar(w * 0.35, h - 40, w * 0.3, 6)],
  contact: (w, h) => [rect(0, 0, w, h, 12), bar(32, 32, w * 0.4, 14), ...input(32, 72, (w - 72) / 2, 40), ...input(40 + (w - 72) / 2 + 0, 72, (w - 72) / 2, 40), ...input(32, 128, w - 64, 40), rect(32, 184, w - 64, h - 264, 6), bar(40, 196, w * 0.3, 6), ...button(w - 152, h - 64, 120, 40)],
};

const fallback: Draw = (w, h) => [rect(0, 0, w, h, 8), path(`M0,0L${w},${h}M${w},0L0,${h}`)];

export type WireframeProps = {
  type: string;
  /** Drawing size in px (the placement size, or the palette default for thumbnails). */
  width: number;
  height: number;
  className?: string;
};

/** The wireframe for a palette type, scaled to fill its box (thumbnails letterbox). */
export function Wireframe({ type, width, height, className }: WireframeProps) {
  const draw = DRAW[type] ?? fallback;
  return (
    <svg
      aria-hidden
      data-annotate-wireframe={type}
      className={className}
      viewBox={`-1 -1 ${width + 2} ${height + 2}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      overflow="visible"
    >
      {draw(width, height).map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </svg>
  );
}
