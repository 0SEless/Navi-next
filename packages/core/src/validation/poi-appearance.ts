import type {
  OutdoorPointOfInterest,
  PointOfInterest,
  PointOfInterestAppearance,
  PointOfInterestAppearanceMode,
  PointOfInterestGeometry,
  WorldPOIGeometry,
} from '../types'
import { resolvePointOfInterestGeometry } from './poi-geometry'

export const DEFAULT_POI_2_5D_HEIGHT = 3.5
export const MAX_POI_2_5D_HEIGHT = 100

export type PointOfInterestAppearanceValidation =
  | { valid: true }
  | { valid: false; error: string }

const APPEARANCE_MODES: readonly PointOfInterestAppearanceMode[] = ['marker', '2d', '2.5d']
const SHAPE_GEOMETRY_TYPES = new Set(['circle', 'rectangle', 'polygon'])

/**
 * Validate the additive visual contract against the POI's canonical geometry.
 *
 * The same rules apply to indoor (floor-local) and outdoor (world) geometry —
 * only the discriminant is consulted, so point stays marker-only and shapes
 * stay 2d/2.5d in both scopes.
 */
export function validatePointOfInterestAppearance(
  value: unknown,
  geometry: PointOfInterestGeometry | WorldPOIGeometry | { type: string },
): PointOfInterestAppearanceValidation {
  if (value === undefined) return { valid: true }
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'POI appearance must be an object' }
  }

  const appearance = value as Record<string, unknown>
  if (!APPEARANCE_MODES.includes(appearance.mode as PointOfInterestAppearanceMode)) {
    return { valid: false, error: 'POI appearance mode must be marker, 2d, or 2.5d' }
  }
  if (appearance.color !== undefined) {
    if (typeof appearance.color !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(appearance.color)) {
      return { valid: false, error: 'POI appearance color must be a #RGB or #RRGGBB hex string' }
    }
  }

  const mode = appearance.mode as PointOfInterestAppearanceMode
  const isPoint = geometry.type === 'point'
  const isShape = SHAPE_GEOMETRY_TYPES.has(geometry.type)
  if (isPoint && mode !== 'marker') {
    return { valid: false, error: 'Point POIs support only the marker appearance' }
  }
  if (isShape && mode === 'marker') {
    return { valid: false, error: 'Shape POIs support only 2d or 2.5d appearance' }
  }

  if (mode !== '2.5d') {
    if (appearance.height !== undefined) {
      return { valid: false, error: 'POI appearance height is only valid for 2.5d mode' }
    }
    return { valid: true }
  }

  if (appearance.height === undefined) return { valid: true }
  if (typeof appearance.height !== 'number' || !Number.isFinite(appearance.height)) {
    return { valid: false, error: 'POI 2.5d height must be finite' }
  }
  if (appearance.height <= 0 || appearance.height > MAX_POI_2_5D_HEIGHT) {
    return { valid: false, error: `POI 2.5d height must be greater than zero and at most ${MAX_POI_2_5D_HEIGHT} meters` }
  }
  return { valid: true }
}

/** Resolve legacy/omitted appearance without mutating or migrating the POI. */
export function resolvePointOfInterestAppearance(poi: PointOfInterest): PointOfInterestAppearance | null {
  const geometry = resolvePointOfInterestGeometry(poi)
  if (!geometry) return null
  return resolveAppearanceForGeometry(geometry.type, poi.appearance)
}

/** Resolve the additive appearance for an outdoor/campus POI (world geometry). */
export function resolveOutdoorPointOfInterestAppearance(poi: OutdoorPointOfInterest): PointOfInterestAppearance | null {
  return resolveAppearanceForGeometry(poi.geometry.type, poi.appearance)
}

function resolveAppearanceForGeometry(
  geometryType: PointOfInterestGeometry['type'],
  stored: PointOfInterestAppearance | undefined,
): PointOfInterestAppearance | null {
  const validation = validatePointOfInterestAppearance(stored, { type: geometryType })
  if (!validation.valid) return null

  if (stored === undefined) {
    return geometryType === 'point' ? { mode: 'marker' } : { mode: '2d' }
  }
  const color = stored.color !== undefined ? { color: stored.color } : {}
  if (stored.mode === '2.5d') {
    return { mode: stored.mode, height: stored.height ?? DEFAULT_POI_2_5D_HEIGHT, ...color }
  }
  return { mode: stored.mode, ...color }
}
