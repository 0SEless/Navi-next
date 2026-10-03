import type {
  LatLng,
  LocalCoord,
  PoiApproachAnchor,
  PointOfInterestGeometry,
  PointOfInterestNavigation,
  PointOfInterestVisibility,
  WorldPOIGeometry,
} from '../types'

/**
 * Visibility + navigation options shared by indoor and outdoor POIs.
 *
 * Both are additive-optional: absent records resolve to the documented
 * defaults, so legacy documents (and migrated Areas) keep prior behavior.
 */

export const DEFAULT_POI_SHOW_ON_MAP = true
export const DEFAULT_POI_SEARCHABLE = true
export const DEFAULT_POI_APPROACH_MODE: PointOfInterestNavigation['approachMode'] = 'automatic'

const TWO_PI = Math.PI * 2
const METERS_PER_DEGREE_LAT = 111_320

export function resolvePoiVisibility(
  visibility: PointOfInterestVisibility | undefined,
): PointOfInterestVisibility {
  return {
    showOnMap: visibility?.showOnMap ?? DEFAULT_POI_SHOW_ON_MAP,
    searchable: visibility?.searchable ?? DEFAULT_POI_SEARCHABLE,
  }
}

export function validatePoiVisibility(value: unknown): { valid: true } | { valid: false; error: string } {
  if (value === undefined) return { valid: true }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, error: 'POI visibility must be an object' }
  }
  const visibility = value as Record<string, unknown>
  if (typeof visibility.showOnMap !== 'boolean') {
    return { valid: false, error: 'POI visibility.showOnMap must be a boolean' }
  }
  if (typeof visibility.searchable !== 'boolean') {
    return { valid: false, error: 'POI visibility.searchable must be a boolean' }
  }
  return { valid: true }
}

export function resolvePoiApproachMode(
  navigation: PointOfInterestNavigation | undefined,
): PointOfInterestNavigation['approachMode'] {
  return navigation?.approachMode ?? DEFAULT_POI_APPROACH_MODE
}

type GeometryKind = PointOfInterestGeometry['type']

export function validatePoiNavigation(
  value: unknown,
  geometry: { type: GeometryKind },
): { valid: true } | { valid: false; error: string } {
  if (value === undefined) return { valid: true }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, error: 'POI navigation must be an object' }
  }
  const navigation = value as Record<string, unknown>
  if (navigation.approachMode !== 'automatic' && navigation.approachMode !== 'preferred') {
    return { valid: false, error: 'POI navigation.approachMode must be automatic or preferred' }
  }
  if (navigation.anchor === undefined) return { valid: true }
  return validatePoiAnchor(navigation.anchor, geometry.type)
}

export function validatePoiAnchor(
  value: unknown,
  geometry: GeometryKind,
): { valid: true } | { valid: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, error: 'POI anchor must be an object' }
  }
  const anchor = value as Record<string, unknown>

  if (geometry === 'circle') {
    if (anchor.kind !== 'circle-angle') return { valid: false, error: 'Circle POIs require a circle-angle anchor' }
    if (typeof anchor.angle !== 'number' || !Number.isFinite(anchor.angle)) {
      return { valid: false, error: 'Circle anchor angle must be finite' }
    }
    return { valid: true }
  }

  if (geometry === 'rectangle') {
    if (anchor.kind !== 'rectangle-edge') return { valid: false, error: 'Rectangle POIs require a rectangle-edge anchor' }
    if (!Number.isInteger(anchor.edge) || (anchor.edge as number) < 0 || (anchor.edge as number) > 3) {
      return { valid: false, error: 'Rectangle anchor edge must be an integer 0..3' }
    }
    if (typeof anchor.t !== 'number' || !Number.isFinite(anchor.t) || anchor.t < 0 || anchor.t > 1) {
      return { valid: false, error: 'Rectangle anchor t must be between 0 and 1' }
    }
    return { valid: true }
  }

  if (geometry === 'polygon') {
    if (anchor.kind !== 'polygon-edge') return { valid: false, error: 'Polygon POIs require a polygon-edge anchor' }
    if (!Number.isInteger(anchor.edge) || (anchor.edge as number) < 0) {
      return { valid: false, error: 'Polygon anchor edge must be a non-negative integer' }
    }
    if (typeof anchor.t !== 'number' || !Number.isFinite(anchor.t) || anchor.t < 0 || anchor.t > 1) {
      return { valid: false, error: 'Polygon anchor t must be between 0 and 1' }
    }
    return { valid: true }
  }

  return { valid: false, error: 'Point POIs do not accept an approach anchor; the point is the anchor' }
}

// ── Anchor projection (geometry-relative → a position on the shape) ──

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

function metersPerDegreeLng(latitude: number): number {
  return Math.max(Math.cos((latitude * Math.PI) / 180) * METERS_PER_DEGREE_LAT, 1)
}

/** Interpolate a world edge point at parameter t (great-circle-agnostic, local-linear). */
function interpolateWorld(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

function interpolateLocal(a: LocalCoord, b: LocalCoord, t: number): LocalCoord {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function projectWorldPoiAnchor(geometry: WorldPOIGeometry, anchor: PoiApproachAnchor): LatLng | null {
  if (!validatePoiAnchor(anchor, geometry.type).valid) return null

  if (geometry.type === 'point') return null

  if (geometry.type === 'circle' && anchor.kind === 'circle-angle') {
    const angle = normalizeAngle(anchor.angle)
    const metersLng = metersPerDegreeLng(geometry.center.lat)
    // angle 0 = due east; positive angles rotate clockwise on the map.
    return {
      lat: geometry.center.lat + (Math.sin(angle) * geometry.radius) / METERS_PER_DEGREE_LAT,
      lng: geometry.center.lng + (Math.cos(angle) * geometry.radius) / metersLng,
    }
  }

  const points = geometry.points
  if (anchor.kind === 'rectangle-edge' || anchor.kind === 'polygon-edge') {
    const edge = anchor.edge
    if (edge < 0 || edge >= points.length) return null
    const next = points[(edge + 1) % points.length]
    return interpolateWorld(points[edge], next, clamp01(anchor.t))
  }

  return null
}

function localRectangleCorners(geometry: Extract<PointOfInterestGeometry, { type: 'rectangle' }>): LocalCoord[] {
  return [
    { x: geometry.min.x, y: geometry.min.y },
    { x: geometry.max.x, y: geometry.min.y },
    { x: geometry.max.x, y: geometry.max.y },
    { x: geometry.min.x, y: geometry.max.y },
  ]
}

export function projectLocalPoiAnchor(geometry: PointOfInterestGeometry, anchor: PoiApproachAnchor): LocalCoord | null {
  if (!validatePoiAnchor(anchor, geometry.type).valid) return null
  if (geometry.type === 'point') return null

  if (geometry.type === 'circle' && anchor.kind === 'circle-angle') {
    const angle = normalizeAngle(anchor.angle)
    return {
      x: geometry.center.x + Math.cos(angle) * geometry.radius,
      y: geometry.center.y + Math.sin(angle) * geometry.radius,
    }
  }

  const points = geometry.type === 'rectangle' ? localRectangleCorners(geometry) : geometry.points
  if (anchor.kind === 'rectangle-edge' || anchor.kind === 'polygon-edge') {
    const edge = anchor.edge
    if (edge < 0 || edge >= points.length) return null
    const next = points[(edge + 1) % points.length]
    return interpolateLocal(points[edge], next, clamp01(anchor.t))
  }

  return null
}

// ── Nearest anchor (used by the Studio "preferred anchor" picker) ──

function nearestOnWorldEdge(point: LatLng, a: LatLng, b: LatLng): { t: number; distance: number } {
  const metersLng = metersPerDegreeLng((a.lat + b.lat) / 2)
  const ax = a.lng * metersLng
  const ay = a.lat * METERS_PER_DEGREE_LAT
  const bx = b.lng * metersLng
  const by = b.lat * METERS_PER_DEGREE_LAT
  const px = point.lng * metersLng
  const py = point.lat * METERS_PER_DEGREE_LAT
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared)
  const cx = ax + dx * t
  const cy = ay + dy * t
  return { t, distance: Math.hypot(px - cx, py - cy) }
}

export function nearestWorldPoiAnchor(
  geometry: WorldPOIGeometry,
  point: LatLng,
): { anchor: PoiApproachAnchor; position: LatLng } | null {
  if (geometry.type === 'point') return null

  if (geometry.type === 'circle') {
    const metersLng = metersPerDegreeLng(geometry.center.lat)
    const dx = (point.lng - geometry.center.lng) * metersLng
    const dy = (point.lat - geometry.center.lat) * METERS_PER_DEGREE_LAT
    const angle = normalizeAngle(Math.atan2(dy, dx))
    return { anchor: { kind: 'circle-angle', angle }, position: projectWorldPoiAnchor(geometry, { kind: 'circle-angle', angle })! }
  }

  const points = geometry.points
  let best: { edge: number; t: number; distance: number } | null = null
  for (let edge = 0; edge < points.length; edge++) {
    const candidate = nearestOnWorldEdge(point, points[edge], points[(edge + 1) % points.length])
    if (!best || candidate.distance < best.distance) best = { edge, ...candidate }
  }
  if (!best) return null

  const anchor: PoiApproachAnchor = geometry.type === 'rectangle'
    ? { kind: 'rectangle-edge', edge: (best.edge % 4) as 0 | 1 | 2 | 3, t: best.t }
    : { kind: 'polygon-edge', edge: best.edge, t: best.t }
  return { anchor, position: projectWorldPoiAnchor(geometry, anchor)! }
}

function nearestOnLocalEdge(point: LocalCoord, a: LocalCoord, b: LocalCoord): { t: number; distance: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
  const cx = a.x + dx * t
  const cy = a.y + dy * t
  return { t, distance: Math.hypot(point.x - cx, point.y - cy) }
}

export function nearestLocalPoiAnchor(
  geometry: PointOfInterestGeometry,
  point: LocalCoord,
): { anchor: PoiApproachAnchor; position: LocalCoord } | null {
  if (geometry.type === 'point') return null

  if (geometry.type === 'circle') {
    const angle = normalizeAngle(Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x))
    return { anchor: { kind: 'circle-angle', angle }, position: projectLocalPoiAnchor(geometry, { kind: 'circle-angle', angle })! }
  }

  const points = geometry.type === 'rectangle' ? localRectangleCorners(geometry) : geometry.points
  let best: { edge: number; t: number; distance: number } | null = null
  for (let edge = 0; edge < points.length; edge++) {
    const candidate = nearestOnLocalEdge(point, points[edge], points[(edge + 1) % points.length])
    if (!best || candidate.distance < best.distance) best = { edge, ...candidate }
  }
  if (!best) return null

  const anchor: PoiApproachAnchor = geometry.type === 'rectangle'
    ? { kind: 'rectangle-edge', edge: (best.edge % 4) as 0 | 1 | 2 | 3, t: best.t }
    : { kind: 'polygon-edge', edge: best.edge, t: best.t }
  return { anchor, position: projectLocalPoiAnchor(geometry, anchor)! }
}
