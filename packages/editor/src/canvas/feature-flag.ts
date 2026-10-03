/**
 * P2-T7: Feature flag for the Canvas editor.
 *
 * When ENABLE_CANVAS_EDITOR is true, the new Canvas-based editor is used.
 * When false, the legacy MapLibre-based editor is used.
 *
 * This flag is consumed by the editor wrapper component to switch between
 * rendering paths. It should be set at build time or via environment
 * variable in production.
 */

/** Enable the Canvas-2D editor (P2). Default: false (legacy MapLibre). */
export const ENABLE_CANVAS_EDITOR = false
