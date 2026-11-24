/**
 * Layout mode palette (parity spec 10): wireframe components the user drops on the page
 * to show an agent where a new component should go. Pure data; sizes are px on the 8px
 * grid (a few small controls use 4px steps where the real component is that size).
 */

export type PaletteGroup = "Basic" | "Controls" | "Display" | "Sections";

export type PaletteItem = {
  /** Stable id stored in `placement.componentType`. */
  type: string;
  /** Label shown in the palette and the output (spec 10 labels exactly). */
  label: string;
  group: PaletteGroup;
  width: number;
  height: number;
};

export const PALETTE_GROUPS: readonly PaletteGroup[] = ["Basic", "Controls", "Display", "Sections"];

const item = (label: string, group: PaletteGroup, width: number, height: number): PaletteItem => ({
  type: label.toLowerCase(),
  label,
  group,
  width,
  height,
});

export const PALETTE: readonly PaletteItem[] = [
  item("Button", "Basic", 120, 40),
  item("Input", "Basic", 240, 40),
  item("Text", "Basic", 320, 72),
  item("Heading", "Basic", 320, 48),
  item("Image", "Basic", 320, 200),
  item("Card", "Basic", 280, 200),
  item("Navigation", "Basic", 640, 56),
  item("Table", "Basic", 480, 240),
  item("List", "Basic", 280, 200),
  item("Modal", "Basic", 400, 280),

  item("Dropdown", "Controls", 200, 40),
  item("Toggle", "Controls", 56, 32),
  item("Stepper", "Controls", 128, 40),
  item("Rating", "Controls", 160, 32),
  item("Checkbox", "Controls", 160, 24),
  item("Radio", "Controls", 160, 24),
  item("Slider", "Controls", 240, 32),

  item("Avatar", "Display", 48, 48),
  item("Badge", "Display", 64, 24),
  item("Tag", "Display", 80, 32),
  item("Breadcrumb", "Display", 280, 24),
  item("Pagination", "Display", 280, 40),
  item("Progress", "Display", 240, 16),
  item("Alert", "Display", 400, 64),
  item("Toast", "Display", 320, 64),
  item("Notification", "Display", 360, 80),
  item("Tooltip", "Display", 180, 40),
  item("Stat", "Display", 200, 104),
  item("Skeleton", "Display", 280, 120),
  item("Chip", "Display", 96, 32),
  item("Icon", "Display", 24, 24),
  item("Spinner", "Display", 32, 32),

  item("Pricing", "Sections", 320, 400),
  item("Testimonial", "Sections", 400, 200),
  item("CTA", "Sections", 640, 160),
  item("Profile", "Sections", 320, 240),
  item("Feature", "Sections", 320, 200),
  item("Team", "Sections", 640, 240),
  item("Login", "Sections", 360, 360),
  item("Contact", "Sections", 400, 400),
];

const BY_TYPE = new Map(PALETTE.map((p) => [p.type, p]));

export function paletteItem(type: string): PaletteItem | undefined {
  return BY_TYPE.get(type);
}

/** Output label for a stored `componentType`: the palette label, else the raw type. */
export function componentLabel(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}
