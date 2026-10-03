import type {
  CampusDocument,
  CoordinateTransformer,
  LocalCoord,
  NavigationGraph,
  OutdoorPointOfInterest,
  POI,
  POIIndex,
  PointOfInterest,
  PointOfInterestGeometry,
  RuntimePOIGeometry,
} from '@navi/core'
import {
  CoordinateTransformer as CoordinateTransformerImpl,
  getWorldPointOfInterestRepresentative,
  projectLocalPoiAnchor,
  projectWorldPoiAnchor,
  resolvePoiApproachMode,
  resolvePointOfInterestGeometry,
  validatePointOfInterestGeometry,
  validateWorldPointOfInterestGeometry,
} from '@navi/core'

function footprintCentroid(footprint: { points: Array<{ lat: number; lng: number }> } | undefined): { lat: number; lng: number } | null {
  const points = footprint?.points ?? []
  if (points.length === 0) return null
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function registerDocumentCoordinates(document: CampusDocument, transformer: CoordinateTransformer): void {
  for (const building of document.buildings ?? []) {
    transformer.registerBuilding({
      buildingId: building.id,
      origin: footprintCentroid(building.footprint) ?? { lat: 0, lng: 0 },
      rotation: building.rotation ?? 0,
    })
    for (const floor of building.floors ?? []) {
      transformer.registerFloor(building.id, floor.level, {
        offset: floor.offset ?? { x: 0, y: 0 },
        rotation: floor.rotation ?? 0,
      })
    }
  }
}

function invalidGeometryError(poi: { id: string }, message: string): Error {
  return new Error(`POI_INVALID_GEOMETRY ${poi.id}: ${message}`)
}

function polygonCentroid(points: LocalCoord[]): LocalCoord {
  let twiceArea = 0
  let centroidX = 0
  let centroidY = 0

  for (let index = 0; index < points.length; index++) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    const cross = current.x * next.y - next.x * current.y
    twiceArea += cross
    centroidX += (current.x + next.x) * cross
    centroidY += (current.y + next.y) * cross
  }

  if (twiceArea === 0) {
    throw new Error('polygon has zero area')
  }

  return {
    x: centroidX / (3 * twiceArea),
    y: centroidY / (3 * twiceArea),
  }
}

/** Resolve any authored point/shape to its deterministic local representative. */
export function getPointOfInterestRepresentative(poi: PointOfInterest): LocalCoord {
  const geometry = resolvePointOfInterestGeometry(poi)
  if (!geometry) throw invalidGeometryError(poi, 'geometry is missing')

  const validation = validatePointOfInterestGeometry(geometry)
  if (!validation.valid) throw invalidGeometryError(poi, validation.error)

  switch (geometry.type) {
    case 'point':
      return { ...geometry.position }
    case 'circle':
      return { ...geometry.center }
    case 'rectangle':
      return {
        x: (geometry.min.x + geometry.max.x) / 2,
        y: (geometry.min.y + geometry.max.y) / 2,
      }
    case 'polygon':
      return polygonCentroid(geometry.points)
  }
}

function transformLocal(
  transformer: CoordinateTransformer,
  position: LocalCoord,
  buildingId: string,
  floor: number,
  poiId: string,
): { lat: number; lng: number } {
  const world = transformer.floorLocalToWorld(position, buildingId, floor)
  if (!world) {
    throw new Error(`POI_COORDINATE_TRANSFORM_FAILED ${poiId}: no registered transform for ${buildingId}/${floor}`)
  }
  return { ...world }
}

function transformGeometry(
  geometry: PointOfInterestGeometry,
  transformer: CoordinateTransformer,
  buildingId: string,
  floor: number,
  poiId: string,
): RuntimePOIGeometry {
  switch (geometry.type) {
    case 'point':
      return { type: 'point', position: transformLocal(transformer, geometry.position, buildingId, floor, poiId) }
    case 'circle':
      return {
        type: 'circle',
        center: transformLocal(transformer, geometry.center, buildingId, floor, poiId),
        radius: geometry.radius,
      }
    case 'rectangle': {
      const corners = [
        { x: geometry.min.x, y: geometry.min.y },
        { x: geometry.max.x, y: geometry.min.y },
        { x: geometry.max.x, y: geometry.max.y },
        { x: geometry.min.x, y: geometry.max.y },
      ]
      return {
        type: 'rectangle',
        points: corners.map(corner => transformLocal(transformer, corner, buildingId, floor, poiId)),
      }
    }
    case 'polygon':
      return {
        type: 'polygon',
        points: geometry.points.map(point => transformLocal(transformer, point, buildingId, floor, poiId)),
      }
  }
}

function projectAuthoredPOI(
  poi: PointOfInterest,
  buildingId: string,
  floor: { id: string; level: number },
  transformer: CoordinateTransformer,
): POI {
  const geometry = resolvePointOfInterestGeometry(poi)
  if (!geometry) throw invalidGeometryError(poi, 'geometry is missing')
  const validation = validatePointOfInterestGeometry(geometry)
  if (!validation.valid) throw invalidGeometryError(poi, validation.error)

  const representative = transformLocal(
    transformer,
    getPointOfInterestRepresentative(poi),
    buildingId,
    floor.level,
    poi.id,
  )

  // Preferred approach: the authored anchor is geometry-relative, so its world
  // position is resolved against the current geometry on every projection.
  let approach: { mode: 'preferred'; position: { lat: number; lng: number } } | null = null
  if (resolvePoiApproachMode(poi.navigation) === 'preferred' && geometry.type !== 'point' && poi.navigation?.anchor) {
    const anchorLocal = projectLocalPoiAnchor(geometry, poi.navigation.anchor)
    if (anchorLocal) {
      approach = { mode: 'preferred', position: transformLocal(transformer, anchorLocal, buildingId, floor.level, poi.id) }
    }
  }

  return {
    id: poi.id,
    label: poi.name,
    category: poi.category,
    position: representative,
    buildingId,
    floor: floor.level,
    floorId: floor.id,
    properties: { ...(poi.metadata ?? {}) },
    source: 'authored',
    sourceId: poi.id,
    geometry: transformGeometry(geometry, transformer, buildingId, floor.level, poi.id),
    ...(poi.appearance !== undefined ? { appearance: structuredClone(poi.appearance) } : {}),
    ...(poi.visibility !== undefined ? { visibility: structuredClone(poi.visibility) } : {}),
    ...(approach ? { approach } : {}),
  }
}

/**
 * Project an outdoor/campus POI (world geometry) into the shared runtime index.
 * No coordinate transform is involved: the authored world geometry is the
 * runtime geometry contract, so outdoor records publish verbatim with an
 * explicit scope marker and no building/floor/node identity.
 */
function projectOutdoorPOI(poi: OutdoorPointOfInterest): POI {
  const validation = validateWorldPointOfInterestGeometry(poi.geometry)
  if (!validation.valid) throw invalidGeometryError(poi, validation.error)

  let approach: { mode: 'preferred'; position: { lat: number; lng: number } } | null = null
  if (resolvePoiApproachMode(poi.navigation) === 'preferred' && poi.geometry.type !== 'point' && poi.navigation?.anchor) {
    const position = projectWorldPoiAnchor(poi.geometry, poi.navigation.anchor)
    if (position) approach = { mode: 'preferred', position }
  }

  return {
    id: poi.id,
    label: poi.name,
    category: poi.category,
    position: getWorldPointOfInterestRepresentative(poi.geometry),
    properties: { ...(poi.metadata ?? {}) },
    source: 'authored',
    sourceId: poi.id,
    scope: 'outdoor',
    geometry: structuredClone(poi.geometry),
    ...(poi.appearance !== undefined ? { appearance: structuredClone(poi.appearance) } : {}),
    ...(poi.visibility !== undefined ? { visibility: structuredClone(poi.visibility) } : {}),
    ...(approach ? { approach } : {}),
  }
}

function projectGraphPOI(node: NavigationGraph['nodes'][number]): POI {
  const position = { ...node.position }
  return {
    id: `${node.id}_poi`,
    label: node.label || '',
    category: node.label || 'poi',
    position,
    buildingId: node.buildingId,
    floor: node.floor,
    nodeId: node.id,
    properties: {},
    source: 'graph-derived',
    sourceId: node.id,
    geometry: { type: 'point', position: { ...position } },
  }
}

/** Build the single derived runtime POI index from graph compatibility data and authored Floor.pois. */
export function buildPOIIndex(navGraph: NavigationGraph, document: CampusDocument): POIIndex {
  const transformer = new CoordinateTransformerImpl()
  registerDocumentCoordinates(document, transformer)
  const points: POI[] = []
  const usedIds = new Set<string>()

  for (const node of navGraph.nodes.filter(node => node.type === 'poi')) {
    const point = projectGraphPOI(node)
    if (usedIds.has(point.id)) {
      throw new Error(`POI_ID_COLLISION ${point.id}: duplicate graph-derived POI id`)
    }
    usedIds.add(point.id)
    points.push(point)
  }

  for (const building of document.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      for (const poi of floor.pois ?? []) {
        if (usedIds.has(poi.id)) {
          throw new Error(`POI_ID_COLLISION ${poi.id}: authored POI id is already in use`)
        }
        usedIds.add(poi.id)
        points.push(projectAuthoredPOI(poi, building.id, floor, transformer))
      }
    }
  }

  // Outdoor/campus POIs share the same derived index and identity space.
  // Appended after graph-derived and indoor records so existing documents keep
  // their deterministic ordering.
  for (const poi of document.pois ?? []) {
    if (usedIds.has(poi.id)) {
      throw new Error(`POI_ID_COLLISION ${poi.id}: authored POI id is already in use`)
    }
    usedIds.add(poi.id)
    points.push(projectOutdoorPOI(poi))
  }

  return { version: '1.0.0', points }
}
