import type { Wall, LocalCoord } from '@navi/core'

/**
 * VERTICAL CONTRACT (floor-elevation audit, Phase A)
 * See spec/FLOOR-ELEVATION-ACTIVE-FLOW.md.
 *
 * - `Floor.elevation` is the authoritative STACKING datum: meters above the
 *   building ground plane, derived by `recalculateBuilding` (lowest level = 0,
 *   accumulating floor heights). It is consumed by multi-floor stacking
 *   contexts only (publisher package builder, runtime floor geometry,
 *   published POI extrusion `base_elevation = baseElevation + elevation`).
 * - A view that renders exactly one floor (Studio floor editor, Navigate's
 *   active floor) presents that floor in its own base plane, so the plane
 *   every renderable is pinned to — wall extrusion base, room / derived-room /
 *   door / route extrusions, floor-plan raster, 2D overlays — is this
 *   presentation datum. Passing `FLOOR_PRESENTATION_DATUM` to
 *   `wallsToExtrusionCollection` keeps wall bases aligned with the rest of the
 *   floor representation. Never compensate with ad-hoc Z offsets (+3m,
 *   level*3, base slabs) and never mutate `Floor.elevation` for rendering.
 */
export const FLOOR_PRESENTATION_DATUM = 0

/**
 * W13A: Convert a Wall (building-local meters) into a 4-corner GeoJSON Polygon
 * representing the wall footprint for fill-extrusion rendering.
 *
 * The polygon is offset perpendicular to the wall direction by thickness/2 on
 * each side. Coordinates remain in building-local meters — the caller must
 * transform to world LatLng before passing to MapLibre.
 */
export function wallToPolygon(wall: Wall): GeoJSON.Polygon {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const len = Math.sqrt(dx * dx + dy * dy)

  // Degenerate wall: return a point-sized polygon
  if (len < 1e-10) {
    const p = wall.start
    const t = wall.thickness / 2
    const coords: [number, number][] = [
      [p.x - t, p.y - t],
      [p.x + t, p.y - t],
      [p.x + t, p.y + t],
      [p.x - t, p.y + t],
      [p.x - t, p.y - t],
    ]
    return { type: 'Polygon', coordinates: [coords] }
  }

  // Perpendicular unit normal (right-hand side of start→end)
  const nx = -dy / len
  const ny = dx / len

  const half = wall.thickness / 2

  // Four corners: offset start and end by ±half perpendicular
  const s1: LocalCoord = { x: wall.start.x + nx * half, y: wall.start.y + ny * half }
  const s2: LocalCoord = { x: wall.start.x - nx * half, y: wall.start.y - ny * half }
  const e1: LocalCoord = { x: wall.end.x + nx * half, y: wall.end.y + ny * half }
  const e2: LocalCoord = { x: wall.end.x - nx * half, y: wall.end.y - ny * half }

  // Closed ring: s1 → e1 → e2 → s2 → s1
  const coords: [number, number][] = [
    [s1.x, s1.y],
    [e1.x, e1.y],
    [e2.x, e2.y],
    [s2.x, s2.y],
    [s1.x, s1.y],
  ]

  return { type: 'Polygon', coordinates: [coords] }
}

/**
 * W13A: Convert a Wall to a GeoJSON Feature with fill-extrusion properties.
 * Properties include `base` (the caller-supplied floor datum — stacking floors
 * pass `floor.elevation`, single-floor views pass `FLOOR_PRESENTATION_DATUM`,
 * see the vertical contract above) and `height = base + wall.height`
 * for MapLibre fill-extrusion-base / fill-extrusion-height.
 */
export function wallToExtrusionFeature(
  wall: Wall,
  floorElevation: number,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      id: wall.id,
      base: floorElevation,
      height: floorElevation + wall.height,
    },
    geometry: wallToPolygon(wall),
  }
}

/**
 * W13A: Convert an array of Walls to a GeoJSON FeatureCollection of extrusion features.
 */
export function wallsToExtrusionCollection(
  walls: Wall[],
  floorElevation: number,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: walls.map((w) => wallToExtrusionFeature(w, floorElevation)),
  }
}
