// ── Coordinate System ──
// Per-entity coordinate storage as defined in ADR-0007.
// World coordinates (WGS84) for outdoor entities, building-local meters for indoor.

export interface LatLng {
  lat: number  // -90 to 90
  lng: number  // -180 to 180
}

export interface LatLngElevation extends LatLng {
  elevation: number  // meters above sea level
}

export interface LocalCoord {
  x: number  // meters east from building origin
  y: number  // meters north from building origin
}

// ── Typed geometry containers ──

export interface WorldPolygon {
  points: LatLng[]  // closed ring: first === last
}

export interface LocalPolygon {
  points: LocalCoord[]  // closed ring: first === last
}

export interface WorldPolyline {
  points: LatLng[]  // ordered, at least 2
}

export interface LocalPolyline {
  points: LocalCoord[]  // ordered, at least 2
}

// ── Value equality helpers ──

export function latLngEquals(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng
}

export function localCoordEquals(a: LocalCoord, b: LocalCoord): boolean {
  return a.x === b.x && a.y === b.y
}

// ── Floor Plan Alignment ──
// W12B: Canonical alignment type. The app's computeFloorPlanCoords uses this
// structure. All layers that store or consume alignment must be structurally
// compatible with this interface.

export interface PlanAlignment {
  /** Translation in building-local meters (applied after local-axis scale and rotation). */
  offset?: { x: number; y: number }
  /** Dimensionless legacy multiplier relative to the footprint-bbox fit. Read compatibility only when axes are present. */
  scale?: number
  /** Dimensionless multiplier for the image-local X axis. */
  scaleX?: number
  /** Dimensionless multiplier for the image-local Y axis. */
  scaleY?: number
  /** Rotation in degrees clockwise (after local-axis scale). */
  rotation?: number
  /** Render opacity only — no geometric effect. */
  opacity?: number
  /** Reference-image transform lock; distinct from Floor.locked. */
  locked?: boolean
}
