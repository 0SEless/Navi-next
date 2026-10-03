/**
 * Theme resolution for MapLibre layers.
 *
 * MapLibre paint expressions do NOT evaluate CSS `var()` — they run in the GL
 * style context, not the DOM. So we resolve CSS custom properties at runtime
 * via `getComputedStyle`, returning the concrete value (e.g. "#F1F5F9") that
 * MapLibre can use. This lets the indoor layers stay themeable from
 * `globals.css` (light + dark) without hard-coding hexes.
 *
 * Mirrors the legacy helper in `public/CampusMap.tsx` (kept separate to avoid
 * touching the legacy Navigate surface).
 */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
