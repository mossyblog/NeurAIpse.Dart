import { MARKER_COLOR_IDS } from "../core/settings.ts";

/** Marker palette: each colour id maps to a token on the shadow surface. */
export const MARKER_COLORS: Record<string, string> = Object.fromEntries(
  MARKER_COLOR_IDS.map((id) => [id, `var(--annotate-marker-${id})`]),
);

export const MARKER_COLOR_NAMES: Record<string, string> = Object.fromEntries(
  MARKER_COLOR_IDS.map((id) => [id, id.charAt(0).toUpperCase() + id.slice(1)]),
);

export function markerColor(id: string): string {
  return MARKER_COLORS[id] ?? MARKER_COLORS.blue;
}
