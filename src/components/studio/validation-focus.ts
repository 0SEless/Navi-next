import type {
  CampusDocument,
  CoordinateTransformer,
  Floor,
  LatLng,
  LocalCoord,
} from '@navi/core'
import type { ValidationIssue } from '@navi/editor'
import { deriveRooms } from '@navi/editor/src/geometry/room-derivation'
import { wallsToSegments } from '@navi/editor/src/geometry/wall-to-segment'
import type { Graph } from '@/engine/graph'
import type { ValidationFocus, ValidationFocusGeometry } from '@/types/studio-types'

export type { ValidationFocus, ValidationFocusGeometry } from '@/types/studio-types'

interface FloorScope {
  buildingId: string
  floor: Floor
}

function isFiniteLocal(point: LocalCoord): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function isFiniteWorld(point: LatLng): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng)
}

function worldPoints(points: ReadonlyArray<LatLng>): LatLng[] | null {
  if (points.length === 0 || points.some((point) => !isFiniteWorld(point))) return null
  return points.map((point) => ({ lat: point.lat, lng: point.lng }))
}

function localPointsToWorld(
  points: ReadonlyArray<LocalCoord>,
  buildingId: string,
  transformer: CoordinateTransformer,
): LatLng[] | null {
  if (points.length === 0 || points.some((point) => !isFiniteLocal(point))) return null
  const converted: LatLng[] = []
  for (const point of points) {
    const world = transformer.buildingLocalToWorld(point, buildingId)
    if (!world || !isFiniteWorld(world)) return null
    converted.push({ lat: world.lat, lng: world.lng })
  }
  return converted
}

function scopedFloors(document: CampusDocument, issue: ValidationIssue): FloorScope[] {
  const scopes: FloorScope[] = []
  for (const building of document.buildings ?? []) {
    if (issue.buildingId && issue.buildingId !== building.id) continue
    for (const floor of building.floors ?? []) {
      if (issue.floorId && issue.floorId !== floor.id) continue
      scopes.push({ buildingId: building.id, floor })
    }
  }
  return scopes
}

function makeFocus(
  issue: ValidationIssue,
  target: ValidationIssue['targets'][number],
  geometry: ValidationFocusGeometry,
  scope: { buildingId?: string; floor?: number } = {},
): ValidationFocus {
  return {
    issueId: issue.issueId,
    targetId: target.entityId,
    targetType: target.entityType,
    buildingId: scope.buildingId ?? issue.buildingId,
    floor: scope.floor,
    layer: issue.layer,
    geometry,
  }
}

function authoredRoomGeometry(
  floor: Floor,
  targetId: string,
  buildingId: string,
  transformer: CoordinateTransformer,
): ValidationFocusGeometry | null {
  const legacyRoom = floor.rooms?.find((room) => room.id === targetId)
  if (legacyRoom) {
    const points = localPointsToWorld(legacyRoom.polygon.points, buildingId, transformer)
    return points && points.length >= 3 ? { kind: 'polygon', points } : null
  }

  const attributes = floor.roomAttributes?.find((room) => room.roomId === targetId || room.faceId === targetId)
  if (!attributes || !floor.walls || floor.walls.length === 0) return null

  try {
    const derivedRoom = deriveRooms(wallsToSegments(floor.walls), [])
      .find((room) => room.faceId === attributes.faceId)
    if (!derivedRoom) return null
    const points = localPointsToWorld(derivedRoom.polygon.points, buildingId, transformer)
    return points && points.length >= 3 ? { kind: 'polygon', points } : null
  } catch {
    return null
  }
}

function resolveAuthoredTarget(
  target: ValidationIssue['targets'][number],
  document: CampusDocument,
  issue: ValidationIssue,
  transformer: CoordinateTransformer,
): ValidationFocus | null {
  if (target.entityType === 'building') {
    const building = document.buildings?.find((candidate) => candidate.id === target.entityId)
    const points = building ? worldPoints(building.footprint?.points ?? []) : null
    return points && points.length >= 3
      ? makeFocus(issue, target, { kind: 'polygon', points }, { buildingId: building?.id })
      : null
  }

  if (target.entityType === 'road') {
    const road = document.roads?.find((candidate) => candidate.id === target.entityId)
    const points = road ? worldPoints(road.polyline?.points ?? []) : null
    return points && points.length >= 2 ? makeFocus(issue, target, { kind: 'line', points }) : null
  }

  if (target.entityType === 'area') {
    const area = document.areas?.find((candidate) => candidate.id === target.entityId)
    const points = area ? worldPoints(area.points) : null
    return points && points.length >= 3 ? makeFocus(issue, target, { kind: 'polygon', points }) : null
  }

  for (const scope of scopedFloors(document, issue)) {
    const { floor, buildingId } = scope
    const scoped = { buildingId, floor: floor.level }

    if (target.entityType === 'floor' && floor.id === target.entityId) {
      const building = document.buildings.find((candidate) => candidate.id === buildingId)
      const points = building ? worldPoints(building.footprint?.points ?? []) : null
      if (points && points.length >= 3) return makeFocus(issue, target, { kind: 'polygon', points }, scoped)
    }

    if (target.entityType === 'room') {
      const geometry = authoredRoomGeometry(floor, target.entityId, buildingId, transformer)
      if (geometry) return makeFocus(issue, target, geometry, scoped)
    }

    if (target.entityType === 'entrance') {
      const entrance = floor.entrances?.find((candidate) => candidate.id === target.entityId)
      const position = entrance
        ? localPointsToWorld([entrance.position], buildingId, transformer)?.[0]
        : undefined
      if (position) return makeFocus(issue, target, { kind: 'point', position }, scoped)
    }

    if (target.entityType === 'wall') {
      const wall = floor.walls?.find((candidate) => candidate.id === target.entityId)
      const points = wall
        ? localPointsToWorld([wall.start, wall.end], buildingId, transformer)
        : null
      if (points && points.length === 2) return makeFocus(issue, target, { kind: 'line', points }, scoped)
    }

    if (target.entityType === 'hallway') {
      const hallway = floor.hallways?.find((candidate) => candidate.id === target.entityId)
      const points = hallway
        ? localPointsToWorld(hallway.polyline.points, buildingId, transformer)
        : null
      if (points && points.length >= 2) return makeFocus(issue, target, { kind: 'line', points }, scoped)
    }

    if (target.entityType === 'connector_stop') {
      const stop = floor.connectorStops?.find((candidate) => candidate.id === target.entityId)
      const position = stop
        ? localPointsToWorld([stop.position], buildingId, transformer)?.[0]
        : undefined
      if (position) return makeFocus(issue, target, { kind: 'point', position }, scoped)
    }

    if (target.entityType === 'staircase' || target.entityType === 'elevator') {
      const feature = target.entityType === 'staircase'
        ? floor.staircases?.find((candidate) => candidate.id === target.entityId)
        : floor.elevators?.find((candidate) => candidate.id === target.entityId)
      const position = feature
        ? localPointsToWorld([feature.position], buildingId, transformer)?.[0]
        : undefined
      if (position) return makeFocus(issue, target, { kind: 'point', position }, scoped)
    }

    if (target.entityType === 'qr' || target.entityType === 'checkpoint') {
      const checkpoint = document.qrCheckpoints?.find((candidate) => candidate.id === target.entityId)
      const position = checkpoint
        ? localPointsToWorld([checkpoint.position], buildingId, transformer)?.[0]
        : undefined
      if (position) return makeFocus(issue, target, { kind: 'point', position }, scoped)
    }

    if (target.entityType === 'panorama') {
      const panorama = document.panoramas?.find((candidate) => candidate.id === target.entityId)
      if (panorama) {
        const position = 'lat' in panorama.position
          ? panorama.position
          : localPointsToWorld([panorama.position], buildingId, transformer)?.[0]
        if (position && isFiniteWorld(position)) {
          return makeFocus(issue, target, { kind: 'point', position: { lat: position.lat, lng: position.lng } }, scoped)
        }
      }
    }
  }

  return null
}

function resolveGraphTarget(
  target: ValidationIssue['targets'][number],
  issue: ValidationIssue,
  graph: Graph,
): ValidationFocus | null {
  if (target.entityType === 'route-node') {
    // Validation rules report the authored RouteNetwork ID. The legacy graph
    // projection prefixes that ID, while retaining it in metadata for lookup.
    const node = graph.getNode(target.entityId)
      ?? graph.getNode(`N-route-${target.entityId}`)
      ?? graph.nodes.find((candidate) => candidate.metadata?.routeNodeId === target.entityId)
    if (!node || !isFiniteWorld(node.position)) return null
    return makeFocus(issue, target, {
      kind: 'point',
      position: { lat: node.position.lat, lng: node.position.lng },
    }, {
      buildingId: node.buildingId || issue.buildingId,
      floor: node.floor,
    })
  }

  if (target.entityType === 'route-edge') {
    // Route edges use the same authored-ID → projected-ID convention as
    // nodes, but their raw ID is not copied into edge metadata.
    const edge = graph.getEdge(target.entityId)
      ?? graph.getEdge(`E-route-${target.entityId}`)
    const from = edge ? graph.getNode(edge.from) : undefined
    const to = edge ? graph.getNode(edge.to) : undefined
    if (!from || !to || !isFiniteWorld(from.position) || !isFiniteWorld(to.position)) return null
    const sameFloor = from.floor === to.floor
    const sameBuilding = from.buildingId === to.buildingId
    return makeFocus(issue, target, {
      kind: 'line',
      points: [
        { lat: from.position.lat, lng: from.position.lng },
        { lat: to.position.lat, lng: to.position.lng },
      ],
    }, {
      buildingId: issue.buildingId ?? (sameBuilding ? from.buildingId : undefined),
      floor: sameFloor ? from.floor : undefined,
    })
  }

  return null
}

export function resolveValidationFocus(
  issue: ValidationIssue,
  document: CampusDocument,
  graph: Graph,
  transformer: CoordinateTransformer,
): ValidationFocus | null {
  for (const target of issue.targets) {
    const graphFocus = resolveGraphTarget(target, issue, graph)
    if (graphFocus) return graphFocus

    const authoredFocus = resolveAuthoredTarget(target, document, issue, transformer)
    if (authoredFocus) return authoredFocus
  }
  return null
}
